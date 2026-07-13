#!/usr/bin/env node

import { spawn } from "node:child_process";
import { mkdir, open, readFile, rm, writeFile } from "node:fs/promises";
import { hostname } from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";

import { buildPathEvidence } from "./forward-path-evidence.mjs";
import {
  latestProcessedSnapshotId,
  makeForwardReadOnlyClient,
  resolveDependencyCandidates,
} from "./forward-resolve-hosts.mjs";
import { forwardReadOnlyAuthorization } from "./live-demo-conductor.mjs";
import {
  buildServiceNowChangePreflight,
  fetchServiceNowChange,
} from "./servicenow-change-preflight.mjs";
import { sha256 } from "./servicenow-change-feedback.mjs";

const WORKFLOW_SCHEMA = "forward-dynatrace-servicenow-change-workflow/v1";
const DEFAULT_SNAPSHOT_TIMEOUT_MS = 15 * 60 * 1000;
const DEFAULT_SNAPSHOT_POLL_INTERVAL_MS = 15 * 1000;
const DEFAULT_DYNATRACE_STABILIZATION_SECONDS = 120;

const usage = `
ServiceNow-first two-phase change-assurance conductor

Capture the approved pre-deployment baseline:
  npm run servicenow:change-workflow -- \\
    --phase start \\
    --change-number CHG0042187 \\
    --deployment-id checkout-api-2026.07.15.3 \\
    --network-id network-production \\
    --service-entity-id SERVICE-CHECKOUT-API \\
    --dependencies /secure/evidence/dynatrace-dependencies.json \\
    --output-dir /secure/evidence/change-assurance

Resume after the customer-owned deployment and Dynatrace stabilization:
  npm run servicenow:change-workflow -- \\
    --phase complete \\
    --state /secure/evidence/change-assurance/servicenow-change-workflow.json \\
    --context /secure/evidence/forward-change-context.json

Options:
  --phase start|complete         Workflow phase.
  --change-number value         Exact ServiceNow change number for start.
  --deployment-id value         Customer deployment ID for start.
  --network-id value            Forward network ID for start.
  --service-entity-id value     Affected Dynatrace service; repeat for start.
  --dependencies path           Normalized live Dynatrace dependencies for start.
  --output-dir path             Evidence directory for start.
  --instance-alias value        Publish-safe ServiceNow label.
  --evaluation-time value       Start preflight evaluation time; default current time.
  --before-snapshot-id value    Approved processed before snapshot; default latest processed.
  --state path                  Baseline workflow state for complete.
  --context path                Stabilized Dynatrace deployment/health context for complete.
  --snapshot-timeout-ms value   New-snapshot wait bound; default ${DEFAULT_SNAPSHOT_TIMEOUT_MS}.
  --snapshot-poll-ms value      New-snapshot polling interval; default ${DEFAULT_SNAPSHOT_POLL_INTERVAL_MS}.
  --stabilization-seconds value Dynatrace stabilization wait; default ${DEFAULT_DYNATRACE_STABILIZATION_SECONDS}.
  --publish-servicenow          Publish idempotent ServiceNow feedback during complete.
  --verify-servicenow-retry     With ServiceNow publication, prove an identical retry
                                reuses the original work note and attachment.
  --publish-dynatrace           Publish the aggregate Dynatrace gate event during complete.
  --dynatrace-environment-url   Dynatrace Apps environment URL for publication.
  --dynatrace-api-base-url      Override Dynatrace OpenPipeline origin.
  --dynatrace-token-file path   Platform token file outside the repository.
  --report-only                 Exit 0 for a warn/fail gate; default exit is 2.
  --help                        Show help.

The deployment remains customer-owned. Start performs no Forward writes.
Complete performs read-only path analysis and dry-run intent reconciliation;
Forward check mutation is never enabled by this conductor.
`;

const repeatableArgs = new Set(["service-entity-id"]);
const flagArgs = new Set([
  "help",
  "publish-servicenow",
  "verify-servicenow-retry",
  "publish-dynatrace",
  "report-only",
]);

