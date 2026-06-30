#!/usr/bin/env node

import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { createHash, generateKeyPairSync, sign } from "node:crypto";
import { createServer } from "node:http";
import { mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const demoDependenciesPath = path.join(root, "shared/demo-dependencies.json");
const importerPath = path.join(root, "scripts/forward-import-package.mjs");

const readJson = async (filePath) => JSON.parse(await readFile(filePath, "utf8"));

const toSlug = (value) =>
  value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 80);

const toTagValue = (value) => toSlug(value) || "unknown";

const toIntegrationKey = (dependency) =>
  [
    "dt",
    toSlug(dependency.appName),
    toSlug(dependency.environment),
    toSlug(dependency.serviceEntityId),
    toSlug(dependency.source),
    toSlug(dependency.destination),
    dependency.protocol,
    dependency.port,
  ]
    .filter(Boolean)
    .join(":");

const toPriority = (criticality) => {
  if (criticality === "critical") {
    return "HIGH";
  }
  if (criticality === "high") {
    return "MEDIUM";
  }
  return "LOW";
};

const toProtocolValue = (protocol) => (protocol === "tcp" ? "6" : "17");

const toIntentCheck = (dependency) => ({
  definition: {
    checkType: "Existential",
    filters: {
      from: {
        location: {
          type: "HostFilter",
          value: dependency.source,
        },
        headers: [
          {
            type: "PacketFilter",
            values: {
              ip_proto: [toProtocolValue(dependency.protocol)],
            },
          },
          {
            type: "PacketFilter",
            values: {
              tp_dst: [dependency.port],
            },
          },
        ],
      },
      to: {
        location: {
          type: "HostFilter",
          value: dependency.destination,
        },
      },
      flowTypes: ["VALID"],
    },
    headerFieldsWithDefaults: ["url"],
    noiseTypes: [],
    returnPath: "ANY",
  },
  enabled: true,
  name: `[Dynatrace] ${dependency.appName} ${dependency.environment}: ${dependency.source} -> ${dependency.destination} ${dependency.protocol}/${dependency.port}`,
  note: [
    `Generated from Dynatrace service ${dependency.serviceName}`,
    `serviceEntityId=${dependency.serviceEntityId}`,
    `integrationKey=${toIntegrationKey(dependency)}`,
    `owner=${dependency.owner}`,
    `confidence=${dependency.confidence}`,
  ].join("; "),
  priority: toPriority(dependency.criticality),
  tags: [
    "dynatrace",
    `app:${toTagValue(dependency.appName)}`,
    `environment:${toTagValue(dependency.environment)}`,
    `owner:${toTagValue(dependency.owner)}`,
    `dynatrace-key:${toIntegrationKey(dependency)}`,
  ],
});

const sha256Hex = (text) => createHash("sha256").update(text, "utf8").digest("hex");

const toManifest = (checks, checksText) => ({
  schemaVersion: "forward-dynatrace/v1",
  packageType: "forward-intent-import",
  packageId: `dynatrace-forward-${new Date().toISOString().replace(/[^0-9]/g, "").slice(0, 14)}`,
  generatedAt: new Date().toISOString(),
  requestedIngestPath: "manual-import",
  source: {
    platform: "dynatrace",
    app: "forward-dynatrace",
    writePolicy: "dynatrace-never-writes-forward",
  },
  artifacts: {
    manifest: "forward-dynatrace-manifest.json",
    intentChecks: "forward-intent-checks.json",
  },
  integrity: {
    algorithm: "sha256",
    intentChecksSha256: sha256Hex(checksText),
  },
  intentChecks: {
    count: checks.length,
    checkType: "Existential",
    payloadShape: "NewNetworkCheck[]",
    bulkEndpoint: "/api/snapshots/{snapshotId}/checks?bulk",
    dedupeRequiredBeforePost: true,
  },
  validation: {
    requiredTagPrefix: "dynatrace-key:",
    requiredTagsPerCheck: 1,
    credentialPolicy: "no-forward-credentials-in-dynatrace",
  },
  reconciliation: {
    defaultApplyPolicy: "create-missing-only",
    changedChecks: "report-only",
    staleChecks: "report-only",
  },
});

