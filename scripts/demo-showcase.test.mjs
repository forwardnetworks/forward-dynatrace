import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdtemp, readFile, rm, stat } from "node:fs/promises";
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

test("builds one credential-free two-act presenter bundle", async (t) => {
  const outputDir = await mkdtemp(path.join(tmpdir(), "forward-dynatrace-showcase-test-"));
  t.after(() => rm(outputDir, { recursive: true, force: true }));
  const stdout = await run([
    "--disable-warning=MODULE_TYPELESS_PACKAGE_JSON",
    "--experimental-strip-types",
    "scripts/demo-showcase.mjs",
    "--output-dir",
    outputDir,
  ]);
  const summary = JSON.parse(stdout);

  assert.equal(summary.schemaVersion, "forward-dynatrace-two-act-showcase/v1");
  assert.equal(summary.provenance.synthetic, true);
  assert.equal(summary.externalReads, 0);
  assert.equal(summary.externalWrites, 0);
  assert.equal(summary.acts.intent.packageStatus, "ready");
  assert.equal(summary.acts.intent.rows, 100);
  assert.equal(summary.acts.intent.syntheticRows, 100);
  assert.equal(summary.acts.intent.readyRows, 100);
  assert.equal(summary.acts.intent.intentChecks, 100);
  assert.match(summary.acts.intent.intentChecksSha256, /^[a-f0-9]{64}$/u);
  assert.deepEqual(summary.acts.intent.validation, {
    mode: "validate-only",
    status: "valid",
    plannedChecks: 100,
    mutationCounts: { created: 0, updated: 0, deactivated: 0 },
  });
  assert.deepEqual(
    summary.acts.assurance.scenarios.map((scenario) => scenario.decision),
    ["pass", "fail"],
  );
  assert.equal(summary.acts.assurance.scenarios[1].forward.afterBlocked, 12);

  for (const relativePath of [
    "SHOWCASE.md",
    "showcase-summary.json",
    "intent/forward-dynatrace-manifest.json",
    "intent/forward-intent-checks.json",
    "intent/validate-report.json",
    "assurance/DEMO.md",
  ]) {
    assert.ok((await stat(path.join(outputDir, relativePath))).isFile(), relativePath);
  }

  for (const scenario of summary.acts.assurance.scenarios) {
    const event = JSON.parse(await readFile(
      path.join(outputDir, "assurance", scenario.id, "forward-change-validation-event.json"),
      "utf8",
    ));
    assert.equal(event.properties["forward.dynatrace.synthetic"], true);
    assert.equal(
      event.properties["forward.dynatrace.servicenow_evidence_sha256"],
      scenario.serviceNow.evidenceSha256,
    );
  }

  const dependencies = JSON.parse(await readFile(
    path.join(outputDir, "intent/normalized-dependencies.json"),
    "utf8",
  ));
  assert.equal(dependencies.every((dependency) => dependency.synthetic === true), true);
  const checksText = await readFile(
    path.join(outputDir, "intent/forward-intent-checks.json"),
    "utf8",
  );
  const checks = JSON.parse(checksText);
  assert.equal(
    checks.every((check) => check.tags.includes("provenance:synthetic")),
    true,
  );
  assert.equal(
    createHash("sha256").update(checksText, "utf8").digest("hex"),
    summary.acts.intent.intentChecksSha256,
  );

  const markdown = await readFile(path.join(outputDir, "SHOWCASE.md"), "utf8");
  assert.match(markdown, /SYNTHETIC DEMO SHOWCASE/u);
  assert.match(markdown, /Act 1 — Dynatrace Dependency Evidence Becomes Forward Intent/u);
  assert.match(markdown, /Act 2 — ServiceNow Governs A Cross-Domain Change Decision/u);
  assert.match(markdown, /Generated Forward checks: \*\*100\*\*/u);
  assert.match(markdown, /Explicitly synthetic dependency rows: \*\*100\*\*/u);
  assert.match(markdown, /100\*\* checks planned, \*\*0\*\* mutations/u);
  assert.match(markdown, /24 → 12/u);
  assert.match(markdown, /\[package manifest\]\(intent\/forward-dynatrace-manifest\.json\)/u);
  assert.match(markdown, /\[assurance\/DEMO\.md\]\(assurance\/DEMO\.md\)/u);
  assert.match(markdown, /never as customer acceptance evidence/u);

  const repeated = JSON.parse(await run([
    "--disable-warning=MODULE_TYPELESS_PACKAGE_JSON",
    "--experimental-strip-types",
    "scripts/demo-showcase.mjs",
    "--output-dir",
    outputDir,
  ]));
  assert.equal(repeated.acts.intent.intentChecksSha256, summary.acts.intent.intentChecksSha256);
  assert.deepEqual(
    repeated.acts.assurance.scenarios.map((scenario) => ({
      id: scenario.id,
      runId: scenario.runId,
      evidenceSha256: scenario.serviceNow.evidenceSha256,
    })),
    summary.acts.assurance.scenarios.map((scenario) => ({
      id: scenario.id,
      runId: scenario.runId,
      evidenceSha256: scenario.serviceNow.evidenceSha256,
    })),
  );
});

test("provides bounded CLI help and rejects unsupported options", async () => {
  const help = await run([
    "--disable-warning=MODULE_TYPELESS_PACKAGE_JSON",
    "--experimental-strip-types",
    "scripts/demo-showcase.mjs",
    "--help",
  ]);
  assert.match(help, /two-act demo showcase/u);
  assert.match(help, /--output-dir path/u);
  await assert.rejects(
    run([
      "--disable-warning=MODULE_TYPELESS_PACKAGE_JSON",
      "--experimental-strip-types",
      "scripts/demo-showcase.mjs",
      "--unexpected",
    ]),
    /Unsupported option: --unexpected/u,
  );
});
