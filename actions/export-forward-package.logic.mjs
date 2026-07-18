import { createHash } from "node:crypto";

import * as appSettingsV2 from "@dynatrace-sdk/client-app-settings-v2";

import forwardSync from "../api/forward-sync.function.ts";

const CONNECTION_SCHEMA = "forward-package-handoff-connection";
const PUBLICATION_SCHEMA = "forward-dynatrace-handoff-publication/v1";
const RECEIPT_SCHEMA = "forward-dynatrace-handoff-receipt/v1";
const MAX_RESPONSE_BYTES = 64 * 1024;
const DEFAULT_TIMEOUT_MS = 30_000;

// The pinned SDK exposes ESM named exports to the App Toolkit bundler but its
// package entry point resolves to CommonJS in Node. Support both shapes so the
// same action module is executable in the checked Node 24 test environment.
const appSettingsObjectsClient = appSettingsV2.appSettingsObjectsClient ||
  appSettingsV2.default?.appSettingsObjectsClient;

const sha256 = (value) => createHash("sha256").update(value).digest("hex");

const parseRequest = (value) => {
  if (typeof value === "string") {
    try {
      return JSON.parse(value);
    } catch (error) {
      throw new Error(`Forward package request is not valid JSON: ${error.message}`);
    }
  }
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error("Forward package request must be a JSON object or an expression resolving to one.");
  }
  return value;
};

const requiredString = (value, label, maxLength = 1024) => {
  const normalized = typeof value === "string" ? value.trim() : "";
  if (!normalized) throw new Error(`${label} must be a non-empty string.`);
  if (normalized.length > maxLength) throw new Error(`${label} exceeds ${maxLength} characters.`);
  return normalized;
};

const assertKnownKeys = (value, allowed, label) => {
  const unknown = Object.keys(value).filter((key) => !allowed.has(key));
  if (unknown.length > 0) {
    throw new Error(`${label} contains unsupported fields: ${unknown.join(", ")}.`);
  }
};

const handoffUrl = (value) => {
  const url = new URL(requiredString(value, "Handoff connection URL", 2048));
  if (url.protocol !== "https:") throw new Error("Handoff connection URL must use HTTPS.");
  if (url.username || url.password || url.search || url.hash) {
    throw new Error("Handoff connection URL must not contain credentials, query parameters, or fragments.");
  }
  if (!url.pathname.endsWith("/v1/packages")) {
    throw new Error("Handoff connection URL must end with /v1/packages.");
  }
  return url.toString();
};

const loadDynatraceConnection = async (connectionId) =>
  appSettingsObjectsClient?.getAppSettingsObjectByObjectId({ objectId: connectionId });

const validateConnection = (connection) => {
  if (!connection || typeof connection !== "object" || Array.isArray(connection)) {
    throw new Error("Handoff connection could not be loaded.");
  }
  if (connection.schemaId && connection.schemaId !== CONNECTION_SCHEMA) {
    throw new Error(`Handoff connection must use settings schema ${CONNECTION_SCHEMA}.`);
  }
  const value = connection.value;
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error("Handoff connection value is invalid.");
  }
  assertKnownKeys(value, new Set(["name", "url", "token", "retentionClass"]), "Handoff connection");
  const token = requiredString(value.token, "Handoff connection token", 4096);
  if (token.length < 16) throw new Error("Handoff connection token must contain at least 16 characters.");
  const retentionClass = requiredString(value.retentionClass, "Handoff retention class", 128);
  if (!/^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/u.test(retentionClass)) {
    throw new Error("Handoff retention class must be a publish-safe identifier.");
  }
  return {
    url: handoffUrl(value.url),
    token,
    retentionClass,
  };
};

const publicationFile = (name, text) => ({
  name,
  sha256: sha256(text),
  contentBase64: Buffer.from(text, "utf8").toString("base64"),
});

export const buildHandoffPublication = ({ manifestText, intentChecksText, retentionClass }) => {
  const manifest = JSON.parse(manifestText);
  return {
    schemaVersion: PUBLICATION_SCHEMA,
    packageId: manifest.packageId,
    generatedAt: manifest.generatedAt,
    retentionClass,
    files: [
      publicationFile("forward-intent-checks.json", intentChecksText),
      publicationFile("forward-dynatrace-manifest.json", manifestText),
    ],
  };
};

const receiptUrl = (value, label, expectedUrl) => {
  const url = new URL(requiredString(value, label, 2048));
  if (url.protocol !== "https:" || url.username || url.password || url.search || url.hash) {
    throw new Error(`${label} must be an HTTPS URL without credentials, query parameters, or fragments.`);
  }
  if (url.toString() !== expectedUrl) {
    throw new Error(`${label} does not match the selected handoff connection.`);
  }
  return url.toString();
};

const receiptUrlsForConnection = (connectionUrl, packageId) => {
  const publishUrl = new URL(connectionUrl);
  const rootPath = publishUrl.pathname.slice(0, -"/v1/packages".length);
  publishUrl.pathname = `${rootPath}/v1/packages/${encodeURIComponent(packageId)}/`;
  const immutableUrl = publishUrl.toString();
  publishUrl.pathname = `${rootPath}/v1/packages/latest/`;
  return { immutableUrl, latestUrl: publishUrl.toString() };
};

