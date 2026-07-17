import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";

import { buildImportPlan } from "./forward-import-plan.mjs";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

const runSchemaValidate = async (args = []) =>
  new Promise((resolve, reject) => {
    const child = spawn(process.execPath, ["scripts/schema-validate.mjs", ...args], {
      cwd: root,
      stdio: ["ignore", "pipe", "pipe"],
    });
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (chunk) => {
      stdout += chunk;
    });
    child.stderr.on("data", (chunk) => {
      stderr += chunk;
    });
    child.on("error", reject);
    child.on("close", (code) => {
      if (code !== 0) {
        reject(new Error(`${process.execPath} scripts/schema-validate.mjs exited ${code}: ${stderr || stdout}`));
        return;
      }
      resolve(JSON.parse(stdout));
    });
  });

test("validates committed examples and generated demo package", async () => {
  const result = await runSchemaValidate();
  assert.equal(result.status, "ok");
  assert.ok(result.validated >= 10);
  assert.ok(result.artifacts.includes("shared/demo-forward-ingest-status.json"));
});

test("rejects connector configs that contain secret-shaped keys", async () => {
  const tempDir = await mkdtemp(path.join(tmpdir(), "forward-dynatrace-bad-schema-"));
  const configPath = path.join(tempDir, "bad-config.json");
  await writeFile(
    configPath,
    `${JSON.stringify(
      {
        schemaVersion: "forward-dynatrace-connector/v1",
        forwardPassword: "do-not-store",
      },
      null,
      2,
    )}\n`,
  );

  await assert.rejects(
    runSchemaValidate(["--connector-config", configPath]),
    /failed schema validation/,
  );
});

test("validates the sole v1 immutable import-plan contract", async () => {
  const tempDir = await mkdtemp(path.join(tmpdir(), "forward-import-plan-schema-"));
  const planPath = path.join(tempDir, "plan.json");
  const sourceKey = `source-key:sha256:${"a".repeat(64)}`;
  const plan = buildImportPlan({
    createdAt: "2026-07-17T12:00:00.000Z",
    manifest: {
      packageId: "package-1",
      integrity: { intentChecksSha256: "b".repeat(64) },
      source: { instanceTag: "source-instance:dt-schema-validation" },
    },
    manifestText: "{}\n",
    packageSignatureStatus: "verified",
    networkId: "network-1",
    snapshotId: "snapshot-1",
    reconciliation: {
      create: [{ key: sourceKey, fingerprint: "c".repeat(64) }],
      unchanged: [],
      changed: [],
      stale: [],
      collision: [],
    },
    policy: {
      applyUpdates: false,
      deactivateStale: false,
      maxUpdates: 0,
      maxDeactivations: 0,
    },
  });
  await writeFile(planPath, `${JSON.stringify(plan, null, 2)}\n`);

  const result = await runSchemaValidate(["--import-plan", planPath]);
  assert.deepEqual(result.artifacts, [planPath]);
});

test("validates sanitized problem network-evidence events", async () => {
  const tempDir = await mkdtemp(path.join(tmpdir(), "forward-network-evidence-schema-"));
  const eventPath = path.join(tempDir, "event.json");
  await writeFile(
    eventPath,
    `${JSON.stringify(
      {
        schemaVersion: "forward-dynatrace-network-evidence-event/v1",
        timestamp: "2026-01-01T00:00:00.000Z",
        eventType: "forward.dynatrace.network.evidence",
        severity: "WARN",
        title: "Modeled network evidence for problem P-1",
        properties: {
          "forward.dynatrace.evidence_run_id": "run-1",
          "forward.dynatrace.problem_id": "P-1",
          "forward.dynatrace.network_assessment": "inconclusive",
          "forward.dynatrace.count.total": 1,
          "forward.dynatrace.count.queryable": 0,
          "forward.dynatrace.count.reachable": 0,
          "forward.dynatrace.count.blocked": 0,
          "forward.dynatrace.count.ambiguous": 0,
          "forward.dynatrace.count.unmapped": 1,
          "forward.dynatrace.count.failed": 0,
        },
      },
      null,
      2,
    )}\n`,
  );

  const result = await runSchemaValidate(["--network-evidence-event", eventPath]);
  assert.equal(result.status, "ok");
  assert.deepEqual(result.artifacts, [eventPath]);
});

test("validates a change event with bounded Guardian execution context", async () => {
  const tempDir = await mkdtemp(path.join(tmpdir(), "forward-guardian-context-schema-"));
  const eventPath = path.join(tempDir, "event.json");
  const executionContext = {
    schemaVersion: "forward-dynatrace-guardian-context/v1",
    correlationId: "correlation-1",
    gateRunId: "gate-run-1",
    changeId: "CHG-1",
    deploymentId: "DEPLOY-1",
    observedAt: "2026-01-01T00:00:00Z",
    evidenceWindow: {
      from: "2025-12-31T23:45:00Z",
      to: "2026-01-01T00:00:00Z",
    },
    scope: {
      mappingId: "scope-1",
      applicationId: "application-1",
      environmentId: "environment-1",
      serviceEntityIds: ["SERVICE-1"],
      owner: "team-1",
      criticality: "high",
    },
    network: {
      networkId: "network-1",
      beforeSnapshotId: "before",
      afterSnapshotId: "after",
    },
    dependencies: [{ protocol: "TCP", ports: [443] }],
    mapping: {
      state: "resolved",
      confidence: "high",
      sourceRecordCount: 1,
      mappingSha256: "c".repeat(64),
    },
    provenance: { evidenceSource: "validation-source", synthetic: false },
  };
  await writeFile(eventPath, `${JSON.stringify({
    schemaVersion: "forward-dynatrace-change-validation-event/v1",
    timestamp: "2026-01-01T00:00:00Z",
    eventType: "forward.dynatrace.change.validation",
    severity: "INFO",
    title: "Forward change gate pass: CHG-1",
    properties: {
      "forward.dynatrace.gate_run_id": "gate-run-1",
      "forward.dynatrace.change_id": "CHG-1",
      "forward.dynatrace.deployment_id": "DEPLOY-1",
      "forward.dynatrace.gate_decision": "pass",
      "forward.dynatrace.gate_reason_codes": "PASS",
      "forward.dynatrace.gate_sha256": "a".repeat(64),
      "forward.dynatrace.before_snapshot_id": "before",
      "forward.dynatrace.after_snapshot_id": "after",
      "forward.dynatrace.before_reachable": 1,
      "forward.dynatrace.before_blocked": 0,
      "forward.dynatrace.after_reachable": 1,
      "forward.dynatrace.after_blocked": 0,
      "forward.dynatrace.scope_mapping_id": "scope-1",
      "forward.dynatrace.scope_mapping_sha256": "b".repeat(64),
      "forward.dynatrace.scope_environment_id": "environment-1",
      "forward.dynatrace.scope_source_record_count": 1,
      "forward.dynatrace.correlation_id": "correlation-1",
      "forward.dynatrace.correlation_sha256": "b".repeat(64),
      "timeframe.from": "2025-12-31T23:45:00Z",
      "timeframe.to": "2026-01-01T00:00:00Z",
      execution_context: executionContext,
    },
  }, null, 2)}\n`);

  const result = await runSchemaValidate(["--change-validation-event", eventPath]);
  assert.equal(result.status, "ok");
  assert.deepEqual(result.artifacts, [eventPath]);
});