export const parseArgs = (argv) => {
  const args = {};
  for (let index = 0; index < argv.length; index += 1) {
    const value = argv[index];
    if (!value.startsWith("--")) throw new Error(`Unexpected argument: ${value}`);
    const key = value.slice(2);
    if (flagArgs.has(key)) {
      args[key] = true;
      continue;
    }
    const next = argv[index + 1];
    if (!next || next.startsWith("--")) throw new Error(`Missing value for ${value}.`);
    args[key] = repeatableArgs.has(key) ? [...(args[key] || []), next] : next;
    index += 1;
  }
  return args;
};

const required = (value, label) => {
  if (typeof value !== "string" || !value.trim()) throw new Error(`Missing required ${label}.`);
  return value.trim();
};

const positiveInteger = (value, fallback, label) => {
  const parsed = Number.parseInt(value || String(fallback), 10);
  if (!Number.isInteger(parsed) || parsed <= 0) throw new Error(`${label} must be a positive integer.`);
  return parsed;
};

const nonNegativeInteger = (value, fallback, label) => {
  const parsed = Number.parseInt(value ?? String(fallback), 10);
  if (!Number.isInteger(parsed) || parsed < 0) throw new Error(`${label} must be a non-negative integer.`);
  return parsed;
};

const canonicalJson = (value) => `${JSON.stringify(value, null, 2)}\n`;
const readJsonText = async (filePath) => {
  const text = await readFile(path.resolve(filePath), "utf8");
  return { text, value: JSON.parse(text) };
};

const writeJson = async (filePath, value) => {
  const text = canonicalJson(value);
  await writeFile(filePath, text);
  return { text, sha256: sha256(text) };
};

export const selectScopedDependencies = (dependencies, serviceEntityIds) => {
  if (!Array.isArray(dependencies)) throw new Error("Dynatrace dependencies must be an array.");
  const requested = [...new Set((serviceEntityIds || []).map((value) => required(value, "service entity ID")))].sort();
  if (requested.length === 0) throw new Error("At least one affected service entity ID is required.");
  const requestedSet = new Set(requested);
  const selected = dependencies.filter((dependency) => requestedSet.has(dependency?.serviceEntityId));
  const found = new Set(selected.map((dependency) => dependency.serviceEntityId));
  const missing = requested.filter((serviceId) => !found.has(serviceId));
  if (missing.length > 0) {
    throw new Error(`Dynatrace dependency evidence is missing affected services: ${missing.join(", ")}.`);
  }
  return selected;
};

export const waitForNewProcessedSnapshot = async ({
  api,
  networkId,
  beforeSnapshotId,
  timeoutMs = DEFAULT_SNAPSHOT_TIMEOUT_MS,
  pollIntervalMs = DEFAULT_SNAPSHOT_POLL_INTERVAL_MS,
  now = Date.now,
  sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
}) => {
  const startedAt = now();
  while (true) {
    const snapshotId = await latestProcessedSnapshotId({ api, networkId });
    if (snapshotId !== beforeSnapshotId) return snapshotId;
    const elapsed = now() - startedAt;
    if (elapsed >= timeoutMs) {
      throw new Error(`No new processed Forward snapshot appeared within ${timeoutMs} ms.`);
    }
    await sleep(Math.min(pollIntervalMs, timeoutMs - elapsed));
  }
};

export const validateStabilizedContext = ({
  context,
  beforeEvidenceGeneratedAt,
  stabilizationStartedAt,
  stabilizationSeconds,
}) => {
  const contextObservedAt = Date.parse(context?.observedAt);
  const stabilizationFloor = stabilizationSeconds > 0
    ? stabilizationStartedAt + (stabilizationSeconds * 1000) - 1000
    : Number.NEGATIVE_INFINITY;
  const freshnessFloor = Math.max(Date.parse(beforeEvidenceGeneratedAt), stabilizationFloor);
  if (Number.isNaN(contextObservedAt) || contextObservedAt < freshnessFloor) {
    throw new Error(
      "Dynatrace change context must be collected after the baseline and the configured stabilization wait.",
    );
  }
  return context;
};

const requireForwardReadEnvironment = (env) => {
  required(env.FORWARD_BASE_URL, "environment: FORWARD_BASE_URL");
  const dedicated = env.FORWARD_PATH_SEARCH_AUTHORIZATION || env.FORWARD_HOST_RESOLUTION_AUTHORIZATION ||
    env.FORWARD_READONLY_AUTHORIZATION || env.FORWARD_AUTHORIZATION;
  if (!dedicated) {
    required(env.FORWARD_USER, "environment: FORWARD_USER");
    required(env.FORWARD_PASSWORD, "environment: FORWARD_PASSWORD");
  }
};

