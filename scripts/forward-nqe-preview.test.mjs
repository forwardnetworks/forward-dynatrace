import assert from "node:assert/strict";
import { test } from "node:test";
import { pathToFileURL } from "node:url";

import { executeForwardNqePreview } from "./forward-nqe-executor.mjs";

const moduleUrl = pathToFileURL(
  new URL("../api/forward-nqe-preview.function.ts", import.meta.url).pathname,
).href;
const { buildForwardNqePreview, default: forwardNqePreviewAppFunction } =
  await import(moduleUrl);

const queryId = "FQ_aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa";
const baseRequest = {
  forwardAccessProfile: "network-operator",
  forwardBaseUrl: "https://forward.example.com",
  forwardNetworkId: "network-1",
  dependency: {
    appName: "Checkout",
    environment: "prod",
    serviceEntityId: "SERVICE-123",
    serviceName: "checkout-api",
    source: "checkout-vip",
    destination: "orders-db",
    protocol: "tcp",
    port: "443",
    owner: "commerce",
  },
};

const execute = async (request, fetchImpl, allowedQueryIds = []) => {
  const planned = await buildForwardNqePreview(request);
  return executeForwardNqePreview({
    request,
    planned,
    authorization: "Basic read-only-test",
    allowedQueryIds,
    fetchImpl,
  });
};

test("plans a credential-free Network Operator arbitrary NQE request", async () => {
  const result = await buildForwardNqePreview(baseRequest);

  assert.equal(result.status, "planned");
  assert.equal(result.requestPreview.method, "POST");
  assert.equal(result.requestPreview.path, "/api/nqe?networkId=network-1");
  assert.equal(result.requestPreview.body.query.includes("network.devices"), true);
  assert.equal(JSON.stringify(result.evidence).includes("checkout-api"), true);
});

test("Read Only requires an approved Forward Library query ID", async () => {
  const blocked = await buildForwardNqePreview({
    ...baseRequest,
    forwardAccessProfile: "read-only",
  });
  assert.equal(blocked.status, "blocked");
  assert.match(blocked.summary, /Forward Library NQE query ID/);

  const planned = await buildForwardNqePreview({
    ...baseRequest,
    forwardAccessProfile: "read-only",
    templateId: "approved-library-query",
    queryId,
  });
  assert.equal(planned.status, "planned");
});

test("preview function routes execute mode to the bundled NQE action", async () => {
  const result = await forwardNqePreviewAppFunction({
    ...baseRequest,
    execute: true,
  });

  assert.equal(result.status, "blocked");
  assert.match(result.summary, /bundled Dynatrace NQE Workflow action/);
  assert.equal(result.evidence.find((item) => item.label === "Mode")?.value, "plan");
});

test("plans before Forward target metadata is supplied", async () => {
  const result = await buildForwardNqePreview({
    forwardAccessProfile: "network-operator",
    dependency: baseRequest.dependency,
    templateId: "endpoint-inventory-smoke",
  });

  assert.equal(result.status, "planned");
  assert.equal(result.requestPreview.path, "/api/nqe");
  assert.match(result.summary, /Add Forward URL metadata and a network ID/);
});

test("rejects malformed Forward query IDs during planning", async () => {
  const result = await buildForwardNqePreview({
    ...baseRequest,
    templateId: "approved-library-query",
    queryId: "not-a-forward-query-id",
  });

  assert.equal(result.status, "blocked");
  assert.match(result.summary, /FQ_<40 hex chars>/);
});

test("app-backend executor requires target metadata", async () => {
  const request = { forwardAccessProfile: "network-operator", templateId: "endpoint-inventory-smoke" };
  const planned = await buildForwardNqePreview(request);

  await assert.rejects(
    executeForwardNqePreview({
      request,
      planned,
      authorization: "Basic read-only-test",
    }),
    /Forward URL metadata and a network ID/,
  );
});

test("app-backend executor requires explicit authorization", async () => {
  const planned = await buildForwardNqePreview(baseRequest);

  await assert.rejects(
    executeForwardNqePreview({ request: baseRequest, planned }),
    /valid Forward Authorization value/,
  );
});

test("app-backend executor rejects query IDs outside its allowlist", async () => {
  const request = {
    ...baseRequest,
    templateId: "approved-library-query",
    queryId,
  };
  const planned = await buildForwardNqePreview(request);

  await assert.rejects(
    executeForwardNqePreview({
      request,
      planned,
      authorization: "Basic read-only-test",
      allowedQueryIds: [],
    }),
    /not in the approved Library-query allowlist/,
  );
});

test("app-backend executor calls only POST /api/nqe and sanitizes results", async () => {
  const calls = [];
  const request = {
    ...baseRequest,
    templateId: "approved-library-query",
    queryId,
    snapshotId: "snapshot-1",
  };
  const result = await execute(
    request,
    async (url, init) => {
      calls.push({ url, init });
      return new Response(
        JSON.stringify({
          snapshotId: "snapshot-1",
          totalNumItems: 2,
          items: [
            { Status: "mapped", Confidence: 95, Device: "leaf-1" },
            { Status: "mapped", Confidence: 90, Device: "leaf-2" },
          ],
        }),
        { status: 200, headers: { "Content-Type": "application/json" } },
      );
    },
    [queryId],
  );

  assert.equal(calls.length, 1);
  assert.equal(
    calls[0].url,
    "https://forward.example.com/api/nqe?networkId=network-1&snapshotId=snapshot-1",
  );
  assert.equal(calls[0].init.method, "POST");
  assert.equal(calls[0].init.headers.Authorization, "Basic read-only-test");
  assert.equal(result.status, "ready");
  assert.equal(result.result.totalRows, 2);
  assert.equal(result.result.returnedRows, 2);
  assert.deepEqual(result.result.columns, ["Status", "Confidence", "Device"]);
  assert.equal(result.result.sampleRows, undefined);
});

test("app-backend executor treats Library query rows as policy evidence, not host resolution", async () => {
  const request = {
    ...baseRequest,
    templateId: "approved-library-query",
    queryId,
  };
  const result = await execute(
    request,
    async () => new Response(
      JSON.stringify({
        totalNumItems: 2,
        items: [
          { policy: "approved", violations: 0 },
          { policy: "review", violations: 1 },
        ],
      }),
      { status: 200, headers: { "Content-Type": "application/json" } },
    ),
    [queryId],
  );

  assert.equal(result.status, "ready");
  assert.equal(result.result.totalRows, 2);
  assert.deepEqual(result.result.columns, ["policy", "violations"]);
  assert.equal(result.endpointResolution, undefined);
  assert.match(result.nextSteps[0], /customer-owned NQE policy/);
});

test("app-backend executor rejects non-TLS remote origins", async () => {
  const request = {
    ...baseRequest,
    forwardBaseUrl: "http://forward.example.com",
  };
  const planned = await buildForwardNqePreview(request);

  await assert.rejects(
    executeForwardNqePreview({
      request,
      planned,
      authorization: "Basic read-only-test",
    }),
    /must use HTTPS/,
  );
});
