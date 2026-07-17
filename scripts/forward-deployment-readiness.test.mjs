import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

const dependency = {
  id: "checkout-orders-db",
  appName: "Checkout",
  environment: "prod",
  serviceEntityId: "SERVICE-DEMO-CHECKOUT",
  serviceName: "checkout-api",
  source: "checkout-vip",
  destination: "orders-db",
  protocol: "tcp",
  port: "443",
  owner: "commerce-platform",
  criticality: "critical",
  confidence: 98,
  mappingState: "ready",
};

const runCommand = async (args, env = process.env) =>
  new Promise((resolve, reject) => {
    const child = spawn(process.execPath, args, {
      cwd: root,
      env,
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
      resolve({ code, stdout, stderr });
    });
  });

const runJson = async (args, env) => {
  const result = await runCommand(args, env);
  return {
    ...result,
    json: result.stdout ? JSON.parse(result.stdout) : null,
  };
};

const buildPackage = async () => {
  const outputDir = await mkdtemp(path.join(tmpdir(), "forward-readiness-package-"));
  const dependenciesPath = path.join(outputDir, "dependencies.json");
  await writeFile(dependenciesPath, `${JSON.stringify([dependency], null, 2)}\n`);

  const buildResult = await runJson([
    "--disable-warning=MODULE_TYPELESS_PACKAGE_JSON",
    "--experimental-strip-types",
    "scripts/build-forward-package.mjs",
    "--dependencies",
    dependenciesPath,
    "--output-dir",
    outputDir,
    "--source-instance-id",
    "dt-readiness-test",
  ]);
  assert.equal(buildResult.code, 0, buildResult.stderr);

  return {
    checks: path.join(outputDir, "forward-intent-checks.json"),
    manifest: path.join(outputDir, "forward-dynatrace-manifest.json"),
    outputDir,
  };
};

test("passes validate-only package readiness without contacting Forward", async () => {
  const pkg = await buildPackage();
  const result = await runJson([
    "scripts/forward-deployment-readiness.mjs",
    "--checks",
    pkg.checks,
    "--manifest",
    pkg.manifest,
  ]);

  assert.equal(result.code, 0, result.stderr);
  assert.equal(result.json.overallStatus, "ready");
  assert.equal(
    result.json.gates.find((gate) => gate.id === "package-validation")?.status,
    "pass",
  );
  assert.equal(
    result.json.gates.find((gate) => gate.id === "forward-dry-run")?.status,
    "skip",
  );
});

test("fails Forward dry-run readiness when runtime credentials are missing", async () => {
  const pkg = await buildPackage();
  const env = {
    ...process.env,
    FORWARD_BASE_URL: "https://forward.example.com",
    FORWARD_NETWORK_ID: "network-1",
    FORWARD_AUTHORIZATION_FILE: "",
  };
  const result = await runJson(
    [
      "scripts/forward-deployment-readiness.mjs",
      "--checks",
      pkg.checks,
      "--manifest",
      pkg.manifest,
      "--dry-run",
    ],
    env,
  );

  assert.equal(result.code, 1);
  assert.equal(result.json.overallStatus, "failed");
  assert.equal(
    result.json.gates.find((gate) => gate.id === "forward-connectivity")?.status,
    "fail",
  );
  assert.match(
    result.json.gates.find((gate) => gate.id === "forward-connectivity")?.summary,
    /FORWARD_AUTHORIZATION_FILE/,
  );
});

test("refuses connector configs with apply enabled", async () => {
  const pkg = await buildPackage();
  const configPath = path.join(pkg.outputDir, "forward-connector.config.json");
  await writeFile(
    configPath,
    `${JSON.stringify(
      {
        schemaVersion: "forward-dynatrace-connector/v1",
        checks: pkg.checks,
        manifest: pkg.manifest,
        forwardBaseUrl: "https://forward.example.com",
        forwardNetworkId: "network-1",
        apply: true,
        reportPath: path.join(pkg.outputDir, "forward-import-report.json"),
        metricsPath: path.join(pkg.outputDir, "forward-import-metrics.prom"),
        statusArtifactPath: path.join(pkg.outputDir, "forward-ingest-status.json"),
      },
      null,
      2,
    )}\n`,
  );

  const result = await runJson([
    "scripts/forward-deployment-readiness.mjs",
    "--config",
    configPath,
    "--dry-run",
  ]);

  assert.equal(result.code, 1);
  assert.equal(result.json.overallStatus, "failed");
  assert.equal(
    result.json.gates.find((gate) => gate.id === "connector-mutation-policy")?.status,
    "fail",
  );
  assert.equal(
    result.json.gates.find((gate) => gate.id === "forward-dry-run")?.status,
    "skip",
  );
});

test("writes readiness report when output path is supplied", async () => {
  const pkg = await buildPackage();
  const output = path.join(pkg.outputDir, "readiness.json");
  const result = await runJson([
    "scripts/forward-deployment-readiness.mjs",
    "--checks",
    pkg.checks,
    "--manifest",
    pkg.manifest,
    "--output",
    output,
  ]);

  assert.equal(result.code, 0, result.stderr);
  const written = JSON.parse(await readFile(output, "utf8"));
  assert.equal(written.schemaVersion, "forward-dynatrace-deployment-readiness/v1");
  assert.equal(written.overallStatus, "ready");
});
