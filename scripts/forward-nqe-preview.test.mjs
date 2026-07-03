import assert from "node:assert/strict";
import { test } from "node:test";
import { pathToFileURL } from "node:url";

const moduleUrl = pathToFileURL(
  new URL("../api/forward-nqe-preview.function.ts", import.meta.url).pathname,
).href;
const { buildForwardNqePreview } = await import(moduleUrl);

const withEnv = async (env, fn) => {
  const previous = {};
  for (const key of Object.keys(env)) {
    previous[key] = process.env[key];
    if (env[key] === undefined) {
      delete process.env[key];
    } else {
      process.env[key] = env[key];
    }
  }

  try {
    return await fn();
  } finally {
    for (const [key, value] of Object.entries(previous)) {
      if (value === undefined) {
        delete process.env[key];
      } else {
        process.env[key] = value;
      }
    }
  }
};

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

test("plans read-only NQE request without runtime credentials", async () => {
  const result = await withEnv(
    {
      FORWARD_NQE_READONLY_AUTHORIZATION: undefined,
      FORWARD_READONLY_AUTHORIZATION: undefined,
      FORWARD_NQE_ALLOWED_QUERY_IDS: undefined,
    },
    () => buildForwardNqePreview(baseRequest, async () => {
      throw new Error("fetch should not be called in plan mode");
    }),
  );

  assert.equal(result.status, "planned");
  assert.equal(result.requestPreview.method, "POST");
  assert.equal(result.requestPreview.path, "/api/nqe?networkId=network-1");
  assert.equal(result.requestPreview.body.query.includes("network.devices"), true);
  assert.equal(JSON.stringify(result.evidence).includes("checkout-api"), true);
});

test("blocks execution when read-only runtime authorization is absent", async () => {
  const result = await withEnv(
    {
      FORWARD_NQE_READONLY_AUTHORIZATION: undefined,
      FORWARD_READONLY_AUTHORIZATION: undefined,
      FORWARD_NQE_ALLOWED_QUERY_IDS: undefined,
    },
    () => buildForwardNqePreview(
      {
        ...baseRequest,
        execute: true,
      },
      async () => {
        throw new Error("fetch should not be called without authorization");
      },
    ),
  );

  assert.equal(result.status, "blocked");
  assert.match(result.summary, /read-only Forward authorization header/);
});

test("rejects query IDs that are not allowlisted", async () => {
  const queryId = "FQ_aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa";
  const result = await withEnv(
    {
      FORWARD_NQE_ALLOWED_QUERY_IDS: "FQ_bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb",
    },
    () => buildForwardNqePreview({
      ...baseRequest,
      templateId: "approved-endpoint-resolution",
      queryId,
    }),
  );

  assert.equal(result.status, "blocked");
  assert.match(result.summary, /not in the runtime allowlist/);
});

test("executes only POST /api/nqe and returns sanitized aggregate evidence", async () => {
  const queryId = "FQ_aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa";
  const calls = [];

  const result = await withEnv(
    {
      FORWARD_NQE_READONLY_AUTHORIZATION: "Basic read-only-demo",
      FORWARD_NQE_ALLOWED_QUERY_IDS: queryId,
    },
    () => buildForwardNqePreview(
      {
        ...baseRequest,
        templateId: "approved-endpoint-resolution",
        queryId,
        snapshotId: "snapshot-1",
        execute: true,
      },
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
          {
            status: 200,
            headers: { "Content-Type": "application/json" },
          },
        );
      },
    ),
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
