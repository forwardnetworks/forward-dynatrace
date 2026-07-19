#!/usr/bin/env node

import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

import forwardSync from "../api/forward-sync.function.ts";
import { createSyncForwardIntentAction } from "../actions/sync-forward-intent-checks.logic.mjs";

const examples = [
  "deploy/dynatrace-workflows/forward-sync-on-demand.payload.example.json",
  "deploy/dynatrace-workflows/forward-sync-schedule.payload.example.json",
  "deploy/dynatrace-workflows/forward-sync-problem.payload.example.json",
];

const jsonResponse = (value) => new Response(JSON.stringify(value), {
  status: 200,
  headers: { "content-type": "application/json" },
});

for (const example of examples) {
  const payload = JSON.parse(await readFile(example, "utf8"));
  const preview = forwardSync(payload);
  assert.equal(preview.status, "ready", `${example} should produce a ready plan preview`);
  assert.ok(preview.intentCheckCount > 0, `${example} should generate intent checks`);
  const manifest = JSON.parse(preview.exportManifestPreview);
  assert.equal(manifest.requestedIngestPath, "direct-api");
  assert.equal(manifest.source.writePolicy, "dynatrace-app-backend-calls-forward-api");

  const action = createSyncForwardIntentAction({
    loadConnection: async () => ({
      schemaId: "forward-api-connection",
      value: {
        name: "validation",
        baseUrl: "https://forward.example.com/api",
        networkId: "network-1",
        username: "validation-user",
        password: "validation-password",
        forwardAccessProfile: payload.forwardAccessProfile,
      },
    }),
    fetchImpl: async (url, options) => {
      if (url.endsWith("/api/public/csrf")) {
        return jsonResponse({ headerName: "X-CSRF-TOKEN", token: "validation-csrf" });
      }
      if (url.endsWith("/snapshots/latestProcessed")) {
        return jsonResponse({ id: "snapshot-1", state: "PROCESSED", createdAt: "2026-07-18T12:00:00Z" });
      }
      if (url.includes("/hosts/")) {
        const isSource = url.includes("checkout") || url.includes("frontend") || url.includes("source");
        return jsonResponse({ hosts: [{ subnets: [isSource ? "10.0.0.1" : "10.0.0.2"] }] });
      }
      if (url.includes("/paths-bulk")) {
        return jsonResponse(JSON.parse(options.body).queries.map(() => ({
          info: { paths: [{ forwardingOutcome: "DELIVERED", securityOutcome: "PERMITTED" }] },
        })));
      }
      return jsonResponse({ checks: [] });
    },
  });
  const result = await action({ connectionId: "validation", request: payload });
  assert.equal(result.schemaVersion, "forward-dynatrace-direct-sync/v1");
  assert.equal(result.operation, "plan");
  assert.equal(result.counts.create, preview.intentCheckCount);
  assert.equal(JSON.stringify(result).includes("validation-password"), false);
}

const appConfig = JSON.parse(await readFile("app.config.json", "utf8"));
assert.deepEqual(
  appConfig.app.actions.map((actionDefinition) => actionDefinition.name).sort(),
  ["run-forward-nqe-evidence", "sync-forward-intent-checks"],
);

const sampleResult = JSON.parse(await readFile("assets/sync-forward-intent-checks.sample-result.json", "utf8"));
assert.equal(sampleResult.schemaVersion, "forward-dynatrace-direct-sync/v1");
assert.equal(sampleResult.boundary, "tenant-managed-secret-backend-only");
assert.equal("handoff" in sampleResult, false);

process.stdout.write("Dynatrace direct-API workflow examples passed.\n");
