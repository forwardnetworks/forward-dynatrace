#!/usr/bin/env node

import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { createHash, generateKeyPairSync, sign } from "node:crypto";
import { createServer } from "node:http";
import { mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

import {
  SOURCE_KEY_TAG_PREFIX,
  dependencySourceKeyTag,
  requiredOwnershipTags,
  sourceInstanceTag,
} from "../lib/managed-check-identity.mjs";
import {
  buildNqeChecksFromDependencies,
  buildNqeDiffRequestsFromDependencies,
} from "./forward-nqe-artifacts.mjs";
import { packageSigningPayload } from "./forward-import-package.mjs";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const importerPath = path.join(root, "scripts/forward-import-package.mjs");
const sourceInstanceId = "dt-workflow-smoke";

const readJson = async (filePath) => JSON.parse(await readFile(filePath, "utf8"));

const smokeDependencies = [
  {
    id: "smoke-frontend-api",
    appName: "Smoke App",
    environment: "demo",
    serviceEntityId: "SERVICE-SMOKE-FRONTEND",
    serviceName: "smoke-frontend",
    source: "frontend-vip",
    destination: "api-vip",
    protocol: "tcp",
    port: "443",
    owner: "platform",
    criticality: "critical",
    confidence: 95,
    mappingState: "ready",
  },
  {
    id: "smoke-api-db",
    appName: "Smoke App",
    environment: "demo",
    serviceEntityId: "SERVICE-SMOKE-API",
    serviceName: "smoke-api",
    source: "api-vip",
    destination: "database-vip",
    protocol: "tcp",
    port: "5432",
    owner: "platform",
    criticality: "high",
    confidence: 90,
    mappingState: "ready",
  },
  {
    id: "smoke-api-queue",
    appName: "Smoke App",
    environment: "demo",
    serviceEntityId: "SERVICE-SMOKE-QUEUE",
    serviceName: "smoke-worker",
    source: "api-vip",
    destination: "queue-vip",
    protocol: "tcp",
    port: "5672",
    owner: "platform",
    criticality: "medium",
    confidence: 85,
    mappingState: "review",
  },
];

const toSlug = (value) =>
  value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 80);

const toTagValue = (value) => toSlug(value) || "unknown";

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

const toIntentCheck = (dependency) => {
  const sourceKey = dependencySourceKeyTag(dependency, { sourceInstanceId });
  return ({
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
    `sourceKey=${sourceKey}`,
    `owner=${dependency.owner}`,
    `confidence=${dependency.confidence}`,
  ].join("; "),
  priority: toPriority(dependency.criticality),
  tags: [
    "dynatrace",
    ...requiredOwnershipTags({ sourceInstanceId, sourceKey }),
    `app:${toTagValue(dependency.appName)}`,
    `environment:${toTagValue(dependency.environment)}`,
    `owner:${toTagValue(dependency.owner)}`,
  ],
  });
};

const sha256Hex = (text) => createHash("sha256").update(text, "utf8").digest("hex");

