#!/usr/bin/env node

import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { pathToFileURL } from "node:url";

import {
  readToken,
  redactSecrets,
  toOpenPipelineApiBaseUrl,
} from "./publish-dynatrace-status-event.mjs";

const OPENPIPELINE_EVENTS_ENDPOINT = "/platform/ingest/v1/events";
const OPENPIPELINE_EVENTS_SCOPE = "openpipeline:events:ingest";
const EVIDENCE_SCHEMA = "forward-dynatrace-path-evidence/v1";
const EVENT_SCHEMA = "forward-dynatrace-network-evidence-event/v1";
const EVENT_TYPE = "forward.dynatrace.network.evidence";
const VALID_ASSESSMENTS = new Set([
  "consistent-with-network-policy-block",
  "no-modeled-policy-block",
  "inconclusive",
]);
const forbiddenTextPatterns = [
  /Authorization/i,
  /Basic\s+[A-Za-z0-9+/=]+/i,
  /Bearer\s+[A-Za-z0-9._-]+/i,
  /FORWARD_PASSWORD/i,
  /dt0[a-z0-9]{2,}\.[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{20,}/i,
];

const usage = `
Dynatrace network-evidence event publisher

Dry-run by default:
  node scripts/publish-dynatrace-network-evidence.mjs \\
    --evidence forward-path-evidence.json \\
    --problem-id P-EXAMPLE-001 \\
    --environment-url https://your-environment-id.apps.dynatrace.com/ \\
    --output forward-network-evidence-event.json

Options:
  --apply                     POST the sanitized event to Dynatrace OpenPipeline.
  --api-base-url URL          Override the Dynatrace live ingest origin.
  --environment-url URL       Dynatrace Apps environment URL.
  --evidence path             Detailed Forward path-evidence artifact.
  --output path               Write the sanitized event artifact.
  --problem-id id             Dynatrace problem identifier.
  --run-id id                 Optional diagnosis/publisher correlation ID.
  --service-entity-id id      Optional affected Dynatrace service entity ID.
  --token-file path           Platform Token file outside the repository.
  --help                      Show this help.

The published event contains aggregate modeled-reachability evidence only. It
does not contain dependency IDs, endpoints, device names, Forward query URLs,
hop details, credentials, or Forward response bodies. The Platform Token needs
${OPENPIPELINE_EVENTS_SCOPE} for --apply.
`;

export const parseArgs = (argv) => {
  const args = {};
  for (let index = 0; index < argv.length; index += 1) {
    const value = argv[index];
    if (!value.startsWith("--")) {
      throw new Error(`Unexpected positional argument: ${value}`);
    }
    const key = value.slice(2);
    if (key === "apply" || key === "help") {
      args[key] = true;
      continue;
    }
    const next = argv[index + 1];
    if (!next || next.startsWith("--")) {
      throw new Error(`Missing value for --${key}`);
    }
    args[key] = next;
    index += 1;
  }
  return args;
};

const required = (args, key) => {
  if (!args[key]) throw new Error(`Missing required option: --${key}`);
  return args[key];
};

const assertNoForbiddenContent = (value, label) => {
  const text = JSON.stringify(value);
  if (forbiddenTextPatterns.some((pattern) => pattern.test(text))) {
    throw new Error(`${label} contains forbidden credential-like content.`);
  }
};

export const validatePathEvidence = (evidence) => {
  if (!evidence || typeof evidence !== "object" || Array.isArray(evidence)) {
    throw new Error("Path evidence must be a JSON object.");
  }
  if (evidence.schemaVersion !== EVIDENCE_SCHEMA) {
    throw new Error(`Path evidence schemaVersion must be ${EVIDENCE_SCHEMA}.`);
  }
  if (!VALID_ASSESSMENTS.has(evidence.modeledReachabilityAssessment)) {
    throw new Error("Path evidence has an unsupported modeled reachability assessment.");
  }
  if (!evidence.counts || typeof evidence.counts !== "object") {
    throw new Error("Path evidence must contain aggregate counts.");
  }
  for (const key of ["total", "queryable", "reachable", "blocked", "ambiguous", "unmapped", "failed"]) {
    if (!Number.isInteger(evidence.counts[key]) || evidence.counts[key] < 0) {
      throw new Error(`Path evidence count ${key} must be a non-negative integer.`);
    }
  }
  assertNoForbiddenContent(evidence, "Path evidence");
  return evidence;
};

const uniqueSorted = (values) => [
  ...new Set(values.filter((value) => typeof value === "string" && value.trim())),
].sort();

const eventSeverity = (evidence) => {
  if (evidence.counts.failed > 0) return "ERROR";
  if (
    evidence.counts.blocked > 0 ||
    evidence.modeledReachabilityAssessment === "inconclusive"
  ) {
    return "WARN";
  }
  return "INFO";
};

export const buildNetworkEvidenceEvent = (
  evidence,
  { problemId, serviceEntityId = null, runId },
) => {
  const validated = validatePathEvidence(evidence);
  const rows = Array.isArray(validated.rows) ? validated.rows : [];
  const forwardingOutcomes = uniqueSorted(
    rows.flatMap((row) => (Array.isArray(row.forwardingOutcomes) ? row.forwardingOutcomes : [])),
  );
  const securityOutcomes = uniqueSorted(
    rows.flatMap((row) => (Array.isArray(row.securityOutcomes) ? row.securityOutcomes : [])),
  );
  const maxHopCount = rows.reduce(
    (maximum, row) => Math.max(maximum, Number.isInteger(row.maxHopCount) ? row.maxHopCount : 0),
    0,
  );
  const event = {
    schemaVersion: EVENT_SCHEMA,
    timestamp: validated.generatedAt || new Date().toISOString(),
    eventType: EVENT_TYPE,
    severity: eventSeverity(validated),
    title: `forward.dynatrace modeled network evidence for problem ${problemId}`,
    properties: {
      "forward.dynatrace.evidence_run_id": runId,
      "forward.dynatrace.problem_id": problemId,
      "forward.dynatrace.service_entity_id": serviceEntityId,
      "forward.dynatrace.network_assessment": validated.modeledReachabilityAssessment,
      "forward.dynatrace.target.network_id": validated.target?.networkId || null,
      "forward.dynatrace.target.snapshot_id": validated.target?.snapshotId || null,
      "forward.dynatrace.count.total": validated.counts.total,
      "forward.dynatrace.count.queryable": validated.counts.queryable,
      "forward.dynatrace.count.reachable": validated.counts.reachable,
      "forward.dynatrace.count.blocked": validated.counts.blocked,
      "forward.dynatrace.count.ambiguous": validated.counts.ambiguous,
      "forward.dynatrace.count.unmapped": validated.counts.unmapped,
      "forward.dynatrace.count.failed": validated.counts.failed,
      "forward.dynatrace.forwarding_outcomes": forwardingOutcomes.join(","),
      "forward.dynatrace.security_outcomes": securityOutcomes.join(","),
      "forward.dynatrace.max_hop_count": maxHopCount,
      "forward.dynatrace.evidence_source": validated.source,
      ...(validated.mode === "execute"
        ? { "forward.dynatrace.synthetic": false }
        : {}),
    },
  };
  assertNoForbiddenContent(event, "Network evidence event");
  return event;
};

export const toOpenPipelineNetworkEvidenceRecord = (event) => ({
  "event.provider": "forward-dynatrace",
  "event.type": event.eventType,
  "event.name": event.title,
  "event.category": "network-evidence",
  "event.status": event.severity,
  timestamp: event.timestamp,
  severity: event.severity,
  ...Object.fromEntries(
    Object.entries(event.properties).filter(([, value]) => value !== null && value !== undefined),
  ),
});

export const publishNetworkEvidenceEvent = async ({
  event,
  apiBaseUrl,
  token,
  fetchImpl = globalThis.fetch,
}) => {
  const response = await fetchImpl(`${apiBaseUrl}${OPENPIPELINE_EVENTS_ENDPOINT}`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify([toOpenPipelineNetworkEvidenceRecord(event)]),
  });
  const text = await response.text();
  if (!response.ok) {
    throw new Error(
      `Dynatrace network evidence publish failed with ${response.status}: ${text.slice(0, 500)}`,
    );
  }
  return { responseStatus: response.status };
};

