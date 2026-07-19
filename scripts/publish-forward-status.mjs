#!/usr/bin/env node

import { createHash } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { pathToFileURL } from "node:url";

const DEFAULT_STATUS_FILE = "forward-ingest-status.json";
const DEFAULT_CHECKSUM_FILE = "forward-ingest-status.sha256";
const DEFAULT_EVENT_FILE = "forward-ingest-status-event.json";
const EVIDENCE_SOURCE_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/;

const usage = `
Forward ingest status publisher

Usage:
  node scripts/publish-forward-status.mjs \\
    --status forward-ingest-status.json \\
    --output-dir /secure/evidence/dynatrace-forward/latest

Options:
  --status path       Sanitized synchronization status artifact from app-development tooling.
  --output path       Write sanitized status to this exact path.
  --output-dir path   Write forward-ingest-status.json into this directory.
  --checksum path     Write sha256 checksum to this path.
  --event-output path Write publish-safe Dynatrace event payload JSON.
  --evidence-source   Optional publish-safe live provenance label.

This script does not contact Forward or Dynatrace. It validates and republishes
aggregate status for an approved app-development or operating evidence directory.
`;

const allowedTopLevelFields = new Set([
  "approval",
  "applyPolicy",
  "counts",
  "durationMs",
  "forwardAccessProfile",
  "generatedAt",
  "importState",
  "importPlan",
  "mode",
  "mutationCounts",
  "mutationFailure",
  "packageId",
  "packageIntegrity",
  "packageSignature",
  "plannedChecks",
  "plannedNqeChecks",
  "plannedNqeDiffRequests",
  "postApplyVerification",
  "runId",
  "schemaVersion",
  "target",
  "unresolvedCounts",
]);

