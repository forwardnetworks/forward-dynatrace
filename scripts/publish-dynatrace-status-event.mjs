#!/usr/bin/env node

import { readFile } from "node:fs/promises";
import { pathToFileURL } from "node:url";

const OPENPIPELINE_EVENTS_ENDPOINT = "/platform/ingest/v1/events";
const OPENPIPELINE_EVENTS_SCOPE = "openpipeline:events:ingest";
const VALID_SEVERITIES = new Set(["INFO", "WARN", "ERROR"]);

const usage = `
Dynatrace Forward status event publisher

Dry-run by default:
  node scripts/publish-dynatrace-status-event.mjs \\
    --event forward-ingest-status-event.json \\
    --environment-url https://<environment-id>.apps.dynatrace.com/

Live publish:
  node scripts/publish-dynatrace-status-event.mjs \\
    --event forward-ingest-status-event.json \\
    --environment-url https://<environment-id>.apps.dynatrace.com/ \\
    --apply

Options:
  --event path            Publish-safe event JSON from publish-forward-status.mjs.
  --apply                 POST the event to Dynatrace OpenPipeline. Dry-run otherwise.
  --environment-url URL   Dynatrace app/environment URL.
  --api-base-url URL      Override API base URL. Defaults to the Dynatrace live ingest origin.
  --token-file path       Optional local token file outside the repo.
  --run-id id             Optional publisher run ID for audit correlation.

Required for --apply:
  DYNATRACE_TOKEN, DYNATRACE_TOKEN_FILE, or --token-file.

The Platform Token needs ${OPENPIPELINE_EVENTS_SCOPE}. This publishes aggregate
Forward-side ingest telemetry back to Dynatrace. It never reads Forward
credentials and never writes to Forward.
`;

const forbiddenTextPatterns = [
  /Authorization/i,
  /Basic\s+[A-Za-z0-9+/=]+/i,
  /Bearer\s+[A-Za-z0-9._-]+/i,
  /FORWARD_PASSWORD/i,
  /dt0[a-z0-9]{2,}\.[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{20,}/i,
];

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
  if (!args[key]) {
    throw new Error(`Missing required option: --${key}`);
  }
  return args[key];
};

