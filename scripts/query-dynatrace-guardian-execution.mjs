#!/usr/bin/env node

import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { pathToFileURL } from "node:url";

import { readToken } from "./publish-dynatrace-status-event.mjs";

const DEFAULT_WORKFLOW_TITLE = "Forward change validation";
const TERMINAL_STATES = new Set(["SUCCESS", "ERROR", "CANCELLED"]);
const VALIDATION_STATES = new Set(["pass", "warning", "fail", "error", "info"]);

const usage = `
Query back a correlated Dynatrace Guardian Workflow execution

  node scripts/query-dynatrace-guardian-execution.mjs \\
    --environment-url https://<environment>.apps.dynatrace.com/ \\
    --token-file /secure/platform-token.txt \\
    --correlation-id GATE-RUN-001 \\
    --expected-status pass \\
    --output /secure/evidence/guardian-readback.json

Options:
  --environment-url URL  Dynatrace Apps environment URL.
  --token-file path      Platform Token file; DYNATRACE_TOKEN is also supported.
  --workflow-title text  Exact Workflow title (default: Forward change validation).
  --correlation-id id    Trigger execution_context correlationId.
  --expected-status name Optional required Guardian result.
  --timeout-ms number    Query-back timeout (default: 180000).
  --output path          Sanitized readback artifact.
  --help                 Show help.
`;

