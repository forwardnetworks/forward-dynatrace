#!/usr/bin/env node

import { createHash } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { pathToFileURL } from "node:url";

import { readToken, toOpenPipelineApiBaseUrl } from "./publish-dynatrace-status-event.mjs";

const GATE_SCHEMA = "forward-dynatrace-change-validation/v1";
const EVENT_SCHEMA = "forward-dynatrace-change-validation-event/v1";
const EVENT_TYPE = "forward.dynatrace.change.validation";
const ENDPOINT = "/platform/ingest/v1/events";

const usage = `
Publish a sanitized Forward and Dynatrace change-validation event

  node scripts/publish-dynatrace-change-gate.mjs \\
    --gate forward-change-validation-gate.json \\
    --environment-url https://<environment>.apps.dynatrace.com/ \\
    --output forward-change-validation-event.json

Options:
  --gate path              Change-validation gate artifact (required).
  --environment-url URL    Dynatrace Apps environment URL.
  --api-base-url URL       Override Dynatrace ingest origin.
  --token-file path        Platform Token file for --apply.
  --run-id id              Publisher run ID.
  --output path            Write the sanitized event artifact.
  --apply                  Publish to Dynatrace OpenPipeline.
  --help                   Show help.

Dry-run is the default. This publisher sends aggregate decision evidence only.
`;

const parseArgs = (argv) => {
  const args = {};
  for (let index = 0; index < argv.length; index += 1) {
    const value = argv[index];
    if (value === "--apply" || value === "--help") {
      args[value.slice(2)] = true;
      continue;
    }
    if (!value.startsWith("--")) throw new Error(`Unexpected argument: ${value}`);
    const next = argv[index + 1];
    if (!next || next.startsWith("--")) throw new Error(`Missing value for ${value}`);
    args[value.slice(2)] = next;
    index += 1;
  }
  return args;
};

const required = (args, key) => {
  if (!args[key]) throw new Error(`Missing required option: --${key}`);
  return args[key];
};

const sha256 = (value) => createHash("sha256").update(value).digest("hex");
const integer = (value) => (Number.isInteger(value) && value >= 0 ? value : 0);
const compact = (value) => Object.fromEntries(
  Object.entries(value).filter(([, item]) => item !== null && item !== undefined),
);

export const validateChangeGate = (gate) => {
  if (!gate || typeof gate !== "object" || Array.isArray(gate)) {
    throw new Error("Change gate must be an object.");
  }
  if (gate.schemaVersion !== GATE_SCHEMA) {
    throw new Error(`Change gate schemaVersion must be ${GATE_SCHEMA}.`);
  }
  if (!["pass", "warn", "fail"].includes(gate.decision)) {
    throw new Error("Change gate decision must be pass, warn, or fail.");
  }
  if (!gate.change?.changeId || !gate.change?.deploymentId) {
    throw new Error("Change gate must identify the change and deployment.");
  }
  if (!gate.forward?.before?.snapshotId || !gate.forward?.after?.snapshotId) {
    throw new Error("Change gate must identify before and after snapshots.");
  }
  if (!Array.isArray(gate.reasons) || gate.reasons.length === 0) {
    throw new Error("Change gate must contain decision reasons.");
  }
  return gate;
};

const severityForDecision = (decision) =>
  decision === "pass" ? "INFO" : decision === "warn" ? "WARN" : "ERROR";

const provenanceProperties = ({ evidenceSource, synthetic }) => {
  if (evidenceSource === undefined && synthetic === undefined) return {};
  if (
    typeof evidenceSource !== "string" ||
    !/^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/.test(evidenceSource)
  ) {
    throw new Error("Evidence source must be a bounded publish-safe identifier.");
  }
  if (typeof synthetic !== "boolean") {
    throw new Error("Synthetic provenance must be an explicit boolean.");
  }
  return {
    "forward.dynatrace.evidence_source": evidenceSource,
    "forward.dynatrace.synthetic": synthetic,
  };
};

