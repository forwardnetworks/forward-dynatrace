import assert from "node:assert/strict";
import test from "node:test";

import {
  buildSecurityCorrelationEventBatch,
  publishSecurityCorrelationEvents,
  validateSecurityCorrelation,
} from "./publish-dynatrace-security-correlation.mjs";

const queueItem = {
  correlationId: "a".repeat(64),
  severity: "high",
  confidence: "high",
  owner: "security",
  evidence: {
    dynatraceFindingId: "DT-1",
    dynatraceObservedAt: "2026-01-01T00:00:00Z",
    forwardExposureId: "FWD-1",
    forwardSnapshotId: "snapshot-1",
    forwardObservedAt: "2026-01-01T00:01:00Z",
    identityMappingId: "mapping-1",
  },
  facts: {
    observedExecution: true,
    vulnerableRuntime: true,
    modeledReachability: true,
    internetAddressability: false,
    policyFinding: false,
  },
  disposition: "investigate",
};

const artifact = {
  schemaVersion: "forward-dynatrace-security-correlation/v1",
  generatedAt: "2026-01-01T00:02:00Z",
  provenance: { source: "unit-test", synthetic: false },
  counts: { rejectedMappings: 0 },
  investigationQueue: [queueItem],
};

test("builds bounded security events with separate facts and evidence IDs", () => {
  const batch = buildSecurityCorrelationEventBatch(artifact, { runId: "security-run-1" });
  assert.equal(batch.records.length, 1);
  assert.equal(batch.records[0]["event.status"], "ERROR");
  assert.equal(batch.records[0]["forward.dynatrace.evidence_source"], "unit-test");
  assert.equal(batch.records[0]["forward.dynatrace.synthetic"], false);
  assert.equal(batch.records[0]["forward.dynatrace.fact.modeled_reachability"], true);
  assert.equal(batch.records[0]["forward.dynatrace.dynatrace_finding_id"], "DT-1");
});

test("rejects correlation batches over the publication bound", () => {
  assert.throws(
    () => validateSecurityCorrelation({ ...artifact, investigationQueue: Array(101).fill(queueItem) }),
    /exceeds 100/,
  );
});

test("publishes nothing for an empty investigation queue", async () => {
  const batch = buildSecurityCorrelationEventBatch({ ...artifact, investigationQueue: [] }, { runId: "empty" });
  let called = false;
  const result = await publishSecurityCorrelationEvents({
    batch,
    apiBaseUrl: "https://example.test",
    token: "secret",
    fetchImpl: async () => { called = true; },
  });
  assert.equal(called, false);
  assert.deepEqual(result, { published: 0, responseStatus: null });
});
