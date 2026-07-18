#!/usr/bin/env node

import { createHash } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { pathToFileURL } from "node:url";

const CHANGE_CONTEXT_SCHEMA = "forward-dynatrace-change-context/v1";
const PATH_EVIDENCE_SCHEMA = "forward-dynatrace-path-evidence/v1";
const RECONCILIATION_SCHEMA = "forward-dynatrace-status/v1";
const GATE_SCHEMA = "forward-dynatrace-change-validation/v1";
const COUNT_KEYS = ["total", "queryable", "reachable", "blocked", "ambiguous", "unmapped", "failed"];

const usage = `
Forward and Dynatrace change-validation gate

Usage:
  npm run forward:change-gate -- \\
    --context change-context.json \\
    --before-evidence before-path-evidence.json \\
    --after-evidence after-path-evidence.json \\
    --reconciliation-status forward-ingest-status.json \\
    --output forward-change-validation-gate.json

Options:
  --context path                 Dynatrace change/deployment context.
  --before-evidence path         Forward path evidence for the approved before snapshot.
  --after-evidence path          Forward path evidence for the approved after snapshot.
  --reconciliation-status path   Sanitized Forward reconciliation status for the after snapshot.
  --output path                  Write the deterministic gate artifact.
  --fail-on-non-pass             Exit 2 after writing when the decision is warn or fail.
  --help                         Show this help.

This command is read-only. It combines already-collected evidence and does not
contact or mutate Forward, Dynatrace, or a deployment system.
`;

export const parseArgs = (argv) => {
  const args = {};
  for (let index = 0; index < argv.length; index += 1) {
    const value = argv[index];
    if (value === "--help" || value === "--fail-on-non-pass") {
      args[value.slice(2)] = true;
      continue;
    }
    if (!value.startsWith("--")) {
      throw new Error(`Unexpected positional argument: ${value}`);
    }
    const next = argv[index + 1];
    if (!next || next.startsWith("--")) {
      throw new Error(`Missing value for ${value}.`);
    }
    args[value.slice(2)] = next;
    index += 1;
  }
  return args;
};

const required = (args, key) => {
  if (!args[key]) throw new Error(`Missing required option: --${key}.`);
  return args[key];
};

const isRecord = (value) => Boolean(value) && typeof value === "object" && !Array.isArray(value);

const assertNonNegativeInteger = (value, label) => {
  if (!Number.isInteger(value) || value < 0) {
    throw new Error(`${label} must be a non-negative integer.`);
  }
};

export const validateChangeContext = (context) => {
  if (!isRecord(context) || context.schemaVersion !== CHANGE_CONTEXT_SCHEMA) {
    throw new Error(`Change context schemaVersion must be ${CHANGE_CONTEXT_SCHEMA}.`);
  }
  for (const key of ["changeId", "deploymentId", "observedAt"]) {
    if (typeof context[key] !== "string" || !context[key].trim()) {
      throw new Error(`Change context ${key} must be a non-empty string.`);
    }
  }
  if (Number.isNaN(Date.parse(context.observedAt))) {
    throw new Error("Change context observedAt must be an ISO date-time.");
  }
  if (
    !Array.isArray(context.serviceEntityIds) ||
    context.serviceEntityIds.length === 0 ||
    context.serviceEntityIds.some((value) => typeof value !== "string" || !value.trim())
  ) {
    throw new Error("Change context serviceEntityIds must contain non-empty strings.");
  }
  if (!isRecord(context.dynatrace)) {
    throw new Error("Change context must contain dynatrace state.");
  }
  if (!new Set(["SUCCEEDED", "FAILED", "IN_PROGRESS", "UNKNOWN"]).has(context.dynatrace.deploymentState)) {
    throw new Error("Unsupported Dynatrace deploymentState.");
  }
  if (!new Set(["HEALTHY", "DEGRADED", "UNHEALTHY", "UNKNOWN"]).has(context.dynatrace.serviceHealth)) {
    throw new Error("Unsupported Dynatrace serviceHealth.");
  }
  assertNonNegativeInteger(context.dynatrace.openProblemCount, "Dynatrace openProblemCount");
  return context;
};

export const validatePathEvidence = (evidence, label) => {
  if (!isRecord(evidence) || evidence.schemaVersion !== PATH_EVIDENCE_SCHEMA) {
    throw new Error(`${label} schemaVersion must be ${PATH_EVIDENCE_SCHEMA}.`);
  }
  if (!isRecord(evidence.target)) throw new Error(`${label} must contain target.`);
  if (!isRecord(evidence.counts)) throw new Error(`${label} must contain counts.`);
  for (const key of COUNT_KEYS) {
    assertNonNegativeInteger(evidence.counts[key], `${label} counts.${key}`);
  }
  return evidence;
};