export const run = async (argv = process.argv.slice(2)) => {
  const args = parseArgs(argv);
  if (args.help) {
    process.stdout.write(usage);
    return;
  }
  const problemId = required(args, "problem-id");
  const evidence = JSON.parse(await readFile(required(args, "evidence"), "utf8"));
  const runId =
    args["run-id"] ||
    `forward-network-evidence-${new Date().toISOString().replace(/[^0-9]/g, "").slice(0, 14)}`;
  const event = buildNetworkEvidenceEvent(evidence, {
    problemId,
    serviceEntityId: args["service-entity-id"] || null,
    runId,
  });
  if (args.output) {
    const outputPath = path.resolve(args.output);
    await mkdir(path.dirname(outputPath), { recursive: true });
    await writeFile(outputPath, `${JSON.stringify(event, null, 2)}\n`);
  }

  const environmentUrl = args["environment-url"] || process.env.DYNATRACE_ENVIRONMENT_URL;
  if (!environmentUrl && !args["api-base-url"]) {
    throw new Error("Missing required option: --environment-url or --api-base-url.");
  }
  const apiBaseUrl =
    args["api-base-url"] ||
    process.env.DYNATRACE_API_BASE_URL ||
    toOpenPipelineApiBaseUrl(environmentUrl);
  const summary = {
    mode: args.apply ? "apply" : "dry-run",
    apiBaseUrl,
    endpoint: OPENPIPELINE_EVENTS_ENDPOINT,
    requiredScope: OPENPIPELINE_EVENTS_SCOPE,
    problemId,
    serviceEntityId: args["service-entity-id"] || null,
    runId,
    assessment: event.properties["forward.dynatrace.network_assessment"],
    severity: event.severity,
    counts: evidence.counts,
    output: args.output ? path.resolve(args.output) : null,
  };
  if (!args.apply) {
    process.stdout.write(`${JSON.stringify(summary, null, 2)}\n`);
    return;
  }

  const result = await publishNetworkEvidenceEvent({
    event,
    apiBaseUrl,
    token: await readToken(args["token-file"]),
  });
  process.stdout.write(
    `${JSON.stringify({ ...summary, status: "published", responseStatus: result.responseStatus }, null, 2)}\n`,
  );
};

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  run().catch((error) => {
    process.stderr.write(`${redactSecrets(error.message)}\n`);
    process.stderr.write(usage);
    process.exit(1);
  });
}
