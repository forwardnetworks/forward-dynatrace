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
    authorization: "Basic read-only-demo",
    allowedQueryIds,
    fetchImpl,
  });
};

test("plans a credential-free read-only NQE request", async () => {
  const result = await buildForwardNqePreview(baseRequest);

  assert.equal(result.status, "planned");
  assert.equal(result.requestPreview.method, "POST");
  assert.equal(result.requestPreview.path, "/api/nqe?networkId=network-1");
  assert.equal(result.requestPreview.body.query.includes("network.devices"), true);
  assert.equal(JSON.stringify(result.evidence).includes("checkout-api"), true);
});

test("Dynatrace app function blocks execute mode", async () => {
  const result = await forwardNqePreviewAppFunction({
    ...baseRequest,
    execute: true,
  });

  assert.equal(result.status, "blocked");
  assert.match(result.summary, /Dynatrace app function is plan-only/);
  assert.equal(result.evidence.find((item) => item.label === "Mode")?.value, "plan");
});

test("plans before Forward target metadata is supplied", async () => {
  const result = await buildForwardNqePreview({
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
    templateId: "approved-endpoint-resolution",
    queryId: "not-a-forward-query-id",
  });

  assert.equal(result.status, "blocked");
  assert.match(result.summary, /FQ_<40 hex chars>/);
});

test("Forward-side executor requires target metadata", async () => {
  const request = { templateId: "endpoint-inventory-smoke" };
  const planned = await buildForwardNqePreview(request);

  await assert.rejects(
    executeForwardNqePreview({
      request,
      planned,
      authorization: "Basic read-only-demo",
    }),
    /Forward URL metadata and a network ID/,
  );
});

test("Forward-side executor requires explicit authorization", async () => {
  const planned = await buildForwardNqePreview(baseRequest);

  await assert.rejects(
    executeForwardNqePreview({ request: baseRequest, planned }),
    /valid read-only Authorization value/,
  );
});

test("Forward-side executor rejects query IDs outside its allowlist", async () => {
  const request = {
    ...baseRequest,
    templateId: "approved-endpoint-resolution",
    queryId,
  };
  const planned = await buildForwardNqePreview(request);

  await assert.rejects(
    executeForwardNqePreview({
      request,
      planned,
      authorization: "Basic read-only-demo",
      allowedQueryIds: [],
    }),
    /not in the Forward-side runtime allowlist/,
  );
});

test("Forward-side executor calls only POST /api/nqe and sanitizes results", async () => {
  const calls = [];
  const request = {
    ...baseRequest,
    templateId: "approved-endpoint-resolution",
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
  assert.equal(calls[0].init.headers.Authorization, "Basic read-only-demo");
  assert.equal(result.status, "ready");
  assert.equal(result.result.totalRows, 2);
  assert.equal(result.result.returnedRows, 2);
  assert.deepEqual(result.result.columns, ["Status", "Confidence", "Device"]);
  assert.equal(result.result.sampleRows, undefined);
});

test("Forward-side executor marks unresolved endpoints needs-map", async () => {
  const request = {
    ...baseRequest,
    templateId: "approved-endpoint-resolution",
    queryId,
  };
  const result = await execute(
    request,
    async () => new Response(
      JSON.stringify({
        totalNumItems: 2,
        items: [
          { endpointRole: "source", endpoint: "checkout-vip", matchCount: 1 },
          { endpointRole: "destination", endpoint: "orders-db", matchCount: 0 },
        ],
      }),
      { status: 200, headers: { "Content-Type": "application/json" } },
    ),
    [queryId],
  );

  assert.equal(result.status, "ready");
  assert.equal(result.endpointResolution.mappingState, "needs-map");
  assert.equal(result.endpointResolution.source.status, "resolved");
  assert.equal(result.endpointResolution.destination.status, "unresolved");
  assert.match(result.summary, /could not resolve/);
});

test("Forward-side executor marks ambiguous endpoint matches review", async () => {
  const request = {
    ...baseRequest,
    templateId: "approved-endpoint-resolution",
    queryId,
  };
  const result = await execute(
    request,
    async () => new Response(
      JSON.stringify({
        totalNumItems: 1,
        items: [{ sourceMatchCount: 2, destinationMatchCount: 1 }],
      }),
      { status: 200, headers: { "Content-Type": "application/json" } },
    ),
    [queryId],
  );

  assert.equal(result.endpointResolution.mappingState, "review");
  assert.equal(result.endpointResolution.source.status, "ambiguous");
  assert.equal(result.endpointResolution.destination.status, "resolved");
});

test("Forward-side executor rejects non-TLS remote origins", async () => {
  const request = {
    ...baseRequest,
    forwardBaseUrl: "http://forward.example.com",
  };
  const planned = await buildForwardNqePreview(request);

  await assert.rejects(
    executeForwardNqePreview({
      request,
      planned,
      authorization: "Basic read-only-demo",
    }),
    /must use HTTPS/,
  );
});
