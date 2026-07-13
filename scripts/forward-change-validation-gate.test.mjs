import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { test } from "node:test";

import { buildChangeValidationGate } from "./forward-change-validation-gate.mjs";

const context = {
  schemaVersion: "forward-dynatrace-change-context/v1",
  changeId: "CHG-1",
  deploymentId: "DEPLOY-1",
  observedAt: "2026-01-01T00:00:00.000Z",
  serviceEntityIds: ["SERVICE-2", "SERVICE-1"],
  dynatrace: {
    deploymentState: "SUCCEEDED",
    serviceHealth: "HEALTHY",
    openProblemCount: 0,
  },
};

const pathEvidence = (snapshotId, counts = {}) => ({
  schemaVersion: "forward-dynatrace-path-evidence/v1",
  generatedAt: "2026-01-01T00:00:00.000Z",
  mode: "execute",
  status: "completed",
  source: "forward-path-search-bulk",
  endpoint: "POST /api/networks/{networkId}/paths-bulk",
  modeledReachabilityAssessment: "no-modeled-policy-block",
  hostResolution: null,
  target: { networkId: "network-1", snapshotId },
  request: {
    intent: "PREFER_DELIVERED",
    maxCandidates: 5000,
    maxResults: 1,
    maxReturnPathResults: 0,
    maxSeconds: 30,
    queryCount: 2,
  },
  counts: {
    total: 2,
    queryable: 2,
    reachable: 2,
    blocked: 0,
    ambiguous: 0,
    unmapped: 0,
    failed: 0,
    ...counts,
  },
  rows: [],
});

const reconciliation = {
  schemaVersion: "forward-dynatrace-status/v1",
  generatedAt: "2026-01-01T00:00:00.000Z",
  runId: "forward-run-1",
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

const hashes = {
  contextSha256: "a".repeat(64),
  beforePathEvidenceSha256: "b".repeat(64),
  afterPathEvidenceSha256: "c".repeat(64),
  reconciliationStatusSha256: "d".repeat(64),
};

test("builds a deterministic pass artifact from healthy Dynatrace and Forward evidence", () => {
  const input = {
    context,
    beforeEvidence: pathEvidence("snapshot-before"),
    afterEvidence: pathEvidence("snapshot-after"),
    reconciliationStatus: reconciliation,
    evidenceHashes: hashes,
  };
  const first = buildChangeValidationGate(input);
  const second = buildChangeValidationGate(input);
  assert.deepEqual(first, second);
  assert.equal(first.decision, "pass");
  assert.deepEqual(first.change.serviceEntityIds, ["SERVICE-1", "SERVICE-2"]);
  assert.deepEqual(first.reasons.map((reason) => reason.code), ["ALL_VALIDATIONS_PASSED"]);
});

test("fails closed on blocked paths, unhealthy service, open problems, and drift", () => {
  const artifact = buildChangeValidationGate({
    context: {
      ...context,
      dynatrace: {
        deploymentState: "FAILED",
        serviceHealth: "UNHEALTHY",
        openProblemCount: 1,
      },
    },
    beforeEvidence: pathEvidence("snapshot-before"),
    afterEvidence: pathEvidence("snapshot-after", { reachable: 1, blocked: 1 }),
    reconciliationStatus: {
      ...reconciliation,
      counts: { create: 0, unchanged: 0, changed: 1, stale: 1 },
      unresolvedCounts: { changed: 1, stale: 1 },
    },
    evidenceHashes: hashes,
  });
  const codes = new Set(artifact.reasons.map((reason) => reason.code));
  assert.equal(artifact.decision, "fail");
  for (const code of [
    "FORWARD_BLOCKED_PATHS",
    "FORWARD_PATH_REGRESSION",
    "DYNATRACE_DEPLOYMENT_FAILED",
    "DYNATRACE_SERVICE_UNHEALTHY",
    "DYNATRACE_OPEN_PROBLEMS",
    "FORWARD_UNRESOLVED_DRIFT",
  ]) {
    assert.equal(codes.has(code), true, code);
  }
});

test("warns instead of passing when evidence is partial or health is uncertain", () => {
  const before = pathEvidence("snapshot-before", { reachable: 1, ambiguous: 1 });
  before.status = "partial";
  const after = pathEvidence("snapshot-before", { reachable: 1, ambiguous: 1 });
  after.status = "partial";
  const artifact = buildChangeValidationGate({
    context: {
      ...context,
      dynatrace: {
        deploymentState: "IN_PROGRESS",
        serviceHealth: "DEGRADED",
        openProblemCount: 0,
      },
    },
    beforeEvidence: before,
    afterEvidence: after,
    reconciliationStatus: {
      ...reconciliation,
      target: { networkId: "network-1", snapshotId: "snapshot-before" },
    },
    evidenceHashes: hashes,
  });
  assert.equal(artifact.decision, "warn");
  assert.equal(artifact.reasons.some((reason) => reason.code === "FORWARD_SNAPSHOT_UNCHANGED"), true);
  assert.equal(artifact.reasons.some((reason) => reason.code === "FORWARD_MAPPING_INCOMPLETE"), true);
});

test("CLI writes a schema-valid gate artifact and can fail a deployment job", async () => {
  const workdir = await mkdtemp(path.join(tmpdir(), "forward-change-gate-"));
  const files = {
    context: path.join(workdir, "context.json"),
    before: path.join(workdir, "before.json"),
    after: path.join(workdir, "after.json"),
    reconciliation: path.join(workdir, "reconciliation.json"),
    output: path.join(workdir, "gate.json"),
  };
  await Promise.all([
    writeFile(files.context, `${JSON.stringify(context, null, 2)}\n`),
    writeFile(files.before, `${JSON.stringify(pathEvidence("snapshot-before"), null, 2)}\n`),
    writeFile(files.after, `${JSON.stringify(pathEvidence("snapshot-after"), null, 2)}\n`),
    writeFile(files.reconciliation, `${JSON.stringify(reconciliation, null, 2)}\n`),
  ]);
  const result = spawnSync(
    process.execPath,
    [
      "scripts/forward-change-validation-gate.mjs",
      "--context",
      files.context,
      "--before-evidence",
      files.before,
      "--after-evidence",
      files.after,
      "--reconciliation-status",
      files.reconciliation,
      "--output",
      files.output,
    ],
    { cwd: process.cwd(), encoding: "utf8" },
  );
  assert.equal(result.status, 0, result.stderr);
  assert.equal(JSON.parse(await readFile(files.output, "utf8")).decision, "pass");

  const schemaResult = spawnSync(
    process.execPath,
    ["scripts/schema-validate.mjs", "--change-validation-gate", files.output],
    { cwd: process.cwd(), encoding: "utf8" },
  );
  assert.equal(schemaResult.status, 0, schemaResult.stderr);
});
