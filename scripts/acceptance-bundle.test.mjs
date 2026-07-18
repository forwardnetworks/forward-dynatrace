import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { mkdtemp, readFile, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const queryId = "FQ_aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa";

const runBundle = async (outputDir, dependenciesPath) =>
  new Promise((resolve, reject) => {
    const child = spawn(
      process.execPath,
      [
        "scripts/acceptance-bundle.mjs",
        "--dependencies",
        dependenciesPath,
        "--output-dir",
        outputDir,
        "--source-instance-id",
        "dt-acceptance-test",
        "--sync-mode",
        "data-connector",
        "--nqe-query-id",
        queryId,
        "--nqe-diff-query-id",
        queryId,
        "--nqe-diff-before-snapshot-id",
        "snapshot-before",
        "--nqe-diff-after-snapshot-id",
        "snapshot-after",
      ],
      {
        cwd: root,
        stdio: ["ignore", "pipe", "pipe"],
      },
    );
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
        reject(new Error(`${process.execPath} scripts/acceptance-bundle.mjs exited ${code}: ${stderr || stdout}`));
        return;
      }
      resolve(JSON.parse(stdout));
    });
  });

test("creates an acceptance evidence bundle without contacting Forward", async () => {
  const outputDir = await mkdtemp(path.join(tmpdir(), "forward-dynatrace-acceptance-"));
  const dependenciesPath = path.join(outputDir, "unit-dependencies.json");
  await writeFile(dependenciesPath, `${JSON.stringify([
    {
      id: "unit-dependency-1",
      appName: "Unit Application",
      environment: "test",
      serviceEntityId: "SERVICE-UNIT-1",
      serviceName: "unit-service",
      sourceLabel: "unit-client",
      source: "192.0.2.10/32",
      destinationLabel: "unit-service",
      destination: "198.51.100.20/32",
      protocol: "tcp",
      port: 443,
      owner: "unit-owner",
      criticality: "medium",
      confidence: 100,
      mappingState: "ready",
    },
  ], null, 2)}\n`);
  const summary = await runBundle(outputDir, dependenciesPath);

  assert.equal(summary.schemaVersion, "forward-dynatrace-acceptance-bundle/v1");
  assert.equal(summary.package.intentChecks, 1);
  assert.equal(summary.package.nqeChecks, 1);
  assert.equal(summary.package.nqeDiffRequests, 1);
  assert.equal(summary.import.status, "valid");
  assert.equal(summary.writePolicy, "validate-only-no-forward-contact");

  for (const requiredFile of [
    "ACCEPTANCE.md",
    "acceptance-summary.json",
    "redacted-environment.json",
    "forward-import-report.json",
    "forward-ingest-status.json",
    "package/forward-dynatrace-manifest.json",
    "package/forward-intent-checks.json",
    "package/forward-eligibility-report.json",
    "dynatrace-status/forward-ingest-status-event.json",
  ]) {
    assert.ok((await stat(path.join(outputDir, requiredFile))).isFile());
  }

  const acceptance = await readFile(path.join(outputDir, "ACCEPTANCE.md"), "utf8");
  assert.match(acceptance, /does not contact Forward/);
});
