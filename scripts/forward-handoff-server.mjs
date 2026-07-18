#!/usr/bin/env node

import { createHash, randomUUID, timingSafeEqual } from "node:crypto";
import { createServer } from "node:http";
import {
  appendFile,
  mkdir,
  mkdtemp,
  readFile,
  rm,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";

import { publishPackageHandoff } from "./publish-forward-package.mjs";

const PUBLICATION_SCHEMA = "forward-dynatrace-handoff-publication/v1";
const RECEIPT_SCHEMA = "forward-dynatrace-handoff-receipt/v1";
const ALLOWED_FILES = new Set([
  "forward-dynatrace-manifest.json",
  "forward-intent-checks.json",
  "forward-nqe-checks.json",
  "forward-nqe-diff-requests.json",
  "forward-dynatrace-package.sig",
]);
const REQUIRED_FILES = new Set([
  "forward-dynatrace-manifest.json",
  "forward-intent-checks.json",
]);
const DEFAULT_BODY_LIMIT = 10 * 1024 * 1024;
const DEFAULT_PORT = 8090;

const canonicalJson = (value) => `${JSON.stringify(value, null, 2)}\n`;
const sha256 = (value) => createHash("sha256").update(value).digest("hex");
const safePackageId = (value) => {
  if (typeof value !== "string" || !/^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/u.test(value)) {
    throw new HttpError(400, "packageId must be a path-safe identifier.");
  }
  return value;
};

class HttpError extends Error {
  constructor(statusCode, message) {
    super(message);
    this.statusCode = statusCode;
  }
}

const requiredString = (value, label, maxLength = 2048) => {
  const normalized = typeof value === "string" ? value.trim() : "";
  if (!normalized) throw new HttpError(400, `${label} must be a non-empty string.`);
  if (normalized.length > maxLength) throw new HttpError(400, `${label} exceeds ${maxLength} characters.`);
  return normalized;
};

const assertKnownKeys = (value, allowed, label) => {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new HttpError(400, `${label} must be a JSON object.`);
  }
  const unknown = Object.keys(value).filter((key) => !allowed.has(key));
  if (unknown.length > 0) {
    throw new HttpError(400, `${label} contains unsupported fields: ${unknown.join(", ")}.`);
  }
};

const decodeBase64 = (value, label) => {
  const text = requiredString(value, `${label}.contentBase64`, DEFAULT_BODY_LIMIT);
  if (!/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/u.test(text)) {
    throw new HttpError(400, `${label}.contentBase64 is not canonical base64.`);
  }
  const bytes = Buffer.from(text, "base64");
  if (bytes.toString("base64") !== text) {
    throw new HttpError(400, `${label}.contentBase64 is not canonical base64.`);
  }
  return bytes;
};

const decodeUtf8 = (bytes, label) => {
  try {
    return new TextDecoder("utf-8", { fatal: true }).decode(bytes);
  } catch {
    throw new HttpError(400, `${label} is not valid UTF-8.`);
  }
};

