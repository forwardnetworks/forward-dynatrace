import assert from "node:assert/strict";
import { test } from "node:test";
import { pathToFileURL } from "node:url";

const moduleUrl = pathToFileURL(
  new URL("../ui/app/change-outcomes.ts", import.meta.url).pathname,
).href;
const { isBoundChangeOutcome, selectBoundChangeOutcomes } = await import(moduleUrl);

const checksum = "a".repeat(64);
const bound = (decision, suffix) => ({
  "forward.dynatrace.gate_run_id": `gate-${suffix}`,
  "forward.dynatrace.change_id": `CHG-${suffix}`,
  "forward.dynatrace.gate_decision": decision,
  "forward.dynatrace.network_id": "235937",
  "forward.dynatrace.before_snapshot_id": `before-${suffix}`,
  "forward.dynatrace.after_snapshot_id": `after-${suffix}`,
  "forward.dynatrace.before_reachable": 24,
  "forward.dynatrace.after_reachable": decision === "pass" ? 24 : 12,
  "forward.dynatrace.service_health": decision === "pass" ? "HEALTHY" : "UNHEALTHY",
  "forward.dynatrace.servicenow_evidence_sha256": checksum,
  "forward.dynatrace.servicenow_idempotency_key": `forward-dynatrace:${checksum}`,
  "forward.dynatrace.evidence_source": "checked-servicenow-demo-rehearsal",
  "forward.dynatrace.synthetic": true,
});

test("selects only explicitly classified checksum-bound pass and fail outcomes", () => {
  const records = [
    bound("fail", "newest-fail"),
    {
      "forward.dynatrace.gate_run_id": "legacy-pass",
      "forward.dynatrace.gate_decision": "pass",
    },
    bound("pass", "newest-pass"),
  ];

  assert.deepEqual(
    selectBoundChangeOutcomes(records).map(
      (record) => record["forward.dynatrace.gate_run_id"],
    ),
    ["gate-newest-pass", "gate-newest-fail"],
  );
});

test("rejects legacy or mismatched ServiceNow evidence from headline outcomes", () => {
  const legacy = {
    "forward.dynatrace.gate_decision": "pass",
    "forward.dynatrace.servicenow_evidence_sha256": checksum,
  };
  const mismatched = {
    ...bound("fail", "mismatched"),
    "forward.dynatrace.servicenow_idempotency_key": `forward-dynatrace:${"b".repeat(64)}`,
  };
  const unspecified = {
    ...bound("pass", "unspecified"),
    "forward.dynatrace.synthetic": undefined,
  };

  assert.equal(isBoundChangeOutcome(legacy), false);
  assert.equal(isBoundChangeOutcome(mismatched), false);
  assert.equal(isBoundChangeOutcome(unspecified), false);
  assert.deepEqual(selectBoundChangeOutcomes([legacy, mismatched, unspecified]), []);
});

test("requires exact Forward and Dynatrace evidence for headline eligibility", () => {
  const missingSnapshot = {
    ...bound("pass", "missing-snapshot"),
    "forward.dynatrace.after_snapshot_id": "",
  };
  const missingHealth = {
    ...bound("fail", "missing-health"),
    "forward.dynatrace.service_health": undefined,
  };
  const invalidReachability = {
    ...bound("pass", "invalid-reachability"),
    "forward.dynatrace.after_reachable": -1,
  };

  assert.equal(isBoundChangeOutcome(missingSnapshot), false);
  assert.equal(isBoundChangeOutcome(missingHealth), false);
  assert.equal(isBoundChangeOutcome(invalidReachability), false);
});

test("withholds the comparison headline until both pass and fail outcomes exist", () => {
  assert.deepEqual(selectBoundChangeOutcomes([bound("pass", "only-pass")]), []);
  assert.deepEqual(selectBoundChangeOutcomes([bound("fail", "only-fail")]), []);
});
