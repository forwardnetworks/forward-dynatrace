import { readFile } from "node:fs/promises";
import path from "node:path";

import {
  buildTransitionEventRecords,
  computeTransitions,
} from "./forward-check-health-transitions.mjs";
import {
  buildNetworkEvidenceEvent,
  toOpenPipelineNetworkEvidenceRecord,
} from "./publish-dynatrace-network-evidence.mjs";
import {
  buildSecurityCorrelationEventBatch,
} from "./publish-dynatrace-security-correlation.mjs";
import {
  toOpenPipelineEventRecord,
} from "./publish-dynatrace-status-event.mjs";
import {
  sanitizeStatusArtifact,
  toDynatraceStatusEvent,
} from "./publish-forward-status.mjs";
import { correlateSecurityExposure } from "./security-exposure-correlation.mjs";
import { buildDemoRehearsal } from "./servicenow-demo-rehearsal.mjs";

const EVIDENCE_SOURCE = "checked-servicenow-demo-rehearsal";
const NETWORK_ID = "235937";

const readJson = async (file) => JSON.parse(await readFile(file, "utf8"));

const statusRecord = (artifact, publisherRunId) => {
  const sanitized = sanitizeStatusArtifact(artifact);
  return {
    ...toOpenPipelineEventRecord(toDynatraceStatusEvent(sanitized), publisherRunId),
    "forward.dynatrace.evidence_source": EVIDENCE_SOURCE,
    "forward.dynatrace.synthetic": true,
  };
};

const captureStatus = ({ generatedAt, runId, importState, mode, snapshotId, counts }) => ({
  schemaVersion: "forward-dynatrace-status/v1",
  generatedAt,
  runId,
  packageId: "dynatrace-forward-change-rehearsal",
  mode,
  importState,
  applyPolicy: "create-missing-only",
  packageSignature: { status: "verified" },
  target: { networkId: NETWORK_ID, snapshotId },
  plannedChecks: 24,
  counts,
});

const networkRecord = ({ generatedAt, problemId, snapshotId, reachable, blocked }) => {
  const evidence = {
    schemaVersion: "forward-dynatrace-path-evidence/v1",
    generatedAt,
    source: EVIDENCE_SOURCE,
    modeledReachabilityAssessment:
      blocked > 0 ? "consistent-with-network-policy-block" : "no-modeled-policy-block",
    target: { networkId: NETWORK_ID, snapshotId },
    counts: {
      total: 24,
      queryable: 24,
      reachable,
      blocked,
      ambiguous: 0,
      unmapped: 0,
      failed: 0,
    },
    rows: [],
  };
  const event = buildNetworkEvidenceEvent(evidence, {
    problemId,
    serviceEntityId: "SERVICE-CHECKOUT",
    runId: `network-${problemId.toLowerCase()}`,
  });
  return {
    ...toOpenPipelineNetworkEvidenceRecord(event),
    "forward.dynatrace.synthetic": true,
  };
};

const buildHealthRows = () => {
  const identityHash = "a".repeat(64);
  const initialState = {
    schemaVersion: "forward-dynatrace-check-health-state/v1",
    updatedAt: "2026-07-13T03:20:00.000Z",
    networkId: NETWORK_ID,
    snapshotId: "1322820",
    checks: {
      [identityHash]: {
        status: "PASS",
        owner: "checkout-platform",
        service: "checkout-api",
      },
    },
  };
  const failed = computeTransitions(
    initialState,
    [{ identityHash, status: "FAIL", owner: "checkout-platform", service: "checkout-api" }],
    {
      generatedAt: "2026-07-13T03:24:00.000Z",
      networkId: NETWORK_ID,
      snapshotId: "1322821",
      provenance: { source: EVIDENCE_SOURCE, synthetic: true },
    },
  );
  const recovered = computeTransitions(
    failed.nextState,
    [{ identityHash, status: "PASS", owner: "checkout-platform", service: "checkout-api" }],
    {
      generatedAt: "2026-07-13T03:29:00.000Z",
      networkId: NETWORK_ID,
      snapshotId: "1322822",
      provenance: { source: EVIDENCE_SOURCE, synthetic: true },
    },
  );
  return [
    ...buildTransitionEventRecords(recovered.batch),
    ...buildTransitionEventRecords(failed.batch),
  ];
};

const buildSecurityRows = async () => {
  const [findings, exposures, mappings] = await Promise.all([
    readJson(new URL("../shared/demo-security-dynatrace-findings.json", import.meta.url)),
    readJson(new URL("../shared/demo-security-forward-exposures.json", import.meta.url)),
    readJson(new URL("../shared/demo-security-identity-mappings.json", import.meta.url)),
  ]);
  const artifact = correlateSecurityExposure({
    findings,
    exposures,
    mappings,
    generatedAt: "2026-07-13T03:25:00.000Z",
    provenance: { source: EVIDENCE_SOURCE, synthetic: true },
  });
  return buildSecurityCorrelationEventBatch(artifact, {
    runId: "security-servicenow-demo-rehearsal",
  }).records;
};

export const buildCaptureEvidence = async (outputDir) => {
  const rehearsal = await buildDemoRehearsal(outputDir);
  const changeRows = [];
  for (const scenario of [...rehearsal.scenarios].reverse()) {
    const event = await readJson(
      path.join(outputDir, scenario.id, "forward-change-validation-event.json"),
    );
    changeRows.push({ timestamp: event.timestamp, severity: event.severity, ...event.properties });
  }

  return {
    ingestRows: [
      statusRecord(
        captureStatus({
          generatedAt: "2026-07-13T03:19:00.000Z",
          runId: "reconcile-idempotency-rehearsal",
          importState: "reconciled",
          mode: "dry-run",
          snapshotId: "1322821",
          counts: { create: 0, unchanged: 24, changed: 0, stale: 0 },
        }),
        "publish-idempotency-rehearsal",
      ),
      statusRecord(
        captureStatus({
          generatedAt: "2026-07-13T03:18:00.000Z",
          runId: "apply-create-missing-rehearsal",
          importState: "applied",
          mode: "apply",
          snapshotId: "1322821",
          counts: { create: 24, unchanged: 0, changed: 0, stale: 0 },
        }),
        "publish-create-missing-rehearsal",
      ),
    ],
    networkRows: [
      networkRecord({
        generatedAt: "2026-07-13T03:22:00.000Z",
        problemId: "P-REHEARSAL-REGRESSION",
        snapshotId: "1322821",
        reachable: 12,
        blocked: 12,
      }),
      networkRecord({
        generatedAt: "2026-07-13T03:12:00.000Z",
        problemId: "P-REHEARSAL-SAFE",
        snapshotId: "1322820",
        reachable: 24,
        blocked: 0,
      }),
    ],
    changeRows,
    healthRows: buildHealthRows(),
    securityRows: await buildSecurityRows(),
  };
};
