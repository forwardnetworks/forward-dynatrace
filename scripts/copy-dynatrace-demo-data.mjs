#!/usr/bin/env node

import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { normalizeDynatraceRows } from "./normalize-dynatrace-dependencies.mjs";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const defaultQueryPath = path.join(
  root,
  "deploy/dynatrace-dql/service-dependencies-smartscape.dql",
);

const usage = `
Dynatrace demo tenant copier

Demo-only sidecar workflow. Do not use this to populate production tenants or
customer-owned production environments.

Usage:
  node scripts/copy-dynatrace-demo-data.mjs \\
    --source-environment-url https://<source-environment-id>.apps.dynatrace.com/ \\
    --destination-environment-url https://<destination-environment-id>.apps.dynatrace.com/ \\
    --source-token-file /secure/path/source-token.txt \\
    --destination-token-file /secure/path/destination-token.txt \\
    --output-dir /tmp/forward-dynatrace-demo-copy \\
    --apply

Options:
  --apply                         Ingest copied records into the destination tenant.
  --destination-api-base-url URL   Override destination API origin.
  --destination-environment-url URL
                                  Destination Dynatrace Apps environment URL.
  --destination-token-file path    Destination Platform Token file.
  --max-result-records 100         Maximum source DQL result records.
  --output-dir path                Output directory for source rows and normalized dependencies.
  --poll-interval-ms 1000          Delay between source query polls.
  --poll-timeout-ms 60000          Maximum poll time for async source query completion.
  --query text                     Inline source DQL query.
  --query-file path                Source DQL file. Defaults to Smartscape service-call starter query.
  --request-timeout-ms 30000       Initial source query request wait timeout.
  --run-id id                      Copy run ID. Defaults to a timestamp-based ID.
  --source-api-base-url URL        Override source API origin.
  --source-environment-url URL     Source Dynatrace Apps environment URL.
  --source-token-file path         Source Platform Token file.
  --token-file path                Use one Platform Token file for source and destination.

Required:
  A source token with storage read access for the queried data.
  A destination token with openpipeline:events:ingest.

This copies Dynatrace dependency evidence into a demo/trial sandbox only. It never contacts Forward.
Production deployments must query the customer's own Dynatrace topology instead of copied demo data.
`;

const parseArgs = (argv) => {
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

const redactSecrets = (text) =>
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

const readTokenFile = async (tokenFile) => {
  if (!tokenFile) {
    throw new Error("Missing token file path.");
  }
  const expandedTokenFile = tokenFile.replace(/^~(?=$|\/)/, process.env.HOME || "");
  return extractToken(await readFile(expandedTokenFile, "utf8"));
};

const toPlatformApiBaseUrl = (environmentUrl) => {
  const url = new URL(environmentUrl);
  return url.origin;
};

const toEnvironmentId = (environmentUrl) => new URL(environmentUrl).hostname.split(".")[0];

const toPositiveInteger = (value, label) => {
  const parsed = Number.parseInt(value, 10);
  if (!Number.isInteger(parsed) || parsed <= 0) {
    throw new Error(`${label} must be a positive integer.`);
  }
  return parsed;
};

const sleep = (ms) => new Promise((resolve) => {
  setTimeout(resolve, ms);
});

const readQuery = async (args) => {
  if (args.query && args["query-file"]) {
    throw new Error("Use either --query or --query-file, not both.");
  }
  if (args.query) {
    return args.query;
  }
  return readFile(args["query-file"] || defaultQueryPath, "utf8");
};

const readResponseJson = async (response, label) => {
  const text = await response.text();
  let body;
  try {
    body = text ? JSON.parse(text) : {};
  } catch {
    body = text;
  }
  if (!response.ok) {
    const printable = typeof body === "string" ? body : JSON.stringify(body);
    throw new Error(`${label} failed with ${response.status}: ${printable.slice(0, 500)}`);
  }
  return body;
};

const executeQuery = async ({
  apiBaseUrl,
  token,
  query,
  maxResultRecords,
  requestTimeoutMs,
  pollIntervalMs,
  pollTimeoutMs,
}) => {
  const executeResponse = await fetch(`${apiBaseUrl}/platform/storage/query/v1/query:execute`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
      Accept: "application/json",
    },
    body: JSON.stringify({
      includeTypes: true,
      maxResultRecords,
      query,
      requestTimeoutMilliseconds: requestTimeoutMs,
    }),
  });
  let result = await readResponseJson(executeResponse, "Source Dynatrace query execute");

  const started = Date.now();
  while (result.state !== "SUCCEEDED") {
    if (!result.requestToken) {
      throw new Error(`Source Dynatrace query ended in state ${result.state || "unknown"} without records.`);
    }
    if (Date.now() - started > pollTimeoutMs) {
      throw new Error(`Source Dynatrace query did not finish within ${pollTimeoutMs} ms.`);
    }
    await sleep(pollIntervalMs);
    const url = new URL(`${apiBaseUrl}/platform/storage/query/v1/query:poll`);
    url.searchParams.set("request-token", result.requestToken);
    url.searchParams.set("request-timeout-milliseconds", String(requestTimeoutMs));
    const pollResponse = await fetch(url, {
      headers: {
        Authorization: `Bearer ${token}`,
        Accept: "application/json",
      },
    });
    result = await readResponseJson(pollResponse, "Source Dynatrace query poll");
  }

  return result.result?.records || [];
};

