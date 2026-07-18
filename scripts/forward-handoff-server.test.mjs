import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { createServer } from "node:http";
import { mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { test } from "node:test";

import {
  requiredOwnershipTags,
  sourceInstanceTag,
  sourceKeyTag,
} from "../lib/managed-check-identity.mjs";
import {
  createHandoffRequestHandler,
  createHandoffService,
  loadHandoffTokens,
  run,
  validateHandoffPublication,
} from "./forward-handoff-server.mjs";

const sha256 = (value) => createHash("sha256").update(value).digest("hex");
const sourceInstanceId = "dt-handoff-server-test";

const check = (port = "443") => {
  const sourceKey = sourceKeyTag({
    sourceInstanceId,
    identity: { kind: "intent", source: "source", destination: "destination", protocol: "tcp", port },
  });
  return ({
  name: `[Dynatrace] Checkout prod: source -> destination tcp/${port}`,
  enabled: true,
  priority: "HIGH",
  tags: ["dynatrace", ...requiredOwnershipTags({ sourceInstanceId, sourceKey })],
  definition: {
    checkType: "Existential",
    filters: {
      from: {
        location: { type: "HostFilter", value: "10.0.0.1" },
        headers: [{ type: "PacketFilter", values: { ip_proto: ["6"], tp_dst: [port] } }],
      },
      to: { location: { type: "HostFilter", value: "10.0.0.2" } },
      flowTypes: ["VALID"],
    },
    headerFieldsWithDefaults: ["url"],
    noiseTypes: [],
    returnPath: "ANY",
  },
  });
};

const publicationFile = (name, text) => ({
  name,
  sha256: sha256(text),
  contentBase64: Buffer.from(text).toString("base64"),
});

const publication = ({ packageId = "package-1", port = "443", retentionClass = "nonproduction-30d" } = {}) => {
  const checksText = `${JSON.stringify([check(port)], null, 2)}\n`;
  const generatedAt = new Date().toISOString();
  const manifestText = `${JSON.stringify({
    schemaVersion: "forward-dynatrace/v1",
    packageType: "forward-intent-import",
    packageId,
    generatedAt,
    requestedIngestPath: "data-connector",
    requestedForwardAccessProfile: "read-only",
    source: {
      platform: "dynatrace",
      app: "com.forward.dynatrace",
      instanceId: sourceInstanceId,
      instanceTag: sourceInstanceTag(sourceInstanceId),
      writePolicy: "dynatrace-never-writes-forward",
    },
    artifacts: {
      manifest: "forward-dynatrace-manifest.json",
      intentChecks: "forward-intent-checks.json",
    },
    integrity: { algorithm: "sha256", intentChecksSha256: sha256(checksText) },
    intentChecks: {
      count: 1,
      checkType: "Existential",
      payloadShape: "NewNetworkCheck[]",
      bulkEndpoint: "/api/snapshots/{snapshotId}/checks?bulk",
      dedupeRequiredBeforePost: true,
      dedupe: "managed-source-key",
    },
    validation: {
      managedByTag: "managed-by:com.forward.dynatrace",
      contractVersionTag: "contract-version:1",
      sourceInstanceTagPrefix: "source-instance:",
      sourceKeyTagPrefix: "source-key:sha256:",
      ownershipTagsPerCheck: 4,
      identityPolicy: "strict-ownership-tuple",
      credentialPolicy: "no-forward-credentials-in-dynatrace",
    },
    reconciliation: {
      strategy: "source-scoped-desired-state",
      defaultApplyPolicy: "create-missing-only",
      changedChecks: "report-only",
      staleChecks: "report-only",
      collisionPolicy: "reject",
    },
  }, null, 2)}\n`;
  return {
    schemaVersion: "forward-dynatrace-handoff-publication/v1",
    packageId,
    generatedAt,
    retentionClass,
    files: [
      publicationFile("forward-intent-checks.json", checksText),
      publicationFile("forward-dynatrace-manifest.json", manifestText),
    ],
  };
};

test("validates exact publication bytes, membership, identity, and retention", () => {
  const value = publication();
  const validated = validateHandoffPublication(value, { retentionClass: "nonproduction-30d" });
  assert.equal(validated.packageId, "package-1");
  assert.equal(validated.files.size, 2);
  assert.throws(
    () => validateHandoffPublication({ ...value, retentionClass: "forever" }, {
      retentionClass: "nonproduction-30d",
    }),
    /retentionClass does not match/,
  );
  const corrupt = structuredClone(value);
  corrupt.files[0].sha256 = "0".repeat(64);
  assert.throws(
    () => validateHandoffPublication(corrupt, { retentionClass: "nonproduction-30d" }),
    /checksum mismatch/,
  );

  const unreferenced = structuredClone(value);
  unreferenced.files.push(publicationFile("forward-nqe-checks.json", "[]\n"));
  assert.throws(
    () => validateHandoffPublication(unreferenced, { retentionClass: "nonproduction-30d" }),
    /membership must match the manifest artifact reference/,
  );

  const nonCanonical = structuredClone(value);
  nonCanonical.files[0].contentBase64 = "AB==";
  nonCanonical.files[0].sha256 = sha256(Buffer.from("AB==", "base64"));
  assert.throws(
    () => validateHandoffPublication(nonCanonical, { retentionClass: "nonproduction-30d" }),
    /not canonical base64/,
  );
});

test("loads distinct handoff identities from protected token files by default", async () => {
  const directory = await mkdtemp(path.join(tmpdir(), "forward-handoff-tokens-"));
  const writeTokenFile = path.join(directory, "write-token");
  const readTokenFile = path.join(directory, "read-token");
  await writeFile(writeTokenFile, "write-token-1234567890\n", { mode: 0o600 });
  await writeFile(readTokenFile, "read-token-1234567890\n", { mode: 0o600 });
  assert.deepEqual(await loadHandoffTokens({
    FORWARD_HANDOFF_WRITE_TOKEN_FILE: writeTokenFile,
    FORWARD_HANDOFF_READ_TOKEN_FILE: readTokenFile,
  }), {
    writeToken: "write-token-1234567890",
    readToken: "read-token-1234567890",
  });
  await assert.rejects(
    loadHandoffTokens({
      FORWARD_HANDOFF_WRITE_TOKEN: "write-token-1234567890",
      FORWARD_HANDOFF_READ_TOKEN: "read-token-1234567890",
    }),
    /ALLOW_ENV_TOKENS=1/,
  );
});

test("fails startup on ambiguous security and numeric policy values", async () => {
  const base = {
    FORWARD_HANDOFF_ROOT: "/tmp/forward-handoff-invalid-config",
    FORWARD_HANDOFF_PUBLIC_BASE_URL: "https://handoff.example.com",
    FORWARD_HANDOFF_RETENTION_CLASS: "nonproduction-30d",
  };
  await assert.rejects(
    run({ ...base, FORWARD_HANDOFF_REQUIRE_SIGNATURE: "true" }),
    /FORWARD_HANDOFF_REQUIRE_SIGNATURE must be 0 or 1/,
  );
  await assert.rejects(
    run({ ...base, FORWARD_HANDOFF_PORT: "8090junk" }),
    /FORWARD_HANDOFF_PORT is invalid/,
  );
  await assert.rejects(
    run({ ...base, FORWARD_HANDOFF_MAX_PACKAGE_AGE_MINUTES: "0" }),
    /FORWARD_HANDOFF_MAX_PACKAGE_AGE_MINUTES must be a positive number/,
  );
});

test("publishes idempotently, serves read-only bytes, and audits denied access", async (t) => {
  const root = await mkdtemp(path.join(tmpdir(), "forward-handoff-server-"));
  let tick = 0;
  const service = createHandoffService({
    handoffRoot: root,
    publicBaseUrl: "https://handoff.example.com",
    retentionClass: "nonproduction-30d",
    now: () => `2026-07-15T18:30:${String(tick++).padStart(2, "0")}.000Z`,
  });
  const server = createServer(createHandoffRequestHandler({
    service,
    writeToken: "write-token-1234567890",
    readToken: "read-token-1234567890",
  }));
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  t.after(() => server.close());
  const baseUrl = `http://127.0.0.1:${server.address().port}`;
  const body = publication();
  const publish = () => fetch(`${baseUrl}/v1/packages`, {
    method: "POST",
    headers: {
      Authorization: "Bearer write-token-1234567890",
      "Content-Type": "application/json",
      "Idempotency-Key": "forward-dynatrace:package-1",
    },
    body: JSON.stringify(body),
  });

  const first = await publish();
  assert.equal(first.status, 201);
  const firstReceipt = await first.json();
  assert.equal(firstReceipt.status, "published");
  assert.equal(firstReceipt.immutableUrl, "https://handoff.example.com/v1/packages/package-1/");
  assert.equal(firstReceipt.retentionClass, "nonproduction-30d");

  const second = await publish();
  assert.equal(second.status, 200);
  assert.equal((await second.json()).status, "existing");

  const denied = await fetch(`${baseUrl}/v1/packages/latest/forward-dynatrace-manifest.json`);
  assert.equal(denied.status, 401);
  const allowed = await fetch(`${baseUrl}/v1/packages/latest/forward-dynatrace-manifest.json`, {
    headers: { Authorization: "Bearer read-token-1234567890" },
  });
  assert.equal(allowed.status, 200);
  assert.equal(allowed.headers.has("x-forward-handoff-access-log-id"), true);
  assert.deepEqual(await allowed.json(), JSON.parse(Buffer.from(
    body.files.find((file) => file.name === "forward-dynatrace-manifest.json").contentBase64,
    "base64",
  ).toString("utf8")));

  const log = (await readFile(service.accessLogPath, "utf8"))
    .trim().split("\n").map((line) => JSON.parse(line));
  assert.deepEqual(log.map((event) => `${event.operation}:${event.status}`), [
    "publish:published",
    "publish:existing",
    "read:denied",
    "read:allowed",
  ]);
  assert.equal(JSON.stringify(log).includes("write-token"), false);
  assert.equal(JSON.stringify(log).includes("read-token"), false);
});

test("rejects unintended writers and immutable package conflicts", async (t) => {
  const root = await mkdtemp(path.join(tmpdir(), "forward-handoff-server-conflict-"));
  const service = createHandoffService({
    handoffRoot: root,
    publicBaseUrl: "https://handoff.example.com",
    retentionClass: "nonproduction-30d",
  });
  const server = createServer(createHandoffRequestHandler({
    service,
    writeToken: "write-token-1234567890",
    readToken: "read-token-1234567890",
  }));
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  t.after(() => server.close());
  const baseUrl = `http://127.0.0.1:${server.address().port}`;
  const request = (body, token = "write-token-1234567890") => fetch(`${baseUrl}/v1/packages`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
      "Idempotency-Key": "forward-dynatrace:package-1",
    },
    body: JSON.stringify(body),
  });
  assert.equal((await request(publication(), "not-the-write-token")).status, 401);
  assert.equal((await request(publication())).status, 201);
  const conflict = await request(publication({ port: "8443" }));
  assert.equal(conflict.status, 409);
  assert.match((await conflict.json()).error, /Immutable package conflict/);
});

test("returns a bounded 413 response and audits rejected publication input", async (t) => {
  const root = await mkdtemp(path.join(tmpdir(), "forward-handoff-server-bounds-"));
  const service = createHandoffService({
    handoffRoot: root,
    publicBaseUrl: "https://handoff.example.com",
    retentionClass: "nonproduction-30d",
  });
  const server = createServer(createHandoffRequestHandler({
    service,
    writeToken: "write-token-1234567890",
    readToken: "read-token-1234567890",
    maxBodyBytes: 1024,
  }));
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  t.after(() => server.close());
  const response = await fetch(`http://127.0.0.1:${server.address().port}/v1/packages`, {
    method: "POST",
    headers: {
      Authorization: "Bearer write-token-1234567890",
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ oversized: "x".repeat(2048) }),
  });
  assert.equal(response.status, 413);
  assert.match((await response.json()).error, /too large/);
  const events = (await readFile(service.accessLogPath, "utf8"))
    .trim().split("\n").map((line) => JSON.parse(line));
  assert.deepEqual(events.map((event) => `${event.operation}:${event.status}`), ["publish:rejected"]);
});
