import assert from "node:assert/strict";
import test from "node:test";

import {
  createForwardConnectionDiagnostic,
} from "../lib/forward-connection-diagnostic.ts";

const connection = (profile = "read-only") => ({
  objectId: "connection-object-1",
  schemaId: "forward-api-connection",
  value: {
    name: "Sandbox Read Only",
    baseUrl: "https://forward.example.com",
    networkId: "protected-network-id",
    credentialVaultId: "CREDENTIALS_VAULT-0000000000000001",
    forwardAccessProfile: profile,
    approvedLibraryQueryIds: "",
    approvedQueryDigests: "",
  },
});

const credential = {
  id: "CREDENTIALS_VAULT-0000000000000001",
  type: "USERNAME_PASSWORD",
  username: "protected-access-key",
  password: "protected-token-secret",
};

const fixedOptions = (overrides = {}) => ({
  loadConnection: async () => connection(),
  loadCredential: async () => credential,
  now: () => new Date("2026-08-09T12:00:00.000Z"),
  correlationIdFactory: () => "diagnostic-correlation-1",
  forwardClientOptions: { maxRetries: 0 },
  ...overrides,
});

test("proves a Vault-backed Read Only connection with GET-only snapshot access", async () => {
  const calls = [];
  const logs = [];
  const diagnostic = createForwardConnectionDiagnostic(fixedOptions({
    fetchImpl: async (url, options) => {
      calls.push({ url: String(url), method: options?.method, headers: options?.headers });
      return new Response(JSON.stringify({ id: "snapshot-protected" }), { status: 200 });
    },
    logWriter: (level, record) => logs.push({ level, record }),
  }));

  const result = await diagnostic({ connectionId: "connection-object-1" });

  assert.equal(result.status, "ready");
  assert.equal(result.forwardAccessProfile, "read-only");
  assert.deepEqual(result.checks, {
    configuration: "passed",
    credentialVault: "passed",
    verifiedHttps: "passed",
    authentication: "passed",
    networkAccess: "passed",
    processedSnapshot: "passed",
    readOnlyPilot: "passed",
  });
  assert.deepEqual(calls.map(({ method }) => method), ["GET"]);
  assert.equal(
    calls[0].url,
    "https://forward.example.com/api/networks/protected-network-id/snapshots/latestProcessed",
  );
  assert.equal(logs.length, 1);
  assert.equal(logs[0].level, "info");
  assert.equal(logs[0].record.status, "ready");
  const publicEvidence = JSON.stringify({ result, logs });
  assert.doesNotMatch(publicEvidence, /protected-network-id|snapshot-protected/u);
  assert.doesNotMatch(publicEvidence, /protected-access-key|protected-token-secret|CREDENTIALS_VAULT-/u);
});

test("returns a bounded failure reason and never logs a raw authenticated error", async () => {
  const logs = [];
  const diagnostic = createForwardConnectionDiagnostic(fixedOptions({
    fetchImpl: async () => new Response("customer hostname and raw error", { status: 403 }),
    logWriter: (level, record) => logs.push({ level, record }),
  }));

  const result = await diagnostic({ connectionId: "connection-object-1" });

  assert.equal(result.status, "blocked");
  assert.equal(result.reasonCode, "authentication-or-external-request-denied");
  assert.equal(result.httpStatusClass, "4xx");
  assert.equal(result.checks.credentialVault, "passed");
  assert.equal(result.checks.authentication, "blocked");
  assert.equal(logs[0].level, "warn");
  const publicEvidence = JSON.stringify({ result, logs });
  assert.doesNotMatch(publicEvidence, /customer hostname|raw error/u);
  assert.doesNotMatch(publicEvidence, /protected-access-key|protected-token-secret|CREDENTIALS_VAULT-/u);
});

test("warns when a reachable connection is not declared Read Only", async () => {
  const diagnostic = createForwardConnectionDiagnostic(fixedOptions({
    loadConnection: async () => connection("network-admin"),
    fetchImpl: async () => new Response(JSON.stringify({ id: "snapshot-protected" }), { status: 200 }),
    logWriter: () => undefined,
  }));

  const result = await diagnostic({ connectionId: "connection-object-1" });

  assert.equal(result.status, "ready");
  assert.equal(result.forwardAccessProfile, "network-admin");
  assert.equal(result.checks.readOnlyPilot, "warning");
  assert.match(result.summary, /not declared Read Only/u);
});

test("rejects unexpected input without attempting a connection", async () => {
  let connectionLoads = 0;
  const diagnostic = createForwardConnectionDiagnostic(fixedOptions({
    loadConnection: async () => {
      connectionLoads += 1;
      return connection();
    },
    logWriter: () => undefined,
  }));

  const result = await diagnostic({ connectionId: "connection-object-1", secret: "no" });

  assert.equal(result.status, "blocked");
  assert.equal(result.reasonCode, "connection-configuration-invalid");
  assert.equal(connectionLoads, 0);
});