const runChild = (argv, { env = process.env, allowedCodes = [0] } = {}) =>
  new Promise((resolve, reject) => {
    const child = spawn(process.execPath, argv, {
      cwd: process.cwd(),
      env,
      stdio: ["ignore", "pipe", "pipe"],
    });
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (chunk) => { stdout += chunk; });
    child.stderr.on("data", (chunk) => { stderr += chunk; });
    child.on("error", reject);
    child.on("close", (code) => {
      if (!allowedCodes.includes(code)) {
        reject(new Error(`${argv[0]} exited ${code}: ${(stderr || stdout).slice(0, 1200)}`));
        return;
      }
      resolve({ code, stdout, stderr });
    });
  });

export const validateWorkflowState = (state) => {
  if (!state || state.schemaVersion !== WORKFLOW_SCHEMA) {
    throw new Error(`Workflow state schemaVersion must be ${WORKFLOW_SCHEMA}.`);
  }
  if (!new Set(["blocked", "baseline-captured", "completed"]).has(state.status)) {
    throw new Error("Workflow state status is invalid.");
  }
  return state;
};

export const withExclusiveWorkflowLock = async (stateFile, operation) => {
  const lockPath = `${path.resolve(stateFile)}.lock`;
  const acquire = async (allowRecovery) => {
    try {
      const handle = await open(lockPath, "wx", 0o600);
      try {
        await handle.writeFile(canonicalJson({
          schemaVersion: "forward-dynatrace-workflow-lock/v1",
          hostname: hostname(),
          pid: process.pid,
          startedAt: new Date().toISOString(),
          stateFile: path.resolve(stateFile),
        }));
      } catch (error) {
        await handle.close();
        await rm(lockPath, { force: true });
        throw error;
      }
      return handle;
    } catch (error) {
      if (error?.code !== "EEXIST") throw error;
      if (allowRecovery) {
        let existing;
        try {
          existing = JSON.parse(await readFile(lockPath, "utf8"));
        } catch {
          existing = null;
        }
        if (existing?.hostname === hostname() && Number.isInteger(existing.pid)) {
          let running = true;
          try {
            process.kill(existing.pid, 0);
          } catch (killError) {
            if (killError?.code === "ESRCH") running = false;
          }
          if (!running) {
            await rm(lockPath, { force: true });
            return acquire(false);
          }
        }
      }
      throw new Error(
        `Another conductor already holds the workflow lock: ${lockPath}. ` +
        "If the recorded process is gone, verify the lock metadata before removing it.",
      );
    }
  };
  const handle = await acquire(true);
  try {
    return await operation();
  } finally {
    try {
      await handle.close();
    } finally {
      await rm(lockPath, { force: true });
    }
  }
};