const forbiddenTextPatterns = [
  /Authorization/i,
  /Basic\s+[A-Za-z0-9+/=]+/i,
  /Bearer\s+[A-Za-z0-9._-]+/i,
  /FORWARD_PASSWORD/i,
  /dt0[a-z0-9]{2,}\.[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{20,}/i,
];

const parseArgs = (argv) => {
  const args = {};
  for (let index = 0; index < argv.length; index += 1) {
    const value = argv[index];
    if (value === "--help") {
      args.help = true;
      continue;
    }
    if (value.startsWith("--")) {
      const key = value.slice(2);
      const next = argv[index + 1];
      if (!next || next.startsWith("--")) {
        throw new Error(`Missing value for ${value}.`);
      }
      args[key] = next;
      index += 1;
      continue;
    }
    throw new Error(`Unsupported positional argument: ${value}`);
  }
  return args;
};

const required = (args, key) => {
  if (!args[key]) {
    throw new Error(`Missing required option: --${key}`);
  }
  return args[key];
};

const sha256Hex = (text) => createHash("sha256").update(text, "utf8").digest("hex");

const provenanceFromArgs = (args) => {
  const evidenceSource = args["evidence-source"];
  if (args.synthetic !== undefined) {
    throw new Error("--synthetic is not supported; status publication is live-only.");
  }
  if (evidenceSource === undefined) return null;
  if (
    typeof evidenceSource !== "string" ||
    !EVIDENCE_SOURCE_PATTERN.test(evidenceSource)
  ) {
    throw new Error("--evidence-source requires a publish-safe live label.");
  }
  return { evidenceSource, synthetic: false };
};

const eventSeverity = (artifact) => {
  if (artifact.importState === "failed") {
    return "ERROR";
  }
  if (
    artifact.importState === "needs-review" ||
    (artifact.unresolvedCounts?.changed ?? 0) > 0 ||
    (artifact.unresolvedCounts?.stale ?? 0) > 0
  ) {
    return "WARN";
  }
  return "INFO";
};

export const sanitizeStatusArtifact = (artifact) => {
  if (!artifact || typeof artifact !== "object" || Array.isArray(artifact)) {
    throw new Error("Status artifact must be a JSON object.");
  }
  if (artifact.schemaVersion !== "forward-dynatrace-status/v1") {
    throw new Error("Status artifact schemaVersion must be forward-dynatrace-status/v1.");
  }

  const unknownFields = Object.keys(artifact).filter((key) => !allowedTopLevelFields.has(key));
  if (unknownFields.length > 0) {
    throw new Error(`Status artifact contains unsupported field(s): ${unknownFields.join(", ")}`);
  }

  const text = JSON.stringify(artifact);
  for (const pattern of forbiddenTextPatterns) {
    if (pattern.test(text)) {
      throw new Error("Status artifact contains forbidden credential-like content.");
    }
  }

  return {
    schemaVersion: artifact.schemaVersion,
    generatedAt: artifact.generatedAt || null,
    runId: artifact.runId || null,
    packageId: artifact.packageId || null,
    mode: artifact.mode || null,
    forwardAccessProfile: artifact.forwardAccessProfile || null,
    importState: artifact.importState || null,
    applyPolicy: artifact.applyPolicy || null,
    packageIntegrity: artifact.packageIntegrity || null,
    packageSignature: {
      status: artifact.packageSignature?.status || "not-provided",
    },
    target: {
      networkId: artifact.target?.networkId || null,
      snapshotId: artifact.target?.snapshotId || null,
    },
    counts: artifact.counts || {
      create: 0,
      unchanged: 0,
      changed: 0,
      stale: 0,
      collision: 0,
    },
    unresolvedCounts: artifact.unresolvedCounts || {
      changed: artifact.counts?.changed || 0,
      stale: artifact.counts?.stale || 0,
    },
    mutationCounts: artifact.mutationCounts || {
      created: 0,
      updated: 0,
      deactivated: 0,
    },
    mutationFailure: artifact.mutationFailure
      ? {
          phase: artifact.mutationFailure.phase || "unknown",
          statusCode: artifact.mutationFailure.statusCode ?? null,
          affectedCount: artifact.mutationFailure.affectedCount || 0,
          recoveryRequired: true,
      }
      : null,
    postApplyVerification: artifact.postApplyVerification
      ? {
          state: artifact.postApplyVerification.state || "unavailable",
          planned: artifact.postApplyVerification.planned || 0,
          counts: artifact.postApplyVerification.counts || null,
        }
      : {
          state: "not-run",
          planned: artifact.plannedChecks || 0,
          counts: null,
        },
    importPlan: artifact.importPlan
      ? {
          planId: artifact.importPlan.planId || null,
          planSha256: artifact.importPlan.planSha256 || null,
          state: artifact.importPlan.state || null,
        }
      : null,
    plannedChecks: artifact.plannedChecks || 0,
    plannedNqeChecks: artifact.plannedNqeChecks || 0,
    plannedNqeDiffRequests: artifact.plannedNqeDiffRequests || 0,
  };
};

export const toDynatraceStatusEvent = (artifact, provenance = null) => ({
  schemaVersion: "forward-dynatrace-status-event/v1",
  timestamp: artifact.generatedAt || new Date().toISOString(),
  eventType: "forward.dynatrace.ingest.status",
  severity: eventSeverity(artifact),
  title: `forward.dynatrace ingest ${artifact.importState || "unknown"}`,
  properties: {
    "forward.dynatrace.run_id": artifact.runId,
    "forward.dynatrace.package_id": artifact.packageId,
    "forward.dynatrace.mode": artifact.mode,
    "forward.dynatrace.access_profile": artifact.forwardAccessProfile,
    "forward.dynatrace.import_state": artifact.importState,
    "forward.dynatrace.apply_policy": artifact.applyPolicy,
    "forward.dynatrace.signature_status": artifact.packageSignature.status,
    "forward.dynatrace.target.network_id": artifact.target.networkId,
    "forward.dynatrace.target.snapshot_id": artifact.target.snapshotId,
    "forward.dynatrace.planned_checks": artifact.plannedChecks,
    "forward.dynatrace.planned_nqe_checks": artifact.plannedNqeChecks,
    "forward.dynatrace.planned_nqe_diff_requests": artifact.plannedNqeDiffRequests,
    "forward.dynatrace.count.create": artifact.counts.create,
    "forward.dynatrace.count.unchanged": artifact.counts.unchanged,
    "forward.dynatrace.count.changed": artifact.counts.changed,
    "forward.dynatrace.count.stale": artifact.counts.stale,
    "forward.dynatrace.count.collision": artifact.counts.collision || 0,
    "forward.dynatrace.plan_id": artifact.importPlan?.planId || null,
    "forward.dynatrace.plan_state": artifact.importPlan?.state || null,
    "forward.dynatrace.unresolved.changed": artifact.unresolvedCounts.changed,
    "forward.dynatrace.unresolved.stale": artifact.unresolvedCounts.stale,
    "forward.dynatrace.mutation.created": artifact.mutationCounts.created,
    "forward.dynatrace.mutation.updated": artifact.mutationCounts.updated,
    "forward.dynatrace.mutation.deactivated": artifact.mutationCounts.deactivated,
    "forward.dynatrace.mutation.failure_phase": artifact.mutationFailure?.phase || null,
    "forward.dynatrace.mutation.failure_status": artifact.mutationFailure?.statusCode || null,
    "forward.dynatrace.mutation.recovery_required":
      artifact.mutationFailure?.recoveryRequired || false,
    "forward.dynatrace.verification.state": artifact.postApplyVerification.state,
    "forward.dynatrace.verification.planned": artifact.postApplyVerification.planned,
    ...(provenance
      ? {
          "forward.dynatrace.evidence_source": provenance.evidenceSource,
          "forward.dynatrace.synthetic": provenance.synthetic,
        }
      : {}),
  },
});

const main = async () => {
  const args = parseArgs(process.argv.slice(2));
  if (args.help) {
    process.stdout.write(usage);
    return;
  }
  if (args.output && args["output-dir"]) {
    throw new Error("Use either --output or --output-dir, not both.");
  }

  const statusText = await readFile(required(args, "status"), "utf8");
  const provenance = provenanceFromArgs(args);
  const sanitized = sanitizeStatusArtifact(JSON.parse(statusText));
  const outputPath = args.output || path.join(required(args, "output-dir"), DEFAULT_STATUS_FILE);
  const checksumPath = args.checksum || path.join(path.dirname(outputPath), DEFAULT_CHECKSUM_FILE);
  const eventOutputPath =
    args["event-output"] ||
    (args["output-dir"] ? path.join(args["output-dir"], DEFAULT_EVENT_FILE) : null);
  const outputText = JSON.stringify(sanitized, null, 2) + "\n";

  await mkdir(path.dirname(outputPath), { recursive: true });
  await writeFile(outputPath, outputText);
  await writeFile(checksumPath, `${sha256Hex(outputText)}  ${path.basename(outputPath)}\n`);
  if (eventOutputPath) {
    await mkdir(path.dirname(eventOutputPath), { recursive: true });
    await writeFile(
      eventOutputPath,
      `${JSON.stringify(toDynatraceStatusEvent(sanitized, provenance), null, 2)}\n`,
    );
  }

  process.stdout.write(
    JSON.stringify(
      {
        status: "published",
        output: outputPath,
        checksum: checksumPath,
        eventOutput: eventOutputPath,
        sha256: sha256Hex(outputText),
      },
      null,
      2,
    ) + "\n",
  );
};

if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((error) => {
    process.stderr.write(`${error.message}\n`);
    process.stderr.write(usage);
    process.exit(1);
  });
}