export const validateHandoffPublication = (value, { retentionClass }) => {
  assertKnownKeys(
    value,
    new Set(["schemaVersion", "packageId", "generatedAt", "retentionClass", "files"]),
    "handoff publication",
  );
  if (value.schemaVersion !== PUBLICATION_SCHEMA) {
    throw new HttpError(400, `schemaVersion must be ${PUBLICATION_SCHEMA}.`);
  }
  const packageId = safePackageId(value.packageId);
  const generatedAt = requiredString(value.generatedAt, "generatedAt", 64);
  if (!Number.isFinite(Date.parse(generatedAt))) throw new HttpError(400, "generatedAt must be an ISO date-time.");
  const requestedRetention = requiredString(value.retentionClass, "retentionClass", 128);
  if (requestedRetention !== retentionClass) {
    throw new HttpError(409, "retentionClass does not match the handoff service policy.");
  }
  if (!Array.isArray(value.files) || value.files.length < 2 || value.files.length > ALLOWED_FILES.size) {
    throw new HttpError(400, "files must contain the complete bounded package.");
  }
  const files = new Map();
  for (let index = 0; index < value.files.length; index += 1) {
    const file = value.files[index];
    const label = `files[${index}]`;
    assertKnownKeys(file, new Set(["name", "sha256", "contentBase64"]), label);
    const name = requiredString(file.name, `${label}.name`, 128);
    if (!ALLOWED_FILES.has(name)) throw new HttpError(400, `${label}.name is unsupported.`);
    if (files.has(name)) throw new HttpError(400, `Duplicate package file: ${name}.`);
    const expectedSha256 = requiredString(file.sha256, `${label}.sha256`, 64);
    if (!/^[a-f0-9]{64}$/u.test(expectedSha256)) {
      throw new HttpError(400, `${label}.sha256 must be a lowercase SHA-256 digest.`);
    }
    const bytes = decodeBase64(file.contentBase64, label);
    if (sha256(bytes) !== expectedSha256) throw new HttpError(400, `${name} checksum mismatch.`);
    files.set(name, bytes);
  }
  for (const name of REQUIRED_FILES) {
    if (!files.has(name)) throw new HttpError(400, `Missing required package file: ${name}.`);
  }
  let manifest;
  try {
    manifest = JSON.parse(decodeUtf8(
      files.get("forward-dynatrace-manifest.json"),
      "forward-dynatrace-manifest.json",
    ));
  } catch {
    throw new HttpError(400, "forward-dynatrace-manifest.json is not valid UTF-8 JSON.");
  }
  for (const [name, bytes] of files) {
    if (name.endsWith(".json")) decodeUtf8(bytes, name);
  }
  if (manifest.packageId !== packageId || manifest.generatedAt !== generatedAt) {
    throw new HttpError(409, "Publication identity does not match the manifest.");
  }
  for (const [manifestKey, fileName] of [
    ["nqeChecks", "forward-nqe-checks.json"],
    ["nqeDiffRequests", "forward-nqe-diff-requests.json"],
  ]) {
    const referenced = manifest.artifacts?.[manifestKey] === fileName;
    if (files.has(fileName) !== referenced) {
      throw new HttpError(400, `${fileName} membership must match the manifest artifact reference.`);
    }
  }
  return { packageId, generatedAt, retentionClass: requestedRetention, files };
};

const publicRoot = (value) => {
  const url = new URL(value);
  if (url.protocol !== "https:" || url.username || url.password || url.search || url.hash) {
    throw new Error("FORWARD_HANDOFF_PUBLIC_BASE_URL must be an HTTPS origin or path without credentials/query/fragment.");
  }
  return url.toString().replace(/\/+$/u, "");
};

const accessEvent = ({ id = randomUUID(), now, operation, status, packageId = null, file = null }) => ({
  schemaVersion: "forward-dynatrace-handoff-access/v1",
  accessLogId: id,
  timestamp: now(),
  operation,
  status,
  packageId,
  file,
});