export const validateReconciliationStatus = (status) => {
  if (!isRecord(status) || status.schemaVersion !== RECONCILIATION_SCHEMA) {
    throw new Error(`Reconciliation status schemaVersion must be ${RECONCILIATION_SCHEMA}.`);
  }
  if (!isRecord(status.target) || !isRecord(status.counts)) {
    throw new Error("Reconciliation status must contain target and counts.");
  }
  for (const key of ["create", "unchanged", "changed", "stale"]) {
    assertNonNegativeInteger(status.counts[key], `Reconciliation counts.${key}`);
  }
  return status;
};

const summaryCounts = (counts) => Object.fromEntries(COUNT_KEYS.map((key) => [key, counts[key]]));

const evidenceSummary = (evidence) => ({
  snapshotId: evidence.target.snapshotId || null,
  status: evidence.status || null,
  assessment: evidence.modeledReachabilityAssessment || null,
  counts: summaryCounts(evidence.counts),
});

const reconciliationSummary = (status) => ({
  runId: status.runId || null,
  packageId: status.packageId || null,
  importState: status.importState || null,
  target: {
    networkId: status.target.networkId || null,
    snapshotId: status.target.snapshotId || null,
  },
  plannedChecks: status.plannedChecks,
  counts: { ...status.counts },
  unresolvedCounts: status.unresolvedCounts
    ? { ...status.unresolvedCounts }
    : { changed: status.counts.changed, stale: status.counts.stale },
});

const addReason = (reasons, severity, code, message) => {
  reasons.push({ severity, code, message });
};

export const buildChangeValidationGate = ({
  context,
  beforeEvidence,
  afterEvidence,
  reconciliationStatus,
  evidenceHashes,
}) => {
  validateChangeContext(context);
  validatePathEvidence(beforeEvidence, "Before evidence");
  validatePathEvidence(afterEvidence, "After evidence");
  validateReconciliationStatus(reconciliationStatus);

  const reasons = [];
  const beforeNetworkId = beforeEvidence.target.networkId || null;
  const afterNetworkId = afterEvidence.target.networkId || null;
  const beforeSnapshotId = beforeEvidence.target.snapshotId || null;
  const afterSnapshotId = afterEvidence.target.snapshotId || null;

  if (!beforeNetworkId || !afterNetworkId || beforeNetworkId !== afterNetworkId) {
    addReason(reasons, "fail", "FORWARD_NETWORK_MISMATCH", "Before and after evidence must target the same Forward network.");
  }
  if (!beforeSnapshotId || !afterSnapshotId) {
    addReason(reasons, "fail", "FORWARD_SNAPSHOT_MISSING", "Before and after evidence must identify processed Forward snapshots.");
  } else if (beforeSnapshotId === afterSnapshotId) {
    addReason(reasons, "warn", "FORWARD_SNAPSHOT_UNCHANGED", "Before and after evidence use the same Forward snapshot.");
  }
  if (beforeEvidence.mode !== "execute" || afterEvidence.mode !== "execute") {
    addReason(reasons, "fail", "FORWARD_EVIDENCE_NOT_EXECUTED", "Both Forward evidence artifacts must come from execute mode.");
  }
  if (beforeEvidence.status !== "completed" || afterEvidence.status !== "completed") {
    addReason(reasons, "warn", "FORWARD_EVIDENCE_PARTIAL", "At least one Forward evidence artifact is not complete.");
  }
  if (afterEvidence.counts.failed > 0) {
    addReason(reasons, "fail", "FORWARD_PATH_EXECUTION_FAILED", "After-change Forward path evaluation contains failed rows.");
  }
  if (afterEvidence.counts.blocked > 0) {
    addReason(reasons, "fail", "FORWARD_BLOCKED_PATHS", "After-change Forward evidence contains blocked modeled paths.");
  }
  if (
    afterEvidence.counts.blocked > beforeEvidence.counts.blocked ||
    afterEvidence.counts.reachable < beforeEvidence.counts.reachable
  ) {
    addReason(reasons, "fail", "FORWARD_PATH_REGRESSION", "After-change modeled reachability regressed from the before snapshot.");
  }
  if (afterEvidence.counts.ambiguous > 0 || afterEvidence.counts.unmapped > 0) {
    addReason(reasons, "warn", "FORWARD_MAPPING_INCOMPLETE", "After-change evidence contains ambiguous or unmapped dependencies.");
  }

  if (context.dynatrace.deploymentState === "FAILED") {
    addReason(reasons, "fail", "DYNATRACE_DEPLOYMENT_FAILED", "Dynatrace reports that the deployment failed.");
  } else if (context.dynatrace.deploymentState !== "SUCCEEDED") {
    addReason(reasons, "warn", "DYNATRACE_DEPLOYMENT_INCOMPLETE", "Dynatrace deployment state is not succeeded.");
  }
  if (context.dynatrace.serviceHealth === "UNHEALTHY") {
    addReason(reasons, "fail", "DYNATRACE_SERVICE_UNHEALTHY", "Dynatrace reports an unhealthy affected service.");
  } else if (context.dynatrace.serviceHealth !== "HEALTHY") {
    addReason(reasons, "warn", "DYNATRACE_SERVICE_HEALTH_UNCERTAIN", "Dynatrace service health is degraded or unknown.");
  }
  if (context.dynatrace.openProblemCount > 0) {
    addReason(reasons, "fail", "DYNATRACE_OPEN_PROBLEMS", "Dynatrace reports open problems for the affected service set.");
  }

  if (
    reconciliationStatus.target.networkId !== afterNetworkId ||
    reconciliationStatus.target.snapshotId !== afterSnapshotId
  ) {
    addReason(reasons, "fail", "FORWARD_RECONCILIATION_TARGET_MISMATCH", "Forward reconciliation must target the after-change network and snapshot.");
  }
  if (reconciliationStatus.importState === "failed") {
    addReason(reasons, "fail", "FORWARD_RECONCILIATION_FAILED", "Forward reconciliation failed.");
  } else if (!new Set(["reconciled", "applied"]).has(reconciliationStatus.importState)) {
    addReason(reasons, "warn", "FORWARD_RECONCILIATION_INCOMPLETE", "Forward reconciliation is not in a completed state.");
  }
  if (reconciliationStatus.counts.changed > 0 || reconciliationStatus.counts.stale > 0) {
    addReason(reasons, "fail", "FORWARD_UNRESOLVED_DRIFT", "Forward reconciliation reports changed or stale managed intent.");
  }

  let decision = "pass";
  if (reasons.some((reason) => reason.severity === "fail")) decision = "fail";
  else if (reasons.some((reason) => reason.severity === "warn")) decision = "warn";
  if (reasons.length === 0) {
    addReason(reasons, "info", "ALL_VALIDATIONS_PASSED", "Dynatrace and Forward evidence satisfy the change gate.");
  }

  return {
    schemaVersion: GATE_SCHEMA,
    generatedAt: context.observedAt,
    change: {
      changeId: context.changeId,
      deploymentId: context.deploymentId,
      serviceEntityIds: [...new Set(context.serviceEntityIds)].sort(),
    },
    decision,
    reasons,
    dynatrace: { ...context.dynatrace },
    forward: {
      networkId: beforeNetworkId === afterNetworkId ? beforeNetworkId : null,
      before: evidenceSummary(beforeEvidence),
      after: evidenceSummary(afterEvidence),
      delta: Object.fromEntries(
        ["reachable", "blocked", "ambiguous", "unmapped", "failed"].map((key) => [
          key,
          afterEvidence.counts[key] - beforeEvidence.counts[key],
        ]),
      ),
      reconciliation: reconciliationSummary(reconciliationStatus),
    },
    evidence: { ...evidenceHashes },
  };
};

