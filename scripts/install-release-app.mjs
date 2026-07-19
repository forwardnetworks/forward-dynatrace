#!/usr/bin/env node

import { createHash } from "node:crypto";
import { readFile, stat } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

import AdmZip from "adm-zip";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const DEFAULT_TOKEN_URL = "https://sso.dynatrace.com/sso/oauth2/token";
const DEFAULT_TIMEOUT_SECONDS = 180;
const MAX_ARCHIVE_BYTES = 50 * 1_024 * 1_024;
const MAX_UNCOMPRESSED_ARCHIVE_BYTES = 200 * 1_024 * 1_024;
const MAX_ARCHIVE_ENTRIES = 500;
const REQUIRED_MEMBERS = [
  "manifest.yaml",
  "api/dependency-discovery.js",
  "api/run-forward-nqe-evidence.js",
  "api/sync-forward-intent-checks.js",
  "settings/schemas/dependency-discovery-profile.schema.json",
  "settings/schemas/forward-api-connection.schema.json",
  "widgets/actions/run-forward-nqe-evidence/index.js",
  "widgets/actions/sync-forward-intent-checks/index.js",
];

const usage = `Usage:
  npm run dynatrace:release:install -- \\
    --environment-url https://<environment-id>.apps.dynatrace.com/ \\
    --archive /secure/releases/forward-dynatrace-app-v0.x.y.zip \\
    --checksums /secure/releases/SHA256SUMS

Options:
  --environment-url URL   Target Dynatrace Apps environment.
  --archive FILE          Exact released Dynatrace app ZIP.
  --checksums FILE        SHA256SUMS downloaded from the same release.
  --timeout-seconds N     Wait up to 30 through 600 seconds for installation. Default: 180.
  --verify-only           Verify checksum and bundle identity without authentication or upload.
  --help                  Show this help.

Authentication:
  Set DT_APP_OAUTH_CLIENT_ID and DT_APP_OAUTH_CLIENT_SECRET in the operator's secret process.
  Never pass OAuth or Forward credentials on the command line.
`;

export const parseArgs = (argv) => {
  const args = {
    environmentUrl: undefined,
    archive: undefined,
    checksums: undefined,
    timeoutSeconds: DEFAULT_TIMEOUT_SECONDS,
    verifyOnly: false,
    help: false,
  };
  for (let index = 0; index < argv.length; index += 1) {
    const option = argv[index];
    if (option === "--verify-only") {
      args.verifyOnly = true;
      continue;
    }
    if (option === "--help") {
      args.help = true;
      continue;
    }
    if (["--environment-url", "--archive", "--checksums", "--timeout-seconds"].includes(option)) {
      const value = argv[index + 1];
      if (!value || value.startsWith("--")) throw new Error(`${option} requires a value.`);
      index += 1;
      if (option === "--environment-url") args.environmentUrl = value;
      if (option === "--archive") args.archive = value;
      if (option === "--checksums") args.checksums = value;
      if (option === "--timeout-seconds") args.timeoutSeconds = Number.parseInt(value, 10);
      continue;
    }
    throw new Error(`Unsupported option: ${option}`);
  }
  return args;
};

const manifestField = (manifest, name) => {
  const match = manifest.match(new RegExp(`^${name}:\\s*([^\\r\\n]+)$`, "mu"));
  return match?.[1]?.trim() || "";
};

export const validateEnvironmentUrl = (value) => {
  const url = new URL(value);
  if (url.protocol !== "https:") throw new Error("Dynatrace environment URL must use HTTPS.");
  if (url.username || url.password || url.search || url.hash) {
    throw new Error("Dynatrace environment URL must not contain credentials, query, or fragment data.");
  }
  if (url.pathname !== "/" && url.pathname !== "") {
    throw new Error("Dynatrace environment URL must end at the Apps environment root.");
  }
  if (!url.hostname.endsWith(".apps.dynatrace.com")) {
    throw new Error("Dynatrace environment URL must use an apps.dynatrace.com SaaS host.");
  }
  url.pathname = "/";
  return url.toString().replace(/\/$/u, "");
};

export const validateOAuthTokenUrl = (value = DEFAULT_TOKEN_URL) => {
  const url = new URL(value);
  if (
    url.protocol !== "https:" ||
    url.hostname !== "sso.dynatrace.com" ||
    url.pathname !== "/sso/oauth2/token" ||
    url.username ||
    url.password ||
    url.search ||
    url.hash
  ) {
    throw new Error("Dynatrace OAuth token URL must be the official SSO token endpoint.");
  }
  return url;
};

