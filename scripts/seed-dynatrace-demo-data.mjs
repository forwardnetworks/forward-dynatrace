#!/usr/bin/env node

import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const demoDependenciesPath = path.join(root, "shared/demo-dependencies.json");
const appConfigPath = path.join(root, "app.config.json");

const usage = `
Dynatrace demo dependency seeder

Dry-run by default:
  node scripts/seed-dynatrace-demo-data.mjs

Live ingest:
  node scripts/seed-dynatrace-demo-data.mjs --apply

Options:
  --apply                         POST synthetic demo dependency events to Dynatrace.
  --environment-url URL           Dynatrace app/environment URL. Defaults to app.config.json.
  --api-base-url URL              Override API base URL. Defaults to the Dynatrace Apps environment origin.
  --token-file path               Optional local token file outside the repo.
  --run-id id                     Demo run ID. Defaults to a timestamp-based ID.

Required for --apply:
  DYNATRACE_TOKEN, DYNATRACE_TOKEN_FILE, or --token-file.

Uses OpenPipeline events with Bearer auth. The Platform Token needs openpipeline:events:ingest.
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

const OPENPIPELINE_EVENTS_ENDPOINT = "/platform/ingest/v1/events";
const OPENPIPELINE_EVENTS_SCOPE = "openpipeline:events:ingest";

const toDependencyEvent = (dependency, runId, timestamp) => ({
  "event.provider": "forward-dynatrace-demo",
  "event.type": "com.forward.demo.dependency",
  "demo.synthetic": true,
  "demo.run_id": runId,
  "dependency.id": dependency.id,
  "dependency.mapping_state": dependency.mappingState,
  "dependency.confidence": dependency.confidence,
  "dt.entity.service": dependency.serviceEntityId,
  "service.name": dependency.serviceName,
  "app.name": dependency.appName,
  "app.environment": dependency.environment,
  "network.source": dependency.source,
  "network.destination": dependency.destination,
  "network.protocol": dependency.protocol,
  "network.port": dependency.port,
  "owner.team": dependency.owner,
  "criticality": dependency.criticality,
  "timestamp": timestamp,
});

const main = async () => {
  const args = parseArgs(process.argv.slice(2));
  if (args.help) {
    process.stdout.write(usage);
    return;
  }

  const appConfig = await readJson(appConfigPath);
  const dependencies = await readJson(demoDependenciesPath);
  const environmentUrl =
    args["environment-url"] ||
    process.env.DYNATRACE_ENVIRONMENT_URL ||
    appConfig.environmentUrl;
  const apiBaseUrl =
    args["api-base-url"] ||
    process.env.DYNATRACE_API_BASE_URL ||
    toPlatformApiBaseUrl(environmentUrl);
  const runId =
    args["run-id"] ||
    `forward-dynatrace-demo-${new Date().toISOString().replace(/[^0-9]/g, "").slice(0, 14)}`;
  const timestamp = new Date().toISOString();
  const events = dependencies.map((dependency) =>
    toDependencyEvent(dependency, runId, timestamp),
  );

  const summary = {
    mode: args.apply ? "apply" : "dry-run",
    target: "openpipeline-events",
    apiBaseUrl,
    endpoint: OPENPIPELINE_EVENTS_ENDPOINT,
    requiredScope: OPENPIPELINE_EVENTS_SCOPE,
    queryTable: "events",
    runId,
    eventType: "com.forward.demo.dependency",
    provider: "forward-dynatrace-demo",
    syntheticEvents: events.length,
    readyRows: dependencies.filter((dependency) => dependency.mappingState === "ready").length,
    reviewRows: dependencies.filter((dependency) => dependency.mappingState === "review").length,
    needsMapRows: dependencies.filter((dependency) => dependency.mappingState === "needs-map").length,
  };

  if (!args.apply) {
    process.stdout.write(JSON.stringify(summary, null, 2) + "\n");
    return;
  }

  const token = await readToken(args["token-file"] || process.env.DYNATRACE_TOKEN_FILE);
  const response = await fetch(`${apiBaseUrl}${OPENPIPELINE_EVENTS_ENDPOINT}`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(events),
  });
  const text = await response.text();

  if (!response.ok) {
    throw new Error(
      `Dynatrace demo seed failed with ${response.status}: ${text.slice(0, 500)}`,
    );
  }

  process.stdout.write(
    JSON.stringify(
      {
        ...summary,
        status: "seeded",
        responseStatus: response.status,
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