export const createHandoffService = ({
  handoffRoot,
  publicBaseUrl,
  retentionClass,
  requireSignature = false,
  maxPackageAgeMinutes = 60,
  accessLogPath = null,
  now = () => new Date().toISOString(),
} = {}) => {
  const root = path.resolve(handoffRoot);
  const baseUrl = publicRoot(publicBaseUrl);
  const policy = requiredString(retentionClass, "retentionClass", 128);
  const logPath = path.resolve(accessLogPath || path.join(root, "access.jsonl"));

  const logAccess = async (details) => {
    const event = accessEvent({ now, ...details });
    await mkdir(path.dirname(logPath), { recursive: true, mode: 0o700 });
    await appendFile(logPath, `${JSON.stringify(event)}\n`, { mode: 0o600 });
    return event;
  };

  const publish = async (publication, idempotencyKey) => {
    const validated = validateHandoffPublication(publication, { retentionClass: policy });
    if (idempotencyKey !== `forward-dynatrace:${validated.packageId}`) {
      throw new HttpError(409, "Idempotency-Key does not match the package ID.");
    }
    const sourceDir = await mkdtemp(path.join(tmpdir(), "forward-handoff-ingress-"));
    try {
      for (const [name, bytes] of validated.files) {
        await writeFile(path.join(sourceDir, name), bytes, { mode: 0o600 });
      }
      let result;
      try {
        result = await publishPackageHandoff({
          packageDir: sourceDir,
          handoffRoot: root,
          requireSignature,
          maxPackageAgeMinutes,
        });
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        throw new HttpError(/conflict/iu.test(message) ? 409 : 400, message);
      }
      const event = await logAccess({
        operation: "publish",
        status: result.created ? "published" : "existing",
        packageId: validated.packageId,
      });
      return {
        schemaVersion: RECEIPT_SCHEMA,
        status: result.created ? "published" : "existing",
        packageId: validated.packageId,
        receivedAt: event.timestamp,
        manifestSha256: sha256(validated.files.get("forward-dynatrace-manifest.json")),
        files: result.files,
        immutableUrl: `${baseUrl}/v1/packages/${encodeURIComponent(validated.packageId)}/`,
        latestUrl: `${baseUrl}/v1/packages/latest/`,
        retentionClass: policy,
        accessLogId: event.accessLogId,
      };
    } finally {
      await rm(sourceDir, { recursive: true, force: true });
    }
  };

  const read = async ({ packageId, file }) => {
    const safeFile = requiredString(file, "file", 128);
    if (!ALLOWED_FILES.has(safeFile)) throw new HttpError(404, "Unknown package file.");
    const packageSegment = packageId === "latest" ? "latest" : safePackageId(packageId);
    const filePath = packageSegment === "latest"
      ? path.join(root, "latest", safeFile)
      : path.join(root, "packages", packageSegment, safeFile);
    let bytes;
    try {
      bytes = await readFile(filePath);
    } catch (error) {
      if (error?.code === "ENOENT") throw new HttpError(404, "Package file not found.");
      throw error;
    }
    const event = await logAccess({
      operation: "read",
      status: "allowed",
      packageId: packageSegment,
      file: safeFile,
    });
    return { bytes, accessLogId: event.accessLogId };
  };

  return { publish, read, logAccess, accessLogPath: logPath };
};

const constantTimeEqual = (left, right) => {
  const a = Buffer.from(String(left || ""));
  const b = Buffer.from(String(right || ""));
  return a.length === b.length && timingSafeEqual(a, b);
};

const authorized = (header, token) =>
  typeof header === "string" && header.startsWith("Bearer ") &&
  constantTimeEqual(header.slice(7), token);

const binaryFlag = (value, label, defaultValue = false) => {
  if (value === undefined || value === null || value === "") return defaultValue;
  if (String(value) === "1") return true;
  if (String(value) === "0") return false;
  throw new Error(`${label} must be 0 or 1 when set.`);
};

const readTokenFile = async (filePath, label) => {
  const resolved = path.resolve(requiredString(filePath, `${label} file path`, 4096));
  let value;
  try {
    value = await readFile(resolved, "utf8");
  } catch {
    throw new Error(`${label} file could not be read.`);
  }
  return requiredString(value, label, 4096);
};