const validateReceipt = (value, publication, responseStatus, connection) => {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error("Package handoff returned an invalid receipt.");
  }
  assertKnownKeys(value, new Set([
    "schemaVersion", "status", "packageId", "receivedAt", "manifestSha256", "files",
    "immutableUrl", "latestUrl", "retentionClass", "accessLogId",
  ]), "Package handoff receipt");
  if (value.schemaVersion !== RECEIPT_SCHEMA) {
    throw new Error(`Package handoff receipt schemaVersion must be ${RECEIPT_SCHEMA}.`);
  }
  if (!new Set(["published", "existing"]).has(value.status)) {
    throw new Error("Package handoff receipt status is invalid.");
  }
  if (
    (value.status === "published" && responseStatus !== 201) ||
    (value.status === "existing" && responseStatus !== 200)
  ) {
    throw new Error("Package handoff HTTP status does not match the receipt status.");
  }
  if (value.packageId !== publication.packageId) {
    throw new Error("Package handoff receipt changed the package ID.");
  }
  const manifestFile = publication.files.find((file) => file.name === "forward-dynatrace-manifest.json");
  if (value.manifestSha256 !== manifestFile.sha256) {
    throw new Error("Package handoff receipt manifest checksum does not match published bytes.");
  }
  const expectedFiles = publication.files.map((file) => file.name).sort();
  if (!Array.isArray(value.files) || JSON.stringify([...value.files].sort()) !== JSON.stringify(expectedFiles)) {
    throw new Error("Package handoff receipt file membership does not match published bytes.");
  }
  if (value.retentionClass !== publication.retentionClass) {
    throw new Error("Package handoff receipt retention class does not match the connection policy.");
  }
  const expectedUrls = receiptUrlsForConnection(connection.url, publication.packageId);
  receiptUrl(value.immutableUrl, "Package handoff receipt immutableUrl", expectedUrls.immutableUrl);
  receiptUrl(value.latestUrl, "Package handoff receipt latestUrl", expectedUrls.latestUrl);
  const receivedAt = requiredString(value.receivedAt, "Package handoff receipt receivedAt", 64);
  if (!Number.isFinite(Date.parse(receivedAt))) {
    throw new Error("Package handoff receipt receivedAt must be an ISO date-time.");
  }
  const accessLogId = requiredString(value.accessLogId, "Package handoff receipt accessLogId", 128);
  if (!/^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/u.test(accessLogId)) {
    throw new Error("Package handoff receipt accessLogId must be a publish-safe identifier.");
  }
  return value;
};

const readBoundedResponseText = async (response) => {
  if (!response.body?.getReader) {
    const text = await response.text();
    if (Buffer.byteLength(text, "utf8") > MAX_RESPONSE_BYTES) {
      throw new Error("Package handoff response exceeded 65536 bytes.");
    }
    return text;
  }
  const reader = response.body.getReader();
  const chunks = [];
  let size = 0;
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    size += value.byteLength;
    if (size > MAX_RESPONSE_BYTES) {
      await reader.cancel();
      throw new Error("Package handoff response exceeded 65536 bytes.");
    }
    chunks.push(Buffer.from(value));
  }
  return Buffer.concat(chunks).toString("utf8");
};

export const publishHandoff = async ({
  connection,
  publication,
  fetchImpl = globalThis.fetch,
  timeoutMs = DEFAULT_TIMEOUT_MS,
}) => {
  if (!Number.isFinite(timeoutMs) || timeoutMs <= 0) {
    throw new Error("Package handoff timeout must be a positive number.");
  }
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetchImpl(connection.url, {
      method: "POST",
      headers: {
        Accept: "application/json",
        Authorization: `Bearer ${connection.token}`,
        "Content-Type": "application/json",
        "Idempotency-Key": `forward-dynatrace:${publication.packageId}`,
      },
      body: JSON.stringify(publication),
      signal: controller.signal,
    });
    const text = await readBoundedResponseText(response);
    if (!response.ok) {
      throw new Error(`Package handoff publication failed with HTTP ${response.status}.`);
    }
    let receipt;
    try {
      receipt = JSON.parse(text);
    } catch {
      throw new Error("Package handoff returned invalid JSON.");
    }
    return validateReceipt(receipt, publication, response.status, connection);
  } finally {
    clearTimeout(timeout);
  }
};

export const createExportForwardPackageAction = ({
  loadConnection = loadDynatraceConnection,
  fetchImpl = globalThis.fetch,
} = {}) => async (payload) => {
  if (!payload || payload.request === undefined || payload.request === null) {
    throw new Error("Input field 'request' is missing.");
  }
  const connectionId = requiredString(payload.connectionId, "Input field 'connectionId'", 255);
  const connection = validateConnection(await loadConnection(connectionId));
  const result = forwardSync(parseRequest(payload.request));
  if (result.status !== "ready") {
    throw new Error(result.summary);
  }
  const manifest = JSON.parse(result.exportManifestPreview);
  const publication = buildHandoffPublication({
    manifestText: result.exportManifestPreview,
    intentChecksText: result.intentChecksPreview,
    retentionClass: connection.retentionClass,
  });
  const receipt = await publishHandoff({ connection, publication, fetchImpl });
  return {
    schemaVersion: "forward-dynatrace-workflow-action/v1",
    status: result.status,
    packageId: manifest.packageId,
    generatedAt: result.generatedAt,
    intentCheckCount: result.intentCheckCount,
    rejectedDependencyCount: result.rejectedDependencyCount,
    artifacts: {
      manifestFileName: "forward-dynatrace-manifest.json",
      manifest: result.exportManifestPreview,
      intentChecksFileName: "forward-intent-checks.json",
      intentChecks: result.intentChecksPreview,
    },
    handoff: receipt,
    boundary: "dynatrace-never-writes-forward",
  };
};

export default createExportForwardPackageAction();
