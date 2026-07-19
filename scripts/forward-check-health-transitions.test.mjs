import assert from "node:assert/strict";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";

import {
  acquirePollLock,
  assertTransitionBound,
  computeTransitions,
  normalizeManagedInventory,
  publishTransitions,
} from "./forward-check-health-transitions.mjs";

const check = (key, status, tags = []) => ({
  id: `check-${key}`,
  status,
  perfMonitoringEnabled: true,
  tags: [
    "dynatrace",
    "managed-by:com.forward.dynatrace",
    "contract-version:1",
    "source-instance:dt-test-environment",
    `source-key:sha256:${key.repeat(64).slice(0, 64)}`,
    ...tags,
  ],
});

test("aggregates Forward performance health for managed checks only", () => {
  const inventory = normalizeManagedInventory(
    [check("a", "PASS"), check("b", "PASS"), { id: "other", status: "PASS", tags: ["other"] }],
    { "check-a": "HEALTHY", "check-b": "UNHEALTHY", other: "HEALTHY" },
  );
  const { batch } = computeTransitions(null, inventory, {
    generatedAt: "2026-01-01T00:00:00Z",
    networkId: "n",
    snapshotId: "s1",
  });
  assert.equal(batch.counts.performanceEnabled, 2);
  assert.equal(batch.counts.healthHealthy, 1);
  assert.equal(batch.counts.healthUnhealthy, 1);
});

test("baselines managed checks without emitting events", () => {
  const inventory = normalizeManagedInventory([check("a", "PASS"), { status: "FAIL", tags: ["other"] }]);
  const { batch } = computeTransitions(null, inventory, { generatedAt: "2026-01-01T00:00:00Z", networkId: "n", snapshotId: "s1" });
  assert.equal(batch.counts.tracked, 1);
  assert.equal(batch.counts.transitions, 0);
  assert.equal(batch.counts.healthUnknown, 1);
});

test("rejects duplicate managed identities and state from another network", () => {
  assert.throws(
    () => normalizeManagedInventory([check("a", "PASS"), check("a", "FAIL")]),
    /duplicate source-key/,
  );
  const baseline = computeTransitions(null, normalizeManagedInventory([check("a", "PASS")]), {
    generatedAt: "2026-01-01T00:00:00Z", networkId: "n1", snapshotId: "s1",
  });
  assert.throws(
    () => computeTransitions(baseline.nextState, [], {
      generatedAt: "2026-01-01T00:01:00Z", networkId: "n2", snapshotId: "s2",
    }),
    /does not match n2/,
  );
});

test("emits only bounded state transitions and is stable on repeat", () => {
  const first = normalizeManagedInventory([check("a", "PASS", ["owner:apps"]), check("b", "FAIL"), check("c", "PASS")]);
  const baseline = computeTransitions(null, first, { generatedAt: "2026-01-01T00:00:00Z", networkId: "n", snapshotId: "s1" });
  const second = normalizeManagedInventory([check("a", "FAIL", ["owner:apps"]), check("b", "PASS"), check("d", "ERROR")]);
  const changed = computeTransitions(baseline.nextState, second, { generatedAt: "2026-01-01T00:01:00Z", networkId: "n", snapshotId: "s2" });
  assert.deepEqual(changed.batch.transitions.map((item) => item.type).sort(), ["FAIL_TO_PASS", "MISSING", "PASS_TO_FAIL"]);
  assert.equal(changed.batch.transitions.some((item) => item.owner === "apps"), true);
  const repeated = computeTransitions(changed.nextState, second, { generatedAt: "2026-01-01T00:02:00Z", networkId: "n", snapshotId: "s2" });
  assert.equal(repeated.batch.counts.transitions, 0);
});

test("publishes a current health summary for an unchanged cycle", async () => {
  let called = false;
  const result = await publishTransitions({
    batch: {
      generatedAt: "2026-01-01T00:00:00Z",
      networkId: "n",
      snapshotId: "s",
      provenance: { source: "unit-test", synthetic: false },
      counts: {
        tracked: 1,
        performanceEnabled: 1,
        healthHealthy: 1,
        healthUnhealthy: 0,
        healthDisabled: 0,
        healthNotApplicable: 0,
        healthUnknown: 0,
      },
      transitions: [],
    },
    apiBaseUrl: "https://example.test",
    token: "secret",
    fetchImpl: async (_url, options) => {
      called = true;
      assert.equal(JSON.parse(options.body)[0]["event.type"], "forward.dynatrace.check.health.summary");
      return new Response("accepted", { status: 202 });
    },
  });
  assert.deepEqual(result, { published: 0, summaryPublished: 1, responseStatus: 202 });
  assert.equal(called, true);
});

test("bounds transition volume before publication or state advance", () => {
  assert.throws(
    () => assertTransitionBound({ transitions: Array.from({ length: 101 }, () => ({})) }),
    /exceeding the approved bound 100/,
  );
  assert.throws(
    () => assertTransitionBound({ transitions: [] }, 101),
    /between 1 and 100/,
  );
});

test("prevents overlapping pollers for one durable state", async () => {
  const directory = await mkdtemp(path.join(tmpdir(), "forward-check-health-lock-"));
  const statePath = path.join(directory, "state.json");
  const release = await acquirePollLock(statePath);
  await assert.rejects(() => acquirePollLock(statePath), /lock already exists/);
  await release();
  const releaseAgain = await acquirePollLock(statePath);
  await releaseAgain();
});

test("retries transient Dynatrace publication with stable event identity", async () => {
  let attempts = 0;
  const bodies = [];
  const result = await publishTransitions({
    batch: {
      generatedAt: "2026-01-01T00:00:00Z",
      networkId: "n",
      snapshotId: "s",
      provenance: { source: "unit-test", synthetic: false },
      counts: {
        tracked: 1,
        performanceEnabled: 1,
        healthHealthy: 0,
        healthUnhealthy: 1,
        healthDisabled: 0,
        healthNotApplicable: 0,
        healthUnknown: 0,
      },
      transitions: [{
        transitionId: "a".repeat(64),
        identityHash: "b".repeat(64),
        type: "PASS_TO_FAIL",
        before: "PASS",
        after: "FAIL",
        owner: null,
        service: "checkout",
      }],
    },
    apiBaseUrl: "https://example.test",
    token: "secret",
    sleepImpl: async () => {},
    fetchImpl: async (_url, options) => {
      attempts += 1;
      bodies.push(options.body);
      return new Response(attempts === 1 ? "busy" : "accepted", {
        status: attempts === 1 ? 503 : 202,
      });
    },
  });
  assert.equal(attempts, 2);
  assert.equal(bodies[0], bodies[1]);
  assert.equal(JSON.parse(bodies[0])[1]["event.id"], "a".repeat(64));
  assert.equal(JSON.parse(bodies[0])[0]["event.type"], "forward.dynatrace.check.health.summary");
  assert.deepEqual(result, { published: 1, summaryPublished: 1, responseStatus: 202 });
});