export const loadHandoffTokens = async (env) => {
  const allowEnvironmentTokens = env.FORWARD_HANDOFF_ALLOW_ENV_TOKENS === "1";
  if (
    env.FORWARD_HANDOFF_ALLOW_ENV_TOKENS !== undefined &&
    !new Set(["0", "1"]).has(String(env.FORWARD_HANDOFF_ALLOW_ENV_TOKENS))
  ) {
    throw new Error("FORWARD_HANDOFF_ALLOW_ENV_TOKENS must be 0 or 1 when set.");
  }
  const load = async (kind) => {
    const prefix = `FORWARD_HANDOFF_${kind}_TOKEN`;
    const direct = typeof env[prefix] === "string" && env[prefix].trim() ? env[prefix] : null;
    const file = typeof env[`${prefix}_FILE`] === "string" && env[`${prefix}_FILE`].trim()
      ? env[`${prefix}_FILE`]
      : null;
    if (direct && file) throw new Error(`${prefix} and ${prefix}_FILE are mutually exclusive.`);
    if (direct && !allowEnvironmentTokens) {
      throw new Error(`${prefix} requires FORWARD_HANDOFF_ALLOW_ENV_TOKENS=1; use ${prefix}_FILE by default.`);
    }
    const token = file
      ? await readTokenFile(file, `Handoff ${kind.toLowerCase()} token`)
      : requiredString(direct, `${prefix}_FILE`, 4096);
    if (token.length < 16) throw new Error(`Handoff ${kind.toLowerCase()} token must contain at least 16 characters.`);
    return token;
  };
  const writeToken = await load("WRITE");
  const readToken = await load("READ");
  if (constantTimeEqual(writeToken, readToken)) {
    throw new Error("Handoff write/read tokens must be distinct.");
  }
  return { writeToken, readToken };
};

const readBody = (request, maxBodyBytes) => new Promise((resolve, reject) => {
  const chunks = [];
  let size = 0;
  let rejected = false;
  request.on("data", (chunk) => {
    size += chunk.length;
    if (size > maxBodyBytes && !rejected) {
      rejected = true;
      chunks.length = 0;
      reject(new HttpError(413, "Request body is too large."));
      return;
    }
    if (!rejected) chunks.push(chunk);
  });
  request.on("end", () => {
    if (!rejected) resolve(Buffer.concat(chunks).toString("utf8"));
  });
  request.on("error", reject);
});

const sendJson = (response, statusCode, value) => {
  response.writeHead(statusCode, {
    "Cache-Control": "no-store",
    "Content-Type": "application/json; charset=utf-8",
  });
  response.end(canonicalJson(value));
};

export const createHandoffRequestHandler = ({
  service,
  writeToken,
  readToken,
  maxBodyBytes = DEFAULT_BODY_LIMIT,
}) => async (request, response) => {
  const requestUrl = new URL(request.url || "/", "http://handoff.local");
  const publishRoute = request.method === "POST" && requestUrl.pathname === "/v1/packages";
  const readRoute = request.method === "GET" && requestUrl.pathname.startsWith("/v1/packages/");
  const auditOperation = publishRoute ? "publish" : readRoute ? "read" : null;
  let failureLogged = false;
  try {
    if (request.method === "GET" && requestUrl.pathname === "/healthz") {
      sendJson(response, 200, { status: "ok", schemaVersion: RECEIPT_SCHEMA });
      return;
    }
    if (publishRoute) {
      if (!authorized(request.headers.authorization, writeToken)) {
        await service.logAccess({ operation: "publish", status: "denied" });
        failureLogged = true;
        throw new HttpError(401, "Unauthorized.");
      }
      let body;
      try {
        body = JSON.parse(await readBody(request, maxBodyBytes));
      } catch (error) {
        if (error instanceof HttpError) throw error;
        throw new HttpError(400, "Request body must be valid JSON.");
      }
      const receipt = await service.publish(body, request.headers["idempotency-key"]);
      sendJson(response, receipt.status === "published" ? 201 : 200, receipt);
      return;
    }
    const match = request.method === "GET"
      ? requestUrl.pathname.match(/^\/v1\/packages\/([^/]+)\/(forward-[A-Za-z0-9.-]+)$/u)
      : null;
    if (match) {
      if (!authorized(request.headers.authorization, readToken)) {
        await service.logAccess({ operation: "read", status: "denied" });
        failureLogged = true;
        throw new HttpError(401, "Unauthorized.");
      }
      let packageId;
      try {
        packageId = decodeURIComponent(match[1]);
      } catch {
        throw new HttpError(400, "Package ID encoding is invalid.");
      }
      const result = await service.read({ packageId, file: match[2] });
      response.writeHead(200, {
        "Cache-Control": "no-store",
        "Content-Type": match[2].endsWith(".json") ? "application/json" : "application/octet-stream",
        "X-Forward-Handoff-Access-Log-Id": result.accessLogId,
      });
      response.end(result.bytes);
      return;
    }
    throw new HttpError(404, "Not found.");
  } catch (error) {
    let statusCode = error instanceof HttpError ? error.statusCode : 500;
    let message = statusCode === 500
      ? "Internal handoff service error."
      : error instanceof Error ? error.message : String(error);
    if (auditOperation && !failureLogged) {
      try {
        await service.logAccess({
          operation: auditOperation,
          status: statusCode === 404 ? "not-found" : statusCode >= 500 ? "error" : "rejected",
        });
      } catch {
        statusCode = 500;
        message = "Internal handoff service error.";
      }
    }
    sendJson(response, statusCode, { error: message });
  }
};

