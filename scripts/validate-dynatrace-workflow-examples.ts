#!/usr/bin/env node

import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

import forwardSync from "../api/forward-sync.function.ts";
import { createSyncForwardIntentAction } from "../actions/sync-forward-intent-checks.logic.ts";
import type { ForwardSyncRequest } from "../lib/types/forward.ts";

const examples = [
  "deploy/dynatrace-workflows/forward-sync-on-demand.payload.example.json",
  "deploy/dynatrace-workflows/forward-sync-schedule.payload.example.json",
  "deploy/dynatrace-workflows/forward-sync-problem.payload.example.json",
];

const isRecord = (value: unknown): value is Record<string, unknown> =>
  Boolean(value) && typeof value === "object" && !Array.isArray(value);

const parseRecord = (text: string, label: string): Record<string, unknown> => {
  const value: unknown = JSON.parse(text);
  if (!isRecord(value)) throw new Error(`${label} must be a JSON object.`);
  return value;
};

const jsonResponse = (value: unknown): Response => new Response(JSON.stringify(value), {
  status: 200,
  headers: { "content-type": "application/json" },
});

for (const example of examples) {
  const payload = JSON.parse(await readFile(example, "utf8")) as ForwardSyncRequest;
  const preview = forwardSync(payload);
  assert.equal(preview.status, "ready", `${example} should produce a ready plan preview`);
  assert.ok(preview.intentCheckCount > 0, `${example} should generate intent checks`);
  const manifest = parseRecord(preview.exportManifestPreview, `${example} manifest`);
  assert.equal(manifest.requestedIngestPath, "direct-api");
  assert.ok(isRecord(manifest.source));
  assert.equal(manifest.source.writePolicy, "dynatrace-app-backend-calls-forward-api");

  const action = createSyncForwardIntentAction({
    loadConnection: () => Promise.resolve({
      schemaId: "forward-api-connection",
      value: {
        name: "validation",
        baseUrl: "https://forward.example.com/api",
        networkId: "network-1",
        credentialVaultId: "CREDENTIALS_VAULT-0000000000000001",
        forwardAccessProfile: payload.forwardAccessProfile,
      },
    }),
    loadCredential: () => Promise.resolve({
      type: "USERNAME_PASSWORD",
      username: "validation-user",
      password: "validation-password",
    }),
    fetchImpl: (input, options) => {
      const url = input instanceof Request
        ? input.url
        : input instanceof URL
          ? input.href
          : input;
      if (url.endsWith("/api/public/csrf")) {
        return Promise.resolve(jsonResponse({ headerName: "X-CSRF-TOKEN", token: "validation-csrf" }));
      }
      if (url.endsWith("/snapshots/latestProcessed")) {
        return Promise.resolve(jsonResponse({ id: "snapshot-1", state: "PROCESSED", createdAt: "2026-07-18T12:00:00Z" }));
      }
      if (url.includes("/hosts/")) {
        const isSource = url.includes("checkout") || url.includes("frontend") || url.includes("source");
        return Promise.resolve(jsonResponse({ hosts: [{ subnets: [isSource ? "10.0.0.1" : "10.0.0.2"] }] }));
      }
      if (url.includes("/paths-bulk")) {
        const body = typeof options?.body === "string"
          ? JSON.parse(options.body) as { queries: unknown[] }
          : { queries: [] };
        return Promise.resolve(jsonResponse(body.queries.map(() => ({
          info: { paths: [{ forwardingOutcome: "DELIVERED", securityOutcome: "PERMITTED" }] },
        }))));
      }
      return Promise.resolve(jsonResponse({ checks: [] }));
    },
  });
  const result = await action({ connectionId: "validation", request: payload });
  assert.ok(isRecord(result));
  assert.equal(result.schemaVersion, "forward-dynatrace-direct-sync/v1");
  assert.equal(result.operation, "plan");
  assert.ok(isRecord(result.counts));
  assert.equal(result.counts.create, preview.intentCheckCount);
  assert.equal(JSON.stringify(result).includes("validation-password"), false);
}

const appConfig = JSON.parse(await readFile("app.config.json", "utf8")) as {
  app: { actions: Array<{ name: string }> };
};
assert.deepEqual(
  appConfig.app.actions.map((actionDefinition) => actionDefinition.name).sort(),
  ["run-forward-nqe-evidence", "sync-forward-intent-checks"],
);

const sampleResult = parseRecord(
  await readFile("assets/sync-forward-intent-checks.sample-result.json", "utf8"),
  "sync-forward-intent-checks sample result",
);
assert.equal(sampleResult.schemaVersion, "forward-dynatrace-direct-sync/v1");
assert.equal(sampleResult.boundary, "tenant-managed-secret-backend-only");
assert.equal("handoff" in sampleResult, false);

process.stdout.write("Dynatrace direct-API workflow examples passed.\n");
