import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { createServer } from "node:http";
import { mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";

import {
  isIpOrSubnet,
  resolveDependencyCandidates,
  selectResolvedHostCandidate,
} from "./forward-resolve-hosts.mjs";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

const dependency = (overrides = {}) => ({
  id: "checkout-orders",
  appName: "Checkout",
  environment: "prod",
  serviceEntityId: "SERVICE-CHECKOUT",
  serviceName: "checkout-api",
  source: "checkout-vip",
  destination: "orders-db",
  protocol: "tcp",
  port: "443",
  owner: "commerce",
  criticality: "critical",
  confidence: 98,
  mappingState: "review",
  ...overrides,
});

const runJson = async (args, env = process.env) =>
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
      if (code !== 0) {
        reject(new Error(`${process.execPath} ${args.join(" ")} exited ${code}: ${stderr || stdout}`));
        return;
      }
      resolve(JSON.parse(stdout));
    });
  });

const readBody = async (request) =>
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

const startFakeForward = async () =>
  new Promise((resolve) => {
    const calls = [];
    const server = createServer(async (request, response) => {
      const url = new URL(request.url || "/", "http://127.0.0.1");
      calls.push({
        method: request.method,
        path: url.pathname,
        searchParams: Object.fromEntries(url.searchParams.entries()),
        authorization: request.headers.authorization || "",
        body: await readBody(request),
      });

      if (
        request.method === "GET" &&
        url.pathname === "/api/networks/network-1/snapshots/latestProcessed"
      ) {
        jsonResponse(response, 200, { id: "snapshot-1" });
        return;
      }

      const hostPrefix = "/api/networks/network-1/hosts/";
      if (request.method === "GET" && url.pathname.startsWith(hostPrefix)) {
        const specifier = decodeURIComponent(url.pathname.slice(hostPrefix.length));
        const hostFixtures = {
          "checkout-vip": {
            hosts: [
              {
                name: "checkout-vip",
                type: "INFERRED_HOST",
                subnets: ["10.10.10.10"],
                deviceName: "edge-a",
              },
            ],
          },
          "orders-db": {
            hosts: [
              {
                name: "orders-db",
                type: "INFERRED_HOST",
                subnets: ["10.20.20.20/32"],
                deviceName: "edge-b",
              },
            ],
          },
          "shared-name": {
            hosts: [
              { name: "shared-name", type: "INFERRED_HOST", subnets: ["10.1.1.1"] },
              { name: "shared-name", type: "INFERRED_HOST", subnets: ["10.1.1.2"] },
            ],
          },
          missing: {
            hosts: [],
          },
        };
        jsonResponse(response, 200, hostFixtures[specifier] || { hosts: [] });
        return;
      }

      jsonResponse(response, 404, { message: "not found" });
    });

    server.listen(0, "127.0.0.1", () => {
      const address = server.address();
      resolve({
        server,
        calls,
        baseUrl: `http://127.0.0.1:${address.port}`,
      });
    });
  });

test("detects IP and subnet inputs without live Forward lookup", () => {
  assert.equal(isIpOrSubnet("10.0.0.1"), true);
  assert.equal(isIpOrSubnet("10.0.0.0/24"), true);
  assert.equal(isIpOrSubnet("checkout-vip"), false);
});

test("selects exactly one Forward host subnet as resolved", () => {
  const result = selectResolvedHostCandidate({
    hosts: [{ name: "checkout-vip", subnets: ["10.10.10.10"] }],
  });

  assert.equal(result.status, "resolved");
  assert.equal(result.value, "10.10.10.10");
  assert.equal(result.filterType, "HostFilter");
});

test("marks multi-candidate host resolution as review", () => {
  const result = selectResolvedHostCandidate({
    hosts: [
      { name: "shared-name", subnets: ["10.1.1.1"] },
      { name: "shared-name", subnets: ["10.1.1.2"] },
    ],
  });

  assert.equal(result.status, "ambiguous");
  assert.equal(result.candidateCount, 2);
});

test("executes read-only Forward host resolution and updates dependency eligibility", async () => {
  const { server, calls, baseUrl } = await startFakeForward();
  try {
    const result = await resolveDependencyCandidates({
      dependencies: [
        dependency(),
        dependency({ id: "ambiguous", source: "shared-name" }),
        dependency({ id: "missing", destination: "missing" }),
      ],
      forwardBaseUrl: baseUrl,
      forwardNetworkId: "network-1",
      authorization: "Bearer readonly-token",
      execute: true,
    });

    assert.equal(result.report.counts.ready, 1);
    assert.equal(result.report.counts.review, 1);
    assert.equal(result.report.counts.needsMap, 1);
    assert.equal(result.dependencies[0].mappingState, "ready");
    assert.equal(result.dependencies[0].sourceResolvedValue, "10.10.10.10");
    assert.equal(result.dependencies[0].destinationResolvedValue, "10.20.20.20/32");
    assert.equal(calls[0].path, "/api/networks/network-1/snapshots/latestProcessed");
    assert.ok(calls.every((call) => call.authorization === "Bearer readonly-token"));
  } finally {
    await new Promise((resolve, reject) => {
      server.close((error) => (error ? reject(error) : resolve()));
    });
  }
});

test("CLI resolver output feeds intent-check package generation", async () => {
  const { server, baseUrl } = await startFakeForward();
  const workdir = await mkdtemp(path.join(tmpdir(), "forward-resolve-hosts-"));
  const dependenciesPath = path.join(workdir, "dependencies.json");
  const authorizationPath = path.join(workdir, "forward-readonly-authorization.txt");
  const resolvedPath = path.join(workdir, "resolved-dependencies.json");
  const reportPath = path.join(workdir, "host-resolution-report.json");
  try {
    await writeFile(
      dependenciesPath,
      `${JSON.stringify([dependency(), dependency({ id: "ambiguous", source: "shared-name" })], null, 2)}\n`,
    );
    await writeFile(authorizationPath, "Bearer readonly-token\n");

    const report = await runJson(
      [
        "scripts/forward-resolve-hosts.mjs",
        "--dependencies",
        dependenciesPath,
        "--forward-base-url",
        baseUrl,
        "--forward-network-id",
        "network-1",
        "--authorization-file",
        authorizationPath,
        "--execute",
        "--output",
        resolvedPath,
        "--report",
        reportPath,
      ],
      process.env,
    );

    assert.equal(report.counts.ready, 1);
    assert.equal(report.counts.review, 1);

    await runJson([
      "--disable-warning=MODULE_TYPELESS_PACKAGE_JSON",
      "--experimental-strip-types",
      "scripts/build-forward-package.mjs",
      "--dependencies",
      resolvedPath,
      "--output-dir",
      workdir,
    ]);

    const checks = JSON.parse(
      await readFile(path.join(workdir, "forward-intent-checks.json"), "utf8"),
    );
    assert.equal(checks.length, 1);
    assert.equal(checks[0].definition.filters.from.location.value, "10.10.10.10");
    assert.equal(checks[0].definition.filters.to.location.value, "10.20.20.20/32");
    assert.match(
      checks[0].tags.find((tag) => tag.startsWith("dynatrace-key:")),
      /checkout-vip:orders-db/,
    );
  } finally {
    await new Promise((resolve, reject) => {
      server.close((error) => (error ? reject(error) : resolve()));
    });
  }
});