export const sha256 = (text) => createHash("sha256").update(text).digest("hex");

const readHashedJson = async (filePath) => {
  const text = await readFile(path.resolve(filePath), "utf8");
  return { value: JSON.parse(text), sha256: sha256(text) };
};

export const run = async (argv = process.argv.slice(2)) => {
  const args = parseArgs(argv);
  if (args.help) {
    process.stdout.write(usage);
    return 0;
  }
  const context = await readHashedJson(required(args, "context"));
  const before = await readHashedJson(required(args, "before-evidence"));
  const after = await readHashedJson(required(args, "after-evidence"));
  const reconciliation = await readHashedJson(required(args, "reconciliation-status"));
  const artifact = buildChangeValidationGate({
    context: context.value,
    beforeEvidence: before.value,
    afterEvidence: after.value,
    reconciliationStatus: reconciliation.value,
    evidenceHashes: {
      contextSha256: context.sha256,
      beforePathEvidenceSha256: before.sha256,
      afterPathEvidenceSha256: after.sha256,
      reconciliationStatusSha256: reconciliation.sha256,
    },
  });
  if (args.output) {
    const outputPath = path.resolve(args.output);
    await mkdir(path.dirname(outputPath), { recursive: true });
    await writeFile(outputPath, `${JSON.stringify(artifact, null, 2)}\n`);
  }
  process.stdout.write(`${JSON.stringify(artifact, null, 2)}\n`);
  return args["fail-on-non-pass"] && artifact.decision !== "pass" ? 2 : 0;
};

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  run()
    .then((code) => {
      process.exitCode = code;
    })
    .catch((error) => {
      process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
      process.stderr.write(usage);
      process.exitCode = 1;
    });
}
