import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const runSchemaValidate = async (args = []) => new Promise((resolve, reject) => {
  const child = spawn(process.execPath, ["scripts/schema-validate.mjs", ...args], {
    cwd: root,
    stdio: ["ignore", "pipe", "pipe"],
  });
  let stdout = "";
  let stderr = "";
  child.stdout.on("data", (chunk) => { stdout += chunk; });
  child.stderr.on("data", (chunk) => { stderr += chunk; });
  child.on("error", reject);
  child.on("close", (code) => {
    if (code !== 0) {
      reject(new Error(`${process.execPath} scripts/schema-validate.mjs exited ${code}: ${stderr || stdout}`));
      return;
    }
    resolve(JSON.parse(stdout));
  });
});

test("validates committed examples and a generated direct-API package", async () => {
  const result = await runSchemaValidate();
  assert.equal(result.status, "ok");
  assert.equal(result.validated, 4);
  assert.ok(result.artifacts.some((name) => name.endsWith("forward-dynatrace-manifest.json")));
  assert.ok(result.artifacts.some((name) => name.endsWith("forward-intent-checks.json")));
});

test("validates sanitized network-evidence events", async () => {
  const directory = await mkdtemp(path.join(tmpdir(), "forward-network-evidence-"));
  const eventPath = path.join(directory, "event.json");
  await writeFile(eventPath, `${JSON.stringify({
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
      "forward.dynatrace.count.failed": 0
    }
  }, null, 2)}\n`);
  const result = await runSchemaValidate(["--network-evidence-event", eventPath]);
  assert.deepEqual(result.artifacts, [eventPath]);
});

test("rejects unsupported external runtime schema options", async () => {
  await assert.rejects(
    runSchemaValidate(["--connector-config", "unsupported.json"]),
    /Unsupported option/,
  );
});
