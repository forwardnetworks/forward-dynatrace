import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { createServer } from "node:http";
import { mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";

import {
  buildPathQuery,
  classifyPathSearchResult,
  modeledReachabilityAssessment,
  summarizePathSearchResult,
} from "./forward-path-evidence.mjs";

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

const startFakeForward = async () =>
  new Promise((resolve) => {
    const calls = [];
    const server = createServer(async (request, response) => {
      const url = new URL(request.url || "/", "http://127.0.0.1");
      const body = await readBody(request);
      calls.push({
        method: request.method,
        path: url.pathname,
        searchParams: Object.fromEntries(url.searchParams.entries()),
        authorization: request.headers.authorization || "",
        contentType: request.headers["content-type"] || "",
        body,
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
            hosts: [{ name: "checkout-vip", subnets: ["10.10.10.10"] }],
          },
          "orders-db": {
            hosts: [{ name: "orders-db", subnets: ["10.20.20.20/32"] }],
          },
          missing: {
            hosts: [],
          },
        };
        jsonResponse(response, 200, hostFixtures[specifier] || { hosts: [] });
        return;
      }

      if (request.method === "POST" && url.pathname === "/api/networks/network-1/paths-bulk") {
        const payload = JSON.parse(body);
        jsonResponse(
          response,
          200,
          payload.queries.map(() => ({
            srcIpLocationType: "HOST",
            dstIpLocationType: "HOST",
            queryUrl: "https://forward.example.com/path-search/demo",
            info: {
              paths: [
                {
                  forwardingOutcome: "DELIVERED",
                  securityOutcome: "PERMITTED",
                },
              ],
            },
          })),
        );
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

test("bootstraps Forward CSRF for Basic-auth path search", async () => {
  const calls = [];
  let csrfRequests = 0;
  const fetchImpl = async (url, options = {}) => {
    const parsed = new URL(url);
    calls.push({
      path: parsed.pathname,
      method: options.method || "GET",
      headers: options.headers || {},
    });
    if (parsed.pathname === "/api/public/csrf") {
      csrfRequests += 1;
      return new Response(JSON.stringify({
        headerName: "X-CSRF-TOKEN",
        parameterName: "_csrf",
        token: `csrf-${csrfRequests}`,
      }), { status: 200 });
    }
    if (parsed.pathname.endsWith("/paths-bulk")) {
      const token = options.headers?.["X-CSRF-TOKEN"];
      if (token !== "csrf-1") {
        return new Response(JSON.stringify({ message: "Invalid CSRF token" }), { status: 403 });
      }
      return new Response(JSON.stringify([{ info: { paths: [] } }]), { status: 200 });
    }
    throw new Error(`Unexpected request: ${parsed.pathname}`);
  };

  const { buildPathEvidence } = await import("./forward-path-evidence.mjs");
  const evidence = await buildPathEvidence({
    dependencies: [dependency({
      sourceResolvedValue: "10.10.10.10/32",
      destinationResolvedValue: "10.20.20.20/32",
    })],
    forwardBaseUrl: "https://forward.example.test",
    forwardNetworkId: "network-1",
    snapshotId: "snapshot-1",
    authorization: "Basic dXNlcjpwYXNz",
    execute: true,
    fetchImpl,
  });

  assert.equal(evidence.counts.blocked, 1);
  assert.equal(csrfRequests, 1);
  assert.equal(calls[0].path, "/api/public/csrf");
  assert.equal(calls[0].headers.Authorization, undefined);
  assert.equal(calls[1].headers.Authorization, "Basic dXNlcjpwYXNz");
  assert.equal(calls[1].headers["X-CSRF-TOKEN"], "csrf-1");
});

test("builds path queries from Forward-resolved endpoint values", () => {
  const result = buildPathQuery(
    dependency({
      sourceResolvedValue: "10.10.10.10",
      destinationResolvedValue: "10.20.20.20/32",
    }),
  );

  assert.deepEqual(result.query, {
    dstIp: "10.20.20.20/32",
    srcIp: "10.10.10.10",
    ipProto: 6,
    dstPort: "443",
  });
});

test("builds path queries from explicit Forward device source filters", () => {
  const result = buildPathQuery(
    dependency({
      source: "edge-a",
      sourceFilterType: "DeviceFilter",
      destinationResolvedValue: "10.20.20.20",
    }),
  );

  assert.deepEqual(result.query, {
    dstIp: "10.20.20.20",
    from: "edge-a",
    ipProto: 6,
    dstPort: "443",
  });
});

test("refuses path queries when names have not been Forward-resolved", () => {
  const result = buildPathQuery(dependency());

  assert.equal(result.query, null);
  assert.match(result.reason, /Destination is not/);
});

test("classifies Forward path search responses into evidence states", () => {
  assert.equal(
    classifyPathSearchResult({
      info: { paths: [{ forwardingOutcome: "DELIVERED", securityOutcome: "PERMITTED" }] },
    }),
    "reachable",
  );
  assert.equal(
    classifyPathSearchResult({
      info: { paths: [{ forwardingOutcome: "DELIVERED", securityOutcome: "DENIED" }] },
    }),
    "blocked",
  );
  assert.equal(classifyPathSearchResult({ info: { paths: [] } }), "blocked");
  assert.equal(classifyPathSearchResult({ timedOut: true }), "ambiguous");
  assert.equal(classifyPathSearchResult({ error: true }), "failed");
  assert.equal(classifyPathSearchResult({ errorMessage: "bad query" }), "failed");
});

test("summarizes causal path outcomes without copying hop-level topology", () => {
  const summary = summarizePathSearchResult({
    srcIpLocationType: "HOST",
    dstIpLocationType: "DNAT",
    queryUrl: "https://forward.example.com/path-search/demo",
    info: {
      paths: [
        {
          forwardingOutcome: "DELIVERED",
          securityOutcome: "PERMITTED",
          hops: [{ deviceName: "leaf-a" }, { deviceName: "firewall-a" }],
        },
        {
          forwardingOutcome: "DELIVERED",
          securityOutcome: "PERMITTED",
          hops: [{ deviceName: "leaf-b" }],
        },
      ],
    },
  });

  assert.deepEqual(summary, {
    queryUrl: "https://forward.example.com/path-search/demo",
    sourceLocationType: "HOST",
    destinationLocationType: "DNAT",
    pathCount: 2,
    forwardingOutcomes: ["DELIVERED"],
    securityOutcomes: ["PERMITTED"],
    maxHopCount: 2,
  });
  assert.equal(JSON.stringify(summary).includes("leaf-a"), false);
});

test("builds a bounded modeled-reachability assessment", () => {
  assert.equal(
    modeledReachabilityAssessment([{ status: "reachable" }, { status: "reachable" }]),
    "no-modeled-policy-block",
  );
  assert.equal(
    modeledReachabilityAssessment([{ status: "reachable" }, { status: "blocked" }]),
    "consistent-with-network-policy-block",
  );
  assert.equal(
    modeledReachabilityAssessment([{ status: "reachable" }, { status: "ambiguous" }]),
    "inconclusive",
  );
});

test("CLI resolves hosts before executing Forward bulk path search", async () => {
  const { server, calls, baseUrl } = await startFakeForward();
  const workdir = await mkdtemp(path.join(tmpdir(), "forward-path-evidence-"));
  const dependenciesPath = path.join(workdir, "dependencies.json");
  const outputPath = path.join(workdir, "path-evidence.json");
  const authorizationPath = path.join(workdir, "forward-readonly-authorization.txt");
  try {
    await writeFile(
      dependenciesPath,
      `${JSON.stringify(
        [dependency(), dependency({ id: "missing-destination", destination: "missing" })],
        null,
        2,
      )}\n`,
    );
    await writeFile(authorizationPath, "Bearer readonly-token\n");

    const evidence = await runJson([
      "scripts/forward-path-evidence.mjs",
      "--dependencies",
      dependenciesPath,
      "--forward-base-url",
      baseUrl,
      "--forward-network-id",
      "network-1",
      "--authorization-file",
      authorizationPath,
      "--resolve-hosts",
      "--execute",
      "--output",
      outputPath,
    ]);

    assert.equal(evidence.status, "partial");
    assert.equal(evidence.target.snapshotId, "snapshot-1");
    assert.equal(evidence.hostResolution.counts.ready, 1);
    assert.equal(evidence.hostResolution.counts.needsMap, 1);
    assert.equal(evidence.counts.reachable, 1);
    assert.equal(evidence.counts.unmapped, 1);
    assert.equal(evidence.modeledReachabilityAssessment, "inconclusive");
    assert.equal(evidence.rows[0].queryUrl, "https://forward.example.com/path-search/demo");
    assert.deepEqual(evidence.rows[0].forwardingOutcomes, ["DELIVERED"]);
    assert.deepEqual(evidence.rows[0].securityOutcomes, ["PERMITTED"]);
    assert.equal(evidence.rows[0].maxHopCount, 0);

    const persisted = JSON.parse(await readFile(outputPath, "utf8"));
    assert.deepEqual(persisted.counts, evidence.counts);

    const pathSearchCall = calls.find(
      (call) => call.method === "POST" && call.path === "/api/networks/network-1/paths-bulk",
    );
    assert.equal(pathSearchCall.searchParams.snapshotId, "snapshot-1");
    assert.equal(pathSearchCall.authorization, "Bearer readonly-token");
    assert.match(pathSearchCall.contentType, /application\/json/);

    const request = JSON.parse(pathSearchCall.body);
    assert.equal(request.queries.length, 1);
    assert.deepEqual(request.queries[0], {
      dstIp: "10.20.20.20/32",
      srcIp: "10.10.10.10",
      ipProto: 6,
      dstPort: "443",
    });
    assert.equal(request.maxReturnPathResults, 0);
    assert.equal(request.maxOverallSeconds, 30);
    assert.ok(calls.every((call) => call.authorization === "Bearer readonly-token"));
  } finally {
    await new Promise((resolve, reject) => {
      server.close((error) => (error ? reject(error) : resolve()));
    });
  }
});