const startWorkflow = async (args) => {
  requireForwardReadEnvironment(process.env);
  const outputDir = path.resolve(required(args["output-dir"], "option: --output-dir"));
  await mkdir(outputDir, { recursive: true });
  const changeNumber = required(args["change-number"], "option: --change-number");
  const deploymentId = required(args["deployment-id"], "option: --deployment-id");
  const networkId = required(args["network-id"], "option: --network-id");
  const serviceEntityIds = args["service-entity-id"];
  const observedAt = args["evaluation-time"] || new Date().toISOString();
  const preflightPath = path.join(outputDir, "servicenow-change-preflight-start.json");
  const statePath = path.join(outputDir, "servicenow-change-workflow.json");

  const record = await fetchServiceNowChange({
    baseUrl: process.env.SERVICENOW_BASE_URL,
    user: process.env.SERVICENOW_USER,
    password: process.env.SERVICENOW_PASSWORD,
    changeNumber,
  });
  const preflight = buildServiceNowChangePreflight({
    record,
    observedAt,
    instanceAlias: args["instance-alias"],
    deploymentId,
    networkId,
    serviceEntityIds,
  });
  const preflightOutput = await writeJson(preflightPath, preflight);
  if (preflight.authorization.status !== "eligible") {
    const state = {
      schemaVersion: WORKFLOW_SCHEMA,
      status: "blocked",
      updatedAt: preflight.observedAt,
      change: { number: changeNumber, sysId: preflight.change.sysId, deploymentId, serviceEntityIds: preflight.scope.serviceEntityIds },
      forward: { networkId, beforeSnapshotId: null, afterSnapshotId: null },
      decision: null,
      policy: {
        dynatraceStabilizationSeconds: DEFAULT_DYNATRACE_STABILIZATION_SECONDS,
        snapshotTimeoutMs: DEFAULT_SNAPSHOT_TIMEOUT_MS,
        snapshotPollMs: DEFAULT_SNAPSHOT_POLL_INTERVAL_MS,
      },
      artifacts: { preflight: preflightPath },
      hashes: { preflightSha256: preflightOutput.sha256 },
    };
    await writeJson(statePath, state);
    process.stdout.write(canonicalJson({ statePath, ...state }));
    return 2;
  }

  const dependencyInput = await readJsonText(required(args.dependencies, "option: --dependencies"));
  const scopedDependencies = selectScopedDependencies(dependencyInput.value, preflight.scope.serviceEntityIds);
  const scopedDependenciesPath = path.join(outputDir, "dynatrace-dependencies-scoped.json");
  const scopedOutput = await writeJson(scopedDependenciesPath, scopedDependencies);
  const authorization = forwardReadOnlyAuthorization(process.env);
  const api = makeForwardReadOnlyClient({
    forwardBaseUrl: process.env.FORWARD_BASE_URL,
    authorization,
  });
  const beforeSnapshotId = args["before-snapshot-id"] ||
    await latestProcessedSnapshotId({ api, networkId });
  const resolution = await resolveDependencyCandidates({
    dependencies: scopedDependencies,
    forwardBaseUrl: process.env.FORWARD_BASE_URL,
    forwardNetworkId: networkId,
    snapshotId: beforeSnapshotId,
    authorization,
    execute: true,
  });
  if (!resolution.dependencies.some((dependency) => dependency.mappingState === "ready")) {
    throw new Error("Forward host resolution produced no ready affected-service dependencies.");
  }
  const resolvedDependenciesPath = path.join(outputDir, "forward-resolved-dependencies.json");
  const resolutionReportPath = path.join(outputDir, "forward-host-resolution-report.json");
  const resolvedOutput = await writeJson(resolvedDependenciesPath, resolution.dependencies);
  await writeJson(resolutionReportPath, resolution.report);
  const beforeEvidence = await buildPathEvidence({
    dependencies: resolution.dependencies,
    forwardBaseUrl: process.env.FORWARD_BASE_URL,
    forwardNetworkId: networkId,
    snapshotId: beforeSnapshotId,
    authorization,
    execute: true,
  });
  const beforeEvidencePath = path.join(outputDir, "forward-before-path-evidence.json");
  const beforeOutput = await writeJson(beforeEvidencePath, beforeEvidence);
  const state = {
    schemaVersion: WORKFLOW_SCHEMA,
    status: "baseline-captured",
    updatedAt: beforeEvidence.generatedAt,
    change: { number: changeNumber, sysId: preflight.change.sysId, deploymentId, serviceEntityIds: preflight.scope.serviceEntityIds },
    forward: { networkId, beforeSnapshotId, afterSnapshotId: null },
    decision: null,
    policy: {
      dynatraceStabilizationSeconds: DEFAULT_DYNATRACE_STABILIZATION_SECONDS,
      snapshotTimeoutMs: DEFAULT_SNAPSHOT_TIMEOUT_MS,
      snapshotPollMs: DEFAULT_SNAPSHOT_POLL_INTERVAL_MS,
    },
    artifacts: {
      preflight: preflightPath,
      scopedDependencies: scopedDependenciesPath,
      resolvedDependencies: resolvedDependenciesPath,
      hostResolutionReport: resolutionReportPath,
      beforeEvidence: beforeEvidencePath,
    },
    hashes: {
      preflightSha256: preflightOutput.sha256,
      scopedDependenciesSha256: scopedOutput.sha256,
      resolvedDependenciesSha256: resolvedOutput.sha256,
      beforeEvidenceSha256: beforeOutput.sha256,
    },
  };
  await writeJson(statePath, state);
  process.stdout.write(canonicalJson({ statePath, ...state }));
  return 0;
};

