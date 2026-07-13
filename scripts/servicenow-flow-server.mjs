#!/usr/bin/env node

import { spawn } from "node:child_process";
import { createHash, randomUUID, timingSafeEqual } from "node:crypto";
import { createServer } from "node:http";
import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const RUN_SCHEMA = "forward-dynatrace-servicenow-flow-run/v1";
const API_PREFIX = "/v1/servicenow/change-assurance";
const DEFAULT_BODY_LIMIT = 512 * 1024;
const DEFAULT_PORT = 8080;
const DEFAULT_STALE_RUN_MS = 30 * 60 * 1000;
const DEFAULT_MAX_ACTIVE_RUNS = 4;
const MAX_SERVICES = 100;
const MAX_DEPENDENCIES = 5000;
const EVIDENCE_SOURCE_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/;

const canonicalJson = (value) => `${JSON.stringify(value, null, 2)}\n`;
const sha256 = (value) => createHash("sha256").update(value).digest("hex");
const truthy = (value) => /^(1|true|yes|on)$/i.test(String(value || ""));

const explicitBooleanEnv = (value, label) => {
  const normalized = String(value ?? "").trim();
  if (normalized === "1") return true;
  if (normalized === "0") return false;
  throw new Error(`${label} must be explicitly set to 0 or 1.`);
};

class HttpError extends Error {
  constructor(statusCode, message) {
    super(message);
    this.statusCode = statusCode;
  }
}

const requiredString = (value, label, maxLength = 255) => {
  const text = typeof value === "string" ? value.trim() : "";
  if (!text) throw new HttpError(400, `${label} must be a non-empty string.`);
  if (text.length > maxLength) throw new HttpError(400, `${label} exceeds ${maxLength} characters.`);
  return text;
};

const stringArray = (value, label, maxItems = MAX_SERVICES) => {
  if (!Array.isArray(value) || value.length === 0 || value.length > maxItems) {
    throw new HttpError(400, `${label} must contain between 1 and ${maxItems} values.`);
  }
  const normalized = value.map((item) => requiredString(item, `${label} item`, 255));
  if (new Set(normalized).size !== normalized.length) {
    throw new HttpError(400, `${label} must contain unique values.`);
  }
  return normalized.sort();
};

const assertKnownKeys = (value, allowed, label) => {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new HttpError(400, `${label} must be a JSON object.`);
  }
  const unknown = Object.keys(value).filter((key) => !allowed.has(key));
  if (unknown.length > 0) throw new HttpError(400, `${label} contains unsupported fields: ${unknown.join(", ")}.`);
};

export const validateStartRequest = (value) => {
  assertKnownKeys(value, new Set([
    "changeNumber",
    "deploymentId",
    "forwardNetworkId",
    "serviceEntityIds",
    "instanceAlias",
    "dependencies",
    "retry",
  ]), "start request");
  const changeNumber = requiredString(value.changeNumber, "changeNumber", 32);
  if (!/^CHG[0-9]+$/.test(changeNumber)) throw new HttpError(400, "changeNumber must use CHG<number> format.");
  const dependencies = value.dependencies;
  if (dependencies !== undefined && (!Array.isArray(dependencies) || dependencies.length === 0 || dependencies.length > MAX_DEPENDENCIES)) {
    throw new HttpError(400, `dependencies must contain between 1 and ${MAX_DEPENDENCIES} rows when supplied.`);
  }
  return {
    changeNumber,
    deploymentId: requiredString(value.deploymentId, "deploymentId"),
    forwardNetworkId: requiredString(value.forwardNetworkId, "forwardNetworkId"),
    serviceEntityIds: stringArray(value.serviceEntityIds, "serviceEntityIds"),
    instanceAlias: value.instanceAlias ? requiredString(value.instanceAlias, "instanceAlias", 128) : null,
    dependencies: dependencies === undefined ? null : dependencies,
    retry: value.retry === true,
  };
};

const sameStringSet = (left, right) =>
  JSON.stringify([...left].sort()) === JSON.stringify([...right].sort());

