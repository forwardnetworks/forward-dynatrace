import assert from "node:assert/strict";
import test from "node:test";

import {
  buildChangeGateEvent,
  publishChangeGateEvent,
  toOpenPipelineChangeGateRecord,
  validateGuardianTriggerContext,
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

const guardianContext = {
  schemaVersion: "forward-dynatrace-guardian-context/v1",
  correlationId: "correlation-1",
  gateRunId: "gate-run-1",
  changeId: "CHG-1",
  deploymentId: "DEPLOY-1",
  observedAt: "2026-01-01T00:00:00Z",
  evidenceWindow: {
    from: "2025-12-31T23:45:00Z",
    to: "2026-01-01T00:00:00Z",
  },
  scope: {
    mappingId: "scope-1",
    applicationId: "application-1",
    environmentId: "environment-1",
    serviceEntityIds: ["SERVICE-1"],
    locations: ["failure-domain-1"],
    owner: "team-1",
    criticality: "high",
  },
  network: {
    networkId: "network-1",
    beforeSnapshotId: "before",
    afterSnapshotId: "after",
  },
  dependencies: [{ protocol: "TCP", ports: [443] }],
  mapping: {
    state: "resolved",
    confidence: "high",
    sourceRecordCount: 1,
    mappingSha256: "c".repeat(64),
  },
  provenance: { evidenceSource: "validation-source", synthetic: false },
};

test("builds aggregate change-gate event without detailed path evidence", () => {
  const event = buildChangeGateEvent(gate, { runId: "gate-run-1", gateSha256: "a".repeat(64) });
  assert.equal(event.eventType, "forward.dynatrace.change.validation");
  assert.equal(event.severity, "ERROR");
  assert.equal(event.properties["forward.dynatrace.after_blocked"], 1);
  assert.doesNotMatch(JSON.stringify(event), /queryUrl|endpoint|hops|rows/iu);
});

test("requires explicit live provenance when a change event is labeled", () => {
  const event = buildChangeGateEvent(gate, {
    runId: "gate-run-1",
    gateSha256: "a".repeat(64),
    evidenceSource: "live-instrumented-transactions",
    synthetic: false,
  });
  assert.equal(event.properties["forward.dynatrace.synthetic"], false);
  assert.equal(
    event.properties["forward.dynatrace.evidence_source"],
    "live-instrumented-transactions",
  );
  assert.throws(
    () => buildChangeGateEvent(gate, {
      runId: "gate-run-1",
      gateSha256: "a".repeat(64),
      evidenceSource: "missing-boolean",
    }),
    /explicit boolean/,
  );
  assert.throws(
    () => buildChangeGateEvent(gate, {
      runId: "gate-run-1",
      gateSha256: "a".repeat(64),
      evidenceSource: "unit-test",
      synthetic: true,
    }),
    /rejects synthetic evidence/,
  );
});

test("builds a bounded lifecycle Guardian execution context", () => {
  const event = buildChangeGateEvent(gate, {
    runId: "gate-run-1",
    gateSha256: "a".repeat(64),
    guardianContext,
    guardianContextSha256: "b".repeat(64),
  });
  assert.equal(event.properties["forward.dynatrace.correlation_id"], "correlation-1");
  assert.equal(event.properties["forward.dynatrace.scope_mapping_id"], "scope-1");
  assert.equal(event.properties["forward.dynatrace.scope_mapping_sha256"], "c".repeat(64));
  assert.equal(event.properties["timeframe.from"], guardianContext.evidenceWindow.from);
  assert.deepEqual(event.properties.execution_context, guardianContext);
  assert.doesNotMatch(JSON.stringify(event), /password|credential|pathTopology|endpoint/iu);
});

test("fails closed when Guardian context does not identify the same evidence", () => {
  assert.throws(
    () => buildChangeGateEvent(gate, {
      runId: "gate-run-1",
      gateSha256: "a".repeat(64),
      guardianContext: {
        ...guardianContext,
        network: { ...guardianContext.network, afterSnapshotId: "unrelated" },
      },
      guardianContextSha256: "b".repeat(64),
    }),
    /afterSnapshotId must match/,
  );
});

test("Guardian trigger requires resolved observed evidence", () => {
  assert.equal(validateGuardianTriggerContext(guardianContext), guardianContext);
  assert.throws(
    () => validateGuardianTriggerContext({
      ...guardianContext,
      mapping: { ...guardianContext.mapping, confidence: "medium" },
    }),
    /resolved, high-confidence/,
  );
  assert.throws(
    () => validateGuardianTriggerContext({
      ...guardianContext,
      provenance: { ...guardianContext.provenance, synthetic: true },
    }),
    /non-synthetic/,
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

test("publishes one lifecycle Guardian trigger to the SDLC event stream", async () => {
  const event = buildChangeGateEvent(gate, {
    runId: "gate-run-1",
    gateSha256: "a".repeat(64),
    guardianContext,
    guardianContextSha256: "b".repeat(64),
  });
  let requestUrl;
  let requestOptions;
  await publishChangeGateEvent({
    event,
    apiBaseUrl: "https://example.test",
    token: "secret",
    guardianTrigger: true,
    fetchImpl: async (url, options) => {
      requestUrl = url;
      requestOptions = options;
      return { ok: true, status: 202, text: async () => "" };
    },
  });
  assert.equal(requestUrl, "https://example.test/platform/ingest/v1/events.sdlc");
  assert.equal(requestOptions.headers.Authorization, "Api-Token secret");
  assert.deepEqual(JSON.parse(requestOptions.body), toOpenPipelineChangeGateRecord(event));
});