const toCopiedEvent = ({ row, runId, sourceEnvironmentId, destinationEnvironmentId, timestamp }) => ({
  ...row,
  timestamp: row.timestamp || timestamp,
  "event.provider": "forward-dynatrace-demo-copy",
  "event.type": "com.forward.demo.dependency",
  "copy.run_id": runId,
  "copy.source_environment": sourceEnvironmentId,
  "copy.destination_environment": destinationEnvironmentId,
  "copy.source": "dynatrace-demo-tenant",
});

const ingestEvents = async ({ apiBaseUrl, token, events }) => {
  const response = await fetch(`${apiBaseUrl}/platform/ingest/v1/events`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(events),
  });
  await readResponseJson(response, "Destination Dynatrace OpenPipeline ingest");
  return response.status;
};

const main = async () => {
  const args = parseArgs(process.argv.slice(2));
  if (args.help) {
    process.stdout.write(usage);
    return;
  }
  if (!args["source-environment-url"]) {
    throw new Error("Missing required --source-environment-url.");
  }
  if (!args["destination-environment-url"]) {
    throw new Error("Missing required --destination-environment-url.");
  }
  if (!args["output-dir"]) {
    throw new Error("Missing required --output-dir.");
  }

  const sourceTokenFile =
    args["source-token-file"] ||
    args["token-file"] ||
    process.env.DYNATRACE_SOURCE_TOKEN_FILE ||
    process.env.DYNATRACE_TOKEN_FILE;
  const destinationTokenFile =
    args["destination-token-file"] ||
    args["token-file"] ||
    process.env.DYNATRACE_DESTINATION_TOKEN_FILE ||
    process.env.DYNATRACE_TOKEN_FILE;
  const sourceToken = await readTokenFile(sourceTokenFile);
  const destinationToken = args.apply ? await readTokenFile(destinationTokenFile) : "";
  const sourceApiBaseUrl =
    args["source-api-base-url"] || toPlatformApiBaseUrl(args["source-environment-url"]);
  const destinationApiBaseUrl =
    args["destination-api-base-url"] || toPlatformApiBaseUrl(args["destination-environment-url"]);
  const maxResultRecords = toPositiveInteger(args["max-result-records"] || "100", "--max-result-records");
  const requestTimeoutMs = toPositiveInteger(args["request-timeout-ms"] || "30000", "--request-timeout-ms");
  const pollIntervalMs = toPositiveInteger(args["poll-interval-ms"] || "1000", "--poll-interval-ms");
  const pollTimeoutMs = toPositiveInteger(args["poll-timeout-ms"] || "60000", "--poll-timeout-ms");
  const runId =
    args["run-id"] ||
    `forward-dynatrace-copy-${new Date().toISOString().replace(/[^0-9]/g, "").slice(0, 14)}`;
  const query = await readQuery(args);
  const records = await executeQuery({
    apiBaseUrl: sourceApiBaseUrl,
    token: sourceToken,
    query,
    maxResultRecords,
    requestTimeoutMs,
    pollIntervalMs,
    pollTimeoutMs,
  });
  const copiedAt = new Date().toISOString();
  const events = records.map((row) =>
    toCopiedEvent({
      row,
      runId,
      sourceEnvironmentId: toEnvironmentId(args["source-environment-url"]),
      destinationEnvironmentId: toEnvironmentId(args["destination-environment-url"]),
      timestamp: copiedAt,
    }),
  );
  const dependencies = normalizeDynatraceRows(records);
  await mkdir(args["output-dir"], { recursive: true });
  const rowsPath = path.join(args["output-dir"], "source-rows.json");
  const eventsPath = path.join(args["output-dir"], "openpipeline-events.json");
  const dependenciesPath = path.join(args["output-dir"], "dependencies.json");
  await writeFile(rowsPath, JSON.stringify(records, null, 2) + "\n");
  await writeFile(eventsPath, JSON.stringify(events, null, 2) + "\n");
  await writeFile(dependenciesPath, JSON.stringify(dependencies, null, 2) + "\n");

  let responseStatus = null;
  if (args.apply && events.length > 0) {
    responseStatus = await ingestEvents({
      apiBaseUrl: destinationApiBaseUrl,
      token: destinationToken,
      events,
    });
  }

  process.stdout.write(
    JSON.stringify(
      {
        status: args.apply ? "copied" : "dry-run",
        runId,
        sourceRecords: records.length,
        copiedEvents: events.length,
        normalizedDependencies: dependencies.length,
        readyRows: dependencies.filter((dependency) => dependency.mappingState === "ready").length,
        reviewRows: dependencies.filter((dependency) => dependency.mappingState === "review").length,
        needsMapRows: dependencies.filter((dependency) => dependency.mappingState === "needs-map").length,
        responseStatus,
        artifacts: {
          rows: rowsPath,
          events: eventsPath,
          dependencies: dependenciesPath,
        },
      },
      null,
      2,
    ) + "\n",
  );
};

main().catch((error) => {
  process.stderr.write(`${redactSecrets(error.message)}\n`);
  process.stderr.write(usage);
  process.exit(1);
});