export const validateCompleteRequest = (value, run) => {
  assertKnownKeys(value, new Set(["context"]), "complete request");
  const context = value.context;
  assertKnownKeys(context, new Set([
    "schemaVersion",
    "changeId",
    "deploymentId",
    "observedAt",
    "serviceEntityIds",
    "dynatrace",
  ]), "context");
  if (context.schemaVersion !== "forward-dynatrace-change-context/v1") {
    throw new HttpError(400, "context schemaVersion is unsupported.");
  }
  if (context.changeId !== run.change.number || context.deploymentId !== run.change.deploymentId) {
    throw new HttpError(409, "context change or deployment identity does not match the run.");
  }
  const serviceEntityIds = stringArray(context.serviceEntityIds, "context.serviceEntityIds");
  if (!sameStringSet(serviceEntityIds, run.change.serviceEntityIds)) {
    throw new HttpError(409, "context affected services do not match the run.");
  }
  if (!context.dynatrace || typeof context.dynatrace !== "object" || Array.isArray(context.dynatrace)) {
    throw new HttpError(400, "context.dynatrace must be an object.");
  }
  assertKnownKeys(context.dynatrace, new Set(["deploymentState", "serviceHealth", "openProblemCount"]), "context.dynatrace");
  if (!new Set(["SUCCEEDED", "FAILED", "IN_PROGRESS", "UNKNOWN"]).has(context.dynatrace.deploymentState)) {
    throw new HttpError(400, "context.dynatrace.deploymentState is unsupported.");
  }
  if (!new Set(["HEALTHY", "DEGRADED", "UNHEALTHY", "UNKNOWN"]).has(context.dynatrace.serviceHealth)) {
    throw new HttpError(400, "context.dynatrace.serviceHealth is unsupported.");
  }
  if (!Number.isInteger(context.dynatrace.openProblemCount) || context.dynatrace.openProblemCount < 0) {
    throw new HttpError(400, "context.dynatrace.openProblemCount must be a non-negative integer.");
  }
  if (Number.isNaN(Date.parse(context.observedAt))) {
    throw new HttpError(400, "context.observedAt must be an ISO date-time.");
  }
  return { context: { ...context, serviceEntityIds } };
};

const runIdentity = (request) => ({
  changeNumber: request.changeNumber,
  deploymentId: request.deploymentId,
  forwardNetworkId: request.forwardNetworkId,
  serviceEntityIds: request.serviceEntityIds,
  provenance: request.provenance || null,
});

export const runIdForRequest = (request) =>
  `fdca-${sha256(canonicalJson(runIdentity(request))).slice(0, 24)}`;

const safeRunId = (value) => {
  const runId = requiredString(value, "runId", 64);
  if (!/^fdca-[a-f0-9]{24}$/.test(runId)) throw new HttpError(400, "runId is invalid.");
  return runId;
};