export const verifyReleaseArchive = async ({ archivePath, checksumsPath }) => {
  const archiveDetails = await stat(archivePath);
  if (!archiveDetails.isFile() || archiveDetails.size === 0 || archiveDetails.size > MAX_ARCHIVE_BYTES) {
    throw new Error("Released app archive must be a non-empty ZIP no larger than 50 MiB.");
  }
  if (path.extname(archivePath).toLowerCase() !== ".zip") {
    throw new Error("Released app archive must end in .zip.");
  }

  const archiveBytes = await readFile(archivePath);
  const digest = createHash("sha256").update(archiveBytes).digest("hex");
  const checksumText = await readFile(checksumsPath, "utf8");
  const archiveName = path.basename(archivePath);
  const matches = checksumText
    .split(/\r?\n/u)
    .map((line) => line.match(/^([a-f0-9]{64})\s+\*?(.+)$/u))
    .filter((match) => match?.[2] === archiveName);
  if (matches.length !== 1) {
    throw new Error(`SHA256SUMS must contain exactly one entry for ${archiveName}.`);
  }
  if (matches[0][1] !== digest) {
    throw new Error(`Checksum verification failed for ${archiveName}.`);
  }

  const zip = new AdmZip(archiveBytes);
  const entries = zip.getEntries();
  const names = new Set(entries.map((entry) => entry.entryName));
  if (entries.length > MAX_ARCHIVE_ENTRIES || names.size !== entries.length) {
    throw new Error("Released app archive contains too many or duplicate members.");
  }
  let uncompressedBytes = 0;
  for (const entry of entries) {
    if (
      entry.entryName.startsWith("/") ||
      entry.entryName.includes("\\") ||
      /^[A-Za-z]:/u.test(entry.entryName) ||
      entry.entryName.split("/").includes("..")
    ) {
      throw new Error(`Released app archive contains an unsafe member: ${entry.entryName}`);
    }
    uncompressedBytes += Number(entry.header.size || 0);
    if (uncompressedBytes > MAX_UNCOMPRESSED_ARCHIVE_BYTES) {
      throw new Error("Released app archive expands beyond 200 MiB.");
    }
  }
  for (const member of REQUIRED_MEMBERS) {
    if (!names.has(member)) throw new Error(`Released app archive is missing ${member}.`);
  }

  const manifest = zip.readAsText("manifest.yaml");
  const appId = manifestField(manifest, "id");
  const appVersion = manifestField(manifest, "version");
  const appName = manifestField(manifest, "name");
  if (!new Set(["my.forward", "com.forward.dynatrace"]).has(appId)) {
    throw new Error(`Unsupported Dynatrace app ID in archive: ${appId || "missing"}.`);
  }
  if (appName !== "Forward") throw new Error("Dynatrace app manifest name must be Forward.");
  if (!/^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/u.test(appVersion)) {
    throw new Error("Dynatrace app manifest version is invalid.");
  }
  const filenameVersion = archiveName.match(/-v(\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?)\.zip$/u)?.[1];
  if (filenameVersion && filenameVersion !== appVersion) {
    throw new Error(`Archive filename version ${filenameVersion} does not match manifest ${appVersion}.`);
  }

  return { archiveBytes, archiveName, appId, appVersion, digest };
};

const responseError = async (response, label) => {
  const text = (await response.text()).trim().slice(0, 1_000);
  throw new Error(`${label} failed with HTTP ${response.status}${text ? `: ${text}` : "."}`);
};

const oauthToken = async ({ fetchImpl, env }) => {
  const clientId = env.DT_APP_OAUTH_CLIENT_ID;
  const clientSecret = env.DT_APP_OAUTH_CLIENT_SECRET;
  if (!clientId || !clientSecret) {
    throw new Error("DT_APP_OAUTH_CLIENT_ID and DT_APP_OAUTH_CLIENT_SECRET are required for installation.");
  }
  const tokenUrl = validateOAuthTokenUrl(env.DT_APP_OAUTH_TOKEN_URL);
  const body = new URLSearchParams({
    grant_type: "client_credentials",
    client_id: clientId,
    client_secret: clientSecret,
    scope: "app-engine:apps:install app-engine:apps:run",
  });
  const response = await fetchImpl(tokenUrl, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body,
    redirect: "error",
    signal: AbortSignal.timeout(30_000),
  });
  if (!response.ok) {
    throw new Error(`Dynatrace OAuth token request failed with HTTP ${response.status}.`);
  }
  const payload = await response.json();
  if (typeof payload.access_token !== "string" || !payload.access_token) {
    throw new Error("Dynatrace OAuth token response did not contain an access token.");
  }
  return payload.access_token;
};

