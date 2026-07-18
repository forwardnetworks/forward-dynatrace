#!/usr/bin/env node

import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { generateKeyPairSync, sign } from "node:crypto";
import { createServer } from "node:http";
import { mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { packageSigningPayload } from "./forward-import-package.mjs";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const importerPath = path.join(root, "scripts/forward-import-package.mjs");
const dependencyRows = 2500;
const batchSize = 400;
const sourceInstanceId = "dt-load-scale-smoke";

const run = async (args, env = {}) =>
  new Promise((resolve, reject) => {
    const child = spawn(process.execPath, args, {
      cwd: root,
      env: {
        ...process.env,
        ...env,
      },
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
        reject(
          new Error(
            `${process.execPath} ${args.join(" ")} exited ${code}:\n${stderr || stdout}`,
          ),
        );
        return;
      }
      resolve(stdout);
    });
  });

const runJson = async (args, env = {}) => JSON.parse(await run(args, env));

const readJson = async (filePath) => JSON.parse(await readFile(filePath, "utf8"));

const makeRows = (count) =>
  Array.from({ length: count }, (_, index) => {
    const row = {
      "app.name": `payments-${index % 50}`,
      "app.environment": index % 3 === 0 ? "prod" : "stage",
      "dt.entity.service": `SERVICE-SCALE-${String(index + 1).padStart(5, "0")}`,
      "service.name": `scale-service-${index + 1}`,
      "network.source": `scale-src-${index + 1}.example.internal`,
      "network.destination": `scale-dst-${index + 1}.example.internal`,
      "network.protocol": index % 11 === 0 ? "udp" : "tcp",
      "network.port": String(4000 + (index % 500)),
      "owner.team": `team-${index % 17}`,
      criticality: index % 13 === 0 ? "critical" : index % 5 === 0 ? "high" : "medium",
      "dependency.confidence": index % 19 === 0 ? 82 : 96,
    };

    if (index % 37 === 0) {
      delete row["network.destination"];
    }

    return row;
  });

const readRequestBody = async (request) =>
  new Promise((resolve, reject) => {
    let body = "";
    request.setEncoding("utf8");
    request.on("data", (chunk) => {
      body += chunk;
    });
    request.on("end", () => resolve(body));
    request.on("error", reject);
  });

const jsonResponse = (response, statusCode, payload) => {
  response.writeHead(statusCode, { "Content-Type": "application/json" });
  response.end(JSON.stringify(payload));
};

const withForwardFields = (check, index) => ({
  ...structuredClone(check),
  id: `scale-check-${index + 1}`,
  createdAt: "2026-01-01T00:00:00.000Z",
  definedAt: "2026-01-01T00:00:00.000Z",
  executedAt: "2026-01-01T00:01:00.000Z",
  status: "PASS",
});

const startFakeForward = async (state) =>
  new Promise((resolve) => {
    const server = createServer(async (request, response) => {
      const url = new URL(request.url || "/", "http://127.0.0.1");

      if (
        request.method === "GET" &&
        url.pathname === "/api/networks/scale-network/snapshots/latestProcessed"
      ) {
        state.latestSnapshotRequests += 1;
        jsonResponse(response, 200, { id: "snapshot-scale" });
        return;
      }

      if (
        request.method === "GET" &&
        url.pathname === "/api/snapshots/snapshot-scale/checks" &&
        url.searchParams.get("type") === "Existential"
      ) {
        state.inventoryRequests += 1;
        jsonResponse(response, 200, state.existingChecks);
        return;
      }

      if (
        request.method === "POST" &&
        url.pathname === "/api/snapshots/snapshot-scale/checks" &&
        url.searchParams.has("bulk")
      ) {
        const checks = JSON.parse(await readRequestBody(request));
        const offset = state.existingChecks.length;
        state.bulkPostCount += 1;
        state.bulkSizes.push(checks.length);
        state.existingChecks.push(
          ...checks.map((check, index) => withForwardFields(check, offset + index)),
        );
        jsonResponse(response, 200, { created: checks.length });
        return;
      }

      jsonResponse(response, 404, { error: `${request.method} ${url.pathname}` });
    });

    server.listen(0, "127.0.0.1", () => {
      const address = server.address();
      resolve({ server, port: address.port });
    });
  });

