import assert from "node:assert/strict";
import { test } from "node:test";

import {
  assertImportPlanMatches,
  buildImportPlan,
  validateImportPlan,
} from "./forward-import-plan.mjs";

const key = `source-key:sha256:${"a".repeat(64)}`;
const manifest = {
  packageId: "forward-dynatrace-test",
  integrity: { intentChecksSha256: "b".repeat(64) },
  source: { instanceTag: "source-instance:dt-test" },
};
const reconciliation = {
  create: [{ key, fingerprint: "c".repeat(64) }],
  unchanged: [],
  changed: [],
  stale: [],
  collision: [],
};
const input = {
  createdAt: "2026-07-17T12:00:00.000Z",
  manifest,
  manifestText: "{\"packageId\":\"forward-dynatrace-test\"}\n",
  packageSignatureStatus: "verified",
  networkId: "network-1",
  snapshotId: "snapshot-1",
  reconciliation,
  policy: {
    applyUpdates: false,
    deactivateStale: false,
    maxUpdates: 0,
    maxDeactivations: 0,
  },
};

test("builds and validates a deterministic immutable plan", () => {
  const first = buildImportPlan(input);
  const second = buildImportPlan(input);
  assert.deepEqual(second, first);
  assert.equal(validateImportPlan(first), first);
  assert.match(first.planId, /^forward-dynatrace-plan-[a-f0-9]{24}$/u);
});

test("rejects plan content changed after staging", () => {
  const plan = buildImportPlan(input);
  assert.throws(
    () => validateImportPlan({ ...plan, target: { ...plan.target, snapshotId: "snapshot-2" } }),
    /digest does not match/,
  );
});

test("requires current reconciliation to equal the staged plan", () => {
  const staged = buildImportPlan(input);
  const current = buildImportPlan({
    ...input,
    reconciliation: { ...reconciliation, create: [], unchanged: reconciliation.create },
  });
  assert.throws(
    () => assertImportPlanMatches(staged, current),
    /no longer matches/,
  );
});

test("rejects unsigned or internally inconsistent staged plans before digest comparison", () => {
  const plan = buildImportPlan(input);
  assert.throws(
    () =>
      validateImportPlan({
        ...plan,
        package: { ...plan.package, signatureStatus: "not-provided" },
      }),
    /signatureStatus must be verified/u,
  );
  assert.throws(
    () =>
      validateImportPlan({
        ...plan,
        counts: { ...plan.counts, create: 2 },
      }),
    /actions.create count must equal counts.create/u,
  );
});
