import assert from "node:assert/strict";
import test from "node:test";

import {
  buildChangeGateEvent,
  publishChangeGateEvent,
  toOpenPipelineChangeGateRecord,
} from "./publish-dynatrace-change-gate.mjs";

const gate = {
  schemaVersion: "forward-dynatrace-change-validation/v1",
  generatedAt: "2026-01-01T00:00:00Z",
  change: { changeId: "CHG-1", deploymentId: "DEPLOY-1", serviceEntityIds: ["SERVICE-1"] },
  decision: "fail",
  reasons: [{ severity: "fail", code: "FORWARD_BLOCKED_PATHS", message: "Blocked." }],
  dynatrace: { deploymentState: "SUCCEEDED", serviceHealth: "HEALTHY", openProblemCount: 0 },
  forward: {
    networkId: "network-1",
    before: { snapshotId: "before", counts: { reachable: 2, blocked: 0 } },
    after: { snapshotId: "after", counts: { reachable: 1, blocked: 1, ambiguous: 0, unmapped: 0, failed: 0 } },
    reconciliation: { runId: "reconcile-1", importState: "reconciled", counts: { changed: 0, stale: 0 } },
  },
};

test("builds aggregate change-gate event without detailed path evidence", () => {
  const event = buildChangeGateEvent(gate, { runId: "gate-run-1", gateSha256: "a".repeat(64) });
  assert.equal(event.eventType, "forward.dynatrace.change.validation");
  assert.equal(event.severity, "ERROR");
  assert.equal(event.properties["forward.dynatrace.after_blocked"], 1);
  assert.doesNotMatch(JSON.stringify(event), /queryUrl|endpoint|hops|rows/iu);
});

test("requires explicit paired provenance when a change event is labeled", () => {
  const event = buildChangeGateEvent(gate, {
    runId: "gate-run-1",
    gateSha256: "a".repeat(64),
    evidenceSource: "checked-dynatrace-demo-rehearsal",
    synthetic: true,
  });
  assert.equal(event.properties["forward.dynatrace.synthetic"], true);
  assert.equal(
    event.properties["forward.dynatrace.evidence_source"],
    "checked-dynatrace-demo-rehearsal",
  );
  assert.throws(
    () => buildChangeGateEvent(gate, {
      runId: "gate-run-1",
      gateSha256: "a".repeat(64),
      evidenceSource: "missing-boolean",
    }),
    /explicit boolean/,
  );
});

test("publishes one change-gate OpenPipeline record", async () => {
  const event = buildChangeGateEvent(gate, { runId: "gate-run-1", gateSha256: "a".repeat(64) });
  let body;
  const result = await publishChangeGateEvent({
    event,
    apiBaseUrl: "https://example.test",
    token: "secret",
    fetchImpl: async (_url, options) => {
      body = JSON.parse(options.body);
      return { ok: true, status: 202, text: async () => "accepted" };
    },
  });
  assert.equal(result.responseStatus, 202);
  assert.equal(body.length, 1);
  assert.deepEqual(body[0], toOpenPipelineChangeGateRecord(event));
});