const toManifest = (checks, checksText) => ({
  schemaVersion: "forward-dynatrace/v1",
  packageType: "forward-intent-import",
  packageId: `dynatrace-forward-${new Date().toISOString().replace(/[^0-9]/g, "").slice(0, 14)}`,
  generatedAt: new Date().toISOString(),
  requestedIngestPath: "manual-import",
  requestedForwardAccessProfile: "network-admin",
  source: {
    platform: "dynatrace",
    app: "com.forward.dynatrace",
    instanceId: sourceInstanceId,
    instanceTag: sourceInstanceTag(sourceInstanceId),
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
    dedupe: "managed-source-key",
  },
  validation: {
    managedByTag: "managed-by:com.forward.dynatrace",
    contractVersionTag: "contract-version:1",
    sourceInstanceTagPrefix: "source-instance:",
    sourceKeyTagPrefix: SOURCE_KEY_TAG_PREFIX,
    ownershipTagsPerCheck: 4,
    identityPolicy: "strict-ownership-tuple",
    credentialPolicy: "no-forward-credentials-in-dynatrace",
  },
  reconciliation: {
    strategy: "source-scoped-desired-state",
    defaultApplyPolicy: "create-missing-only",
    changedChecks: "report-only",
    staleChecks: "report-only",
    collisionPolicy: "reject",
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
        url.pathname === "/package/forward-nqe-checks.json" &&
        state.packageNqeChecksText
      ) {
        textJsonResponse(response, 200, state.packageNqeChecksText);
        return;
      }

      if (
        request.method === "GET" &&
        url.pathname === "/package/forward-nqe-diff-requests.json" &&
        state.packageNqeDiffRequestsText
      ) {
        textJsonResponse(response, 200, state.packageNqeDiffRequestsText);
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
        if (state.permanentBulkFailureStatus > 0) {
          jsonResponse(response, state.permanentBulkFailureStatus, {
            error: "permanent test failure",
          });
          return;
        }
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

      if (
        request.method === "DELETE" &&
        url.pathname.startsWith("/api/snapshots/snapshot-demo/checks/")
      ) {
        const checkId = decodeURIComponent(url.pathname.split("/").pop() || "");
        const before = state.existingChecks.length;
        state.existingChecks = state.existingChecks.filter((check) => check.id !== checkId);
        if (state.existingChecks.length === before) {
          jsonResponse(response, 404, { error: `check not found: ${checkId}` });
          return;
        }
        state.deleteCount += 1;
        state.deletedIds.push(checkId);
        jsonResponse(response, 200, { deleted: checkId });
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

const signPackage = ({ checksText, manifestText, privateKey, extraArtifacts = {} }) =>
  `${sign(
    null,
    Buffer.from(
      packageSigningPayload({ checksText, manifestText, extraArtifacts }),
      "utf8",
    ),
    privateKey,
  ).toString("base64")}\n`;

const stageApproveApply = async ({
  baseArgs,
  env,
  workdir,
  publicKeyPath,
  signaturePath,
  changeWindowId,
  updateChanged = false,
  retireStale = false,
  maxUpdates = 0,
  maxRetirements = 0,
  failOnDrift = false,
  beforeApply,
}) => {
  const suffix = `${Date.now()}-${Math.random().toString(16).slice(2)}`;
  const planPath = path.join(workdir, `import-plan-${suffix}.json`);
  const approvalPath = path.join(workdir, `import-approval-${suffix}.json`);
  const policyArgs = [
    ...(updateChanged ? ["--apply-updates", "--max-updates", String(maxUpdates)] : []),
    ...(retireStale
      ? ["--deactivate-stale", "--max-deactivations", String(maxRetirements)]
      : []),
    ...(changeWindowId ? ["--change-window-id", changeWindowId] : []),
  ];
  const signedArgs = [
    ...baseArgs,
    "--require-signature",
    "--signature",
    signaturePath,
    "--public-key",
    publicKeyPath,
    ...policyArgs,
  ];

  const staged = await runImporter([...signedArgs, "--stage-plan", planPath], env);
  const plan = await readJson(planPath);
  assert.equal(staged.mode, "stage");
  assert.equal(staged.importPlan.planId, plan.planId);
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
        ...(changeWindowId ? { changeWindowId } : {}),
        approvedAt: approvedAt.toISOString(),
        expiresAt: new Date(approvedAt.getTime() + 60 * 60 * 1000).toISOString(),
        approvedBy: "workflow-smoke",
        reason: "approve the exact immutable workflow smoke import plan",
        actions: {
          createMissing: true,
          updateSourceKeys: plan.actions.update.map((item) => item.sourceKey),
          retireSourceKeys: plan.actions.retire.map((item) => item.sourceKey),
        },
      },
      null,
      2,
    )}\n`,
    { mode: 0o600 },
  );
  await beforeApply?.(plan);

  return runImporter([
    ...signedArgs,
    "--apply",
    "--apply-plan",
    planPath,
    "--require-approval-file",
    approvalPath,
    ...(failOnDrift ? ["--fail-on-drift"] : []),
  ], env);
};

const main = async () => {
  const exportableDependencies = smokeDependencies.filter(
    (dependency) => dependency.mappingState !== "needs-map",
  );
  const checks = exportableDependencies.map(toIntentCheck);
  assert.equal(checks.length, 3);

  const workdir = await mkdtemp(path.join(tmpdir(), "forward-dynatrace-smoke-"));
  const checksPath = path.join(workdir, "forward-intent-checks.json");
  const manifestPath = path.join(workdir, "forward-dynatrace-manifest.json");
  const connectorConfigPath = path.join(workdir, "forward-connector.config.json");
  const authorizationPath = path.join(workdir, "forward-authorization.header");
  const publicKeyPath = path.join(workdir, "forward-dynatrace-public.pem");
  const signaturePath = path.join(workdir, "forward-dynatrace-package.sig");
  const checksText = JSON.stringify(checks, null, 2) + "\n";
  const manifest = toManifest(checks, checksText);
  const manifestText = JSON.stringify(manifest, null, 2) + "\n";
  const { privateKey, publicKey } = generateKeyPairSync("ed25519");
  const packageSignatureText = signPackage({ checksText, manifestText, privateKey });
  const nqeQueryId = "FQ_aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa";
  const nqeChecks = buildNqeChecksFromDependencies(exportableDependencies, {
    queryId: nqeQueryId,
    sourceInstanceId,
  });
  const nqeDiffRequests = buildNqeDiffRequestsFromDependencies(exportableDependencies, {
    queryId: nqeQueryId,
    sourceInstanceId,
    beforeSnapshotId: "snapshot-before",
    afterSnapshotId: "snapshot-after",
  });
  const nqeChecksText = JSON.stringify(nqeChecks, null, 2) + "\n";
  const nqeDiffRequestsText = JSON.stringify(nqeDiffRequests, null, 2) + "\n";
  const manifestWithNqe = structuredClone(manifest);
  manifestWithNqe.artifacts.nqeChecks = "forward-nqe-checks.json";
  manifestWithNqe.artifacts.nqeDiffRequests = "forward-nqe-diff-requests.json";
  manifestWithNqe.integrity.nqeChecksSha256 = sha256Hex(nqeChecksText);
  manifestWithNqe.integrity.nqeDiffRequestsSha256 = sha256Hex(nqeDiffRequestsText);
  manifestWithNqe.nqeChecks = {
    count: nqeChecks.length,
    checkType: "NQE",
    payloadShape: "NewNetworkCheck[]",
    bulkEndpoint: "/api/snapshots/{snapshotId}/checks?bulk",
    dedupeRequiredBeforePost: true,
    dedupe: "managed-source-key",
    queryIdPolicy: "forward-owned-allowlist",
    parameterSource: "dynatrace-app-environment",
  };
  manifestWithNqe.nqeDiffRequests = {
    count: nqeDiffRequests.length,
    payloadShape: "ForwardDynatraceNqeDiffRequest[]",
    endpoint: "/api/nqe-diffs/{before}/{after}",
    queryIdPolicy: "forward-owned-allowlist",
    executionPolicy: "read-only-forward-side-optional",
    parameterSource: "dynatrace-app-environment",
  };
  const manifestWithNqeText = JSON.stringify(manifestWithNqe, null, 2) + "\n";
  await writeFile(checksPath, checksText);
  await writeFile(manifestPath, manifestText);
  await writeFile(
    publicKeyPath,
    publicKey.export({ format: "pem", type: "spki" }),
  );
  await writeFile(signaturePath, packageSignatureText);
  await writeFile(
    authorizationPath,
    `Basic ${Buffer.from("demo-user:demo-password").toString("base64")}\n`,
    { mode: 0o600 },
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
    packageNqeChecksText: "",
    packageNqeDiffRequestsText: "",
    packageSignatureText,
    bulkFailureResponses: 0,
    bulkPostCount: 0,
    bulkSizes: [],
    deleteCount: 0,
    deletedIds: [],
    permanentBulkFailureStatus: 0,
    transientBulkFailures: 0,
  };
  const { server, port } = await startFakeForward(state);
  const env = {
    FORWARD_BASE_URL: `http://127.0.0.1:${port}`,
    FORWARD_AUTHORIZATION_FILE: authorizationPath,
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

    state.packageManifestText = manifestWithNqeText;
    state.packageNqeChecksText = nqeChecksText;
    state.packageNqeDiffRequestsText = nqeDiffRequestsText;
    const pulledPackageWithNqe = await runImporter([
      "--package-url",
      `http://127.0.0.1:${port}/package`,
      "--nqe-query-id-allowlist",
      nqeQueryId,
      "--validate-only",
    ]);
    assert.equal(pulledPackageWithNqe.status, "valid");
    assert.equal(pulledPackageWithNqe.plannedNqeChecks, nqeChecks.length);
    assert.equal(pulledPackageWithNqe.plannedNqeDiffRequests, nqeDiffRequests.length);
    state.packageManifestText = manifestText;
    state.packageNqeChecksText = "";
    state.packageNqeDiffRequestsText = "";

    await writeFile(
      connectorConfigPath,
      JSON.stringify(
        {
          schemaVersion: "forward-dynatrace-connector/v1",
          forwardAccessProfile: "network-admin",
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
      const sourceKey = `source-key:sha256:${createHash("sha256")
        .update(`workflow-smoke-bulk-${index + 1}`, "utf8")
        .digest("hex")}`;
      check.tags = [
        ...check.tags.filter((tag) => !tag.startsWith(SOURCE_KEY_TAG_PREFIX)),
        sourceKey,
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
    const largeSignaturePath = path.join(workdir, "forward-dynatrace-package-large.sig");
    await writeFile(largeChecksPath, largeChecksText);
    await writeFile(largeManifestPath, largeManifestText);
    await writeFile(
      largeSignaturePath,
      signPackage({ checksText: largeChecksText, manifestText: largeManifestText, privateKey }),
      { mode: 0o600 },
    );

    state.existingChecks = [];
    state.bulkPostCount = 0;
    state.bulkSizes = [];
    state.transientBulkFailures = 1;
    state.bulkFailureResponses = 0;
    const largeApply = await stageApproveApply({
      baseArgs: [
        "--checks",
        largeChecksPath,
        "--manifest",
        largeManifestPath,
        "--batch-size",
        "500",
        "--max-retries",
        "2",
      ],
      env,
      workdir,
      publicKeyPath,
      signaturePath: largeSignaturePath,
    });
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
    state.deleteCount = 0;
    state.deletedIds = [];

    const dryRun = await runImporter(["--checks", checksPath, "--manifest", manifestPath], env);
    assert.equal(dryRun.packageId, manifest.packageId);
    assert.equal(typeof dryRun.runId, "string");
    assert.deepEqual(dryRun.counts, {
      create: 3,
      unchanged: 0,
      changed: 0,
      stale: 0,
      collision: 0,
    });

    const apply = await stageApproveApply({
      baseArgs: [
        "--checks",
        checksPath,
        "--manifest",
        manifestPath,
        "--batch-size",
        "2",
      ],
      env,
      workdir,
      publicKeyPath,
      signaturePath,
    });
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
      collision: 0,
    });

    state.existingChecks[0].definition.filters.from.headers[1].values.tp_dst = ["9443"];
    const changed = await runImporter(["--checks", checksPath, "--manifest", manifestPath], env);
    assert.equal(changed.counts.changed, 1);
    assert.equal(changed.changed[0].fields.includes("definition"), true);

    state.existingChecks[0] = withResultFields(checks[0], 0);
    state.existingChecks.push(
      withResultFields(
        (() => {
          const staleSourceKey = `source-key:sha256:${"f".repeat(64)}`;
          return {
            ...structuredClone(checks[0]),
          name: "[Dynatrace] Stale demo check",
            tags: [
              "dynatrace",
              ...requiredOwnershipTags({ sourceInstanceId, sourceKey: staleSourceKey }),
            ],
          };
        })(),
        99,
      ),
    );
    const stale = await runImporter(["--checks", checksPath, "--manifest", manifestPath], env);
    assert.equal(stale.counts.stale, 1);

    state.existingChecks[0].definition.filters.from.headers[1].values.tp_dst = ["9443"];
    const approvedApply = await stageApproveApply({
      baseArgs: ["--checks", checksPath, "--manifest", manifestPath],
      env,
      workdir,
      publicKeyPath,
      signaturePath,
      changeWindowId: "CHG-demo",
      updateChanged: true,
      retireStale: true,
      maxUpdates: 1,
      maxRetirements: 1,
      failOnDrift: true,
    });
    assert.equal(approvedApply.counts.changed, 1);
    assert.equal(approvedApply.counts.stale, 1);
    assert.equal(approvedApply.unresolvedCounts.changed, 0);
    assert.equal(approvedApply.unresolvedCounts.stale, 0);
    assert.deepEqual(approvedApply.mutationCounts, {
      created: 0,
      updated: 1,
      deactivated: 1,
    });
    assert.equal(approvedApply.postApplyVerification.state, "verified");
    assert.equal(approvedApply.postApplyVerification.counts.unchanged, 3);
    assert.equal(state.deleteCount, 2);
    assert.equal(state.existingChecks.length, 3);

    const failureSourceKey = checks[0].tags.find((tag) =>
      tag.startsWith("source-key:sha256:"),
    );
    const failureTarget = state.existingChecks.find((check) =>
      check.tags.includes(failureSourceKey),
    );
    failureTarget.definition.filters.from.headers[1].values.tp_dst = ["9444"];
    const failureReportPath = path.join(workdir, "failed-apply-report.json");
    const failureStatusPath = path.join(workdir, "failed-apply-status.json");
    await assert.rejects(
      stageApproveApply({
        baseArgs: [
          "--checks",
          checksPath,
          "--manifest",
          manifestPath,
          "--max-retries",
          "0",
          "--report",
          failureReportPath,
          "--status-artifact",
          failureStatusPath,
        ],
        env,
        workdir,
        publicKeyPath,
        signaturePath,
        updateChanged: true,
        maxUpdates: 1,
        beforeApply: () => {
          state.permanentBulkFailureStatus = 503;
        },
      }),
      /Importer exited 1/u,
    );
    state.permanentBulkFailureStatus = 0;
    const failureReport = await readJson(failureReportPath);
    const failureStatus = await readJson(failureStatusPath);
    assert.equal(failureReport.mutationFailure.phase, "replace-create");
    assert.equal(failureReport.mutationFailure.statusCode, 503);
    assert.equal(failureReport.mutationFailure.existingCheckDeleted, true);
    assert.equal(failureReport.mutationOutcomes.updated.length, 0);
    assert.equal(failureReport.postApplyVerification.state, "failed");
    assert.equal(failureReport.postApplyVerification.counts.create, 1);
    assert.equal(failureStatus.importState, "failed");
    assert.equal(failureStatus.mutationFailure.phase, "replace-create");
    assert.equal(failureStatus.postApplyVerification.state, "failed");
    assert.equal(JSON.stringify(failureStatus).includes(failureSourceKey), false);
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
