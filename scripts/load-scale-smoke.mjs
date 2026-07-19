#!/usr/bin/env node

import assert from "node:assert/strict";

import { createSyncForwardIntentAction } from "../actions/sync-forward-intent-checks.logic.mjs";

const relationshipCount = 1_000;
const iterations = Number.parseInt(process.env.FORWARD_DYNATRACE_SCALE_ITERATIONS || "1", 10);
assert.ok(Number.isInteger(iterations) && iterations >= 1 && iterations <= 1_000,
  "FORWARD_DYNATRACE_SCALE_ITERATIONS must be an integer from 1 through 1000");
const checks = [];
const bulkSizes = [];
let nextId = 1;

const dependencies = Array.from({ length: relationshipCount }, (_, index) => ({
  id: `relationship-${index + 1}`,
  appName: `application-${index % 40}`,
  environment: index % 3 === 0 ? "production" : "nonproduction",
  serviceEntityId: `SERVICE-${String(index + 1).padStart(5, "0")}`,
  serviceName: `service-${index + 1}`,
  source: `10.${Math.floor(index / 250)}.${Math.floor((index % 250) / 50)}.${(index % 50) + 1}`,
  destination: `172.20.${Math.floor(index / 250)}.${(index % 250) + 1}`,
  protocol: index % 17 === 0 ? "udp" : "tcp",
  port: String(4_000 + (index % 500)),
  owner: `team-${index % 20}`,
  criticality: index % 10 === 0 ? "critical" : index % 3 === 0 ? "high" : "medium",
  confidence: 100,
  mappingState: "ready",
}));

const jsonResponse = (value, status = 200) => new Response(JSON.stringify(value), {
  status,
  headers: { "content-type": "application/json" },
});

const fetchImpl = async (url, options) => {
  if (url.endsWith("/api/public/csrf")) {
    return jsonResponse({ headerName: "X-CSRF-TOKEN", token: "scale-csrf-token" });
  }
  if (url.endsWith("/api/networks/scale-network/snapshots/latestProcessed")) {
    return jsonResponse({ id: "snapshot-scale", state: "PROCESSED", createdAt: "2026-07-18T12:00:00Z" });
  }
  if (url.endsWith("/api/snapshots/snapshot-scale/checks?type=Existential")) {
    return jsonResponse({ checks });
  }
  if (url.endsWith("/api/snapshots/snapshot-scale/checks?bulk") && options.method === "POST") {
    const batch = JSON.parse(options.body);
    bulkSizes.push(batch.length);
    checks.push(...batch.map((check) => ({ ...check, id: String(nextId++) })));
    return jsonResponse({ created: batch.length }, 201);
  }
  throw new Error(`Unexpected scale request: ${options.method} ${url}`);
};

const action = createSyncForwardIntentAction({
  loadConnection: async () => ({
    schemaId: "forward-api-connection",
    value: {
      name: "scale",
      baseUrl: "https://forward.example.com/api",
      networkId: "scale-network",
      username: "scale-user",
      password: "scale-password",
      forwardAccessProfile: "network-admin",
    },
  }),
  fetchImpl,
});

const baseRequest = {
  sourceInstanceId: "dt-scale",
  syncMode: "direct-api",
  forwardAccessProfile: "network-admin",
  dependencies,
  maxCreates: relationshipCount,
  maxUpdates: 0,
  runPathPreflight: false,
};

const startedAt = performance.now();
const plan = await action({
  connectionId: "scale-connection",
  request: { ...baseRequest, operation: "plan" },
});
assert.deepEqual(plan.counts, {
  create: relationshipCount,
  unchanged: 0,
  changed: 0,
  stale: 0,
  collision: 0,
});

const applied = await action({
  connectionId: "scale-connection",
  request: {
    ...baseRequest,
    operation: "apply",
    approvedPlanDigest: plan.planDigest,
    approvedSourceKeys: [],
  },
});
assert.deepEqual(applied.mutationCounts, { created: relationshipCount, updated: 0 });
assert.equal(applied.postApplyVerification, "verified");
assert.equal(applied.counts.unchanged, relationshipCount);
assert.deepEqual(bulkSizes, Array(10).fill(100));

let maximumHeapBytes = process.memoryUsage().heapUsed;
for (let cycle = 2; cycle <= iterations; cycle += 1) {
  const repeatedPlan = await action({
    connectionId: "scale-connection",
    request: { ...baseRequest, operation: "plan" },
  });
  assert.deepEqual(repeatedPlan.counts, {
    create: 0,
    unchanged: relationshipCount,
    changed: 0,
    stale: 0,
    collision: 0,
  });
  maximumHeapBytes = Math.max(maximumHeapBytes, process.memoryUsage().heapUsed);
}

assert.deepEqual(bulkSizes, Array(10).fill(100), "repeat plans must not mutate Forward");

process.stdout.write(`${JSON.stringify({
  status: "ok",
  relationships: relationshipCount,
  cycles: iterations,
  batches: bulkSizes.length,
  maximumBatchSize: Math.max(...bulkSizes),
  maximumHeapMiB: Math.round(maximumHeapBytes / 1024 / 1024),
  elapsedMs: Math.round(performance.now() - startedAt),
}, null, 2)}\n`);
