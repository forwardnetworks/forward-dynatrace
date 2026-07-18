#!/usr/bin/env node

import { createHash } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

import { assertForwardAccessProfile } from "../lib/forward-access-profile.mjs";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const TEMPLATE_SCHEMA = "forward-dynatrace-workflow-template-set/v1";
const ACTION_NAME = "export-forward-package";
const CONNECTION_SCHEMA = "forward-package-handoff-connection";
const MAX_QUERY_BYTES = 128 * 1024;
const REQUIRED_PROJECTION_FIELDS = [
  "id",
  "appName",
  "environment",
  "serviceEntityId",
  "serviceName",
  "source",
  "destination",
  "protocol",
  "port",
  "owner",
  "criticality",
  "confidence",
  "mappingState",
];

const usage = `
Generate importable Dynatrace Workflow templates

Usage:
  npm run dynatrace:workflow:generate -- \\
    --schedule-query /secure/queries/customer-dependencies.dql \\
    --problem-query /secure/queries/customer-problem-dependencies.dql \\
    --source-instance-id dt-env-opaque-id \\
    --forward-access-profile read-only \\
    --output-dir /secure/generated-workflows

Options:
  --schedule-query path  Customer-owned DQL for scheduled and on-demand dependency export.
  --problem-query path   Customer-owned DQL bound to the triggering event with event().
  --source-instance-id id
                         Stable opaque Dynatrace environment/source identifier.
  --forward-access-profile name
                         read-only, network-operator, or network-admin. Default: read-only.
  --output-dir path      Destination for three workflow templates and a checksum manifest.
  --help                 Show help.

Both queries must project the exact normalized dependency fields required by the
export-forward-package action. The generator performs no tenant API calls and
writes no credentials or connection IDs.
`;

const canonicalJson = (value) => `${JSON.stringify(value, null, 2)}\n`;
const sha256 = (value) => createHash("sha256").update(value).digest("hex");

const requiredString = (value, label, maxLength = 4096) => {
  const normalized = typeof value === "string" ? value.trim() : "";
  if (!normalized) throw new Error(`${label} must be a non-empty string.`);
  if (normalized.length > maxLength) throw new Error(`${label} exceeds ${maxLength} characters.`);
  return normalized;
};

const parseArgs = (argv) => {
  const args = {};
  for (let index = 0; index < argv.length; index += 1) {
    const value = argv[index];
    if (value === "--help") {
      args.help = true;
      continue;
    }
    if (!new Set(["--schedule-query", "--problem-query", "--source-instance-id", "--forward-access-profile", "--output-dir"]).has(value)) {
      throw new Error(`Unsupported option: ${value}`);
    }
    const next = argv[index + 1];
    if (!next || next.startsWith("--")) throw new Error(`Missing value for ${value}.`);
    args[value.slice(2)] = next;
    index += 1;
  }
  return args;
};

const projectionPattern = (field) => new RegExp(`(?:^|[\\s,{])${field}\\s*=`, "mu");
const withoutLineComments = (value) => value.replace(/\/\/.*$/gmu, "");

export const validateWorkflowQuery = (query, { problem = false } = {}) => {
  const text = requiredString(query, problem ? "Problem DQL" : "Schedule DQL", MAX_QUERY_BYTES);
  if (Buffer.byteLength(text, "utf8") > MAX_QUERY_BYTES) {
    throw new Error(`DQL exceeds ${MAX_QUERY_BYTES} bytes.`);
  }
  const executableText = withoutLineComments(text);
  const missing = REQUIRED_PROJECTION_FIELDS.filter((field) => !projectionPattern(field).test(executableText));
  if (missing.length > 0) {
    throw new Error(`DQL must project normalized dependency fields: ${missing.join(", ")}.`);
  }
  if (problem && !/\bevent\s*\(\s*\)/u.test(executableText)) {
    throw new Error("Problem DQL must bind the triggering problem through event().");
  }
  return text;
};

const normalizedSourceInstanceId = (value) => {
  const normalized = requiredString(value, "--source-instance-id", 128).toLowerCase();
  if (!/^[a-z0-9][a-z0-9._:-]{2,127}$/u.test(normalized)) {
    throw new Error("--source-instance-id must be a publish-safe opaque identifier.");
  }
  return normalized;
};

const normalizedForwardAccessProfile = (value = "read-only") => {
  const normalized = requiredString(value, "--forward-access-profile", 32);
  return assertForwardAccessProfile(normalized, "--forward-access-profile");
};

const requestExpression = (syncMode, sourceInstanceId, forwardAccessProfile) =>
  `{{ {"sourceInstanceId": "${sourceInstanceId}", "syncMode": "${syncMode}", "forwardAccessProfile": "${forwardAccessProfile}", "dependencies": result("query_dependencies")["records"]} | to_json }}`;

