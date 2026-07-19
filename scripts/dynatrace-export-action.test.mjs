import assert from "node:assert/strict";
import test from "node:test";

import {
  createSyncForwardIntentAction,
  validateConnection,
} from "../actions/sync-forward-intent-checks.logic.mjs";

const dependency = {
  id: "checkout-orders",
  appName: "Checkout",
  environment: "prod",
  serviceEntityId: "SERVICE-CHECKOUT",
  serviceName: "checkout-api",
  source: "10.0.0.1",
  destination: "10.0.0.2",
  protocol: "tcp",
  port: "443",
  owner: "commerce-platform",
  criticality: "critical",
  confidence: 100,
  mappingState: "ready",
};

const connection = (forwardAccessProfile = "read-only") => ({
  schemaId: "forward-api-connection",
  value: {
    name: "nonproduction",
    baseUrl: "https://forward.example.com/api",
    networkId: "network-1",
    username: "service-user",
    password: "service-password",
    forwardAccessProfile,
  },
});

const request = (forwardAccessProfile = "read-only", overrides = {}) => ({
  sourceInstanceId: "dt-test-environment",
  syncMode: "direct-api",
  forwardAccessProfile,
  operation: "plan",
  dependencies: [dependency],
  ...overrides,
});

const response = (value, status = 200) => new Response(
  value === null ? "" : JSON.stringify(value),
  { status, headers: { "content-type": "application/json" } },
);

const harness = ({ profile = "read-only", initialChecks = [] } = {}) => {
  const calls = [];
  const checks = structuredClone(initialChecks);
  let nextId = 100;
  const fetchImpl = async (url, options) => {
    calls.push({
      url,
      method: options.method,
      authorization: options.headers.Authorization,
      csrfToken: options.headers["X-CSRF-TOKEN"],
      body: options.body,
    });
    if (url.endsWith("/api/public/csrf")) {
      assert.equal(options.headers.Authorization, undefined);
      return response({ headerName: "X-CSRF-TOKEN", token: "csrf-test-token" });
    }
    if (url.endsWith("/api/networks/network-1/snapshots/latestProcessed")) {
      return response({ id: "snapshot-1", state: "PROCESSED", createdAt: "2026-07-18T12:00:00Z" });
    }
    const hostMatch = url.match(/\/api\/networks\/network-1\/hosts\/([^?]+)\?snapshotId=snapshot-1$/u);
    if (hostMatch) {
      const host = decodeURIComponent(hostMatch[1]);
      return response({
        hosts: [{ name: host, subnets: [host.startsWith("frontend") ? "10.0.0.1" : "10.0.0.2"] }],
      });
    }
    if (url.endsWith("/api/networks/network-1/paths-bulk?snapshotId=snapshot-1")) {
      return response(JSON.parse(options.body).queries.map(() => ({
        info: { paths: [{ forwardingOutcome: "DELIVERED", securityOutcome: "PERMITTED" }] },
      })));
    }
    if (url.endsWith("/api/snapshots/snapshot-1/checks?type=Existential")) {
      return response({ checks });
    }
    if (url.endsWith("/api/snapshots/snapshot-1/checks?bulk") && options.method === "POST") {
      for (const check of JSON.parse(options.body)) checks.push({ ...check, id: String(nextId++) });
      return response({ created: true }, 201);
    }
    const patchMatch = url.match(/\/api\/snapshots\/snapshot-1\/checks\/(.+)$/u);
    if (patchMatch && options.method === "PATCH") {
      const index = checks.findIndex((check) => String(check.id) === decodeURIComponent(patchMatch[1]));
      assert.notEqual(index, -1);
      checks[index] = { ...JSON.parse(options.body), id: checks[index].id };
      return response(checks[index]);
    }
    throw new Error(`Unexpected Forward API request: ${options.method} ${url}`);
  };
  return {
    action: createSyncForwardIntentAction({
      loadConnection: async (connectionId) => {
        assert.equal(connectionId, "connection-1");
        return connection(profile);
      },
      fetchImpl,
    }),
    calls,
    checks,
  };
};

test("Read Only connection plans direct API creates without mutating Forward", async () => {
  const { action, calls } = harness();
  const result = await action({ connectionId: "connection-1", request: request() });
  assert.equal(result.schemaVersion, "forward-dynatrace-direct-sync/v1");
  assert.equal(result.operation, "plan");
  assert.equal(result.forwardAccessProfile, "read-only");
  assert.deepEqual(result.target, { networkId: "network-1", snapshotId: "snapshot-1" });
  assert.deepEqual(result.counts, { create: 1, unchanged: 0, changed: 0, stale: 0, collision: 0 });
  assert.deepEqual(result.collisionSourceKeys, []);
  assert.deepEqual(result.collisionReasonCounts, {});
  assert.equal(result.hostResolution.counts.ready, 1);
  assert.equal(result.pathEvidence.counts.reachable, 1);
  assert.deepEqual(result.mutationCounts, { created: 0, updated: 0 });
  assert.equal(calls.length, 4);
  assert.equal(
    calls.some((call) => call.method !== "GET" && call.url.includes("/checks")),
    false,
  );
  assert.equal(calls.every((call) => call.url.startsWith("https://forward.example.com/api/")), true);
  assert.equal(JSON.stringify(result).includes("service-password"), false);
  assert.equal(JSON.stringify(result).includes("service-user"), false);
});

test("Network Operator remains plan-only", async () => {
  const { action, calls } = harness({ profile: "network-operator" });
  const plan = await action({ connectionId: "connection-1", request: request("network-operator") });
  await assert.rejects(
    action({
      connectionId: "connection-1",
      request: request("network-operator", { operation: "apply", approvedPlanDigest: plan.planDigest }),
    }),
    /Only a Network Admin connection may apply/,
  );
  assert.equal(
    calls.some((call) => call.method !== "GET" && call.url.includes("/checks")),
    false,
  );
});