export const run = async (env = process.env) => {
  const handoffRoot = requiredString(env.FORWARD_HANDOFF_ROOT, "FORWARD_HANDOFF_ROOT", 4096);
  const publicBaseUrl = requiredString(
    env.FORWARD_HANDOFF_PUBLIC_BASE_URL,
    "FORWARD_HANDOFF_PUBLIC_BASE_URL",
    2048,
  );
  const retentionClass = requiredString(
    env.FORWARD_HANDOFF_RETENTION_CLASS,
    "FORWARD_HANDOFF_RETENTION_CLASS",
    128,
  );
  const requireSignature = binaryFlag(
    env.FORWARD_HANDOFF_REQUIRE_SIGNATURE,
    "FORWARD_HANDOFF_REQUIRE_SIGNATURE",
  );
  const port = Number(env.FORWARD_HANDOFF_PORT || String(DEFAULT_PORT));
  const maxBodyBytes = Number(env.FORWARD_HANDOFF_MAX_BODY_BYTES || String(DEFAULT_BODY_LIMIT));
  const maxPackageAgeMinutes = Number(env.FORWARD_HANDOFF_MAX_PACKAGE_AGE_MINUTES || "60");
  if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error("FORWARD_HANDOFF_PORT is invalid.");
  if (!Number.isInteger(maxBodyBytes) || maxBodyBytes < 1024 || maxBodyBytes > 100 * 1024 * 1024) {
    throw new Error("FORWARD_HANDOFF_MAX_BODY_BYTES must be between 1024 and 104857600.");
  }
  if (!Number.isFinite(maxPackageAgeMinutes) || maxPackageAgeMinutes <= 0) {
    throw new Error("FORWARD_HANDOFF_MAX_PACKAGE_AGE_MINUTES must be a positive number.");
  }
  const { writeToken, readToken } = await loadHandoffTokens(env);
  const service = createHandoffService({
    handoffRoot,
    publicBaseUrl,
    retentionClass,
    requireSignature,
    maxPackageAgeMinutes,
    accessLogPath: env.FORWARD_HANDOFF_ACCESS_LOG,
  });
  const server = createServer(createHandoffRequestHandler({
    service,
    writeToken,
    readToken,
    maxBodyBytes,
  }));
  const host = env.FORWARD_HANDOFF_HOST || "127.0.0.1";
  await new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(port, host, resolve);
  });
  process.stdout.write(`Forward handoff server listening on ${host}:${port}.\n`);
  return server;
};

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  run().catch((error) => {
    process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
    process.exitCode = 1;
  });
}
