import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { test } from "node:test";

import {
  buildAssuranceArtifacts,
  parseArgs,
  run as runAssurance,
  validatePreflightContextAlignment,
} from "./servicenow-change-assurance.mjs";

const preflight = {
  schemaVersion: "forward-dynatrace-servicenow-change-preflight/v1",
  observedAt: "2026-07-15T18:30:00.000Z",
  mode: "read-only",
  source: { instanceAlias: "test-itsm", table: "change_request", authoritativeRead: true },
  change: {
    number: "CHG0042187",
    sysId: "0123456789abcdef0123456789abcdef",
    deploymentId: "checkout-api-2026.07.15.3",
    approval: { value: "approved", display: "Approved" },
    state: { value: "-2", display: "Scheduled" },
    risk: { value: "3", display: "Moderate" },
    assignmentGroup: { value: "89abcdef0123456789abcdef01234567", display: "Commerce" },
    window: { startsAt: "2026-07-15T18:00:00.000Z", endsAt: "2026-07-15T20:00:00.000Z" },
  },
  scope: { forwardNetworkId: "network-1", serviceEntityIds: ["SERVICE-2", "SERVICE-1"] },
  authorization: { status: "eligible", reasons: [], eligibleStateValues: ["-1", "-2"], approvedValues: ["approved"] },
  nextStages: ["combined-change-gate", "servicenow-evidence-feedback"],
};

const context = {
  schemaVersion: "forward-dynatrace-change-context/v1",
  changeId: "CHG0042187",
  deploymentId: "checkout-api-2026.07.15.3",
  observedAt: "2026-07-15T19:00:00.000Z",
  serviceEntityIds: ["SERVICE-1", "SERVICE-2"],
  dynatrace: { deploymentState: "SUCCEEDED", serviceHealth: "HEALTHY", openProblemCount: 0 },
};

const pathEvidence = (snapshotId, overrides = {}) => ({
  schemaVersion: "forward-dynatrace-path-evidence/v1",
  generatedAt: "2026-07-15T19:00:00.000Z",
  mode: "execute",
  status: "completed",
  source: "forward-path-search-bulk",
  endpoint: "POST /api/networks/{networkId}/paths-bulk",
  modeledReachabilityAssessment: "no-modeled-policy-block",
  hostResolution: null,
  target: { networkId: "network-1", snapshotId },
  request: { intent: "PREFER_DELIVERED", maxCandidates: 5000, maxResults: 1, maxReturnPathResults: 0, maxSeconds: 30, queryCount: 2 },
  counts: { total: 2, queryable: 2, reachable: 2, blocked: 0, ambiguous: 0, unmapped: 0, failed: 0, ...overrides },
  rows: [],
});

const reconciliation = {
  schemaVersion: "forward-dynatrace-status/v1",
  generatedAt: "2026-07-15T19:00:00.000Z",
  runId: "reconcile-1",
  packageId: "package-1",
  mode: "dry-run",
  importState: "reconciled",
  applyPolicy: "create-missing-only",
  packageSignature: { status: "verified" },
  target: { networkId: "network-1", snapshotId: "snapshot-after" },
  counts: { create: 0, unchanged: 2, changed: 0, stale: 0 },
  unresolvedCounts: { changed: 0, stale: 0 },
  mutationCounts: { created: 0, updated: 0, deactivated: 0 },
  plannedChecks: 2,
};

test("parses explicit ServiceNow retry verification", () => {
  assert.deepEqual(parseArgs([
    "--publish-servicenow",
    "--verify-servicenow-retry",
    "--output-dir", "/tmp/acceptance",
  ]), {
    "publish-servicenow": true,
    "verify-servicenow-retry": true,
    "output-dir": "/tmp/acceptance",
  });
});

test("requires ServiceNow publication for retry verification", async () => {
  await assert.rejects(
    runAssurance(["--verify-servicenow-retry"]),
    /requires --publish-servicenow/,
  );
});

const asText = (value) => `${JSON.stringify(value, null, 2)}\n`;
const build = (overrides = {}) => buildAssuranceArtifacts({
  preflight,
  context,
  beforeEvidence: pathEvidence("snapshot-before"),
  afterEvidence: pathEvidence("snapshot-after"),
  reconciliationStatus: reconciliation,
  inputTexts: {
    context: asText(context),
    beforeEvidence: asText(pathEvidence("snapshot-before")),
    afterEvidence: asText(pathEvidence("snapshot-after")),
    reconciliationStatus: asText(reconciliation),
  },
  provenance: {
    evidenceSource: "checked-servicenow-test-rehearsal",
    synthetic: true,
  },
  ...overrides,
});

test("binds eligible ServiceNow scope to a deterministic pass gate and publication plans", () => {
  const first = build();
  const second = build();
  assert.equal(first.gate.decision, "pass");
  assert.equal(first.runId, second.runId);
  assert.equal(first.serviceNowPlan.evidenceSha256, second.serviceNowPlan.evidenceSha256);
  assert.equal(first.dynatraceEvent.properties["forward.dynatrace.change_id"], "CHG0042187");
  assert.equal(
    first.dynatraceEvent.properties["forward.dynatrace.servicenow_evidence_sha256"],
    first.serviceNowPlan.evidenceSha256,
  );
  assert.equal(
    first.dynatraceEvent.properties["forward.dynatrace.servicenow_idempotency_key"],
    first.serviceNowPlan.idempotencyKey,
  );
  assert.equal(first.dynatraceEvent.properties["forward.dynatrace.synthetic"], true);
  assert.equal(
    first.dynatraceEvent.properties["forward.dynatrace.evidence_source"],
    "checked-servicenow-test-rehearsal",
  );
  assert.equal(first.serviceNowPlan.evidence.lineage.gateSha256.length, 64);
});

