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
const GUARDIAN_ENDPOINT = "/platform/ingest/v1/events.sdlc";
const GUARDIAN_CONTEXT_SCHEMA = "forward-dynatrace-guardian-context/v1";
const MAX_GUARDIAN_WINDOW_MS = 24 * 60 * 60 * 1000;

const usage = `
Publish a sanitized Forward and Dynatrace change-validation event

  node scripts/publish-dynatrace-change-gate.mjs \\
    --gate forward-change-validation-gate.json \\
    --environment-url https://<environment>.apps.dynatrace.com/ \\
    --output forward-change-validation-event.json

Options:
  --gate path              Change-validation gate artifact (required).
  --guardian-context path  Validated execution context for a lifecycle Guardian.
  --guardian-trigger       Publish to the SDLC event stream for Guardian automation.
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
    if (value === "--apply" || value === "--guardian-trigger" || value === "--help") {
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
const canonicalize = (value) => {
  if (Array.isArray(value)) return value.map(canonicalize);
  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.keys(value).sort().map((key) => [key, canonicalize(value[key])]),
    );
  }
  return value;
};
const canonicalJson = (value) => `${JSON.stringify(canonicalize(value))}\n`;
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

const safeId = (value, label) => {
  if (typeof value !== "string" || !/^[A-Za-z0-9][A-Za-z0-9._:-]{0,254}$/u.test(value)) {
    throw new Error(`${label} must be a bounded publish-safe identifier.`);
  }
  return value;
};

const sameStrings = (left, right) =>
  JSON.stringify([...new Set(left)].sort()) === JSON.stringify([...new Set(right)].sort());

const containsForbiddenContextKey = (value) => {
  if (!value || typeof value !== "object") return false;
  for (const [key, item] of Object.entries(value)) {
    if (/(?:password|token|secret|credential|endpoint|hostname|ipAddress|pathTopology|device)/iu.test(key)) {
      return true;
    }
    if (containsForbiddenContextKey(item)) return true;
  }
  return false;
};

export const validateGuardianExecutionContext = (context, gate, runId) => {
  const validatedGate = validateChangeGate(gate);
  if (!context || typeof context !== "object" || Array.isArray(context)) {
    throw new Error("Guardian execution context must be an object.");
  }
  if (context.schemaVersion !== GUARDIAN_CONTEXT_SCHEMA) {
    throw new Error(`Guardian execution context schemaVersion must be ${GUARDIAN_CONTEXT_SCHEMA}.`);
  }
  safeId(context.correlationId, "Guardian correlationId");
  safeId(context.gateRunId, "Guardian gateRunId");
  if (context.gateRunId !== runId) throw new Error("Guardian gateRunId must match the publisher run ID.");
  if (context.changeId !== validatedGate.change.changeId) {
    throw new Error("Guardian changeId must match the change gate.");
  }
  if (context.deploymentId !== validatedGate.change.deploymentId) {
    throw new Error("Guardian deploymentId must match the change gate.");
  }
  if (context.observedAt !== validatedGate.generatedAt) {
    throw new Error("Guardian observedAt must match the change gate generatedAt.");
  }
  const from = Date.parse(context.evidenceWindow?.from);
  const to = Date.parse(context.evidenceWindow?.to);
  if (!Number.isFinite(from) || !Number.isFinite(to) || from >= to || to - from > MAX_GUARDIAN_WINDOW_MS) {
    throw new Error("Guardian evidenceWindow must be a positive ISO date-time range no longer than 24 hours.");
  }
  if (!context.scope || !sameStrings(context.scope.serviceEntityIds || [], validatedGate.change.serviceEntityIds)) {
    throw new Error("Guardian serviceEntityIds must exactly match the change gate.");
  }
  for (const [value, label] of [
    [context.scope.mappingId, "Guardian scope mappingId"],
    [context.scope.applicationId, "Guardian applicationId"],
    [context.scope.environmentId, "Guardian environmentId"],
    [context.scope.owner, "Guardian owner"],
  ]) safeId(value, label);
  if (!new Set(["critical", "high", "medium", "low"]).has(context.scope.criticality)) {
    throw new Error("Guardian criticality is unsupported.");
  }
  if (
    context.scope.locations !== undefined &&
    (!Array.isArray(context.scope.locations) || context.scope.locations.length > 25)
  ) throw new Error("Guardian locations must be a bounded array.");
  for (const location of context.scope.locations || []) safeId(location, "Guardian location");
  if (!context.network || context.network.networkId !== validatedGate.forward.networkId) {
    throw new Error("Guardian networkId must match the change gate.");
  }
  if (context.network.beforeSnapshotId !== validatedGate.forward.before.snapshotId) {
    throw new Error("Guardian beforeSnapshotId must match the change gate.");
  }
  if (context.network.afterSnapshotId !== validatedGate.forward.after.snapshotId) {
    throw new Error("Guardian afterSnapshotId must match the change gate.");
  }
  if (
    !Array.isArray(context.dependencies) ||
    context.dependencies.length === 0 ||
    context.dependencies.length > 100
  ) {
    throw new Error("Guardian execution context must include at least one bounded dependency protocol/port set.");
  }
  for (const dependency of context.dependencies) {
    if (!new Set(["TCP", "UDP", "SCTP", "ICMP", "OTHER"]).has(dependency?.protocol)) {
      throw new Error("Guardian dependency protocol is unsupported.");
    }
    if (
      !Array.isArray(dependency.ports) ||
      dependency.ports.length > 64 ||
      dependency.ports.some((port) => !Number.isInteger(port) || port < 0 || port > 65535)
    ) throw new Error("Guardian dependency ports must be bounded integers from 0 through 65535.");
  }
  if (
    !context.mapping ||
    !new Set(["resolved", "review", "ambiguous", "unmapped"]).has(context.mapping.state) ||
    !new Set(["high", "medium", "low"]).has(context.mapping.confidence) ||
    !Number.isInteger(context.mapping.sourceRecordCount) ||
    context.mapping.sourceRecordCount < 1 ||
    context.mapping.sourceRecordCount > 100 ||
    !/^[a-f0-9]{64}$/u.test(context.mapping.mappingSha256 || "")
  ) throw new Error("Guardian mapping metadata is invalid or incomplete.");
  provenanceProperties({
    evidenceSource: context.provenance?.evidenceSource,
    synthetic: context.provenance?.synthetic,
  });
  if (containsForbiddenContextKey(context)) {
    throw new Error("Guardian execution context contains a forbidden credential or topology-detail key.");
  }
  return context;
};

export const validateGuardianTriggerContext = (context) => {
  if (context.mapping?.state !== "resolved" || context.mapping?.confidence !== "high") {
    throw new Error("--guardian-trigger requires a resolved, high-confidence scope mapping.");
  }
  if (context.provenance?.synthetic !== false) {
    throw new Error("--guardian-trigger requires explicitly non-synthetic evidence.");
  }
  return context;
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
  if (synthetic !== false) {
    throw new Error("Change-gate publication rejects synthetic evidence.");
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
  guardianContext,
  guardianContextSha256,
}) => {
  const validated = validateChangeGate(gate);
  const before = validated.forward.before;
  const after = validated.forward.after;
  const reconciliation = validated.forward.reconciliation;
  const context = guardianContext
    ? validateGuardianExecutionContext(guardianContext, validated, runId)
    : null;
  if (context && !/^[a-f0-9]{64}$/u.test(guardianContextSha256 || "")) {
    throw new Error("Guardian execution context requires its canonical SHA-256.");
  }
  if (
    context &&
    ((evidenceSource !== undefined && evidenceSource !== context.provenance.evidenceSource) ||
      (synthetic !== undefined && synthetic !== context.provenance.synthetic))
  ) throw new Error("Guardian provenance must match explicit publisher provenance.");
  const provenance = provenanceProperties(context ? {
    evidenceSource: context.provenance.evidenceSource,
    synthetic: context.provenance.synthetic,
  } : { evidenceSource, synthetic });
  const mappingSource = context ? {
    mappingId: context.scope.mappingId,
    mappingSha256: context.mapping.mappingSha256,
    environmentId: context.scope.environmentId,
    sourceRecordCount: context.mapping.sourceRecordCount,
  } : scopeMapping ? {
    mappingId: scopeMapping.mappingId,
    mappingSha256: scopeMapping.mappingSha256,
    environmentId: scopeMapping.environmentId,
    sourceRecordCount: scopeMapping.sourceRecords?.length,
  } : null;
  const mapping = mappingSource ? {
    "forward.dynatrace.scope_mapping_id": mappingSource.mappingId,
    "forward.dynatrace.scope_mapping_sha256": mappingSource.mappingSha256,
    "forward.dynatrace.scope_environment_id": mappingSource.environmentId,
    "forward.dynatrace.scope_source_record_count": mappingSource.sourceRecordCount,
  } : {};
  const guardian = context ? {
    "forward.dynatrace.correlation_id": context.correlationId,
    "forward.dynatrace.correlation_sha256": guardianContextSha256,
    "timeframe.from": context.evidenceWindow.from,
    "timeframe.to": context.evidenceWindow.to,
    execution_context: context,
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
      ...guardian,
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

export const publishChangeGateEvent = async ({
  event,
  apiBaseUrl,
  token,
  guardianTrigger = false,
  fetchImpl = fetch,
}) => {
  const response = await fetchImpl(`${apiBaseUrl}${guardianTrigger ? GUARDIAN_ENDPOINT : ENDPOINT}`, {
    method: "POST",
    headers: {
      Authorization: `${guardianTrigger ? "Api-Token" : "Bearer"} ${token}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(
      guardianTrigger
        ? toOpenPipelineChangeGateRecord(event)
        : [toOpenPipelineChangeGateRecord(event)],
    ),
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
  const guardianContext = args["guardian-context"]
    ? JSON.parse(await readFile(args["guardian-context"], "utf8"))
    : null;
  if (args["guardian-trigger"] && !guardianContext) {
    throw new Error("--guardian-trigger requires --guardian-context.");
  }
  if (args["guardian-trigger"]) validateGuardianTriggerContext(guardianContext);
  const event = buildChangeGateEvent(gate, {
    runId,
    gateSha256: sha256(gateText),
    guardianContext,
    guardianContextSha256: guardianContext ? sha256(canonicalJson(guardianContext)) : undefined,
  });
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
    const result = await publishChangeGateEvent({
      event,
      apiBaseUrl,
      token,
      guardianTrigger: Boolean(args["guardian-trigger"]),
    });
    publication = { published: 1, responseStatus: result.responseStatus };
  }
  process.stdout.write(`${JSON.stringify({
    mode: args.apply ? "apply" : "dry-run",
    eventStream: args["guardian-trigger"] ? "events.sdlc" : "events",
    runId,
    decision: gate.decision,
    apiBaseUrl,
    publication,
  }, null, 2)}\n`);
};

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  run().catch((error) => { process.stderr.write(`${error.message}\n`); process.exitCode = 1; });
}
