import assert from "node:assert/strict";
import { createServer } from "node:http";
import { mkdtemp, readFile, writeFile } from "node:fs/promises";
import { hostname, tmpdir } from "node:os";
import path from "node:path";
import { test } from "node:test";

import {
  parseArgs,
  run,
  selectScopedDependencies,
  validateDependencyProvenance,
  validateStabilizedContext,
  validateWorkflowProvenance,
  validateWorkflowState,
  waitForNewProcessedSnapshot,
  withExclusiveWorkflowLock,
} from "./servicenow-change-workflow.mjs";

test("parses two-phase workflow and repeated affected services", () => {
  assert.deepEqual(parseArgs([
    "--phase", "start",
    "--service-entity-id", "SERVICE-1",
    "--service-entity-id", "SERVICE-2",
    "--evidence-source", "live-customer-evidence",
    "--synthetic",
    "--publish-servicenow",
  ]), {
    phase: "start",
    "service-entity-id": ["SERVICE-1", "SERVICE-2"],
    "evidence-source": "live-customer-evidence",
    synthetic: true,
    "publish-servicenow": true,
  });
  assert.deepEqual(parseArgs([
    "--phase", "complete",
    "--publish-servicenow",
    "--verify-servicenow-retry",
  ]), {
    phase: "complete",
    "publish-servicenow": true,
    "verify-servicenow-retry": true,
  });
});

test("requires ServiceNow publication for live retry verification", async () => {
  await assert.rejects(
    run(["--phase", "complete", "--verify-servicenow-retry"]),
    /requires --publish-servicenow/,
  );
});

test("start phase captures an authoritative scoped before-snapshot baseline", async (t) => {
  const directory = await mkdtemp(path.join(tmpdir(), "servicenow-workflow-start-"));
  const dependenciesPath = path.join(directory, "dependencies.json");
  await writeFile(dependenciesPath, `${JSON.stringify([{
    id: "checkout-orders",
    appName: "Checkout",
    environment: "prod",
    serviceEntityId: "SERVICE-CHECKOUT",
    serviceName: "checkout-api",
    source: "10.10.10.10",
    destination: "10.20.20.20",
    protocol: "tcp",
    port: "443",
    owner: "commerce",
    criticality: "critical",
    confidence: 98,
    mappingState: "ready",
  }], null, 2)}\n`);
  const server = createServer((request, response) => {
    const url = new URL(request.url, "http://127.0.0.1");
    response.setHeader("Content-Type", "application/json");
    if (request.method === "GET" && url.pathname === "/api/now/table/change_request") {
      response.end(JSON.stringify({ result: [{
        sys_id: { value: "0123456789abcdef0123456789abcdef", display_value: "0123456789abcdef0123456789abcdef" },
        number: { value: "CHG0042187", display_value: "CHG0042187" },
        approval: { value: "approved", display_value: "Approved" },
        state: { value: "-2", display_value: "Scheduled" },
        risk: { value: "3", display_value: "Moderate" },
        start_date: { value: "2026-07-15 18:00:00", display_value: "2026-07-15 18:00:00" },
        end_date: { value: "2026-07-15 20:00:00", display_value: "2026-07-15 20:00:00" },
        assignment_group: { value: "89abcdef0123456789abcdef01234567", display_value: "Commerce" },
      }] }));
      return;
    }
    if (request.method === "GET" && url.pathname === "/api/networks/network-1/snapshots/latestProcessed") {
      response.end(JSON.stringify({ id: "snapshot-before" }));
      return;
    }
    if (request.method === "POST" && url.pathname === "/api/networks/network-1/paths-bulk") {
      response.end(JSON.stringify([{ info: { paths: [{ forwardingOutcome: "DELIVERED", securityOutcome: "PERMITTED" }] } }]));
      return;
    }
    response.statusCode = 404;
    response.end(JSON.stringify({ error: `unexpected ${request.method} ${url.pathname}` }));
  });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  t.after(() => server.close());
  const baseUrl = `http://127.0.0.1:${server.address().port}`;
  const previous = Object.fromEntries([
    "SERVICENOW_BASE_URL", "SERVICENOW_USER", "SERVICENOW_PASSWORD",
    "FORWARD_BASE_URL", "FORWARD_READONLY_AUTHORIZATION",
  ].map((key) => [key, process.env[key]]));
  Object.assign(process.env, {
    SERVICENOW_BASE_URL: baseUrl,
    SERVICENOW_USER: "reader",
    SERVICENOW_PASSWORD: "runtime-only",
    FORWARD_BASE_URL: baseUrl,
    FORWARD_READONLY_AUTHORIZATION: "Bearer readonly",
  });
  const originalWrite = process.stdout.write;
  process.stdout.write = () => true;
  try {
    const code = await run([
      "--phase", "start",
      "--change-number", "CHG0042187",
      "--deployment-id", "deployment-1",
      "--network-id", "network-1",
      "--service-entity-id", "SERVICE-CHECKOUT",
      "--dependencies", dependenciesPath,
      "--evidence-source", "live-customer-evidence",
      "--output-dir", directory,
      "--evaluation-time", "2026-07-15T18:30:00.000Z",
    ]);
    assert.equal(code, 0);
  } finally {
    process.stdout.write = originalWrite;
    for (const [key, value] of Object.entries(previous)) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  }
  const state = JSON.parse(await readFile(path.join(directory, "servicenow-change-workflow.json"), "utf8"));
  const evidence = JSON.parse(await readFile(state.artifacts.beforeEvidence, "utf8"));
  assert.equal(state.status, "baseline-captured");
  assert.deepEqual(state.provenance, { evidenceSource: "live-customer-evidence", synthetic: false });
  assert.equal(state.forward.beforeSnapshotId, "snapshot-before");
  assert.equal(evidence.counts.reachable, 1);
  assert.equal(evidence.mode, "execute");
  assert.equal(state.hashes.beforeEvidenceSha256.length, 64);
});