const workflowTemplate = ({
  title,
  description,
  query,
  syncMode,
  sourceInstanceId,
  forwardAccessProfile,
  appId,
  appVersion,
  trigger,
}) => ({
  metadata: {
    version: "1.0.0",
    dependencies: {
      apps: [
        { id: "dynatrace.automations", version: "^1.0.0" },
        { id: appId, version: appVersion },
      ],
    },
    inputs: [{
      type: "connection",
      schema: `app:${appId}:${CONNECTION_SCHEMA}`,
      targets: ["tasks.export_forward_package.connectionId"],
    }],
  },
  workflow: {
    title,
    description,
    tasks: {
      query_dependencies: {
        name: "query_dependencies",
        description: "Query customer-owned normalized dependency evidence from Grail",
        action: "dynatrace.automations:execute-dql-query",
        input: { query },
        position: { x: 0, y: 1 },
      },
      export_forward_package: {
        name: "export_forward_package",
        description: "Publish exact checksummed package bytes to the customer handoff",
        action: `${appId}:${ACTION_NAME}`,
        input: {
          connectionId: "",
          request: requestExpression(syncMode, sourceInstanceId, forwardAccessProfile),
        },
        position: { x: 0, y: 2 },
        predecessors: ["query_dependencies"],
      },
    },
    ...(trigger ? { trigger } : {}),
  },
});

export const buildWorkflowTemplates = ({
  appConfig,
  scheduleQuery,
  problemQuery,
  sourceInstanceId: requestedSourceInstanceId,
  forwardAccessProfile: requestedForwardAccessProfile = "read-only",
}) => {
  const appId = requiredString(appConfig?.app?.id, "app.config.json app.id", 255);
  const appVersion = requiredString(appConfig?.app?.version, "app.config.json app.version", 64);
  const scheduleDql = validateWorkflowQuery(scheduleQuery);
  const problemDql = validateWorkflowQuery(problemQuery, { problem: true });
  const sourceInstanceId = normalizedSourceInstanceId(requestedSourceInstanceId);
  const forwardAccessProfile = normalizedForwardAccessProfile(requestedForwardAccessProfile);
  return {
    "forward-package-on-demand.template.json": workflowTemplate({
      title: "Forward dependency package - on demand",
      description: "Query reviewed customer dependency evidence and publish a Forward intent package on demand.",
      query: scheduleDql,
      syncMode: "manual-import",
      sourceInstanceId,
      forwardAccessProfile,
      appId,
      appVersion,
    }),
    "forward-package-schedule.template.json": workflowTemplate({
      title: "Forward dependency package - schedule",
      description: "Query reviewed customer dependency evidence every 15 minutes and publish a Forward intent package.",
      query: scheduleDql,
      syncMode: "data-connector",
      sourceInstanceId,
      forwardAccessProfile,
      appId,
      appVersion,
      trigger: { schedule: { trigger: { type: "interval", intervalMinutes: 15 } } },
    }),
    "forward-package-problem.template.json": workflowTemplate({
      title: "Forward dependency package - problem",
      description: "Resolve the triggering Dynatrace problem to reviewed dependencies and publish a bounded package.",
      query: problemDql,
      syncMode: "data-connector",
      sourceInstanceId,
      forwardAccessProfile,
      appId,
      appVersion,
      trigger: {
        eventTrigger: {
          triggerConfiguration: {
            type: "davis-problem",
            value: {
              onProblemClose: false,
              categories: {
                monitoringUnavailable: true,
                availability: true,
                error: true,
                slowdown: true,
                resource: true,
                custom: true,
                info: false,
              },
            },
          },
        },
      },
    }),
  };
};

export const generateWorkflowTemplates = async ({
  scheduleQueryPath,
  problemQueryPath,
  sourceInstanceId,
  forwardAccessProfile = "read-only",
  outputDir,
}) => {
  const [appConfig, scheduleQuery, problemQuery] = await Promise.all([
    readFile(path.join(root, "app.config.json"), "utf8").then(JSON.parse),
    readFile(path.resolve(scheduleQueryPath), "utf8"),
    readFile(path.resolve(problemQueryPath), "utf8"),
  ]);
  const templates = buildWorkflowTemplates({
    appConfig,
    scheduleQuery,
    problemQuery,
    sourceInstanceId,
    forwardAccessProfile,
  });
  const destination = path.resolve(outputDir);
  await mkdir(destination, { recursive: true, mode: 0o700 });
  const artifacts = [];
  for (const [name, value] of Object.entries(templates)) {
    const text = canonicalJson(value);
    await writeFile(path.join(destination, name), text, { mode: 0o600 });
    artifacts.push({ name, sha256: sha256(text) });
  }
  const manifest = {
    schemaVersion: TEMPLATE_SCHEMA,
    appId: appConfig.app.id,
    appVersion: appConfig.app.version,
    connectionSchema: `app:${appConfig.app.id}:${CONNECTION_SCHEMA}`,
    artifacts,
  };
  await writeFile(
    path.join(destination, "forward-workflow-templates.manifest.json"),
    canonicalJson(manifest),
    { mode: 0o600 },
  );
  return manifest;
};

export const run = async (argv = process.argv.slice(2)) => {
  const args = parseArgs(argv);
  if (args.help) {
    process.stdout.write(usage);
    return 0;
  }
  const manifest = await generateWorkflowTemplates({
    scheduleQueryPath: requiredString(args["schedule-query"], "--schedule-query"),
    problemQueryPath: requiredString(args["problem-query"], "--problem-query"),
    sourceInstanceId: normalizedSourceInstanceId(args["source-instance-id"]),
    forwardAccessProfile: normalizedForwardAccessProfile(args["forward-access-profile"]),
    outputDir: requiredString(args["output-dir"], "--output-dir"),
  });
  process.stdout.write(canonicalJson(manifest));
  return 0;
};

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  run().then((code) => {
    process.exitCode = code;
  }).catch((error) => {
    process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
    process.exitCode = 1;
  });
}