export const buildChangeGateEvent = (gate, {
  runId,
  gateSha256,
  evidenceSource,
  synthetic,
  scopeMapping,
}) => {
  const validated = validateChangeGate(gate);
  const before = validated.forward.before;
  const after = validated.forward.after;
  const reconciliation = validated.forward.reconciliation;
  const provenance = provenanceProperties({ evidenceSource, synthetic });
  const mapping = scopeMapping ? {
    "forward.dynatrace.scope_mapping_id": scopeMapping.mappingId,
    "forward.dynatrace.scope_mapping_sha256": scopeMapping.mappingSha256,
    "forward.dynatrace.scope_environment_id": scopeMapping.environmentId,
    "forward.dynatrace.scope_source_record_count": scopeMapping.sourceRecords?.length,
  } : {};
  return {
    schemaVersion: EVENT_SCHEMA,
    timestamp: validated.generatedAt,
    eventType: EVENT_TYPE,
    severity: severityForDecision(validated.decision),
    title: `Forward change gate ${validated.decision}: ${validated.change.changeId}`,
    properties: compact({
      "forward.dynatrace.gate_run_id": runId,
      "forward.dynatrace.change_id": validated.change.changeId,
      "forward.dynatrace.deployment_id": validated.change.deploymentId,
      "forward.dynatrace.gate_decision": validated.decision,
      "forward.dynatrace.gate_reason_codes": validated.reasons.map((reason) => reason.code).join(","),
      "forward.dynatrace.gate_sha256": gateSha256,
      "forward.dynatrace.network_id": validated.forward.networkId,
      "forward.dynatrace.before_snapshot_id": before.snapshotId,
      "forward.dynatrace.after_snapshot_id": after.snapshotId,
      "forward.dynatrace.before_reachable": integer(before.counts?.reachable),
      "forward.dynatrace.before_blocked": integer(before.counts?.blocked),
      "forward.dynatrace.after_reachable": integer(after.counts?.reachable),
      "forward.dynatrace.after_blocked": integer(after.counts?.blocked),
      "forward.dynatrace.after_ambiguous": integer(after.counts?.ambiguous),
      "forward.dynatrace.after_unmapped": integer(after.counts?.unmapped),
      "forward.dynatrace.after_failed": integer(after.counts?.failed),
      "forward.dynatrace.reconciliation_run_id": reconciliation?.runId,
      "forward.dynatrace.reconciliation_state": reconciliation?.importState,
      "forward.dynatrace.reconciliation_changed": integer(reconciliation?.counts?.changed),
      "forward.dynatrace.reconciliation_stale": integer(reconciliation?.counts?.stale),
      "forward.dynatrace.deployment_state": validated.dynatrace?.deploymentState,
      "forward.dynatrace.service_health": validated.dynatrace?.serviceHealth,
      "forward.dynatrace.open_problem_count": integer(validated.dynatrace?.openProblemCount),
      ...provenance,
      ...mapping,
    }),
  };
};

export const toOpenPipelineChangeGateRecord = (event) => ({
  "event.provider": "forward-dynatrace",
  "event.type": event.eventType,
  "event.name": event.title,
  "event.category": "change-assurance",
  "event.status": event.severity,
  timestamp: event.timestamp,
  severity: event.severity,
  ...event.properties,
});

export const publishChangeGateEvent = async ({ event, apiBaseUrl, token, fetchImpl = fetch }) => {
  const response = await fetchImpl(`${apiBaseUrl}${ENDPOINT}`, {
    method: "POST",
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
    body: JSON.stringify([toOpenPipelineChangeGateRecord(event)]),
  });
  const text = await response.text();
  if (!response.ok) {
    throw new Error(`Dynatrace change-gate publish failed with ${response.status}: ${text.slice(0, 500)}`);
  }
  return { responseStatus: response.status };
};

export const run = async (argv = process.argv.slice(2)) => {
  const args = parseArgs(argv);
  if (args.help) return process.stdout.write(usage);
  const gateText = await readFile(required(args, "gate"), "utf8");
  const gate = JSON.parse(gateText);
  const runId = args["run-id"] || `forward-change-gate-${new Date().toISOString().replace(/[^0-9]/gu, "").slice(0, 14)}`;
  const event = buildChangeGateEvent(gate, { runId, gateSha256: sha256(gateText) });
  if (args.output) {
    const output = path.resolve(args.output);
    await mkdir(path.dirname(output), { recursive: true });
    await writeFile(output, `${JSON.stringify(event, null, 2)}\n`);
  }
  const environmentUrl = args["environment-url"] || process.env.DYNATRACE_ENVIRONMENT_URL;
  const apiBaseUrl = args["api-base-url"] || process.env.DYNATRACE_API_BASE_URL ||
    (environmentUrl ? toOpenPipelineApiBaseUrl(environmentUrl) : null);
  if (!apiBaseUrl) throw new Error("Missing --environment-url or --api-base-url.");
  let publication = { published: 0, responseStatus: null };
  if (args.apply) {
    const token = await readToken(args["token-file"]);
    const result = await publishChangeGateEvent({ event, apiBaseUrl, token });
    publication = { published: 1, responseStatus: result.responseStatus };
  }
  process.stdout.write(`${JSON.stringify({ mode: args.apply ? "apply" : "dry-run", runId, decision: gate.decision, apiBaseUrl, publication }, null, 2)}\n`);
};

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  run().catch((error) => { process.stderr.write(`${error.message}\n`); process.exitCode = 1; });
}
