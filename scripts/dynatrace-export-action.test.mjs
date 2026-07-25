import assert from "node:assert/strict";
import test from "node:test";

import {
  createSyncForwardIntentAction,
} from "../actions/sync-forward-intent-checks.logic.ts";
import {
  createForwardClient,
  parseCheckList,
} from "../lib/forward-client.ts";
import {
  validateConnection,
} from "../lib/forward-connection.ts";
import {
  dependencySourceKeyTag,
  MANAGED_BY_TAG,
  CONTRACT_VERSION_TAG,
} from "../lib/managed-check-identity.ts";

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

const harness = ({
  profile = "read-only",
  initialChecks = [],
  fetchMock,
} = {}) => {
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
    if (typeof fetchMock === "function") {
      const override = await fetchMock({
        url,
        options,
        calls,
        checks,
      });
      if (override !== undefined) {
        return override;
      }
    }
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

test("apply with runPathPreflight disabled is rejected before any Forward API call", async () => {
  const { action, calls } = harness({ profile: "network-admin" });
  await assert.rejects(
    action({
      connectionId: "connection-1",
      request: request("network-admin", {
        operation: "apply",
        runPathPreflight: false,
        approvedPlanDigest: "0".repeat(64),
      }),
    }),
    /runPathPreflight must not be disabled for apply/,
  );
  assert.equal(calls.length, 0);
});

test("apply is rejected when path preflight reports failed / ambiguous / unmapped rows", async () => {
  const failedPath = harness({
    profile: "network-admin",
    fetchMock: ({ url, options }) => {
      if (url.endsWith("/networks/network-1/paths-bulk?snapshotId=snapshot-1")) {
        const batchSize = JSON.parse(options.body).queries.length;
        return response(Array.from({ length: batchSize }, () => ({ error: true })));
      }
      return undefined;
    },
  });
  const failedPlan = await failedPath.action({
    connectionId: "connection-1",
    request: request("network-admin", { dependencies: [dependency] }),
  });
  await assert.rejects(
    failedPath.action({
      connectionId: "connection-1",
      request: request("network-admin", {
        operation: "apply",
        approvedPlanDigest: failedPlan.planDigest,
      }),
    }),
    /Forward apply is blocked by incomplete modeled path evidence/,
  );

  const ambiguousPath = harness({
    profile: "network-admin",
    fetchMock: ({ url, options }) => {
      if (url.endsWith("/api/networks/network-1/paths-bulk?snapshotId=snapshot-1")) {
        const batchSize = JSON.parse(options.body).queries.length;
        return response(Array.from({ length: batchSize }, () => ({ timedOut: true })));
      }
      return undefined;
    },
  });
  const ambiguousPlan = await ambiguousPath.action({
    connectionId: "connection-1",
    request: request("network-admin", { dependencies: [dependency] }),
  });
  await assert.rejects(
    ambiguousPath.action({
      connectionId: "connection-1",
      request: request("network-admin", {
        operation: "apply",
        approvedPlanDigest: ambiguousPlan.planDigest,
      }),
    }),
    /Forward apply is blocked by incomplete modeled path evidence/,
  );

  const needsMapDependency = {
    ...dependency,
    id: "needs-map-only",
    mappingState: "needs-map",
    serviceEntityId: "",
    source: "",
    destination: "",
  };
  const unmappedPlan = await failedPath.action({
    connectionId: "connection-1",
    request: request("network-admin", {
      dependencies: [dependency, needsMapDependency],
    }),
  });
  await assert.rejects(
    failedPath.action({
      connectionId: "connection-1",
      request: request("network-admin", {
        operation: "apply",
        approvedPlanDigest: unmappedPlan.planDigest,
      }),
    }),
    /Forward apply is blocked by incomplete modeled path evidence/,
  );
});

test("protocol values are strictly validated before Forward planning", async () => {
  const { action } = harness();
  await assert.rejects(
    action({ connectionId: "connection-1", request: request("read-only", {
      dependencies: [{ ...dependency, protocol: "sctp" }],
    }) }),
    /dependencies\[0\]\.protocol must be tcp or udp/,
  );
  await assert.rejects(
    action({ connectionId: "connection-1", request: request("read-only", {
      dependencies: [{ ...dependency, protocol: "TCP" }],
    }) }),
    /dependencies\[0\]\.protocol must be tcp or udp/,
  );
  await assert.rejects(
    action({ connectionId: "connection-1", request: request("read-only", {
      dependencies: [{ ...dependency, protocol: 6 }],
    }) }),
    /dependencies\[0\]\.protocol must be tcp or udp/,
  );
});

test("ports are rejected unless they are decimal strings 1-65535", async () => {
  const { action } = harness();
  for (const port of ["0", "65536", "80x", 80, ""]) {
    await assert.rejects(
      action({
        connectionId: "connection-1",
        request: request("read-only", {
          dependencies: [{ ...dependency, port }],
        }),
      }),
      /dependencies\[0\]\.port must be a decimal string from 1 through 65535/,
    );
  }
});

test("invalid confidence, criticality, mapping-state, and unknown fields are rejected", async () => {
  const { action } = harness();
  await assert.rejects(
    action({
      connectionId: "connection-1",
      request: request("read-only", {
        dependencies: [{ ...dependency, confidence: 99.9 }],
      }),
    }),
    /dependencies\[0\]\.confidence must be an integer from 0 through 100/,
  );
  await assert.rejects(
    action({
      connectionId: "connection-1",
      request: request("read-only", {
        dependencies: [{ ...dependency, confidence: 101 }],
      }),
    }),
    /dependencies\[0\]\.confidence must be an integer from 0 through 100/,
  );
  await assert.rejects(
    action({
      connectionId: "connection-1",
      request: request("read-only", {
        dependencies: [{ ...dependency, confidence: -1 }],
      }),
    }),
    /dependencies\[0\]\.confidence must be an integer from 0 through 100/,
  );
  await assert.rejects(
    action({
      connectionId: "connection-1",
      request: request("read-only", {
        dependencies: [{ ...dependency, criticality: "bogus" }],
      }),
    }),
    /dependencies\[0\]\.criticality must be critical, high, medium, or low/,
  );
  await assert.rejects(
    action({
      connectionId: "connection-1",
      request: request("read-only", {
        dependencies: [{ ...dependency, mappingState: "bogus" }],
      }),
    }),
    /dependencies\[0\]\.mappingState must be ready, needs-map, or review/,
  );
  await assert.rejects(
    action({
      connectionId: "connection-1",
      request: request("read-only", {
        dependencies: [{ ...dependency, unexpected: "field" }],
      }),
    }),
    /dependencies\[0\] contains unsupported fields: unexpected/,
  );
});

test("needs-map row with blank identity fields is accepted by request validation and planning", async () => {
  const { action } = harness({ profile: "read-only" });
  const result = await action({
    connectionId: "connection-1",
    request: request("read-only", {
      dependencies: [
        dependency,
        {
          ...dependency,
          id: "needs-map-only",
          mappingState: "needs-map",
          serviceEntityId: "",
          source: "",
          destination: "",
        },
      ],
    }),
  });
  assert.equal(result.counts.create, 1);
  assert.equal(result.hostResolution.counts.needsMap, 1);
  assert.equal(result.pathEvidence.counts.unmapped, 1);
});

test("duplicate dependency identifiers are rejected", async () => {
  const { action } = harness();
  await assert.rejects(
    action({
      connectionId: "connection-1",
      request: request("read-only", {
        dependencies: [
          { ...dependency },
          { ...dependency, id: "checkout-orders" },
        ],
      }),
    }),
    /dependencies contains duplicate dependency identifiers: checkout-orders/,
  );
});

test("existing foreign-source-instance managed check is a collision and blocks apply", async () => {
  const foreignSourceKey = dependencySourceKeyTag(dependency, {
    sourceInstanceId: "dt-test-environment",
  });
  const { action, calls } = harness({
    profile: "network-admin",
    initialChecks: [{
      id: "already-managed",
      name: "foreign-source-instance",
      definition: {},
      enabled: true,
      perfMonitoringEnabled: false,
      tags: [
        MANAGED_BY_TAG,
        CONTRACT_VERSION_TAG,
        foreignSourceKey,
        "source-instance:other-instance",
      ],
    }],
  });
  const collisionPlan = await action({
    connectionId: "connection-1",
    request: request("network-admin"),
  });
  assert.equal(collisionPlan.counts.collision, 1);
  assert.deepEqual(collisionPlan.collisionReasonCounts, { "foreign-source-instance": 1 });
  const plannedDigest = collisionPlan.planDigest;
  await assert.rejects(
    action({
      connectionId: "connection-1",
      request: request("network-admin", {
        operation: "apply",
        approvedPlanDigest: plannedDigest,
      }),
    }),
    /Forward apply is blocked by managed identity or name collisions/,
  );
  assert.equal(calls.some((call) => call.method === "PATCH"), false);
  assert.equal(calls.some((call) => call.method === "POST" && call.url.includes("/checks?bulk")), false);
});

test("duplicate existing managed source keys are a collision and block apply", async () => {
  const seed = harness({ profile: "network-admin" });
  const createPlan = await seed.action({
    connectionId: "connection-1",
    request: request("network-admin"),
  });
  await seed.action({
    connectionId: "connection-1",
    request: request("network-admin", {
      operation: "apply",
      approvedPlanDigest: createPlan.planDigest,
    }),
  });
  const sourceKey = seed.checks[0].tags.find((tag) => tag.startsWith("source-key:"));
  seed.checks.push({
    ...structuredClone(seed.checks[0]),
    id: "duplicate-managed",
  });
  seed.calls.length = 0;

  const collisionPlan = await seed.action({
    connectionId: "connection-1",
    request: request("network-admin"),
  });
  assert.equal(collisionPlan.counts.collision, 1);
  assert.deepEqual(collisionPlan.collisionSourceKeys, [sourceKey]);
  assert.deepEqual(collisionPlan.collisionReasonCounts, {
    "duplicate-existing-source-key": 1,
  });
  await assert.rejects(
    seed.action({
      connectionId: "connection-1",
      request: request("network-admin", {
        operation: "apply",
        approvedPlanDigest: collisionPlan.planDigest,
      }),
    }),
    /Forward apply is blocked by managed identity or name collisions/,
  );
  assert.equal(seed.calls.filter((call) => call.method === "PATCH").length, 0);
  assert.equal(
    seed.calls.filter((call) => call.method === "POST" && call.url.includes("/checks?bulk")).length,
    0,
  );
});

test("plan digest binds existing check fingerprints while change bucket membership stays stable", async () => {
  const seed = harness({ profile: "network-admin" });
  const createPlan = await seed.action({ connectionId: "connection-1", request: request("network-admin") });
  await seed.action({
    connectionId: "connection-1",
    request: request("network-admin", {
      operation: "apply",
      approvedPlanDigest: createPlan.planDigest,
    }),
  });
  seed.checks[0].note = `${seed.checks[0].note}; drift-a`;
  const firstDigestPlan = await seed.action({ connectionId: "connection-1", request: request("network-admin") });
  seed.checks[0].note = `${seed.checks[0].note}; drift-b`;
  const secondDigestPlan = await seed.action({ connectionId: "connection-1", request: request("network-admin") });
  assert.notEqual(firstDigestPlan.planDigest, secondDigestPlan.planDigest);
});

test("plan digest binds mutation budgets", async () => {
  const seed = harness({ profile: "network-admin" });
  const defaultDigest = await seed.action({ connectionId: "connection-1", request: request("network-admin") });
  const limitedBudgetDigest = await seed.action({
    connectionId: "connection-1",
    request: request("network-admin", { maxCreates: 1, maxUpdates: 1 }),
  });
  assert.notEqual(defaultDigest.planDigest, limitedBudgetDigest.planDigest);
});

test("stale plan digests are rejected after drift", async () => {
  const seed = harness({ profile: "network-admin" });
  const plan = await seed.action({
    connectionId: "connection-1",
    request: request("network-admin"),
  });
  await seed.action({
    connectionId: "connection-1",
    request: request("network-admin", {
      operation: "apply",
      approvedPlanDigest: plan.planDigest,
    }),
  });
  const verifiedPlan = await seed.action({
    connectionId: "connection-1",
    request: request("network-admin"),
  });
  seed.checks[0].note = `${seed.checks[0].note}; stale`;
  await assert.rejects(
    seed.action({
      connectionId: "connection-1",
      request: request("network-admin", {
        operation: "apply",
        approvedPlanDigest: verifiedPlan.planDigest,
      }),
    }),
    /approvedPlanDigest does not match the current immutable plan/,
  );
});

test("parseCheckList accepts arrays and named containers and rejects ambiguous pagination/shapes", async () => {
  assert.deepEqual(parseCheckList([{ id: "alpha" }, { id: "beta" }]), [{ id: "alpha" }, { id: "beta" }]);
  assert.deepEqual(parseCheckList({ checks: [{ id: "alpha" }] }), [{ id: "alpha" }]);
  assert.deepEqual(parseCheckList({ items: [{ id: "alpha" }, { id: "beta" }] }), [{ id: "alpha" }, { id: "beta" }]);
  assert.deepEqual(parseCheckList({ checks: [{ id: "a" }], totalCount: 1 }), [{ id: "a" }]);

  assert.throws(() => parseCheckList({}), /unsupported response shape/);
  assert.throws(() => parseCheckList("bad"), /unsupported response shape/);
  assert.throws(() => parseCheckList({ checks: [], nextPageToken: "token" }), /is paginated/);
  assert.throws(() => parseCheckList({ checks: [], nextPage: "next" }), /is paginated/);
  assert.throws(() => parseCheckList({ checks: [], nextCursor: "cursor" }), /is paginated/);
  assert.throws(() => parseCheckList({ checks: [{ id: 1 }], totalCount: 2 }), /returned 1 of 2 checks/);
  assert.throws(() => parseCheckList({ checks: [], hasMore: true }), /additional pages/);
  assert.throws(() => parseCheckList({ checks: [], isLast: false }), /additional pages/);
});

test("GET requests are retried on transient errors", async () => {
  const snapshotAttempts = { count: 0 };
  const { action, calls } = harness({
    profile: "read-only",
    fetchMock: ({ url, options }) => {
      if (options.method === "GET" && url.endsWith("/api/networks/network-1/snapshots/latestProcessed")) {
        snapshotAttempts.count += 1;
        if (snapshotAttempts.count === 1) {
          return response({}, 503);
        }
      }
      return undefined;
    },
  });
  await action({ connectionId: "connection-1", request: request("read-only") });
  assert.equal(snapshotAttempts.count, 2);
  assert.equal(calls.filter((call) => call.method === "GET" && call.url.includes("/snapshots/latestProcessed")).length, 2);
});

test("/paths-bulk is retried when called with a transient status", async () => {
  const pathAttempts = { count: 0 };
  const { action, calls } = harness({
    profile: "read-only",
    fetchMock: ({ url }) => {
      if (url.endsWith("/api/networks/network-1/paths-bulk?snapshotId=snapshot-1")) {
        pathAttempts.count += 1;
        if (pathAttempts.count === 1) {
          return response({}, 503);
        }
      }
      return undefined;
    },
  });
  await action({
    connectionId: "connection-1",
    request: request("read-only", { dependencies: [dependency] }),
  });
  assert.equal(pathAttempts.count, 2);
  assert.equal(calls.filter((call) => call.url.includes("/paths-bulk")).length, 2);
});

test("mutating POST is not retried after transient failures", async () => {
  const postAttempts = { count: 0 };
  const seed = harness({
    profile: "network-admin",
    fetchMock: ({ url, options }) => {
      if (options.method === "POST" && url.includes("/checks?bulk")) {
        postAttempts.count += 1;
        if (postAttempts.count === 1) {
          return response({}, 503);
        }
      }
      return undefined;
    },
  });
  const createPlan = await seed.action({
    connectionId: "connection-1",
    request: request("network-admin"),
  });
  await assert.rejects(
    seed.action({
      connectionId: "connection-1",
      request: request("network-admin", {
        operation: "apply",
        approvedPlanDigest: createPlan.planDigest,
      }),
    }),
    /Forward apply stopped with HTTP 503/,
  );
  assert.equal(postAttempts.count, 1);
});

test("mutating PATCH is not retried after transient failures", async () => {
  const patchAttempts = { count: 0 };
  const seed = harness({
    profile: "network-admin",
    fetchMock: ({ url, options }) => {
      if (options.method === "PATCH" && url.includes("/api/snapshots/snapshot-1/checks/")) {
        patchAttempts.count += 1;
        if (patchAttempts.count === 1) {
          return response({}, 503);
        }
      }
      return undefined;
    },
  });
  const createPlan = await seed.action({
    connectionId: "connection-1",
    request: request("network-admin"),
  });
  await seed.action({
    connectionId: "connection-1",
    request: request("network-admin", {
      operation: "apply",
      approvedPlanDigest: createPlan.planDigest,
    }),
  });
  seed.checks[0].note = `${seed.checks[0].note}; drifted-before-patch`;
  const updatePlan = await seed.action({
    connectionId: "connection-1",
    request: request("network-admin"),
  });
  await assert.rejects(
    seed.action({
      connectionId: "connection-1",
      request: request("network-admin", {
        operation: "apply",
        approvedPlanDigest: updatePlan.planDigest,
        approvedSourceKeys: updatePlan.changedSourceKeys,
      }),
    }),
    /Forward apply stopped with HTTP 503/,
  );
  assert.equal(patchAttempts.count, 1);
});

test("read-only GET requests retry on network errors without a response", async () => {
  const attempts = { count: 0 };
  const { action } = harness({
    profile: "read-only",
    fetchMock: ({ url }) => {
      if (url.endsWith("/api/networks/network-1/snapshots/latestProcessed")) {
        attempts.count += 1;
        if (attempts.count === 1) {
          throw new Error("simulated network reset");
        }
      }
      return undefined;
    },
  });
  await action({ connectionId: "connection-1", request: request("read-only") });
  assert.equal(attempts.count, 2);
});

test("mutating requests do not retry after network errors", async () => {
  const createAttempts = { count: 0 };
  const seed = harness({
    profile: "network-admin",
    fetchMock: ({ url, options }) => {
      if (options.method === "POST" && url.includes("/checks?bulk")) {
        createAttempts.count += 1;
        if (createAttempts.count === 1) {
          throw new Error("simulated network reset");
        }
      }
      return undefined;
    },
  });
  const plan = await seed.action({
    connectionId: "connection-1",
    request: request("network-admin"),
  });
  await assert.rejects(
    seed.action({
      connectionId: "connection-1",
      request: request("network-admin", {
        operation: "apply",
        approvedPlanDigest: plan.planDigest,
      }),
    }),
    /Forward apply stopped with HTTP unknown; reconcile current state and stage a new plan\./,
  );
  assert.equal(createAttempts.count, 1);
});

test("HTTP redirects are rejected explicitly", async () => {
  const { action } = harness({
    profile: "read-only",
    fetchMock: ({ url }) => {
      if (url.endsWith("/api/networks/network-1/snapshots/latestProcessed")) {
        return new Response("", { status: 302, headers: { Location: "https://malicious.example.com/" } });
      }
      return undefined;
    },
  });
  await assert.rejects(
    action({ connectionId: "connection-1", request: request("read-only") }),
    /was redirected with HTTP 302/,
  );
});

test("mutating CSRF token is refreshed at most once and then reused", async () => {
  const calls = [];
  let csrfRefreshCount = 0;
  let pathsAttempts = 0;
  const client = createForwardClient({
    connection: {
      baseUrl: "https://forward.example.com/api",
      authorization: "Basic ignore",
      forwardAccessProfile: "network-admin",
      approvedLibraryQueryIds: [],
      approvedQueryDigests: [],
    },
    fetchImpl: (url, options) => {
      calls.push({ method: options.method, url });
      if (url.endsWith("/api/public/csrf")) {
        csrfRefreshCount += 1;
        return Promise.resolve(new Response(
          JSON.stringify({
            headerName: "X-CSRF-TOKEN",
            token: `token-${csrfRefreshCount}`,
          }),
          { status: 200, headers: { "content-type": "application/json" } },
        ));
      }
      if (url.endsWith("/api/networks/network-1/paths-bulk?snapshotId=snapshot-1")) {
        pathsAttempts += 1;
        if (pathsAttempts === 1) {
          return Promise.resolve(
            new Response(
              JSON.stringify({ message: "CSRF token missing" }),
              { status: 403, headers: { "content-type": "application/json" } },
            ),
          );
        }
      }
      const pathRows = Array.from({ length: pathsAttempts }, () => ({
        info: { paths: [{ forwardingOutcome: "DELIVERED", securityOutcome: "PERMITTED" }] },
      }));
      return Promise.resolve(
        new Response(
          JSON.stringify(pathRows),
          { status: 200, headers: { "content-type": "application/json" } },
        ),
      );
    },
  });
  const result = await client(
    "POST",
    "/networks/network-1/paths-bulk?snapshotId=snapshot-1",
    { queries: [] },
    { retryable: true },
  );
  assert.equal(Array.isArray(result), true);
  assert.equal(csrfRefreshCount, 2);
  assert.equal(pathsAttempts, 2);
  const csrfCalls = calls.filter((call) => call.url.includes("/public/csrf"));
  assert.equal(csrfCalls.length, 2);
});

test("retry-after delay is bounded by the invocation deadline", async () => {
  const start = Date.now();
  const connection = {
    baseUrl: "https://forward.example.com/api",
    authorization: "Basic ignore",
    forwardAccessProfile: "read-only",
    approvedLibraryQueryIds: [],
    approvedQueryDigests: [],
  };
  const client = createForwardClient({
    connection,
    maxRetries: 1,
    invocationTimeoutMs: 120,
    timeoutMs: 120,
    fetchImpl: () => Promise.resolve(
      new Response("{}", {
        status: 503,
        headers: { "content-type": "application/json", "retry-after": "Mon, 01 Jan 2050 00:00:00 GMT" },
      }),
    ),
  });
  await assert.rejects(
    client("GET", "/api/networks/network-1/snapshots/latestProcessed"),
    /invocation deadline was exhausted|Forward API GET failed with HTTP 503|retry budget was exhausted/,
  );
  const elapsed = Date.now() - start;
  assert.ok(elapsed < 500);
});

test("oversized responses are rejected before full buffering", async () => {
  const client = createForwardClient({
    connection: {
      baseUrl: "https://forward.example.com/api",
      authorization: "Basic ignore",
      forwardAccessProfile: "read-only",
      approvedLibraryQueryIds: [],
      approvedQueryDigests: [],
    },
    timeoutMs: 120,
    fetchImpl: () => new Response(
      "{}",
      {
        status: 200,
        headers: {
          "content-type": "application/json",
          "content-length": String((5 * 1024 * 1024) + 1),
        },
      },
    ),
  });
  await assert.rejects(
    client("GET", "/api/networks/network-1/snapshots/latestProcessed"),
    /Forward API response exceeded the 5 MiB app-function bound/,
  );
});

test("retry delays include jitter with jittered exponential backoff", async () => {
  const start = Date.now();
  const oldRandom = Math.random;
  Math.random = () => 1;
  const fetches = { count: 0 };
  const client = createForwardClient({
    connection: {
      baseUrl: "https://forward.example.com/api",
      authorization: "Basic ignore",
      forwardAccessProfile: "read-only",
      approvedLibraryQueryIds: [],
      approvedQueryDigests: [],
    },
    timeoutMs: 50,
    maxRetries: 1,
    fetchImpl: () => {
      fetches.count += 1;
      if (fetches.count === 1) {
        return new Response("{}", { status: 503, headers: { "content-type": "application/json" } });
      }
      return new Response(JSON.stringify({}), { status: 200, headers: { "content-type": "application/json" } });
    },
  });
  try {
    await client("GET", "/api/networks/network-1/snapshots/latestProcessed");
  } finally {
    Math.random = oldRandom;
  }
  const elapsed = Date.now() - start;
  assert.equal(fetches.count, 2);
  assert.ok(elapsed >= 150);
  assert.ok(elapsed < 280);
});