const verifiedStateArtifact = async (state, artifactKey, hashKey) => {
  const artifact = await readJsonText(required(state.artifacts?.[artifactKey], `state artifact: ${artifactKey}`));
  if (sha256(artifact.text) !== state.hashes?.[hashKey]) {
    throw new Error(`Workflow state artifact hash mismatch: ${artifactKey}.`);
  }
  return artifact;
};

const completeWorkflow = async (args) => {
  requireForwardReadEnvironment(process.env);
  required(process.env.FORWARD_USER, "environment: FORWARD_USER for dry-run reconciliation");
  required(process.env.FORWARD_PASSWORD, "environment: FORWARD_PASSWORD for dry-run reconciliation");
  const stateFile = path.resolve(required(args.state, "option: --state"));
  const stateInput = await readJsonText(stateFile);
  const state = validateWorkflowState(stateInput.value);
  if (state.status !== "baseline-captured") {
    throw new Error("Only baseline-captured workflow state can be completed.");
  }
  const outputDir = path.dirname(stateFile);
  const [, resolvedDependencies, beforeEvidence] = await Promise.all([
    verifiedStateArtifact(state, "preflight", "preflightSha256"),
    verifiedStateArtifact(state, "resolvedDependencies", "resolvedDependenciesSha256"),
    verifiedStateArtifact(state, "beforeEvidence", "beforeEvidenceSha256"),
  ]);
  const authorization = forwardReadOnlyAuthorization(process.env);
  const api = makeForwardReadOnlyClient({
    forwardBaseUrl: process.env.FORWARD_BASE_URL,
    authorization,
  });
  if (args["after-snapshot-id"]) {
    throw new Error("The production conductor does not accept --after-snapshot-id; it waits for a new latest processed snapshot.");
  }
  const snapshotTimeoutMs = positiveInteger(args["snapshot-timeout-ms"], DEFAULT_SNAPSHOT_TIMEOUT_MS, "--snapshot-timeout-ms");
  const snapshotPollMs = positiveInteger(args["snapshot-poll-ms"], DEFAULT_SNAPSHOT_POLL_INTERVAL_MS, "--snapshot-poll-ms");
  const dynatraceStabilizationSeconds = nonNegativeInteger(
    args["stabilization-seconds"],
    DEFAULT_DYNATRACE_STABILIZATION_SECONDS,
    "--stabilization-seconds",
  );
  const stabilizationStartedAt = Date.now();
  const [afterSnapshotId] = await Promise.all([
    waitForNewProcessedSnapshot({
      api,
      networkId: state.forward.networkId,
      beforeSnapshotId: state.forward.beforeSnapshotId,
      timeoutMs: snapshotTimeoutMs,
      pollIntervalMs: snapshotPollMs,
    }),
    new Promise((resolve) => setTimeout(resolve, dynatraceStabilizationSeconds * 1000)),
  ]);
  const context = await readJsonText(required(args.context, "option: --context"));
  validateStabilizedContext({
    context: context.value,
    beforeEvidenceGeneratedAt: beforeEvidence.value.generatedAt,
    stabilizationStartedAt,
    stabilizationSeconds: dynatraceStabilizationSeconds,
  });
  const afterEvidence = await buildPathEvidence({
    dependencies: resolvedDependencies.value,
    forwardBaseUrl: process.env.FORWARD_BASE_URL,
    forwardNetworkId: state.forward.networkId,
    snapshotId: afterSnapshotId,
    authorization,
    execute: true,
  });
  const afterEvidencePath = path.join(outputDir, "forward-after-path-evidence.json");
  const afterOutput = await writeJson(afterEvidencePath, afterEvidence);
  const packageDir = path.join(outputDir, "forward-package");
  await runChild([
    "--disable-warning=MODULE_TYPELESS_PACKAGE_JSON",
    "--experimental-strip-types",
    "scripts/build-forward-package.mjs",
    "--dependencies", state.artifacts.resolvedDependencies,
    "--output-dir", packageDir,
    "--sync-mode", "manual-import",
  ]);
  const reconciliationReportPath = path.join(outputDir, "forward-reconciliation-report.json");
  const reconciliationStatusPath = path.join(outputDir, "forward-ingest-status.json");
  await runChild([
    "scripts/forward-import-package.mjs",
    "--checks", path.join(packageDir, "forward-intent-checks.json"),
    "--manifest", path.join(packageDir, "forward-dynatrace-manifest.json"),
    "--snapshot-id", afterSnapshotId,
    "--report", reconciliationReportPath,
    "--status-artifact", reconciliationStatusPath,
  ], { env: { ...process.env, FORWARD_NETWORK_ID: state.forward.networkId } });

  const assuranceArgs = [
    "scripts/servicenow-change-assurance.mjs",
    "--preflight", state.artifacts.preflight,
    "--context", path.resolve(args.context),
    "--before-evidence", state.artifacts.beforeEvidence,
    "--after-evidence", afterEvidencePath,
    "--reconciliation-status", reconciliationStatusPath,
    "--output-dir", outputDir,
    ...(args["publish-servicenow"] ? ["--publish-servicenow"] : []),
    ...(args["verify-servicenow-retry"] ? ["--verify-servicenow-retry"] : []),
    ...(args["publish-dynatrace"] ? ["--publish-dynatrace"] : []),
    ...(args["dynatrace-environment-url"] ? ["--dynatrace-environment-url", args["dynatrace-environment-url"]] : []),
    ...(args["dynatrace-api-base-url"] ? ["--dynatrace-api-base-url", args["dynatrace-api-base-url"]] : []),
    ...(args["dynatrace-token-file"] ? ["--dynatrace-token-file", args["dynatrace-token-file"]] : []),
    ...(args["report-only"] ? ["--report-only"] : []),
  ];
  const assurance = await runChild(assuranceArgs, { allowedCodes: [0, 2] });
  const assuranceSummaryPath = path.join(outputDir, "servicenow-change-assurance.json");
  const assuranceSummary = await readJsonText(assuranceSummaryPath);
  const completedState = {
    ...state,
    status: "completed",
    updatedAt: assuranceSummary.value.generatedAt,
    forward: { ...state.forward, afterSnapshotId },
    decision: assuranceSummary.value.decision,
    policy: {
      dynatraceStabilizationSeconds,
      snapshotTimeoutMs,
      snapshotPollMs,
    },
    artifacts: {
      ...state.artifacts,
      afterEvidence: afterEvidencePath,
      packageDir,
      reconciliationReport: reconciliationReportPath,
      reconciliationStatus: reconciliationStatusPath,
      assuranceSummary: assuranceSummaryPath,
    },
    hashes: {
      ...state.hashes,
      afterEvidenceSha256: afterOutput.sha256,
      contextSha256: sha256(context.text),
      assuranceSummarySha256: sha256(assuranceSummary.text),
    },
  };
  await writeJson(stateFile, completedState);
  process.stdout.write(canonicalJson({ statePath: stateFile, ...completedState }));
  return assurance.code;
};

export const run = async (argv = process.argv.slice(2)) => {
  const args = parseArgs(argv);
  if (args.help) {
    process.stdout.write(usage);
    return 0;
  }
  if (args["verify-servicenow-retry"] && !args["publish-servicenow"]) {
    throw new Error("--verify-servicenow-retry requires --publish-servicenow.");
  }
  if (args["verify-servicenow-retry"] && args.phase !== "complete") {
    throw new Error("--verify-servicenow-retry is valid only for --phase complete.");
  }
  if (args.phase === "start") {
    const outputDir = path.resolve(required(args["output-dir"], "option: --output-dir"));
    await mkdir(outputDir, { recursive: true });
    const stateFile = path.join(outputDir, "servicenow-change-workflow.json");
    return withExclusiveWorkflowLock(stateFile, () => startWorkflow(args));
  }
  if (args.phase === "complete") {
    return withExclusiveWorkflowLock(required(args.state, "option: --state"), () => completeWorkflow(args));
  }
  throw new Error("--phase must be start or complete.");
};

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  run().then((code) => {
    process.exitCode = code;
  }).catch((error) => {
    process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
    process.exitCode = 1;
  });
}