test("Network Admin creates only after exact immutable plan approval and verifies readback", async () => {
  const { action, calls, checks } = harness({ profile: "network-admin" });
  const plan = await action({ connectionId: "connection-1", request: request("network-admin") });
  const result = await action({
    connectionId: "connection-1",
    request: request("network-admin", {
      operation: "apply",
      approvedPlanDigest: plan.planDigest,
      approvedSourceKeys: [],
    }),
  });
  assert.deepEqual(result.mutationCounts, { created: 1, updated: 0 });
  assert.equal(result.postApplyVerification, "verified");
  assert.equal(result.counts.unchanged, 1);
  assert.equal(checks.length, 1);
  assert.equal(
    calls.filter((call) => call.method === "POST" && call.url.includes("/checks?bulk")).length,
    1,
  );
  assert.equal(calls.filter((call) => call.method === "PATCH").length, 0);
  assert.equal(calls.filter((call) => call.url.endsWith("/api/public/csrf")).length, 2);
  assert.equal(
    calls.find((call) => call.method === "POST" && call.url.includes("/checks?bulk")).csrfToken,
    "csrf-test-token",
  );
});

test("Network Admin updates only the exact approved managed source keys", async () => {
  const seed = harness({ profile: "network-admin" });
  const createPlan = await seed.action({ connectionId: "connection-1", request: request("network-admin") });
  await seed.action({
    connectionId: "connection-1",
    request: request("network-admin", { operation: "apply", approvedPlanDigest: createPlan.planDigest }),
  });
  seed.checks[0].note = `${seed.checks[0].note}; drifted=true`;
  const updatePlan = await seed.action({ connectionId: "connection-1", request: request("network-admin") });
  assert.equal(updatePlan.counts.changed, 1);
  const changedKey = seed.checks[0].tags.find((tag) => tag.startsWith("source-key:"));
  assert.deepEqual(updatePlan.changedSourceKeys, [changedKey]);
  assert.deepEqual(updatePlan.staleSourceKeys, []);
  await assert.rejects(
    seed.action({
      connectionId: "connection-1",
      request: request("network-admin", {
        operation: "apply",
        approvedPlanDigest: updatePlan.planDigest,
        approvedSourceKeys: [],
      }),
    }),
    /approvedSourceKeys must exactly match/,
  );
  const result = await seed.action({
    connectionId: "connection-1",
    request: request("network-admin", {
      operation: "apply",
      approvedPlanDigest: updatePlan.planDigest,
      approvedSourceKeys: [changedKey],
    }),
  });
  assert.deepEqual(result.mutationCounts, { created: 0, updated: 1 });
  assert.equal(result.postApplyVerification, "verified");
  assert.equal(seed.calls.filter((call) => call.url.endsWith("/api/public/csrf")).length, 5);
  assert.equal(seed.calls.find((call) => call.method === "PATCH").csrfToken, "csrf-test-token");
});

test("Direct sync plans expose safe collision evidence without mutating Forward", async () => {
  const seed = harness({ profile: "network-admin" });
  const createPlan = await seed.action({ connectionId: "connection-1", request: request("network-admin") });
  await seed.action({
    connectionId: "connection-1",
    request: request("network-admin", { operation: "apply", approvedPlanDigest: createPlan.planDigest }),
  });
  const sourceKey = seed.checks[0].tags.find((tag) => tag.startsWith("source-key:"));
  seed.checks[0].tags = [];

  const collisionPlan = await seed.action({
    connectionId: "connection-1",
    request: request("network-admin"),
  });

  assert.equal(collisionPlan.counts.collision, 1);
  assert.deepEqual(collisionPlan.collisionSourceKeys, [sourceKey]);
  assert.deepEqual(collisionPlan.collisionReasonCounts, { "name-owned-by-another-check": 1 });
  assert.deepEqual(collisionPlan.mutationCounts, { created: 0, updated: 0 });
});

test("plan resolves host evidence and runs bounded modeled path preflight", async () => {
  const { action, calls } = harness();
  const namedDependency = {
    ...dependency,
    source: "frontend.example",
    destination: "backend.example",
    mappingState: "review",
    confidence: 99,
  };
  const result = await action({
    connectionId: "connection-1",
    request: request("read-only", { dependencies: [namedDependency] }),
  });
  assert.deepEqual(result.hostResolution.counts, {
    total: 1,
    ready: 1,
    review: 0,
    needsMap: 0,
    ambiguous: 0,
    unresolved: 0,
  });
  assert.equal(result.pathEvidence.modeledReachabilityAssessment, "no-modeled-policy-block");
  assert.equal(calls.filter((call) => call.url.includes("/hosts/")).length, 2);
  assert.equal(calls.filter((call) => call.url.includes("/paths-bulk")).length, 1);
});

test("connection and request validation fail closed", async () => {
  assert.throws(
    () => validateConnection({ ...connection(), value: { ...connection().value, baseUrl: "http://forward.example.com/api" } }),
    /must use HTTPS/,
  );
  assert.throws(
    () => validateConnection({ ...connection(), value: { ...connection().value, baseUrl: "https://forward.example.com" } }),
    /must end with \/api/,
  );
  const { action } = harness();
  await assert.rejects(
    action({ connectionId: "connection-1", request: request("network-operator") }),
    /profiles must match exactly/,
  );
  await assert.rejects(
    action({ connectionId: "connection-1", request: request("read-only", { unexpected: true }) }),
    /unsupported fields: unexpected/,
  );
  await assert.rejects(
    action({ connectionId: "connection-1", request: request("read-only", { dependencies: [] }) }),
    /No dependency rows selected/,
  );
});
