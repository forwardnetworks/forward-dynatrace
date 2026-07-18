#!/usr/bin/env node

import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { pathToFileURL } from "node:url";

import { readToken, toOpenPipelineApiBaseUrl } from "./publish-dynatrace-status-event.mjs";

const ARTIFACT_SCHEMA = "forward-dynatrace-security-correlation/v1";
const EVENT_BATCH_SCHEMA = "forward-dynatrace-security-correlation-event-batch/v1";
const EVENT_TYPE = "forward.dynatrace.security.correlation";
const ENDPOINT = "/platform/ingest/v1/events";
const MAX_EVENTS = 100;

const usage = `
Publish sanitized Forward and Dynatrace security correlations

  node scripts/publish-dynatrace-security-correlation.mjs \\
    --correlation security-correlation.json \\
    --environment-url https://<environment>.apps.dynatrace.com/ \\
    --output security-correlation-events.json

Options:
  --correlation path       Security-correlation artifact (required).
  --environment-url URL    Dynatrace Apps environment URL.
  --api-base-url URL       Override Dynatrace ingest origin.
  --token-file path        Platform Token file for --apply.
  --run-id id              Publisher run ID.
  --output path            Write sanitized event batch.
  --apply                  Publish to Dynatrace OpenPipeline.
  --help                   Show help.

Dry-run is the default. At most 100 evidence-reference events are published.
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

export const validateSecurityCorrelation = (artifact) => {
  if (!artifact || typeof artifact !== "object" || Array.isArray(artifact)) {
    throw new Error("Security correlation must be an object.");
  }
  if (artifact.schemaVersion !== ARTIFACT_SCHEMA) {
    throw new Error(`Security correlation schemaVersion must be ${ARTIFACT_SCHEMA}.`);
  }
  if (!Array.isArray(artifact.investigationQueue)) {
    throw new Error("Security correlation must contain an investigation queue.");
  }
  if (
    !artifact.provenance ||
    typeof artifact.provenance.source !== "string" ||
    !artifact.provenance.source ||
    typeof artifact.provenance.synthetic !== "boolean"
  ) {
    throw new Error("Security correlation must contain explicit evidence provenance.");
  }
  if (artifact.provenance.synthetic !== false) {
    throw new Error("Security correlation publication rejects synthetic evidence.");
  }
  if (artifact.investigationQueue.length > MAX_EVENTS) {
    throw new Error(`Security correlation exceeds ${MAX_EVENTS} publishable events.`);
  }
  return artifact;
};

const eventStatus = (severity) =>
  severity === "critical" || severity === "high" ? "ERROR" : severity === "medium" ? "WARN" : "INFO";

export const buildSecurityCorrelationEventBatch = (artifact, { runId }) => {
  const validated = validateSecurityCorrelation(artifact);
  const records = validated.investigationQueue.map((item) => ({
    "event.provider": "forward-dynatrace",
    "event.type": EVENT_TYPE,
    "event.name": `Forward security correlation ${item.severity}`,
    "event.category": "security-correlation",
    "event.status": eventStatus(item.severity),
    timestamp: validated.generatedAt,
    severity: item.severity,
    "forward.dynatrace.security_run_id": runId,
    "forward.dynatrace.evidence_source": validated.provenance.source,
    "forward.dynatrace.synthetic": validated.provenance.synthetic,
    "forward.dynatrace.correlation_id": item.correlationId,
    "forward.dynatrace.correlation_confidence": item.confidence,
    "forward.dynatrace.correlation_disposition": item.disposition,
    ...(item.owner ? { "forward.dynatrace.owner": item.owner } : {}),
    "forward.dynatrace.dynatrace_finding_id": item.evidence.dynatraceFindingId,
    "forward.dynatrace.dynatrace_observed_at": item.evidence.dynatraceObservedAt,
    "forward.dynatrace.forward_exposure_id": item.evidence.forwardExposureId,
    "forward.dynatrace.forward_snapshot_id": item.evidence.forwardSnapshotId,
    "forward.dynatrace.forward_observed_at": item.evidence.forwardObservedAt,
    "forward.dynatrace.identity_mapping_id": item.evidence.identityMappingId,
    "forward.dynatrace.fact.observed_execution": item.facts.observedExecution,
    "forward.dynatrace.fact.vulnerable_runtime": item.facts.vulnerableRuntime,
    "forward.dynatrace.fact.modeled_reachability": item.facts.modeledReachability,
    "forward.dynatrace.fact.internet_addressability": item.facts.internetAddressability,
    "forward.dynatrace.fact.policy_finding": item.facts.policyFinding,
  }));
  return {
    schemaVersion: EVENT_BATCH_SCHEMA,
    generatedAt: validated.generatedAt,
    eventType: EVENT_TYPE,
    runId,
    provenance: { ...validated.provenance },
    counts: {
      publishedCandidates: records.length,
      rejectedMappings: validated.counts?.rejectedMappings || 0,
    },
    records,
  };
};

export const publishSecurityCorrelationEvents = async ({ batch, apiBaseUrl, token, fetchImpl = fetch }) => {
  if (batch.records.length === 0) return { published: 0, responseStatus: null };
  const response = await fetchImpl(`${apiBaseUrl}${ENDPOINT}`, {
    method: "POST",
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
    body: JSON.stringify(batch.records),
  });
  const text = await response.text();
  if (!response.ok) {
    throw new Error(`Dynatrace security-correlation publish failed with ${response.status}: ${text.slice(0, 500)}`);
  }
  return { published: batch.records.length, responseStatus: response.status };
};

export const run = async (argv = process.argv.slice(2)) => {
  const args = parseArgs(argv);
  if (args.help) return process.stdout.write(usage);
  const artifact = JSON.parse(await readFile(required(args, "correlation"), "utf8"));
  const runId = args["run-id"] || `forward-security-correlation-${new Date().toISOString().replace(/[^0-9]/gu, "").slice(0, 14)}`;
  const batch = buildSecurityCorrelationEventBatch(artifact, { runId });
  if (args.output) {
    const output = path.resolve(args.output);
    await mkdir(path.dirname(output), { recursive: true });
    await writeFile(output, `${JSON.stringify(batch, null, 2)}\n`);
  }
  const environmentUrl = args["environment-url"] || process.env.DYNATRACE_ENVIRONMENT_URL;
  const apiBaseUrl = args["api-base-url"] || process.env.DYNATRACE_API_BASE_URL ||
    (environmentUrl ? toOpenPipelineApiBaseUrl(environmentUrl) : null);
  if (!apiBaseUrl) throw new Error("Missing --environment-url or --api-base-url.");
  let publication = { published: 0, responseStatus: null };
  if (args.apply) {
    const token = await readToken(args["token-file"]);
    publication = await publishSecurityCorrelationEvents({ batch, apiBaseUrl, token });
  }
  process.stdout.write(`${JSON.stringify({ mode: args.apply ? "apply" : "dry-run", runId, candidates: batch.records.length, apiBaseUrl, publication }, null, 2)}\n`);
};

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  run().catch((error) => { process.stderr.write(`${error.message}\n`); process.exitCode = 1; });
}
