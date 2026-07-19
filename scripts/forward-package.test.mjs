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
          serviceEntityId: "SERVICE-EXAMPLE-CHECKOUT",
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
          serviceEntityId: "SERVICE-EXAMPLE-CHECKOUT",
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
          serviceEntityId: "SERVICE-EXAMPLE-INVENTORY",
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
    "--source-instance-id",
    "dt-test-environment",
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

  assert.equal(buildResult.intentChecks, 2);
  assert.equal(buildResult.nqeChecks, 1);
  assert.equal(buildResult.nqeDiffRequests, 1);

  const manifest = JSON.parse(
    await readFile(path.join(outputDir, "forward-dynatrace-manifest.json"), "utf8"),
  );
  assert.equal(manifest.artifacts.nqeChecks, "forward-nqe-checks.json");
  assert.equal(manifest.artifacts.nqeDiffRequests, "forward-nqe-diff-requests.json");
  assert.equal(manifest.nqeChecks.queryIdPolicy, "forward-owned-allowlist");
  assert.equal(manifest.nqeDiffRequests.executionPolicy, "read-only-app-backend-optional");
  assert.equal(manifest.requestedIngestPath, "direct-api");
});

test("keeps generated check names unique for duplicate service edges", async () => {
  const outputDir = await mkdtemp(path.join(tmpdir(), "forward-dynatrace-duplicate-edge-"));
  const dependenciesPath = path.join(outputDir, "dependencies.json");
  const duplicateEdgeDependencies = [
    {
      id: "frontend-web-frontend-proxy-service-a",
      appName: "Example Application",
      environment: "nonprod",
      serviceEntityId: "SERVICE-00677FCCD8F24235",
      serviceName: "frontend-web",
      source: "frontend-web",
      destination: "frontend-proxy",
      protocol: "tcp",
      port: "443",
      owner: "application-platform",
      criticality: "medium",
      confidence: 80,
      mappingState: "ready",
    },
    {
      id: "frontend-web-frontend-proxy-service-b",
      appName: "Example Application",
      environment: "nonprod",
      serviceEntityId: "SERVICE-95D96EDE93AA13DB",
      serviceName: "frontend-web",
      source: "frontend-web",
      destination: "frontend-proxy",
      protocol: "tcp",
      port: "443",
      owner: "application-platform",
      criticality: "medium",
      confidence: 80,
      mappingState: "ready",
    },
  ];
  await writeFile(dependenciesPath, `${JSON.stringify(duplicateEdgeDependencies, null, 2)}\n`);

  const buildResult = await runJson([
    "--disable-warning=MODULE_TYPELESS_PACKAGE_JSON",
    "--experimental-strip-types",
    "scripts/build-forward-package.mjs",
    "--source-instance-id",
    "dt-test-environment",
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

  assert.ok(checks.every((check) => check.tags.includes("managed-by:com.forward.dynatrace")));
});

test("requires explicit override to include review rows in generated checks", async () => {
  const outputDir = await mkdtemp(path.join(tmpdir(), "forward-dynatrace-review-override-"));
  const dependenciesPath = path.join(outputDir, "dependencies.json");
  await writeFile(
    dependenciesPath,
    `${JSON.stringify(
      [
        {
          id: "review-only-row",
          appName: "Inventory",
          environment: "prod",
          serviceEntityId: "SERVICE-EXAMPLE-INVENTORY",
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

  await assert.rejects(
    runJson([
      "--disable-warning=MODULE_TYPELESS_PACKAGE_JSON",
      "--experimental-strip-types",
      "scripts/build-forward-package.mjs",
      "--source-instance-id",
      "dt-test-environment",
      "--dependencies",
      dependenciesPath,
      "--output-dir",
      outputDir,
    ]),
    /No rows are production-ready/,
  );

  const buildResult = await runJson([
    "--disable-warning=MODULE_TYPELESS_PACKAGE_JSON",
    "--experimental-strip-types",
    "scripts/build-forward-package.mjs",
    "--source-instance-id",
    "dt-test-environment",
    "--dependencies",
    dependenciesPath,
    "--output-dir",
    outputDir,
    "--include-review",
  ]);

  assert.equal(buildResult.includeReviewRows, true);
  assert.equal(buildResult.intentChecks, 1);
  const manifest = JSON.parse(
    await readFile(path.join(outputDir, "forward-dynatrace-manifest.json"), "utf8"),
  );
  assert.equal(manifest.dependencyRows.reviewOverrideEnabled, true);
  assert.equal(manifest.dependencyRows.includedReviewRowCount, 1);
});

test("writes dependency eligibility report with blocked-row reasons", async () => {
  const outputDir = await mkdtemp(path.join(tmpdir(), "forward-dynatrace-eligibility-"));
  const dependenciesPath = path.join(outputDir, "dependencies.json");
  const eligibilityPath = path.join(outputDir, "forward-dependency-eligibility.json");
  await writeFile(
    dependenciesPath,
    `${JSON.stringify(
      [
        {
          id: "ready-row",
          appName: "Checkout",
          environment: "prod",
          serviceEntityId: "SERVICE-EXAMPLE-CHECKOUT",
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
          id: "review-row",
          appName: "Inventory",
          environment: "prod",
          serviceEntityId: "SERVICE-EXAMPLE-INVENTORY",
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
        {
          id: "needs-map-row",
          appName: "Payments",
          environment: "prod",
          serviceEntityId: "SERVICE-EXAMPLE-PAYMENTS",
          serviceName: "payments-api",
          source: "payments-vip",
          destination: "unknown-host",
          protocol: "tcp",
          port: "8443",
          owner: "payments",
          criticality: "critical",
          confidence: 75,
          mappingState: "needs-map",
        },
        {
          id: "missing-source-row",
          appName: "Shipping",
          environment: "prod",
          serviceEntityId: "SERVICE-EXAMPLE-SHIPPING",
          serviceName: "shipping-api",
          source: "",
          destination: "shipping-db",
          protocol: "tcp",
          port: "5432",
          owner: "fulfillment",
          criticality: "medium",
          confidence: 60,
          mappingState: "ready",
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
    "--source-instance-id",
    "dt-test-environment",
    "--dependencies",
    dependenciesPath,
    "--output-dir",
    outputDir,
    "--eligibility-report",
    eligibilityPath,
  ]);

  assert.equal(buildResult.intentChecks, 1);
  assert.equal(buildResult.eligibilityReport, eligibilityPath);

  const report = JSON.parse(await readFile(eligibilityPath, "utf8"));
  assert.equal(report.schemaVersion, "forward-dynatrace-dependency-eligibility/v1");
  assert.equal(report.counts.total, 4);
  assert.equal(report.counts.eligible, 1);
  assert.equal(report.counts.blocked, 3);
  assert.equal(report.rows.find((row) => row.id === "ready-row")?.eligible, true);
  assert.match(
    report.rows.find((row) => row.id === "review-row")?.reason,
    /Held for review/,
  );
  assert.match(
    report.rows.find((row) => row.id === "needs-map-row")?.reason,
    /not mapped/,
  );
  assert.match(
    report.rows.find((row) => row.id === "missing-source-row")?.reason,
    /source/,
  );
});