export const installReleaseArchive = async ({
  environmentUrl,
  archive,
  token,
  fetchImpl = fetch,
  sleep = (milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds)),
  timeoutSeconds = DEFAULT_TIMEOUT_SECONDS,
}) => {
  const baseUrl = validateEnvironmentUrl(environmentUrl);
  const headers = { Authorization: `Bearer ${token}` };
  const installResponse = await fetchImpl(`${baseUrl}/platform/app-engine/registry/v1/apps`, {
    method: "POST",
    headers: { ...headers, "Content-Type": "application/zip", Accept: "application/json" },
    body: archive.archiveBytes,
    redirect: "error",
    signal: AbortSignal.timeout(60_000),
  });
  if (installResponse.status !== 202) await responseError(installResponse, "Dynatrace app upload");
  const stub = await installResponse.json();
  if (stub.id !== archive.appId) throw new Error("Dynatrace accepted an unexpected app identity.");

  const deadline = Date.now() + timeoutSeconds * 1_000;
  while (Date.now() < deadline) {
    const statusResponse = await fetchImpl(
      `${baseUrl}/platform/app-engine/registry/v1/apps/${encodeURIComponent(archive.appId)}?latest-app-version=true&add-fields=resourceStatus.subResourceStatuses,manifest.scopes`,
      {
        headers: { ...headers, Accept: "application/json" },
        redirect: "error",
        signal: AbortSignal.timeout(30_000),
      },
    );
    if (!statusResponse.ok) await responseError(statusResponse, "Dynatrace app status");
    const app = await statusResponse.json();
    if (app.resourceStatus?.status === "ERROR" || app.resourceStatus?.status === "DEACTIVATED") {
      throw new Error(`Dynatrace app installation ended in ${app.resourceStatus.status}.`);
    }
    if (app.resourceStatus?.status === "OK" && app.version === archive.appVersion) {
      return {
        status: "installed",
        appId: app.id,
        appVersion: app.version,
        signatureVerifiedByTenant: Boolean(app.signatureInfo?.signed),
        warnings: Array.isArray(stub.warnings)
          ? stub.warnings.map((warning) => String(warning.message || "").slice(0, 500)).filter(Boolean)
          : [],
      };
    }
    await sleep(2_000);
  }
  throw new Error(`Dynatrace app installation did not become ready within ${timeoutSeconds} seconds.`);
};

const main = async () => {
  const args = parseArgs(process.argv.slice(2));
  if (args.help) {
    process.stdout.write(usage);
    return;
  }
  if (!args.archive) throw new Error("--archive is required.");
  if (!args.checksums) throw new Error("--checksums is required.");
  if (!Number.isInteger(args.timeoutSeconds) || args.timeoutSeconds < 30 || args.timeoutSeconds > 600) {
    throw new Error("--timeout-seconds must be an integer from 30 through 600.");
  }

  const archive = await verifyReleaseArchive({
    archivePath: path.resolve(root, args.archive),
    checksumsPath: path.resolve(root, args.checksums),
  });
  if (args.verifyOnly) {
    process.stdout.write(`${JSON.stringify({
      status: "verified",
      appId: archive.appId,
      appVersion: archive.appVersion,
      archive: archive.archiveName,
      sha256: archive.digest,
    })}\n`);
    return;
  }
  if (!args.environmentUrl) throw new Error("--environment-url is required unless --verify-only is used.");

  const token = await oauthToken({ fetchImpl: fetch, env: process.env });
  const result = await installReleaseArchive({
    environmentUrl: args.environmentUrl,
    archive,
    token,
    timeoutSeconds: args.timeoutSeconds,
  });
  process.stdout.write(`${JSON.stringify(result)}\n`);
};

if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch((error) => {
    process.stderr.write(`${error instanceof Error ? error.message : "Dynatrace release installation failed."}\n`);
    process.exitCode = 1;
  });
}