test("rejects blocked, mismatched, or cross-change input before building a gate", () => {
  assert.throws(
    () => validatePreflightContextAlignment({ ...preflight, authorization: { ...preflight.authorization, status: "blocked" } }, context),
    /must be eligible/,
  );
  assert.throws(
    () => validatePreflightContextAlignment(preflight, { ...context, changeId: "CHG9999999" }),
    /change number must match/,
  );
  assert.throws(
    () => validatePreflightContextAlignment(preflight, { ...context, serviceEntityIds: ["SERVICE-1"] }),
    /services must exactly match/,
  );
  assert.throws(
    () => build({ provenance: undefined }),
    /requires explicit evidence source and synthetic provenance/,
  );
  assert.throws(
    () => build({ provenance: { evidenceSource: "not publish safe", synthetic: true } }),
    /requires explicit evidence source and synthetic provenance/,
  );
});

test("CLI writes the complete dry-run handoff and enforces non-pass exit 2", async () => {
  const temp = await mkdtemp(path.join(tmpdir(), "servicenow-change-assurance-"));
  const files = {
    preflight: path.join(temp, "preflight.json"),
    context: path.join(temp, "context.json"),
    before: path.join(temp, "before.json"),
    after: path.join(temp, "after.json"),
    reconciliation: path.join(temp, "reconciliation.json"),
    output: path.join(temp, "output"),
  };
  const failedAfter = pathEvidence("snapshot-after", { reachable: 1, blocked: 1 });
  await Promise.all([
    writeFile(files.preflight, asText(preflight)),
    writeFile(files.context, asText(context)),
    writeFile(files.before, asText(pathEvidence("snapshot-before"))),
    writeFile(files.after, asText(failedAfter)),
    writeFile(files.reconciliation, asText(reconciliation)),
  ]);
  const result = spawnSync(process.execPath, [
    "scripts/servicenow-change-assurance.mjs",
    "--preflight", files.preflight,
    "--context", files.context,
    "--before-evidence", files.before,
    "--after-evidence", files.after,
    "--reconciliation-status", files.reconciliation,
    "--output-dir", files.output,
    "--use-saved-preflight",
  ], { cwd: process.cwd(), encoding: "utf8" });
  assert.equal(result.status, 2, result.stderr);
  const summary = JSON.parse(await readFile(path.join(files.output, "servicenow-change-assurance.json"), "utf8"));
  const feedback = JSON.parse(await readFile(path.join(files.output, "servicenow-change-feedback.json"), "utf8"));
  const gate = JSON.parse(await readFile(path.join(files.output, "forward-change-validation-gate.json"), "utf8"));
  assert.equal(summary.decision, "fail");
  assert.equal(summary.publications.deploymentGate.status, "artifact-ready");
  assert.equal(feedback.publication.workNote.status, "planned");
  assert.equal(gate.reasons.some((reason) => reason.code === "FORWARD_BLOCKED_PATHS"), true);
  const event = JSON.parse(await readFile(path.join(files.output, "forward-change-validation-event.json"), "utf8"));
  assert.equal(event.properties["forward.dynatrace.synthetic"], true);
  assert.equal(
    event.properties["forward.dynatrace.evidence_source"],
    "servicenow-saved-offline-rehearsal",
  );
  assert.equal(JSON.stringify(summary).includes("runtime-only"), false);
  const validation = spawnSync(process.execPath, [
    "scripts/schema-validate.mjs",
    "--change-validation-gate", path.join(files.output, "forward-change-validation-gate.json"),
    "--change-validation-event", path.join(files.output, "forward-change-validation-event.json"),
    "--servicenow-change-assurance-evidence", summary.artifacts.serviceNowEvidence,
    "--servicenow-change-feedback", path.join(files.output, "servicenow-change-feedback.json"),
    "--servicenow-change-assurance", path.join(files.output, "servicenow-change-assurance.json"),
  ], { cwd: process.cwd(), encoding: "utf8" });
  assert.equal(validation.status, 0, validation.stderr || validation.stdout);

  const retrySummaryPath = path.join(files.output, "servicenow-change-assurance-retry-summary.json");
  summary.publications.serviceNowRetry = {
    status: "verified",
    attempts: 2,
    idempotencyKey: feedback.idempotencyKey,
    publication: {
      workNote: { status: "existing", sysId: "journal-1" },
      attachment: { status: "existing", sysId: "attachment-1" },
    },
  };
  summary.artifacts.serviceNowRetryFeedback = path.join(
    files.output,
    "servicenow-change-feedback-retry.json",
  );
  await writeFile(retrySummaryPath, asText(summary));
  const retryValidation = spawnSync(process.execPath, [
    "scripts/schema-validate.mjs",
    "--servicenow-change-assurance", retrySummaryPath,
  ], { cwd: process.cwd(), encoding: "utf8" });
  assert.equal(retryValidation.status, 0, retryValidation.stderr || retryValidation.stdout);

  summary.publications.serviceNowRetry.publication.attachment.status = "created";
  await writeFile(retrySummaryPath, asText(summary));
  const invalidRetryValidation = spawnSync(process.execPath, [
    "scripts/schema-validate.mjs",
    "--servicenow-change-assurance", retrySummaryPath,
  ], { cwd: process.cwd(), encoding: "utf8" });
  assert.notEqual(invalidRetryValidation.status, 0);
});