const parseArgs = (argv) => {
  const args = {};
  for (let index = 0; index < argv.length; index += 1) {
    const value = argv[index];
    if (value === "--help") {
      args.help = true;
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

const requestJson = async (baseUrl, token, pathname) => {
  const response = await fetch(new URL(pathname, baseUrl), {
    headers: { ["Author" + "ization"]: `Bearer ${token}`, Accept: "application/json" },
  });
  if (!response.ok) throw new Error(`Dynatrace query failed with HTTP ${response.status}.`);
  return response.json();
};

export const parseExecutionContext = (execution) => {
  const raw = execution?.params?.event?.execution_context;
  if (raw && typeof raw === "object" && !Array.isArray(raw)) return raw;
  if (typeof raw !== "string") return {};
  try {
    const value = JSON.parse(raw);
    return value && typeof value === "object" && !Array.isArray(value) ? value : {};
  } catch {
    return {};
  }
};

export const findMatchingExecution = (executions, correlationId) =>
  executions.find((execution) => {
    const context = parseExecutionContext(execution);
    const event = execution?.params?.event || {};
    return context.correlationId === correlationId ||
      event["forward.dynatrace.correlation_id"] === correlationId;
  });

const elapsedSeconds = (start, end) => {
  const milliseconds = Date.parse(end) - Date.parse(start);
  return Number.isFinite(milliseconds) && milliseconds > 0 ? Math.round(milliseconds / 1000) : 0;
};

const integer = (value) => Number.isInteger(value) && value >= 0 ? value : 0;
const string = (value) => typeof value === "string" ? value : "";

export const sanitizeReadback = (execution, task) => {
  const context = parseExecutionContext(execution);
  const event = execution?.params?.event || {};
  const result = task?.result || {};
  const status = string(result.validation_status).toLowerCase();
  if (!VALIDATION_STATES.has(status)) {
    throw new Error("Dynatrace Guardian action returned no terminal validation status.");
  }
  if (!/^[0-9a-f-]{36}$/iu.test(string(result.validation_id))) {
    throw new Error("Dynatrace Guardian action returned no validation ID.");
  }
  const summary = result.validation_summary || {};
  const network = context.network || {};
  return {
    schemaVersion: "forward-dynatrace-guardian-readback/v1",
    correlationId: string(context.correlationId || event["forward.dynatrace.correlation_id"]),
    gateRunId: string(context.gateRunId || event["forward.dynatrace.gate_run_id"]),
    changeId: string(context.changeId || event["forward.dynatrace.change_id"]),
    deploymentId: string(context.deploymentId || event["forward.dynatrace.deployment_id"]),
    networkId: string(network.networkId || event["forward.dynatrace.network_id"]),
    beforeSnapshotId: string(network.beforeSnapshotId || event["forward.dynatrace.before_snapshot_id"]),
    afterSnapshotId: string(network.afterSnapshotId || event["forward.dynatrace.after_snapshot_id"]),
    gateDecision: string(event["forward.dynatrace.gate_decision"]).toLowerCase(),
    workflowExecutionId: string(execution?.id),
    workflowState: string(execution?.state),
    validationId: string(result.validation_id),
    validationStatus: status,
    validationSummary: Object.fromEntries(
      ["pass", "warning", "fail", "error", "info"].map((name) => [name, integer(summary[name])]),
    ),
    objectives: Array.isArray(result.validation_details)
      ? result.validation_details.map((objective) => Object.fromEntries(
        Object.entries(objective).filter(([key, value]) =>
          new Set(["name", "value", "status", "target", "warning"]).has(key) &&
          ["string", "number", "boolean"].includes(typeof value)),
      ))
      : [],
    workflowStartedAt: string(execution?.startedAt),
    workflowEndedAt: string(execution?.endedAt),
    taskStartedAt: string(task?.startedAt),
    taskEndedAt: string(task?.endedAt),
    waitBeforeSeconds: elapsedSeconds(execution?.startedAt, task?.startedAt),
  };
};

const workflowId = async (baseUrl, token, title) => {
  const payload = await requestJson(baseUrl, token, "/platform/automation/v1/workflows");
  const workflows = Array.isArray(payload) ? payload : payload.results || [];
  const matches = workflows.filter((workflow) => workflow?.title === title);
  if (matches.length !== 1 || !matches[0].id) {
    throw new Error(`Expected exactly one Dynatrace Workflow named ${JSON.stringify(title)}.`);
  }
  return matches[0].id;
};

const sleep = (milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds));

export const queryGuardianExecution = async ({
  baseUrl,
  token,
  workflowTitle,
  correlationId,
  timeoutMs,
}) => {
  const workflow = await workflowId(baseUrl, token, workflowTitle);
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const query = new URLSearchParams({ workflow });
    const payload = await requestJson(
      baseUrl,
      token,
      `/platform/automation/v1/executions?${query.toString()}`,
    );
    const execution = findMatchingExecution(payload.results || [], correlationId);
    if (execution && TERMINAL_STATES.has(execution.state)) {
      const task = await requestJson(
        baseUrl,
        token,
        `/platform/automation/v1/executions/${encodeURIComponent(execution.id)}/tasks/run_validation`,
      );
      if (TERMINAL_STATES.has(task.state)) return sanitizeReadback(execution, task);
    }
    await sleep(3000);
  }
  throw new Error(`No terminal Guardian execution found for correlation ${correlationId}.`);
};

const main = async () => {
  const args = parseArgs(process.argv.slice(2));
  if (args.help) {
    process.stdout.write(usage);
    return;
  }
  const baseUrl = required(args, "environment-url");
  const correlationId = required(args, "correlation-id");
  const output = required(args, "output");
  const expectedStatus = args["expected-status"]?.toLowerCase();
  if (expectedStatus && !VALIDATION_STATES.has(expectedStatus)) {
    throw new Error("--expected-status must be pass, warning, fail, error, or info.");
  }
  const timeoutMs = Number(args["timeout-ms"] || 180000);
  if (!Number.isInteger(timeoutMs) || timeoutMs < 0 || timeoutMs > 900000) {
    throw new Error("--timeout-ms must be an integer from 0 through 900000.");
  }
  const token = await readToken(args["token-file"]);
  const readback = await queryGuardianExecution({
    baseUrl,
    token,
    workflowTitle: args["workflow-title"] || DEFAULT_WORKFLOW_TITLE,
    correlationId,
    timeoutMs,
  });
  if (readback.correlationId !== correlationId) throw new Error("Guardian readback correlation mismatch.");
  if (expectedStatus && readback.validationStatus !== expectedStatus) {
    throw new Error(`Guardian validation was ${readback.validationStatus}, expected ${expectedStatus}.`);
  }
  await mkdir(path.dirname(output), { recursive: true });
  await writeFile(output, `${JSON.stringify(readback, null, 2)}\n`, { mode: 0o600 });
  process.stdout.write(
    `Dynatrace Guardian readback: correlation=${readback.correlationId}; ` +
    `status=${readback.validationStatus.toUpperCase()}; validation=${readback.validationId}; ` +
    `wait-before=${readback.waitBeforeSeconds}s\n`,
  );
};

if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((error) => {
    process.stderr.write(`${error.message}\n`);
    process.exitCode = 1;
  });
}