const redactError = (value) => String(value || "workflow execution failed")
  .replace(/\b(?:Basic|Bearer)\s+\S+/gi, "<redacted-authorization>")
  .replace(/dt0[a-z0-9]{2,}\.[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{20,}/gi, "<redacted-dynatrace-token>")
  .slice(0, 1000);

const constantTimeEqual = (left, right) => {
  const a = Buffer.from(String(left || ""));
  const b = Buffer.from(String(right || ""));
  return a.length === b.length && timingSafeEqual(a, b);
};

export const isAuthorized = (authorization, username, password) => {
  if (!authorization || !authorization.startsWith("Basic ")) return false;
  let decoded = "";
  try {
    decoded = Buffer.from(authorization.slice(6), "base64").toString("utf8");
  } catch {
    return false;
  }
  const separator = decoded.indexOf(":");
  if (separator < 0) return false;
  return constantTimeEqual(decoded.slice(0, separator), username) &&
    constantTimeEqual(decoded.slice(separator + 1), password);
};

const defaultWorkflowRunner = ({ argv, env = process.env, allowedCodes = [0] }) =>
  new Promise((resolve, reject) => {
    const child = spawn(process.execPath, argv, {
      cwd: root,
      env,
      stdio: ["ignore", "pipe", "pipe"],
    });
    let stdout = "";
    let stderr = "";
    const append = (current, chunk) => (current + chunk).slice(-65536);
    child.stdout.on("data", (chunk) => { stdout = append(stdout, chunk); });
    child.stderr.on("data", (chunk) => { stderr = append(stderr, chunk); });
    child.on("error", reject);
    child.on("close", (code) => {
      if (!allowedCodes.includes(code)) {
        reject(new Error(`${path.basename(argv[0])} exited ${code}: ${redactError(stderr || stdout)}`));
        return;
      }
      resolve({ code, stdout, stderr });
    });
  });

const atomicWriteJson = async (filePath, value) => {
  const temporary = `${filePath}.${process.pid}.${randomUUID()}.tmp`;
  await writeFile(temporary, canonicalJson(value), { mode: 0o600 });
  await rename(temporary, filePath);
};

const readJson = async (filePath) => JSON.parse(await readFile(filePath, "utf8"));

const publicRun = (run) => ({
  schemaVersion: RUN_SCHEMA,
  runId: run.runId,
  status: run.status,
  phase: run.phase,
  createdAt: run.createdAt,
  updatedAt: run.updatedAt,
  change: run.change,
  forward: run.forward,
  decision: run.decision,
  exitCode: run.exitCode,
  error: run.error,
});

export const createFlowService = ({
  runDir,
  env = process.env,
  workflowRunner = defaultWorkflowRunner,
  now = () => new Date().toISOString(),
} = {}) => {
  const baseDir = path.resolve(runDir || env.SERVICENOW_FLOW_RUN_DIR || "/var/lib/forward-dynatrace/servicenow-flow");
  const staleRunMs = Number.parseInt(env.SERVICENOW_FLOW_STALE_RUN_MS || String(DEFAULT_STALE_RUN_MS), 10);
  const maxActiveRuns = Number.parseInt(env.SERVICENOW_FLOW_MAX_ACTIVE_RUNS || String(DEFAULT_MAX_ACTIVE_RUNS), 10);
  if (!Number.isInteger(staleRunMs) || staleRunMs < 60000 || staleRunMs > 24 * 60 * 60 * 1000) {
    throw new Error("SERVICENOW_FLOW_STALE_RUN_MS must be between 60000 and 86400000.");
  }
  if (!Number.isInteger(maxActiveRuns) || maxActiveRuns < 1 || maxActiveRuns > 32) {
    throw new Error("SERVICENOW_FLOW_MAX_ACTIVE_RUNS must be between 1 and 32.");
  }
  const workflowEvidenceSource = String(env.SERVICENOW_FLOW_EVIDENCE_SOURCE || "").trim();
  if (!workflowEvidenceSource) {
    throw new Error("SERVICENOW_FLOW_EVIDENCE_SOURCE is required.");
  }
  if (!EVIDENCE_SOURCE_PATTERN.test(workflowEvidenceSource)) {
    throw new Error("SERVICENOW_FLOW_EVIDENCE_SOURCE must be a publish-safe label.");
  }
  const workflowProvenance = {
    evidenceSource: workflowEvidenceSource,
    synthetic: explicitBooleanEnv(
      env.SERVICENOW_FLOW_SYNTHETIC,
      "SERVICENOW_FLOW_SYNTHETIC",
    ),
  };
  const activeRuns = new Set();
  const initializingRuns = new Set();
  const runDirectory = (runId) => path.join(baseDir, safeRunId(runId));
  const runRecordPath = (runId) => path.join(runDirectory(runId), "flow-run.json");
  const workflowStatePath = (runId) => path.join(runDirectory(runId), "servicenow-change-workflow.json");

  const tryReadRun = async (runId) => {
    try {
      return await readJson(runRecordPath(runId));
    } catch (error) {
      if (error?.code === "ENOENT") return null;
      throw error;
    }
  };

  const waitForRunInitialization = async (runId) => {
    for (let attempt = 0; attempt < 50; attempt += 1) {
      const run = await tryReadRun(runId);
      if (run) return run;
      await new Promise((resolve) => setTimeout(resolve, 10));
    }
    throw new HttpError(409, `Run ${runId} has an incomplete initialization record.`);
  };

  const readRun = async (runId) => {
    const run = await tryReadRun(runId);
    if (!run) throw new HttpError(404, `Unknown assurance run: ${runId}.`);
    return run;
  };

  const writeRun = async (run) => {
    run.updatedAt = now();
    await atomicWriteJson(runRecordPath(run.runId), run);
    return run;
  };

  const failRun = async (runId, phase, error) => {
    const run = await readRun(runId);
    await writeRun({
      ...run,
      status: "failed",
      phase,
      error: redactError(error instanceof Error ? error.message : error),
      exitCode: 1,
    });
  };

  const executeStart = async (runId, request) => {
    activeRuns.add(runId);
    try {
      const directory = runDirectory(runId);
      let dependenciesPath = path.join(directory, "dynatrace-dependencies.json");
      let run = await readRun(runId);
      await writeRun({ ...run, status: "start-running", phase: "start", error: null });
      if (request.dependencies) {
        await atomicWriteJson(dependenciesPath, request.dependencies);
      } else {
        const queryFile = env.DYNATRACE_DEPENDENCY_QUERY_FILE;
        if (!queryFile) {
          throw new Error("Start requires dependencies or DYNATRACE_DEPENDENCY_QUERY_FILE for live Dynatrace collection.");
        }
        await workflowRunner({
          argv: [
            "scripts/query-dynatrace-dependencies.mjs",
            "--query-file", path.resolve(queryFile),
            "--output", path.join(directory, "dynatrace-dependency-records.json"),
            "--dependencies-output", dependenciesPath,
          ],
          env,
          allowedCodes: [0],
        });
      }
      const argv = [
        "scripts/servicenow-change-workflow.mjs",
        "--phase", "start",
        "--change-number", request.changeNumber,
        "--deployment-id", request.deploymentId,
        "--network-id", request.forwardNetworkId,
        ...request.serviceEntityIds.flatMap((serviceId) => ["--service-entity-id", serviceId]),
        "--dependencies", dependenciesPath,
        "--evidence-source", request.provenance.evidenceSource,
        ...(request.provenance.synthetic ? ["--synthetic"] : []),
        "--output-dir", directory,
        ...(request.instanceAlias ? ["--instance-alias", request.instanceAlias] : []),
      ];
      const result = await workflowRunner({ argv, env, allowedCodes: [0, 2] });
      const state = await readJson(workflowStatePath(runId));
      run = await readRun(runId);
      await writeRun({
        ...run,
        status: state.status,
        phase: "start",
        forward: {
          networkId: state.forward?.networkId || request.forwardNetworkId,
          beforeSnapshotId: state.forward?.beforeSnapshotId || null,
          afterSnapshotId: null,
        },
        exitCode: result.code,
        error: null,
      });
    } catch (error) {
      await failRun(runId, "start", error);
    } finally {
      activeRuns.delete(runId);
    }
  };

  const executeComplete = async (runId, context, contextSha256) => {
    activeRuns.add(runId);
    try {
      const directory = runDirectory(runId);
      const contextPath = path.join(directory, "forward-change-context.json");
      await atomicWriteJson(contextPath, context);
      let run = await readRun(runId);
      await writeRun({
        ...run,
        status: "complete-running",
        phase: "complete",
        contextSha256,
        error: null,
      });
      const argv = [
        "scripts/servicenow-change-workflow.mjs",
        "--phase", "complete",
        "--state", workflowStatePath(runId),
        "--context", contextPath,
        ...(truthy(env.SERVICENOW_FLOW_PUBLISH_SERVICENOW) ? ["--publish-servicenow"] : []),
        ...(truthy(env.SERVICENOW_FLOW_VERIFY_RETRY) ? ["--verify-servicenow-retry"] : []),
        ...(truthy(env.SERVICENOW_FLOW_PUBLISH_DYNATRACE) ? ["--publish-dynatrace"] : []),
        ...(env.DYNATRACE_ENVIRONMENT_URL ? ["--dynatrace-environment-url", env.DYNATRACE_ENVIRONMENT_URL] : []),
        ...(env.DYNATRACE_API_BASE_URL ? ["--dynatrace-api-base-url", env.DYNATRACE_API_BASE_URL] : []),
      ];
      const result = await workflowRunner({ argv, env, allowedCodes: [0, 2] });
      const state = await readJson(workflowStatePath(runId));
      run = await readRun(runId);
      await writeRun({
        ...run,
        status: "completed",
        phase: "complete",
        forward: {
          networkId: state.forward?.networkId || run.forward.networkId,
          beforeSnapshotId: state.forward?.beforeSnapshotId || run.forward.beforeSnapshotId,
          afterSnapshotId: state.forward?.afterSnapshotId || null,
        },
        decision: state.decision || null,
        exitCode: result.code,
        error: null,
      });
    } catch (error) {
      await failRun(runId, "complete", error);
    } finally {
      activeRuns.delete(runId);
    }
  };

  const respondToExistingStart = async (existing, request, requestSha256) => {
    const runId = existing.runId;
    if (existing.requestSha256 !== requestSha256) {
      throw new HttpError(409, "A run with the same change identity has different start input.");
    }
    if (activeRuns.has(runId)) {
      return { statusCode: 202, run: publicRun(existing) };
    }
    if (existing.status === "failed" && existing.phase === "start" && request.retry) {
      if (activeRuns.size + initializingRuns.size >= maxActiveRuns) {
        throw new HttpError(503, "The assurance worker is at its active-run limit.");
      }
      void executeStart(runId, request).catch((error) => {
        process.stderr.write(`${redactError(error)}\n`);
      });
      return {
        statusCode: 202,
        run: publicRun({ ...existing, status: "start-queued", error: null, exitCode: null }),
      };
    }
    return { statusCode: 200, run: publicRun(existing) };
  };

  return {
    async start(value) {
      const request = validateStartRequest(value);
      request.provenance = workflowProvenance;
      const runId = runIdForRequest(request);
      const requestForHash = { ...request };
      delete requestForHash.retry;
      const requestSha256 = sha256(canonicalJson(requestForHash));
      await mkdir(baseDir, { recursive: true, mode: 0o700 });
      let existing = await tryReadRun(runId);
      if (!existing && initializingRuns.has(runId)) {
        existing = await waitForRunInitialization(runId);
      }
      if (existing) return respondToExistingStart(existing, request, requestSha256);
      if (activeRuns.size + initializingRuns.size >= maxActiveRuns) {
        throw new HttpError(503, "The assurance worker is at its active-run limit.");
      }
      initializingRuns.add(runId);
      try {
        try {
          await mkdir(runDirectory(runId), { mode: 0o700 });
        } catch (error) {
          if (error?.code !== "EEXIST") throw error;
          existing = await waitForRunInitialization(runId);
          return respondToExistingStart(existing, request, requestSha256);
        }
        const createdAt = now();
        const run = {
          schemaVersion: RUN_SCHEMA,
          runId,
          status: "start-queued",
          phase: "start",
          createdAt,
          updatedAt: createdAt,
          requestSha256,
          contextSha256: null,
          change: {
            number: request.changeNumber,
            deploymentId: request.deploymentId,
            serviceEntityIds: request.serviceEntityIds,
          },
          provenance: {
            ...request.provenance,
          },
          forward: {
            networkId: request.forwardNetworkId,
            beforeSnapshotId: null,
            afterSnapshotId: null,
          },
          decision: null,
          exitCode: null,
          error: null,
        };
        await atomicWriteJson(runRecordPath(runId), run);
        void executeStart(runId, request).catch((error) => {
          process.stderr.write(`${redactError(error)}\n`);
        });
        return { statusCode: 202, run: publicRun(run) };
      } finally {
        initializingRuns.delete(runId);
      }
    },

    async status(runIdValue) {
      const runId = safeRunId(runIdValue);
      let run = await readRun(runId);
      const runningStatus = new Set(["start-queued", "start-running", "complete-queued", "complete-running"])
        .has(run.status);
      const updatedAt = Date.parse(run.updatedAt);
      const stale = Number.isFinite(updatedAt) && Date.now() - updatedAt > staleRunMs;
      if (runningStatus && !activeRuns.has(runId) && stale) {
        run = await writeRun({
          ...run,
          status: "failed",
          error: "The worker restarted while this phase was running; retry from the authoritative phase input.",
          exitCode: 1,
        });
      }
      const stillRunning = new Set(["start-queued", "start-running", "complete-queued", "complete-running"])
        .has(run.status);
      return { statusCode: activeRuns.has(runId) || stillRunning ? 202 : 200, run: publicRun(run) };
    },

    async complete(runIdValue, value) {
      const runId = safeRunId(runIdValue);
      const run = await readRun(runId);
      const { context } = validateCompleteRequest(value, run);
      const contextSha256 = sha256(canonicalJson(context));
      if (run.contextSha256 && run.contextSha256 !== contextSha256) {
        throw new HttpError(409, "Completion context differs from the context already bound to this run.");
      }
      if (run.status === "completed") return { statusCode: 200, run: publicRun(run) };
      if (activeRuns.has(runId) || run.status === "complete-running") {
        return { statusCode: 202, run: publicRun(run) };
      }
      const retryableCompleteFailure = run.status === "failed" && run.phase === "complete";
      if (run.status !== "baseline-captured" && !retryableCompleteFailure) {
        throw new HttpError(409, `Run ${runId} is not ready for completion.`);
      }
      if (activeRuns.size >= maxActiveRuns) throw new HttpError(503, "The assurance worker is at its active-run limit.");
      void executeComplete(runId, context, contextSha256).catch((error) => {
        process.stderr.write(`${redactError(error)}\n`);
      });
      return {
        statusCode: 202,
        run: publicRun({ ...run, status: "complete-queued", phase: "complete", contextSha256 }),
      };
    },
  };
};

const readRequestBody = async (request, maxBytes) => {
  const chunks = [];
  let bytes = 0;
  for await (const chunk of request) {
    bytes += chunk.length;
    if (bytes > maxBytes) throw new HttpError(413, `Request body exceeds ${maxBytes} bytes.`);
    chunks.push(chunk);
  }
  if (bytes === 0) throw new HttpError(400, "JSON request body is required.");
  try {
    return JSON.parse(Buffer.concat(chunks).toString("utf8"));
  } catch {
    throw new HttpError(400, "Request body must be valid JSON.");
  }
};

const sendJson = (response, statusCode, value) => {
  const body = canonicalJson(value);
  response.writeHead(statusCode, {
    "Content-Type": "application/json",
    "Content-Length": Buffer.byteLength(body),
    "Cache-Control": "no-store",
    "X-Content-Type-Options": "nosniff",
  });
  response.end(body);
};

export const createRequestHandler = ({ service, username, password, maxBodyBytes = DEFAULT_BODY_LIMIT }) =>
  async (request, response) => {
    try {
      const url = new URL(request.url, "http://localhost");
      if (request.method === "GET" && url.pathname === "/healthz") {
        sendJson(response, 200, { status: "ok", schemaVersion: RUN_SCHEMA });
        return;
      }
      if (!isAuthorized(request.headers.authorization, username, password)) {
        response.setHeader("WWW-Authenticate", 'Basic realm="forward-dynatrace-servicenow-flow"');
        throw new HttpError(401, "Authentication is required.");
      }
      if (request.method === "POST" && url.pathname === `${API_PREFIX}/start`) {
        const result = await service.start(await readRequestBody(request, maxBodyBytes));
        sendJson(response, result.statusCode, result.run);
        return;
      }
      const match = url.pathname.match(new RegExp(`^${API_PREFIX}/runs/(fdca-[a-f0-9]{24})(/complete)?$`));
      if (match && request.method === "GET" && !match[2]) {
        const result = await service.status(match[1]);
        sendJson(response, result.statusCode, result.run);
        return;
      }
      if (match && request.method === "POST" && match[2] === "/complete") {
        const result = await service.complete(match[1], await readRequestBody(request, maxBodyBytes));
        sendJson(response, result.statusCode, result.run);
        return;
      }
      throw new HttpError(404, "Route not found.");
    } catch (error) {
      sendJson(response, error?.statusCode || 500, {
        status: "error",
        message: redactError(error instanceof Error ? error.message : error),
      });
    }
  };

export const runServer = ({ env = process.env } = {}) => {
  const username = requiredString(env.SERVICENOW_FLOW_USERNAME, "SERVICENOW_FLOW_USERNAME");
  const password = requiredString(env.SERVICENOW_FLOW_PASSWORD, "SERVICENOW_FLOW_PASSWORD", 1024);
  const port = Number.parseInt(env.SERVICENOW_FLOW_PORT || String(DEFAULT_PORT), 10);
  if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error("SERVICENOW_FLOW_PORT is invalid.");
  const host = env.SERVICENOW_FLOW_HOST || "127.0.0.1";
  const service = createFlowService({ env });
  const server = createServer(createRequestHandler({ service, username, password }));
  server.listen(port, host, () => {
    process.stdout.write(canonicalJson({
      status: "listening",
      host,
      port,
      apiPrefix: API_PREFIX,
      runDirectory: path.resolve(env.SERVICENOW_FLOW_RUN_DIR || "/var/lib/forward-dynatrace/servicenow-flow"),
    }));
  });
  return server;
};

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try {
    runServer();
  } catch (error) {
    process.stderr.write(`${redactError(error instanceof Error ? error.message : error)}\n`);
    process.exitCode = 1;
  }
}