test("captures only exact affected-service dependencies and fails on missing scope", () => {
  const dependencies = [
    { id: "1", serviceEntityId: "SERVICE-1" },
    { id: "2", serviceEntityId: "SERVICE-2" },
    { id: "3", serviceEntityId: "SERVICE-OTHER" },
  ];
  assert.deepEqual(
    selectScopedDependencies(dependencies, ["SERVICE-2", "SERVICE-1"]).map((item) => item.id),
    ["1", "2"],
  );
  assert.throws(
    () => selectScopedDependencies(dependencies, ["SERVICE-1", "SERVICE-MISSING"]),
    /missing affected services: SERVICE-MISSING/,
  );
});

test("requires explicit synthetic provenance for replay-shaped dependencies", () => {
  const replay = [
    { id: "dynatrace-demo-flow-1", owner: "dynatrace-demo" },
    { id: "seeded-flow-2", "forward.dynatrace.seeded": true },
  ];
  assert.throws(
    () => validateDependencyProvenance(replay, {
      evidenceSource: "live-customer-evidence",
      synthetic: false,
    }),
    /contain replay\/demo evidence/,
  );
  assert.deepEqual(
    validateDependencyProvenance(replay, { evidenceSource: "trial-replay", synthetic: true }),
    { evidenceSource: "trial-replay", synthetic: true },
  );
  assert.throws(
    () => validateWorkflowProvenance({ evidenceSource: "not publish safe", synthetic: true }),
    /publish-safe evidence source/,
  );
});

test("waits through the current snapshot and returns only a new processed snapshot", async () => {
  const snapshots = ["snapshot-before", "snapshot-before", "snapshot-after"];
  const api = async () => ({ id: snapshots.shift() });
  let now = 0;
  const result = await waitForNewProcessedSnapshot({
    api,
    networkId: "network-1",
    beforeSnapshotId: "snapshot-before",
    timeoutMs: 100,
    pollIntervalMs: 10,
    now: () => now,
    sleep: async (ms) => { now += ms; },
  });
  assert.equal(result, "snapshot-after");
  assert.equal(now, 20);
});

test("fails closed when no new processed snapshot appears inside the bound", async () => {
  const api = async () => ({ snapshotId: "snapshot-before" });
  let now = 0;
  await assert.rejects(
    waitForNewProcessedSnapshot({
      api,
      networkId: "network-1",
      beforeSnapshotId: "snapshot-before",
      timeoutMs: 20,
      pollIntervalMs: 10,
      now: () => now,
      sleep: async (ms) => { now += ms; },
    }),
    /No new processed Forward snapshot/,
  );
});

test("rejects Dynatrace context captured before baseline or stabilization", () => {
  const input = {
    beforeEvidenceGeneratedAt: "2026-07-15T18:00:00.000Z",
    stabilizationStartedAt: Date.parse("2026-07-15T18:01:00.000Z"),
    stabilizationSeconds: 120,
  };
  assert.throws(
    () => validateStabilizedContext({
      ...input,
      context: { observedAt: "2026-07-15T18:01:30.000Z" },
    }),
    /must be collected after/,
  );
  assert.equal(validateStabilizedContext({
    ...input,
    context: { observedAt: "2026-07-15T18:03:00.000Z" },
  }).observedAt, "2026-07-15T18:03:00.000Z");
});

test("validates resumable workflow state identity and status", () => {
  const state = {
    schemaVersion: "forward-dynatrace-servicenow-change-workflow/v2",
    status: "baseline-captured",
    provenance: { evidenceSource: "live-customer-evidence", synthetic: false },
  };
  assert.equal(validateWorkflowState(state), state);
  assert.throws(
    () => validateWorkflowState({ ...state, status: "unknown" }),
    /status is invalid/,
  );
  assert.throws(
    () => validateWorkflowState({ ...state, provenance: undefined }),
    /requires a publish-safe evidence source/,
  );
  assert.throws(
    () => validateWorkflowState({ ...state, schemaVersion: "forward-dynatrace-servicenow-change-workflow/v1" }),
    /schemaVersion must be forward-dynatrace-servicenow-change-workflow\/v2/,
  );
});

test("serializes completion for one workflow state and releases the lock", async () => {
  const directory = await mkdtemp(path.join(tmpdir(), "servicenow-workflow-lock-"));
  const stateFile = path.join(directory, "state.json");
  let release;
  let signalReady;
  const ready = new Promise((resolve) => { signalReady = resolve; });
  const held = withExclusiveWorkflowLock(stateFile, () => new Promise((resolve) => {
    release = resolve;
    signalReady();
  }));
  await ready;
  await assert.rejects(
    withExclusiveWorkflowLock(stateFile, async () => null),
    /already holds the workflow lock/,
  );
  release("done");
  assert.equal(await held, "done");
  assert.equal(await withExclusiveWorkflowLock(stateFile, async () => "reused"), "reused");
});

test("recovers a same-host lock whose recorded process no longer exists", async () => {
  const directory = await mkdtemp(path.join(tmpdir(), "servicenow-workflow-stale-lock-"));
  const stateFile = path.join(directory, "state.json");
  await writeFile(`${stateFile}.lock`, JSON.stringify({
    schemaVersion: "forward-dynatrace-workflow-lock/v1",
    hostname: hostname(),
    pid: 2147483647,
    startedAt: "2026-07-15T18:00:00.000Z",
    stateFile,
  }));
  assert.equal(await withExclusiveWorkflowLock(stateFile, async () => "recovered"), "recovered");
});
