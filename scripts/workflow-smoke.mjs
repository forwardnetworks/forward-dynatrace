#!/usr/bin/env node

import assert from "node:assert/strict";
import { spawn } from "node:child_process";
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
    `app:${dependency.appName}`,
    `environment:${dependency.environment}`,
    `owner:${dependency.owner}`,
    `dynatrace-key:${toIntegrationKey(dependency)}`,
  ],
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

const startFakeForward = async (state) =>
  new Promise((resolve) => {
    const server = createServer(async (request, response) => {
      const url = new URL(request.url || "/", "http://127.0.0.1");

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
        const offset = state.existingChecks.length;
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
  await writeFile(checksPath, JSON.stringify(checks, null, 2) + "\n");

  const validation = await runImporter(["--checks", checksPath, "--validate-only"]);
  assert.equal(validation.status, "valid");
  assert.equal(validation.plannedChecks, 3);

  const state = { existingChecks: [] };
  const { server, port } = await startFakeForward(state);
  const env = {
    FORWARD_BASE_URL: `http://127.0.0.1:${port}`,
    FORWARD_USER: "demo-user",
    FORWARD_PASSWORD: "demo-password",
    FORWARD_NETWORK_ID: "demo-network",
  };

  try {
    const dryRun = await runImporter(["--checks", checksPath], env);
    assert.deepEqual(dryRun.counts, {
      create: 3,
      unchanged: 0,
      changed: 0,
      stale: 0,
    });

    const apply = await runImporter(["--checks", checksPath, "--apply"], env);
    assert.equal(apply.mode, "apply");
    assert.equal(apply.counts.create, 3);
    assert.equal(state.existingChecks.length, 3);

    const unchanged = await runImporter(["--checks", checksPath], env);
    assert.deepEqual(unchanged.counts, {
      create: 0,
      unchanged: 3,
      changed: 0,
      stale: 0,
    });

    state.existingChecks[0].definition.filters.from.headers[1].values.tp_dst = ["9443"];
    const changed = await runImporter(["--checks", checksPath], env);
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
    const stale = await runImporter(["--checks", checksPath], env);
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
