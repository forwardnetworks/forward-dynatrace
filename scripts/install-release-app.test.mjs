import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";

import AdmZip from "adm-zip";

import {
  installReleaseArchive,
  validateEnvironmentUrl,
  validateOAuthTokenUrl,
  verifyReleaseArchive,
} from "./install-release-app.mjs";

const requiredMembers = [
  "api/dependency-discovery.js",
  "api/run-forward-nqe-evidence.js",
  "api/sync-forward-intent-checks.js",
  "settings/schemas/dependency-discovery-profile.schema.json",
  "settings/schemas/forward-api-connection.schema.json",
  "widgets/actions/run-forward-nqe-evidence/index.js",
  "widgets/actions/sync-forward-intent-checks/index.js",
];

const fixture = async () => {
  const directory = await mkdtemp(path.join(tmpdir(), "forward-release-install-"));
  const archiveName = "forward-dynatrace-app-v0.11.0.zip";
  const archivePath = path.join(directory, archiveName);
  const checksumsPath = path.join(directory, "SHA256SUMS");
  const zip = new AdmZip();
  zip.addFile("manifest.yaml", Buffer.from([
    "app-bundle-version: 0.1.0",
    "id: my.forward",
    "name: Forward",
    "version: 0.11.0",
    "",
  ].join("\n")));
  for (const member of requiredMembers) zip.addFile(member, Buffer.from("fixture\n"));
  zip.writeZip(archivePath);
  const archiveBytes = zip.toBuffer();
  const digest = createHash("sha256").update(archiveBytes).digest("hex");
  await writeFile(checksumsPath, `${digest}  ${archiveName}\n`);
  return { archivePath, checksumsPath };
};

test("verifies checksum and immutable app identity", async () => {
  const files = await fixture();
  const archive = await verifyReleaseArchive(files);
  assert.equal(archive.appId, "my.forward");
  assert.equal(archive.appVersion, "0.11.0");
});

test("rejects a modified archive", async () => {
  const files = await fixture();
  await writeFile(files.archivePath, "modified");
  await assert.rejects(() => verifyReleaseArchive(files), /Checksum verification failed/u);
});

test("requires the exact Dynatrace SaaS environment root", () => {
  assert.equal(
    validateEnvironmentUrl("https://abc123.apps.dynatrace.com/"),
    "https://abc123.apps.dynatrace.com",
  );
  assert.throws(() => validateEnvironmentUrl("http://abc123.apps.dynatrace.com/"), /HTTPS/u);
  assert.throws(() => validateEnvironmentUrl("https://example.com/"), /apps\.dynatrace\.com/u);
});

test("sends OAuth credentials only to the official Dynatrace SSO endpoint", () => {
  assert.equal(
    validateOAuthTokenUrl().toString(),
    "https://sso.dynatrace.com/sso/oauth2/token",
  );
  assert.throws(
    () => validateOAuthTokenUrl("https://example.com/sso/oauth2/token"),
    /official SSO token endpoint/u,
  );
  assert.throws(
    () => validateOAuthTokenUrl("https://sso.dynatrace.com/sso/oauth2/token?redirect=example"),
    /official SSO token endpoint/u,
  );
});

test("uploads the exact verified bytes and waits for the matching ready version", async () => {
  const files = await fixture();
  const archive = await verifyReleaseArchive(files);
  const calls = [];
  const responses = [
    new Response(JSON.stringify({ id: "my.forward", warnings: [] }), { status: 202 }),
    new Response(JSON.stringify({
      id: "my.forward",
      version: "0.11.0",
      resourceStatus: { status: "PENDING" },
      signatureInfo: { signed: false },
    }), { status: 200 }),
    new Response(JSON.stringify({
      id: "my.forward",
      version: "0.11.0",
      resourceStatus: { status: "OK" },
      signatureInfo: { signed: false },
    }), { status: 200 }),
  ];
  const fetchImpl = async (url, options = {}) => {
    calls.push({ url: String(url), options });
    return responses.shift();
  };

  const result = await installReleaseArchive({
    environmentUrl: "https://abc123.apps.dynatrace.com/",
    archive,
    token: "protected-test-token",
    fetchImpl,
    sleep: async () => {},
    timeoutSeconds: 30,
  });

  assert.equal(result.status, "installed");
  assert.equal(result.appVersion, "0.11.0");
  assert.equal(calls[0].options.body.equals(archive.archiveBytes), true);
  assert.equal(calls[0].options.headers.Authorization, "Bearer protected-test-token");
  assert.equal(JSON.stringify(result).includes("protected-test-token"), false);
});
