#!/usr/bin/env node

import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { normalizeDynatraceRows } from "./normalize-dynatrace-dependencies.mjs";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const appConfigPath = path.join(root, "app.config.json");
const defaultQueryPath = path.join(
  root,
  "deploy/dynatrace-dql/service-dependency-candidates-openpipeline-events.dql",
);

const usage = `
Dynatrace dependency query exporter

Usage:
  node scripts/query-dynatrace-dependencies.mjs --environment-url https://<environment-id>.apps.dynatrace.com/ --token-file /secure/path/token --output rows.json
  node scripts/query-dynatrace-dependencies.mjs --query-file query.dql --output rows.json --dependencies-output dependencies.json

Options:
  --api-base-url URL              Override API base URL. Defaults to the Dynatrace Apps environment origin.
  --dependencies-output path      Also write normalized Forward dependency candidates.
  --environment-url URL           Dynatrace app/environment URL. Defaults to app.config.json.
  --max-result-records 1000       Maximum DQL result records.
  --output path                   Write raw DQL records to JSON.
  --poll-interval-ms 1000         Delay between query polls.
  --poll-timeout-ms 60000         Maximum poll time for async query completion.
  --query text                    Inline DQL query.
  --query-file path               DQL file. Defaults to the OpenPipeline dependency starter query.
  --request-timeout-ms 30000      Initial query request wait timeout.
  --token-file path               Optional local token file outside the repo.

Required:
  DYNATRACE_TOKEN, DYNATRACE_TOKEN_FILE, or --token-file.

The Platform Token needs storage read access for the queried table, for example
storage:events:read and storage:buckets:read for fetch events.
`;

const parseArgs = (argv) => {
  const args = {};
  for (let index = 0; index < argv.length; index += 1) {
    const value = argv[index];
    if (!value.startsWith("--")) {
      throw new Error(`Unexpected positional argument: ${value}`);
    }
    const key = value.slice(2);
    if (key === "help") {
      args.help = true;
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

const readJson = async (filePath) => JSON.parse(await readFile(filePath, "utf8"));

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

const readToken = async (tokenFile) => {
  if (process.env.DYNATRACE_TOKEN) {
    return extractToken(process.env.DYNATRACE_TOKEN);
  }

  if (!tokenFile) {
    throw new Error("Missing DYNATRACE_TOKEN, DYNATRACE_TOKEN_FILE, or --token-file.");
  }

  const expandedTokenFile = tokenFile.replace(/^~(?=$|\/)/, process.env.HOME || "");
  return extractToken(await readFile(expandedTokenFile, "utf8"));
};

const toPlatformApiBaseUrl = (environmentUrl) => {
  const url = new URL(environmentUrl);
  return url.origin;
};

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
      query,
      includeTypes: true,
      maxResultRecords,
      requestTimeoutMilliseconds: requestTimeoutMs,
    }),
  });
  let result = await readResponseJson(executeResponse, "Dynatrace query execute");

  const started = Date.now();
  while (result.state !== "SUCCEEDED") {
    if (!result.requestToken) {
      throw new Error(`Dynatrace query ended in state ${result.state || "unknown"} without records.`);
    }
    if (Date.now() - started > pollTimeoutMs) {
      throw new Error(`Dynatrace query did not finish within ${pollTimeoutMs} ms.`);
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
    result = await readResponseJson(pollResponse, "Dynatrace query poll");
  }

  return result.result?.records || [];
};

const main = async () => {
  const args = parseArgs(process.argv.slice(2));
  if (args.help) {
    process.stdout.write(usage);
    return;
  }

  const appConfig = await readJson(appConfigPath);
  const environmentUrl =
    args["environment-url"] ||
    process.env.DYNATRACE_ENVIRONMENT_URL ||
    appConfig.environmentUrl;
  const apiBaseUrl =
    args["api-base-url"] ||
    process.env.DYNATRACE_API_BASE_URL ||
    toPlatformApiBaseUrl(environmentUrl);
  const query = await readQuery(args);
  const maxResultRecords = toPositiveInteger(args["max-result-records"] || "1000", "--max-result-records");
  const requestTimeoutMs = toPositiveInteger(args["request-timeout-ms"] || "30000", "--request-timeout-ms");
  const pollIntervalMs = toPositiveInteger(args["poll-interval-ms"] || "1000", "--poll-interval-ms");
  const pollTimeoutMs = toPositiveInteger(args["poll-timeout-ms"] || "60000", "--poll-timeout-ms");
  const token = await readToken(args["token-file"] || process.env.DYNATRACE_TOKEN_FILE);
  const records = await executeQuery({
    apiBaseUrl,
    token,
    query,
    maxResultRecords,
    requestTimeoutMs,
    pollIntervalMs,
    pollTimeoutMs,
  });

  if (args.output) {
    await writeFile(args.output, JSON.stringify(records, null, 2) + "\n");
  }

  let dependencies = [];
  if (args["dependencies-output"]) {
    dependencies = normalizeDynatraceRows(records);
    await writeFile(args["dependencies-output"], JSON.stringify(dependencies, null, 2) + "\n");
  }

  process.stdout.write(
    JSON.stringify(
      {
        status: "ok",
        records: records.length,
        normalizedDependencies: dependencies.length,
        output: args.output || null,
        dependenciesOutput: args["dependencies-output"] || null,
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
