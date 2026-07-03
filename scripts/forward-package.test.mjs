import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const queryId = "FQ_aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa";

const runJson = async (args) =>
  new Promise((resolve, reject) => {
    const child = spawn(process.execPath, args, {
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
        reject(new Error(`${process.execPath} ${args.join(" ")} exited ${code}: ${stderr || stdout}`));
        return;
      }
      resolve(JSON.parse(stdout));
    });
  });

test("builds optional NQE artifacts and validates the full package", async () => {
  const outputDir = await mkdtemp(path.join(tmpdir(), "forward-dynatrace-nqe-package-"));
  const dependenciesPath = path.join(outputDir, "dependencies.json");
  await writeFile(
    dependenciesPath,
    `${JSON.stringify(
      [
        {
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
        },
        {
          id: "checkout-payment",
          appName: "Checkout",
          environment: "prod",
          serviceEntityId: "SERVICE-DEMO-CHECKOUT",
          serviceName: "checkout-api",
          source: "checkout-vip",
          destination: "payment-gateway",
          protocol: "tcp",
          port: "8443",
          owner: "payments",
          criticality: "critical",
          confidence: 94,
          mappingState: "ready",
        },
        {
          id: "inventory-cache",
          appName: "Inventory",
          environment: "prod",
          serviceEntityId: "SERVICE-DEMO-INVENTORY",
          serviceName: "inventory-api",
          source: "inventory-vip",
          destination: "redis-cache",
          protocol: "tcp",
          port: "6379",
          owner: "supply-chain",
          criticality: "high",
          confidence: 87,
          mappingState: "review",
        },
      ],
      null,
      2,
    )}\n`,
  );

  const buildResult = await runJson([
    "--disable-warning=MODULE_TYPELESS_PACKAGE_JSON",
    "--experimental-strip-types",
    "scripts/build-forward-package.mjs",
    "--dependencies",
    dependenciesPath,
    "--output-dir",
    outputDir,
    "--nqe-query-id",
    queryId,
    "--nqe-diff-query-id",
    queryId,
    "--nqe-diff-before-snapshot-id",
    "snapshot-before",
    "--nqe-diff-after-snapshot-id",
    "snapshot-after",
  ]);

  assert.equal(buildResult.intentChecks, 3);
  assert.equal(buildResult.nqeChecks, 2);
  assert.equal(buildResult.nqeDiffRequests, 2);

  const manifest = JSON.parse(
    await readFile(path.join(outputDir, "forward-dynatrace-manifest.json"), "utf8"),
  );
  assert.equal(manifest.artifacts.nqeChecks, "forward-nqe-checks.json");
  assert.equal(manifest.artifacts.nqeDiffRequests, "forward-nqe-diff-requests.json");
  assert.equal(manifest.nqeChecks.queryIdPolicy, "forward-owned-allowlist");
  assert.equal(manifest.nqeDiffRequests.executionPolicy, "read-only-forward-side-optional");

  const importResult = await runJson([
    "scripts/forward-import-package.mjs",
    "--checks",
    path.join(outputDir, "forward-intent-checks.json"),
    "--manifest",
    path.join(outputDir, "forward-dynatrace-manifest.json"),
    "--nqe-checks",
    path.join(outputDir, "forward-nqe-checks.json"),
    "--nqe-diff-requests",
    path.join(outputDir, "forward-nqe-diff-requests.json"),
    "--nqe-query-id-allowlist",
    queryId,
    "--validate-only",
  ]);

  assert.equal(importResult.status, "valid");
  assert.equal(importResult.plannedChecks, 3);
  assert.equal(importResult.plannedNqeChecks, 2);
  assert.equal(importResult.plannedNqeDiffRequests, 2);
});

test("keeps generated check names unique for duplicate service edges", async () => {
  const outputDir = await mkdtemp(path.join(tmpdir(), "forward-dynatrace-duplicate-edge-"));
  const dependenciesPath = path.join(outputDir, "dependencies.json");
  const duplicateEdgeDependencies = [
    {
      id: "frontend-web-frontend-proxy-service-a",
      appName: "Dynatrace Demo",
      environment: "demo",
      serviceEntityId: "SERVICE-00677FCCD8F24235",
      serviceName: "frontend-web",
      source: "frontend-web",
      destination: "frontend-proxy",
      protocol: "tcp",
      port: "443",
      owner: "dynatrace-demo",
      criticality: "medium",
      confidence: 80,
      mappingState: "review",
    },
    {
      id: "frontend-web-frontend-proxy-service-b",
      appName: "Dynatrace Demo",
      environment: "demo",
      serviceEntityId: "SERVICE-95D96EDE93AA13DB",
      serviceName: "frontend-web",
      source: "frontend-web",
      destination: "frontend-proxy",
      protocol: "tcp",
      port: "443",
      owner: "dynatrace-demo",
      criticality: "medium",
      confidence: 80,
      mappingState: "review",
    },
  ];
  await writeFile(dependenciesPath, `${JSON.stringify(duplicateEdgeDependencies, null, 2)}\n`);

  const buildResult = await runJson([
    "--disable-warning=MODULE_TYPELESS_PACKAGE_JSON",
    "--experimental-strip-types",
    "scripts/build-forward-package.mjs",
    "--dependencies",
    dependenciesPath,
    "--output-dir",
    outputDir,
  ]);

  assert.equal(buildResult.intentChecks, 2);
  const checks = JSON.parse(
    await readFile(path.join(outputDir, "forward-intent-checks.json"), "utf8"),
  );
  assert.equal(new Set(checks.map((check) => check.name)).size, 2);
  assert.ok(checks.every((check) => /\[[a-z0-9-]+\]$/.test(check.name)));

  const importResult = await runJson([
    "scripts/forward-import-package.mjs",
    "--checks",
    path.join(outputDir, "forward-intent-checks.json"),
    "--manifest",
    path.join(outputDir, "forward-dynatrace-manifest.json"),
    "--validate-only",
  ]);
  assert.equal(importResult.status, "valid");
  assert.equal(importResult.plannedChecks, 2);
});