const main = async () => {
  const workdir = await mkdtemp(path.join(tmpdir(), "forward-dynatrace-load-"));
  const rowsPath = path.join(workdir, "dynatrace-rows.json");
  const dependenciesPath = path.join(workdir, "normalized-dependencies.json");
  const packageDir = path.join(workdir, "package");
  const checksPath = path.join(packageDir, "forward-intent-checks.json");
  const manifestPath = path.join(packageDir, "forward-dynatrace-manifest.json");
  const publicKeyPath = path.join(workdir, "forward-dynatrace-public.pem");
  const signaturePath = path.join(workdir, "forward-dynatrace-package.sig");
  const authorizationPath = path.join(workdir, "forward-authorization.header");
  const planPath = path.join(workdir, "forward-import-plan.json");
  const approvalPath = path.join(workdir, "forward-import-approval.json");

  await writeFile(rowsPath, JSON.stringify(makeRows(dependencyRows), null, 2) + "\n");

  await run([
    "scripts/normalize-dynatrace-dependencies.mjs",
    "--input",
    rowsPath,
    "--output",
    dependenciesPath,
  ]);

  const dependencies = await readJson(dependenciesPath);
  const exportableDependencies = dependencies.filter(
    (dependency) => dependency.mappingState === "ready",
  );
  const needsMapDependencies = dependencies.filter(
    (dependency) => dependency.mappingState === "needs-map",
  ).length;
  const reviewDependencies = dependencies.filter(
    (dependency) => dependency.mappingState === "review",
  ).length;
  const rejectedDependencies = needsMapDependencies + reviewDependencies;
  assert.equal(dependencies.length, dependencyRows);
  assert.equal(needsMapDependencies > 0, true);
  assert.equal(reviewDependencies > 0, true);

  const buildResult = await runJson([
    "--disable-warning=MODULE_TYPELESS_PACKAGE_JSON",
    "--experimental-strip-types",
    "scripts/build-forward-package.mjs",
    "--dependencies",
    dependenciesPath,
    "--output-dir",
    packageDir,
    "--sync-mode",
    "data-connector",
    "--source-instance-id",
    sourceInstanceId,
    "--forward-access-profile",
    "network-admin",
  ]);

  assert.equal(buildResult.dependencies, dependencyRows);
  assert.equal(buildResult.selectedDependencies, exportableDependencies.length);
  assert.equal(buildResult.intentChecks, exportableDependencies.length);
  assert.equal(buildResult.rejectedDependencies, rejectedDependencies);

  const manifest = await readJson(manifestPath);
  const checks = await readJson(checksPath);
  assert.equal(manifest.requestedIngestPath, "data-connector");
  assert.equal(manifest.requestedForwardAccessProfile, "network-admin");
  assert.equal(manifest.dependencyRows.rowCount, dependencies.length);
  assert.equal(manifest.dependencyRows.rejectedRowCount, rejectedDependencies);
  assert.equal(manifest.intentChecks.count, exportableDependencies.length);
  assert.equal(checks.length, exportableDependencies.length);
  const checksText = await readFile(checksPath, "utf8");
  const manifestText = await readFile(manifestPath, "utf8");
  const { privateKey, publicKey } = generateKeyPairSync("ed25519");
  await writeFile(
    publicKeyPath,
    publicKey.export({ format: "pem", type: "spki" }),
    { mode: 0o600 },
  );
  await writeFile(
    signaturePath,
    `${sign(
      null,
      Buffer.from(packageSigningPayload({ checksText, manifestText }), "utf8"),
      privateKey,
    ).toString("base64")}\n`,
    { mode: 0o600 },
  );
  await writeFile(
    authorizationPath,
    `Basic ${Buffer.from("scale-user:scale-password").toString("base64")}\n`,
    { mode: 0o600 },
  );

  const validation = await runJson([
    importerPath,
    "--checks",
    checksPath,
    "--manifest",
    manifestPath,
    "--validate-only",
  ]);
  assert.equal(validation.status, "valid");
  assert.equal(validation.plannedChecks, exportableDependencies.length);

  const state = {
    existingChecks: [],
    latestSnapshotRequests: 0,
    inventoryRequests: 0,
    bulkPostCount: 0,
    bulkSizes: [],
  };
  const { server, port } = await startFakeForward(state);
  const env = {
    FORWARD_BASE_URL: `http://127.0.0.1:${port}`,
    FORWARD_AUTHORIZATION_FILE: authorizationPath,
    FORWARD_NETWORK_ID: "scale-network",
  };

  try {
    const stage = await runJson([
      importerPath,
      "--checks",
      checksPath,
      "--manifest",
      manifestPath,
      "--require-signature",
      "--signature",
      signaturePath,
      "--public-key",
      publicKeyPath,
      "--stage-plan",
      planPath,
      "--batch-size",
      String(batchSize),
    ], env);
    assert.equal(stage.mode, "stage");
    const plan = await readJson(planPath);
    const approvedAt = new Date();
    await writeFile(
      approvalPath,
      `${JSON.stringify(
        {
          schemaVersion: "forward-dynatrace-import-approval/v1",
          planId: plan.planId,
          planSha256: plan.planSha256,
          packageId: plan.package.packageId,
          networkId: plan.target.networkId,
          snapshotId: plan.target.snapshotId,
          approvedAt: approvedAt.toISOString(),
          expiresAt: new Date(approvedAt.getTime() + 60 * 60 * 1000).toISOString(),
          approvedBy: "load-scale-smoke",
          reason: "approve the exact immutable scale-smoke import plan",
          actions: {
            createMissing: true,
            updateSourceKeys: [],
            retireSourceKeys: [],
          },
        },
        null,
        2,
      )}\n`,
      { mode: 0o600 },
    );
    const apply = await runJson([
      importerPath,
      "--checks",
      checksPath,
      "--manifest",
      manifestPath,
      "--require-signature",
      "--signature",
      signaturePath,
      "--public-key",
      publicKeyPath,
      "--apply-plan",
      planPath,
      "--require-approval-file",
      approvalPath,
      "--apply",
      "--batch-size",
      String(batchSize),
    ], env);
    assert.equal(apply.mode, "apply");
    assert.equal(apply.counts.create, exportableDependencies.length);
    assert.equal(apply.counts.unchanged, 0);
    assert.equal(apply.counts.changed, 0);
    assert.equal(apply.counts.stale, 0);
    assert.equal(state.existingChecks.length, exportableDependencies.length);
    assert.equal(
      state.bulkPostCount,
      Math.ceil(exportableDependencies.length / batchSize),
    );
    assert.equal(
      state.bulkSizes.reduce((sum, size) => sum + size, 0),
      exportableDependencies.length,
    );
    assert.equal(state.bulkSizes.every((size) => size <= batchSize), true);

    const rerun = await runJson([
      importerPath,
      "--checks",
      checksPath,
      "--manifest",
      manifestPath,
    ], env);
    assert.equal(rerun.counts.create, 0);
    assert.equal(rerun.counts.unchanged, exportableDependencies.length);
    assert.equal(rerun.counts.changed, 0);
    assert.equal(rerun.counts.stale, 0);
  } finally {
    server.close();
  }

  process.stdout.write(
    JSON.stringify(
      {
        status: "ok",
        dependencyRows,
        exportableDependencies: exportableDependencies.length,
        needsMapDependencies,
        reviewDependencies,
        batchSize,
        bulkRequests: state.bulkPostCount,
        bulkSizes: state.bulkSizes,
      },
      null,
      2,
    ) + "\n",
  );
};

main().catch((error) => {
  process.stderr.write(`${error.message}\n`);
  process.exit(1);
});
