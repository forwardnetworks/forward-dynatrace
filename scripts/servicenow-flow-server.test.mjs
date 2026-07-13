import assert from "node:assert/strict";
import { createServer } from "node:http";
import { mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { test } from "node:test";

import {
  createFlowService,
  createRequestHandler,
  isAuthorized,
  runIdForRequest,
  validateCompleteRequest,
  validateStartRequest,
} from "./servicenow-flow-server.mjs";

const startRequest = {
  changeNumber: "CHG0042187",
  deploymentId: "deployment-1",
  forwardNetworkId: "network-1",
  serviceEntityIds: ["SERVICE-2", "SERVICE-1"],
  dependencies: [
    { id: "dependency-1", serviceEntityId: "SERVICE-1" },
    { id: "dependency-2", serviceEntityId: "SERVICE-2" },
  ],
};

const context = {
  schemaVersion: "forward-dynatrace-change-context/v1",
  changeId: "CHG0042187",
  deploymentId: "deployment-1",
  observedAt: "2026-07-15T19:00:00.000Z",
  serviceEntityIds: ["SERVICE-1", "SERVICE-2"],
  dynatrace: {
    deploymentState: "SUCCEEDED",
    serviceHealth: "HEALTHY",
    openProblemCount: 0,
  },
};

const valueAfter = (values, target) => values[values.indexOf(target) + 1];

const waitForStatus = async (service, runId, expected) => {
  for (let attempt = 0; attempt < 100; attempt += 1) {
    const result = await service.status(runId);
    if (result.run.status === expected) return result;
    await new Promise((resolve) => setTimeout(resolve, 2));
  }
  throw new Error(`run ${runId} did not reach ${expected}`);
};

test("validates bounded start and completion contracts", () => {
  const normalized = validateStartRequest(startRequest);
  assert.deepEqual(normalized.serviceEntityIds, ["SERVICE-1", "SERVICE-2"]);
  assert.equal(runIdForRequest(normalized), runIdForRequest(validateStartRequest({
    ...startRequest,
    serviceEntityIds: [...startRequest.serviceEntityIds].reverse(),
  })));
  assert.throws(
    () => validateStartRequest({ ...startRequest, extra: true }),
    /unsupported fields: extra/,
  );
  const run = {
    change: {
      number: "CHG0042187",
      deploymentId: "deployment-1",
      serviceEntityIds: ["SERVICE-1", "SERVICE-2"],
    },
  };
  assert.deepEqual(validateCompleteRequest({ context }, run).context, context);
  assert.throws(
    () => validateCompleteRequest({ context: { ...context, deploymentId: "other" } }, run),
    /identity does not match/,
  );
});

test("runs an idempotent asynchronous start and complete lifecycle without exposing paths", async () => {
  const runDir = await mkdtemp(path.join(tmpdir(), "servicenow-flow-service-"));
  const calls = [];
  const workflowRunner = async ({ argv }) => {
    calls.push(argv);
    const phase = valueAfter(argv, "--phase");
    if (phase === "start") {
      const outputDir = valueAfter(argv, "--output-dir");
      await writeFile(path.join(outputDir, "servicenow-change-workflow.json"), JSON.stringify({
        schemaVersion: "forward-dynatrace-servicenow-change-workflow/v1",
        status: "baseline-captured",
        change: {
          number: "CHG0042187",
          deploymentId: "deployment-1",
          serviceEntityIds: ["SERVICE-1", "SERVICE-2"],
        },
        forward: {
          networkId: "network-1",
          beforeSnapshotId: "snapshot-before",
          afterSnapshotId: null,
        },
        decision: null,
      }));
      return { code: 0, stdout: "", stderr: "" };
    }
    const statePath = valueAfter(argv, "--state");
    const state = JSON.parse(await readFile(statePath, "utf8"));
    await writeFile(statePath, JSON.stringify({
      ...state,
      status: "completed",
      forward: { ...state.forward, afterSnapshotId: "snapshot-after" },
      decision: "pass",
    }));
    return { code: 0, stdout: "", stderr: "" };
  };
  let tick = 0;
  const service = createFlowService({
    runDir,
    workflowRunner,
    now: () => `2026-07-15T19:00:${String(tick++).padStart(2, "0")}.000Z`,
  });

  const started = await service.start(startRequest);
  assert.equal(started.statusCode, 202);
  assert.match(started.run.runId, /^fdca-[a-f0-9]{24}$/);
  const baseline = await waitForStatus(service, started.run.runId, "baseline-captured");
  assert.equal(baseline.run.forward.beforeSnapshotId, "snapshot-before");
  assert.equal(JSON.stringify(baseline.run).includes(runDir), false);

  const replay = await service.start(startRequest);
  assert.equal(replay.statusCode, 200);
  await assert.rejects(
    service.start({
      ...startRequest,
      dependencies: [...startRequest.dependencies, { id: "changed", serviceEntityId: "SERVICE-1" }],
    }),
    /different start input/,
  );

  const completing = await service.complete(started.run.runId, { context });
  assert.equal(completing.statusCode, 202);
  const completed = await waitForStatus(service, started.run.runId, "completed");
  assert.equal(completed.run.decision, "pass");
  assert.equal(completed.run.forward.afterSnapshotId, "snapshot-after");
  assert.equal(calls.length, 2);
  assert.equal(valueAfter(calls[1], "--phase"), "complete");

  const completeReplay = await service.complete(started.run.runId, { context });
  assert.equal(completeReplay.statusCode, 200);
  await assert.rejects(
    service.complete(started.run.runId, {
      context: { ...context, observedAt: "2026-07-15T19:01:00.000Z" },
    }),
    /differs from the context already bound/,
  );
});

test("requires Basic authentication and bounds HTTP request bodies", async (t) => {
  assert.equal(isAuthorized(`Basic ${Buffer.from("flow-user:flow-password").toString("base64")}`, "flow-user", "flow-password"), true);
  assert.equal(isAuthorized("Bearer token", "flow-user", "flow-password"), false);

  const fakeRun = {
    schemaVersion: "forward-dynatrace-servicenow-flow-run/v1",
    runId: "fdca-" + "a".repeat(24),
    status: "start-queued",
  };
  const service = {
    start: async () => ({ statusCode: 202, run: fakeRun }),
    status: async () => ({ statusCode: 200, run: fakeRun }),
    complete: async () => ({ statusCode: 202, run: fakeRun }),
  };
  const server = createServer(createRequestHandler({
    service,
    username: "flow-user",
    password: "flow-password",
    maxBodyBytes: 100,
  }));
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  t.after(() => server.close());
  const baseUrl = `http://127.0.0.1:${server.address().port}`;

  const unauthorized = await fetch(`${baseUrl}/v1/servicenow/change-assurance/start`, {
    method: "POST",
    body: "{}",
  });
  assert.equal(unauthorized.status, 401);

  const authorization = `Basic ${Buffer.from("flow-user:flow-password").toString("base64")}`;
  const accepted = await fetch(`${baseUrl}/v1/servicenow/change-assurance/start`, {
    method: "POST",
    headers: { Authorization: authorization, "Content-Type": "application/json" },
    body: "{}",
  });
  assert.equal(accepted.status, 202);
  assert.equal((await accepted.json()).runId, fakeRun.runId);

  const oversized = await fetch(`${baseUrl}/v1/servicenow/change-assurance/start`, {
    method: "POST",
    headers: { Authorization: authorization, "Content-Type": "application/json" },
    body: JSON.stringify({ data: "x".repeat(200) }),
  });
  assert.equal(oversized.status, 413);
});

test("retries an investigated failed Start phase without changing run identity", async () => {
  const runDir = await mkdtemp(path.join(tmpdir(), "servicenow-flow-retry-"));
  let attempts = 0;
  const workflowRunner = async ({ argv }) => {
    attempts += 1;
    if (attempts === 1) throw new Error("temporary Bearer do-not-leak");
    const outputDir = valueAfter(argv, "--output-dir");
    await writeFile(path.join(outputDir, "servicenow-change-workflow.json"), JSON.stringify({
      schemaVersion: "forward-dynatrace-servicenow-change-workflow/v1",
      status: "baseline-captured",
      change: {
        number: "CHG0042187",
        deploymentId: "deployment-1",
        serviceEntityIds: ["SERVICE-1", "SERVICE-2"],
      },
      forward: {
        networkId: "network-1",
        beforeSnapshotId: "snapshot-before",
        afterSnapshotId: null,
      },
      decision: null,
    }));
    return { code: 0, stdout: "", stderr: "" };
  };
  const service = createFlowService({ runDir, workflowRunner });
  const started = await service.start(startRequest);
  const failed = await waitForStatus(service, started.run.runId, "failed");
  assert.equal(failed.run.error.includes("do-not-leak"), false);
  assert.match(failed.run.error, /redacted-authorization/);

  const retried = await service.start({ ...startRequest, retry: true });
  assert.equal(retried.statusCode, 202);
  assert.equal(retried.run.runId, started.run.runId);
  const baseline = await waitForStatus(service, started.run.runId, "baseline-captured");
  assert.equal(baseline.run.forward.beforeSnapshotId, "snapshot-before");
  assert.equal(attempts, 2);
});

test("rejects excess work without poisoning a later valid start", async () => {
  const runDir = await mkdtemp(path.join(tmpdir(), "servicenow-flow-capacity-"));
  let releaseFirst;
  const firstMayFinish = new Promise((resolve) => { releaseFirst = resolve; });
  const workflowRunner = async ({ argv }) => {
    const deploymentId = valueAfter(argv, "--deployment-id");
    if (deploymentId === "deployment-1") await firstMayFinish;
    const outputDir = valueAfter(argv, "--output-dir");
    await writeFile(path.join(outputDir, "servicenow-change-workflow.json"), JSON.stringify({
      schemaVersion: "forward-dynatrace-servicenow-change-workflow/v1",
      status: "baseline-captured",
      change: {
        number: "CHG0042187",
        deploymentId,
        serviceEntityIds: ["SERVICE-1", "SERVICE-2"],
      },
      forward: {
        networkId: "network-1",
        beforeSnapshotId: `snapshot-${deploymentId}`,
        afterSnapshotId: null,
      },
      decision: null,
    }));
    return { code: 0, stdout: "", stderr: "" };
  };
  const service = createFlowService({
    runDir,
    workflowRunner,
    env: { SERVICENOW_FLOW_MAX_ACTIVE_RUNS: "1" },
  });
  const first = await service.start(startRequest);
  const secondRequest = { ...startRequest, deploymentId: "deployment-2" };
  await assert.rejects(service.start(secondRequest), /active-run limit/);

  releaseFirst();
  await waitForStatus(service, first.run.runId, "baseline-captured");
  const second = await service.start(secondRequest);
  assert.equal(second.statusCode, 202);
  const secondBaseline = await waitForStatus(service, second.run.runId, "baseline-captured");
  assert.equal(secondBaseline.run.forward.beforeSnapshotId, "snapshot-deployment-2");
});

test("marks an orphaned phase failed after restart and permits an authoritative retry", async () => {
  const runDir = await mkdtemp(path.join(tmpdir(), "servicenow-flow-stale-"));
  const neverFinishes = new Promise(() => {});
  const firstService = createFlowService({
    runDir,
    workflowRunner: async () => neverFinishes,
    now: () => "2020-01-01T00:00:00.000Z",
    env: { SERVICENOW_FLOW_STALE_RUN_MS: "60000" },
  });
  const first = await firstService.start(startRequest);
  await waitForStatus(firstService, first.run.runId, "start-running");

  const recoveredService = createFlowService({
    runDir,
    workflowRunner: async ({ argv }) => {
      const outputDir = valueAfter(argv, "--output-dir");
      await writeFile(path.join(outputDir, "servicenow-change-workflow.json"), JSON.stringify({
        schemaVersion: "forward-dynatrace-servicenow-change-workflow/v1",
        status: "baseline-captured",
        change: {
          number: "CHG0042187",
          deploymentId: "deployment-1",
          serviceEntityIds: ["SERVICE-1", "SERVICE-2"],
        },
        forward: {
          networkId: "network-1",
          beforeSnapshotId: "snapshot-after-restart",
          afterSnapshotId: null,
        },
        decision: null,
      }));
      return { code: 0, stdout: "", stderr: "" };
    },
    env: { SERVICENOW_FLOW_STALE_RUN_MS: "60000" },
  });
  const stale = await recoveredService.status(first.run.runId);
  assert.equal(stale.run.status, "failed");
  assert.match(stale.run.error, /worker restarted/);

  const retried = await recoveredService.start({ ...startRequest, retry: true });
  assert.equal(retried.statusCode, 202);
  const baseline = await waitForStatus(recoveredService, retried.run.runId, "baseline-captured");
  assert.equal(baseline.run.forward.beforeSnapshotId, "snapshot-after-restart");
});
