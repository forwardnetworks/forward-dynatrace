import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { mkdtemp, readFile, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { test } from "node:test";

const run = (args) => new Promise((resolve, reject) => {
  const child = spawn(process.execPath, args, {
    cwd: process.cwd(),
    stdio: ["ignore", "pipe", "pipe"],
  });
  let stdout = "";
  let stderr = "";
  child.stdout.on("data", (chunk) => { stdout += chunk; });
  child.stderr.on("data", (chunk) => { stderr += chunk; });
  child.on("error", reject);
  child.on("close", (code) => {
    if (code !== 0) {
      reject(new Error(`${args.join(" ")} exited ${code}: ${stderr || stdout}`));
      return;
    }
    resolve(stdout);
  });
});

test("builds schema-valid safe and regressed synthetic ServiceNow demo scenarios", async () => {
  const outputDir = await mkdtemp(path.join(tmpdir(), "forward-dynatrace-servicenow-demo-test-"));
  const stdout = await run([
    "scripts/servicenow-demo-rehearsal.mjs",
    "--output-dir",
    outputDir,
  ]);
  const summary = JSON.parse(stdout);
  assert.equal(summary.schemaVersion, "forward-dynatrace-servicenow-demo-rehearsal/v1");
  assert.equal(summary.provenance.synthetic, true);
  assert.equal(summary.externalReads, 0);
  assert.equal(summary.externalWrites, 0);
  assert.deepEqual(summary.scenarios.map((scenario) => scenario.decision), ["pass", "fail"]);

  const safe = summary.scenarios[0];
  const regressed = summary.scenarios[1];
  assert.equal(safe.forward.beforeReachable, 24);
  assert.equal(safe.forward.afterReachable, 24);
  assert.equal(regressed.forward.beforeReachable, 24);
  assert.equal(regressed.forward.afterReachable, 12);
  assert.equal(regressed.forward.afterBlocked, 12);
  for (const code of [
    "FORWARD_BLOCKED_PATHS",
    "FORWARD_PATH_REGRESSION",
    "DYNATRACE_SERVICE_UNHEALTHY",
    "DYNATRACE_OPEN_PROBLEMS",
  ]) {
    assert.equal(regressed.reasonCodes.includes(code), true, code);
  }

  for (const scenario of summary.scenarios) {
    const scenarioDir = path.join(outputDir, scenario.id);
    const eventPath = path.join(scenarioDir, "forward-change-validation-event.json");
    const evidencePath = path.join(scenarioDir, scenario.serviceNow.attachmentFileName);
    const event = JSON.parse(await readFile(eventPath, "utf8"));
    assert.equal(event.properties["forward.dynatrace.synthetic"], true);
    assert.equal(
      event.properties["forward.dynatrace.servicenow_evidence_sha256"],
      scenario.serviceNow.evidenceSha256,
    );
    assert.ok((await stat(evidencePath)).isFile());
    await run([
      "scripts/schema-validate.mjs",
      "--change-validation-gate",
      path.join(scenarioDir, "forward-change-validation-gate.json"),
      "--change-validation-event",
      eventPath,
      "--servicenow-change-assurance-evidence",
      evidencePath,
      "--servicenow-change-feedback",
      path.join(scenarioDir, "servicenow-change-feedback.json"),
    ]);
  }

  const demo = await readFile(path.join(outputDir, "DEMO.md"), "utf8");
  assert.match(demo, /SYNTHETIC DEMO REHEARSAL/);
  assert.match(demo, /24 → 12/);
  assert.match(demo, /ServiceNow evidence SHA-256/);

  const repeatedOutputDir = await mkdtemp(
    path.join(tmpdir(), "forward-dynatrace-servicenow-demo-repeat-"),
  );
  const repeated = JSON.parse(await run([
    "scripts/servicenow-demo-rehearsal.mjs",
    "--output-dir",
    repeatedOutputDir,
  ]));
  assert.deepEqual(
    repeated.scenarios.map((scenario) => ({
      id: scenario.id,
      runId: scenario.runId,
      evidenceSha256: scenario.serviceNow.evidenceSha256,
      idempotencyKey: scenario.serviceNow.idempotencyKey,
    })),
    summary.scenarios.map((scenario) => ({
      id: scenario.id,
      runId: scenario.runId,
      evidenceSha256: scenario.serviceNow.evidenceSha256,
      idempotencyKey: scenario.serviceNow.idempotencyKey,
    })),
  );
});