const withResultFields = (check, index) => ({
  ...structuredClone(check),
  id: `demo-check-${index + 1}`,
  createdAt: "2026-01-01T00:00:00Z",
  definedAt: "2026-01-01T00:00:00Z",
  executedAt: "2026-01-01T00:01:00Z",
  status: "PASS",
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

const textJsonResponse = (response, statusCode, text) => {
  response.writeHead(statusCode, { "Content-Type": "application/json" });
  response.end(text);
};

const startFakeForward = async (state) =>
  new Promise((resolve) => {
    const server = createServer(async (request, response) => {
      const url = new URL(request.url || "/", "http://127.0.0.1");

      if (
        request.method === "GET" &&
        url.pathname === "/package/forward-dynatrace-manifest.json"
      ) {
        textJsonResponse(response, 200, state.packageManifestText);
        return;
      }

      if (
        request.method === "GET" &&
        url.pathname === "/package/forward-intent-checks.json"
      ) {
        textJsonResponse(response, 200, state.packageChecksText);
        return;
      }

      if (
        request.method === "GET" &&
        url.pathname === "/package/forward-dynatrace-package.sig"
      ) {
        textJsonResponse(response, 200, state.packageSignatureText);
        return;
      }

      if (
        request.method === "GET" &&
        url.pathname === "/api/networks/demo-network/snapshots/latestProcessed"
      ) {
        jsonResponse(response, 200, { id: "snapshot-demo" });
        return;
      }

      if (
        request.method === "GET" &&
        url.pathname === "/api/snapshots/snapshot-demo/checks" &&
        url.searchParams.get("type") === "Existential"
      ) {
        jsonResponse(response, 200, state.existingChecks);
        return;
      }

      if (
        request.method === "POST" &&
        url.pathname === "/api/snapshots/snapshot-demo/checks" &&
        url.searchParams.has("bulk")
      ) {
        const body = await readRequestBody(request);
        const checks = JSON.parse(body);
        if (state.transientBulkFailures > 0) {
          state.transientBulkFailures -= 1;
          state.bulkFailureResponses += 1;
          response.writeHead(429, {
            "Content-Type": "application/json",
            "Retry-After": "0.01",
          });
          response.end(JSON.stringify({ error: "retry this bulk request" }));
          return;
        }
        const offset = state.existingChecks.length;
        state.bulkPostCount += 1;
        state.bulkSizes.push(checks.length);
        state.existingChecks.push(
          ...checks.map((check, index) => withResultFields(check, offset + index)),
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

const runImporter = async (args, env = {}) =>
  new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [importerPath, ...args], {
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
        reject(new Error(`Importer exited ${code}:\n${stderr || stdout}`));
        return;
      }
      resolve(JSON.parse(stdout));
    });
  });

const main = async () => {
  const dependencies = await readJson(demoDependenciesPath);
  const checks = dependencies
    .filter((dependency) => dependency.mappingState !== "needs-map")
    .map(toIntentCheck);
  assert.equal(checks.length, 3);

  const workdir = await mkdtemp(path.join(tmpdir(), "forward-dynatrace-smoke-"));
  const checksPath = path.join(workdir, "forward-intent-checks.json");
  const manifestPath = path.join(workdir, "forward-dynatrace-manifest.json");
  const connectorConfigPath = path.join(workdir, "forward-connector.config.json");
  const publicKeyPath = path.join(workdir, "forward-dynatrace-public.pem");
  const checksText = JSON.stringify(checks, null, 2) + "\n";
  const manifest = toManifest(checks, checksText);
  const manifestText = JSON.stringify(manifest, null, 2) + "\n";
  const { privateKey, publicKey } = generateKeyPairSync("ed25519");
  const signaturePayload = [
    "forward-dynatrace-package-signature/v1",
    `manifest-sha256:${sha256Hex(manifestText)}`,
    `checks-sha256:${sha256Hex(checksText)}`,
    "",
  ].join("\n");
  const packageSignatureText =
    sign(null, Buffer.from(signaturePayload, "utf8"), privateKey).toString("base64") +
    "\n";
  await writeFile(checksPath, checksText);
  await writeFile(manifestPath, manifestText);
  await writeFile(
    publicKeyPath,
    publicKey.export({ format: "pem", type: "spki" }),
  );

  const validation = await runImporter([
    "--checks",
    checksPath,
    "--manifest",
    manifestPath,
    "--validate-only",
  ]);
  assert.equal(validation.status, "valid");
  assert.equal(validation.plannedChecks, 3);

  const state = {
    existingChecks: [],
    packageChecks: checks,
    packageManifest: manifest,
    packageChecksText: checksText,
    packageManifestText: manifestText,
    packageSignatureText,
    bulkFailureResponses: 0,
    bulkPostCount: 0,
    bulkSizes: [],
    transientBulkFailures: 0,
  };
  const { server, port } = await startFakeForward(state);
  const env = {
    FORWARD_BASE_URL: `http://127.0.0.1:${port}`,
    FORWARD_USER: "demo-user",
    FORWARD_PASSWORD: "demo-password",
    FORWARD_NETWORK_ID: "demo-network",
  };

  try {
    const pulledPackage = await runImporter([
      "--package-url",
      `http://127.0.0.1:${port}/package`,
      "--validate-only",
    ]);
    assert.equal(pulledPackage.status, "valid");
    assert.equal(pulledPackage.plannedChecks, 3);
    assert.equal(pulledPackage.packageId, manifest.packageId);
    assert.equal(
      pulledPackage.packageIntegrity.intentChecksSha256,
      manifest.integrity.intentChecksSha256,
    );

    const signedPackage = await runImporter([
      "--package-url",
      `http://127.0.0.1:${port}/package`,
      "--public-key",
      publicKeyPath,
      "--require-signature",
      "--validate-only",
    ]);
    assert.equal(signedPackage.packageSignature.status, "verified");

    await writeFile(
      connectorConfigPath,
      JSON.stringify(
        {
          schemaVersion: "forward-dynatrace-connector/v1",
          packageUrl: `http://127.0.0.1:${port}/package`,
          forwardBaseUrl: `http://127.0.0.1:${port}`,
          forwardNetworkId: "demo-network",
          validateOnly: true,
          batchSize: 500,
          maxRetries: 0,
          maxPackageAgeMinutes: 1440,
          failOnDrift: true,
          reportPath: path.join(workdir, "connector-report.json"),
          metricsPath: path.join(workdir, "connector-metrics.prom"),
          statusArtifactPath: path.join(workdir, "forward-ingest-status.json"),
        },
        null,
        2,
      ) + "\n",
    );
    const configValidation = await runImporter(["--config", connectorConfigPath]);
    assert.equal(configValidation.status, "valid");
    assert.equal(configValidation.plannedChecks, 3);
    const connectorMetrics = await readFile(
      path.join(workdir, "connector-metrics.prom"),
      "utf8",
    );
    assert.match(connectorMetrics, /forward_dynatrace_import_planned_checks 3/);
    const connectorStatus = await readJson(path.join(workdir, "forward-ingest-status.json"));
    assert.equal(connectorStatus.schemaVersion, "forward-dynatrace-status/v1");
    assert.equal(connectorStatus.importState, "valid");
    assert.equal(connectorStatus.plannedChecks, 3);
    assert.equal(JSON.stringify(connectorStatus).includes("checkout-vip"), false);

    const largeChecks = Array.from({ length: 1001 }, (_, index) => {
      const check = structuredClone(checks[index % checks.length]);
      check.name = `${check.name} bulk ${index + 1}`;
      check.tags = [
        ...check.tags.filter((tag) => !tag.startsWith("dynatrace-key:")),
        `dynatrace-key:dt:bulk:${index + 1}`,
      ];
      return check;
    });
    const largeChecksPath = path.join(workdir, "forward-intent-checks-large.json");
    const largeManifestPath = path.join(workdir, "forward-dynatrace-manifest-large.json");
    const largeChecksText = JSON.stringify(largeChecks, null, 2) + "\n";
    const largeManifestText = JSON.stringify(
      toManifest(largeChecks, largeChecksText),
      null,
      2,
    ) + "\n";
    await writeFile(largeChecksPath, largeChecksText);
    await writeFile(largeManifestPath, largeManifestText);

    state.existingChecks = [];
    state.bulkPostCount = 0;
    state.bulkSizes = [];
    state.transientBulkFailures = 1;
    state.bulkFailureResponses = 0;
    const largeApply = await runImporter([
      "--checks",
      largeChecksPath,
      "--manifest",
      largeManifestPath,
      "--apply",
      "--batch-size",
      "500",
      "--max-retries",
      "2",
    ], env);
    assert.equal(largeApply.counts.create, 1001);
    assert.equal(state.bulkFailureResponses, 1);
    assert.equal(state.bulkPostCount, 3);
    assert.deepEqual(state.bulkSizes, [500, 500, 1]);
    assert.equal(state.existingChecks.length, 1001);

    state.existingChecks = [];
    state.bulkPostCount = 0;
    state.bulkSizes = [];
    state.transientBulkFailures = 0;
    state.bulkFailureResponses = 0;

    const dryRun = await runImporter(["--checks", checksPath, "--manifest", manifestPath], env);
    assert.equal(dryRun.packageId, manifest.packageId);
    assert.equal(typeof dryRun.runId, "string");
    assert.deepEqual(dryRun.counts, {
      create: 3,
      unchanged: 0,
      changed: 0,
      stale: 0,
    });

    const apply = await runImporter([
      "--checks",
      checksPath,
      "--manifest",
      manifestPath,
      "--apply",
      "--batch-size",
      "2",
    ], env);
    assert.equal(apply.mode, "apply");
    assert.equal(apply.counts.create, 3);
    assert.equal(state.existingChecks.length, 3);
    assert.equal(state.bulkPostCount, 2);

    const unchanged = await runImporter(["--checks", checksPath, "--manifest", manifestPath], env);
    assert.deepEqual(unchanged.counts, {
      create: 0,
      unchanged: 3,
      changed: 0,
      stale: 0,
    });

    state.existingChecks[0].definition.filters.from.headers[1].values.tp_dst = ["9443"];
    const changed = await runImporter(["--checks", checksPath, "--manifest", manifestPath], env);
    assert.equal(changed.counts.changed, 1);
    assert.equal(changed.changed[0].fields.includes("definition"), true);

    state.existingChecks[0] = withResultFields(checks[0], 0);
    state.existingChecks.push(
      withResultFields(
        {
          ...structuredClone(checks[0]),
          name: "[Dynatrace] Stale demo check",
          tags: ["dynatrace", "dynatrace-key:dt:stale:demo"],
        },
        99,
      ),
    );
    const stale = await runImporter(["--checks", checksPath, "--manifest", manifestPath], env);
    assert.equal(stale.counts.stale, 1);
  } finally {
    await new Promise((resolve, reject) => {
      server.close((error) => (error ? reject(error) : resolve()));
    });
  }

  process.stdout.write("Workflow smoke passed.\n");
};

main().catch((error) => {
  process.stderr.write(`${error.stack || error.message}\n`);
  process.exit(1);
});