export const redactSecrets = (text) =>
  text.replace(
    /dt0[a-z0-9]{2,}\.[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{20,}/gi,
    "<redacted-dynatrace-token>",
  );

const extractToken = (rawValue) => {
  const token = rawValue
    .split(/\s+/)
    .find((part) =>
      /^dt0[a-z0-9]{2,}\.[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{20,}$/i.test(part),
    );
  if (token) {
    return token;
  }
  return rawValue.trim().split(/\r?\n/)[0].trim();
};

const expandHome = (filePath) =>
  filePath.replace(/^~(?=$|\/)/, process.env.HOME || "");

export const readToken = async (tokenFile) => {
  if (process.env.DYNATRACE_TOKEN) {
    return extractToken(process.env.DYNATRACE_TOKEN);
  }

  const effectiveTokenFile = tokenFile || process.env.DYNATRACE_TOKEN_FILE;
  if (!effectiveTokenFile) {
    throw new Error("Missing DYNATRACE_TOKEN, DYNATRACE_TOKEN_FILE, or --token-file.");
  }

  return extractToken(await readFile(expandHome(effectiveTokenFile), "utf8"));
};

export const toOpenPipelineApiBaseUrl = (environmentUrl) => {
  const url = new URL(environmentUrl);
  if (url.hostname.endsWith(".apps.dynatrace.com")) {
    url.hostname = url.hostname.replace(/\.apps\.dynatrace\.com$/u, ".live.dynatrace.com");
  }
  return url.origin;
};

export const validateStatusEvent = (event) => {
  if (!event || typeof event !== "object" || Array.isArray(event)) {
    throw new Error("Status event must be a JSON object.");
  }
  if (event.schemaVersion !== "forward-dynatrace-status-event/v1") {
    throw new Error(
      "Status event schemaVersion must be forward-dynatrace-status-event/v1.",
    );
  }
  if (event.eventType !== "forward.dynatrace.ingest.status") {
    throw new Error("Status event eventType must be forward.dynatrace.ingest.status.");
  }
  if (!VALID_SEVERITIES.has(event.severity)) {
    throw new Error("Status event severity must be INFO, WARN, or ERROR.");
  }
  if (!event.timestamp || Number.isNaN(Date.parse(event.timestamp))) {
    throw new Error("Status event timestamp must be an ISO timestamp.");
  }
  if (!event.properties || typeof event.properties !== "object" || Array.isArray(event.properties)) {
    throw new Error("Status event properties must be a JSON object.");
  }

  const text = JSON.stringify(event);
  for (const pattern of forbiddenTextPatterns) {
    if (pattern.test(text)) {
      throw new Error("Status event contains forbidden credential-like content.");
    }
  }

  return event;
};

const compactProperties = (properties) =>
  Object.fromEntries(
    Object.entries(properties).filter(([, value]) => value !== undefined && value !== null),
  );

export const toOpenPipelineEventRecord = (event, publisherRunId) => {
  const validated = validateStatusEvent(event);
  return {
    "event.provider": "forward-dynatrace",
    "event.type": validated.eventType,
    "event.name": validated.title || "Forward Dynatrace ingest status",
    "event.category": "forward-dynatrace",
    "event.status": validated.severity,
    "forward.dynatrace.publisher_run_id": publisherRunId,
    timestamp: validated.timestamp,
    severity: validated.severity,
    ...compactProperties(validated.properties),
  };
};

export const publishStatusEvent = async ({
  event,
  environmentUrl,
  apiBaseUrl,
  token,
  publisherRunId,
  fetchImpl = globalThis.fetch,
}) => {
  if (!fetchImpl) {
    throw new Error("No fetch implementation is available.");
  }
  const effectiveApiBaseUrl = apiBaseUrl || toOpenPipelineApiBaseUrl(environmentUrl);
  const record = toOpenPipelineEventRecord(event, publisherRunId);
  const response = await fetchImpl(`${effectiveApiBaseUrl}${OPENPIPELINE_EVENTS_ENDPOINT}`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify([record]),
  });
  const text = await response.text();
  if (!response.ok) {
    throw new Error(
      `Dynatrace status event publish failed with ${response.status}: ${text.slice(0, 500)}`,
    );
  }
  return {
    responseStatus: response.status,
    responseText: text,
  };
};

export const run = async (argv = process.argv.slice(2)) => {
  const args = parseArgs(argv);
  if (args.help) {
    process.stdout.write(usage);
    return;
  }

  const event = validateStatusEvent(JSON.parse(await readFile(required(args, "event"), "utf8")));
  const environmentUrl = args["environment-url"] || process.env.DYNATRACE_ENVIRONMENT_URL;
  if (!environmentUrl && !args["api-base-url"]) {
    throw new Error("Missing required option: --environment-url or --api-base-url.");
  }
  const apiBaseUrl =
    args["api-base-url"] ||
    process.env.DYNATRACE_API_BASE_URL ||
    toOpenPipelineApiBaseUrl(environmentUrl);
  const publisherRunId =
    args["run-id"] ||
    `forward-dynatrace-status-${new Date().toISOString().replace(/[^0-9]/g, "").slice(0, 14)}`;
  const record = toOpenPipelineEventRecord(event, publisherRunId);
  const summary = {
    mode: args.apply ? "apply" : "dry-run",
    target: "openpipeline-events",
    apiBaseUrl,
    endpoint: OPENPIPELINE_EVENTS_ENDPOINT,
    requiredScope: OPENPIPELINE_EVENTS_SCOPE,
    eventType: event.eventType,
    severity: event.severity,
    publisherRunId,
    packageId: event.properties["forward.dynatrace.package_id"] || null,
    importState: event.properties["forward.dynatrace.import_state"] || null,
    plannedChecks: event.properties["forward.dynatrace.planned_checks"] || 0,
    recordFields: Object.keys(record).length,
  };

  if (!args.apply) {
    process.stdout.write(JSON.stringify(summary, null, 2) + "\n");
    return;
  }

  const token = await readToken(args["token-file"]);
  const result = await publishStatusEvent({
    event,
    environmentUrl,
    apiBaseUrl,
    token,
    publisherRunId,
  });
  process.stdout.write(
    JSON.stringify(
      {
        ...summary,
        status: "published",
        responseStatus: result.responseStatus,
      },
      null,
      2,
    ) + "\n",
  );
};

if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  run().catch((error) => {
    process.stderr.write(`${redactSecrets(error.message)}\n`);
    process.stderr.write(usage);
    process.exit(1);
  });
}
