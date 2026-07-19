import assert from "node:assert/strict";
import test from "node:test";

import { createRunForwardNqeAction } from "../actions/run-forward-nqe-evidence.logic.mjs";

const approvedQueryId = "FQ_aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa";

const connection = (profile, approvedLibraryQueryIds = "") => ({
  schemaId: "forward-api-connection",
  value: {
    name: `${profile}-connection`,
    baseUrl: "https://forward.example.com/api",
    networkId: "network-1",
    username: "service-user",
    password: "service-password",
    forwardAccessProfile: profile,
    approvedLibraryQueryIds,
  },
});

const response = (value, status = 200) => new Response(
  JSON.stringify(value),
  { status, headers: { "content-type": "application/json" } },
);

const harness = (profile, approvedLibraryQueryIds = "", resultSnapshotId = "snapshot-1") => {
  const calls = [];
  const action = createRunForwardNqeAction({
    loadConnection: async (connectionId) => {
      assert.equal(connectionId, "connection-1");
      return connection(profile, approvedLibraryQueryIds);
    },
    fetchImpl: async (url, options) => {
      calls.push({ url, options });
      if (url.endsWith("/api/public/csrf")) {
        assert.equal(options.headers.Authorization, undefined);
        return response({ headerName: "X-CSRF-TOKEN", token: "csrf-token" });
      }
      if (url.endsWith("/api/networks/network-1/snapshots/latestProcessed")) {
        return response({ id: "snapshot-1", state: "PROCESSED" });
      }
      if (url.endsWith("/api/nqe?networkId=network-1&snapshotId=snapshot-1")) {
        return response({
          snapshotId: resultSnapshotId,
          totalNumItems: 2,
          items: [
            { result: "pass", Device: "leaf-1" },
            { result: "review", Device: "leaf-2" },
          ],
        });
      }
      throw new Error(`Unexpected request ${options.method} ${url}`);
    },
  });
  return { action, calls };
};

test("Read Only executes an allowlisted Library NQE through the app backend", async () => {
  const { action, calls } = harness("read-only", `${approvedQueryId}\n${approvedQueryId}`);
  const result = await action({
    connectionId: "connection-1",
    request: {
      forwardAccessProfile: "read-only",
      templateId: "approved-library-query",
      queryId: approvedQueryId,
      parameters: { environment: "nonproduction" },
      maxRows: 25,
    },
  });

  assert.equal(result.status, "ready");
  assert.equal(result.forwardAccessProfile, "read-only");
  assert.deepEqual(result.target, { networkId: "network-1", snapshotId: "snapshot-1" });
  assert.equal(result.query.kind, "library");
  assert.equal(result.query.queryId, approvedQueryId);
  assert.equal(result.result.totalRows, 2);
  assert.deepEqual(result.result.columns, ["result", "Device"]);
  assert.equal(JSON.stringify(result).includes("leaf-1"), false);
  assert.equal(JSON.stringify(result).includes("service-password"), false);
  const nqeCall = calls.find((call) => call.url.includes("/api/nqe?"));
  assert.equal(nqeCall.options.method, "POST");
  assert.equal(nqeCall.options.headers.Authorization.startsWith("Basic "), true);
  assert.equal(nqeCall.options.headers["X-CSRF-TOKEN"], "csrf-token");
});

test("Read Only rejects arbitrary or non-allowlisted NQE", async () => {
  const { action } = harness("read-only", approvedQueryId);
  await assert.rejects(
    action({
      connectionId: "connection-1",
      request: { forwardAccessProfile: "read-only", query: "foreach device in network.devices select device.name" },
    }),
    /requires a query ID from the connection allowlist/,
  );
  await assert.rejects(
    action({
      connectionId: "connection-1",
      request: {
        forwardAccessProfile: "read-only",
        templateId: "approved-library-query",
        queryId: "FQ_bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb",
      },
    }),
    /requires a query ID from the connection allowlist/,
  );
});

test("Network Operator executes reviewed arbitrary NQE and returns no query text or rows", async () => {
  const { action, calls } = harness("network-operator");
  const query = "foreach device in network.devices select { Device: device.name }";
  const result = await action({
    connectionId: "connection-1",
    request: {
      forwardAccessProfile: "network-operator",
      templateId: "endpoint-inventory-smoke",
      query,
      maxRows: 10,
    },
  });

  assert.equal(result.query.kind, "arbitrary");
  assert.equal(result.query.queryId, undefined);
  assert.equal(JSON.stringify(result).includes(query), false);
  assert.equal(JSON.stringify(result).includes("leaf-2"), false);
  const body = JSON.parse(calls.find((call) => call.url.includes("/api/nqe?")).options.body);
  assert.equal(body.query, query);
  assert.equal(body.queryOptions.limit, 10);
});

test("NQE action fails closed on profile mismatch and credential-like parameters", async () => {
  const { action } = harness("network-operator");
  await assert.rejects(
    action({
      connectionId: "connection-1",
      request: { forwardAccessProfile: "read-only", queryId: approvedQueryId },
    }),
    /profiles must match exactly/,
  );
  await assert.rejects(
    action({
      connectionId: "connection-1",
      request: {
        forwardAccessProfile: "network-operator",
        query: "foreach device in network.devices select device.name",
        parameters: { nested: { apiToken: "forbidden" } },
      },
    }),
    /credential-like keys/,
  );
});

test("NQE action rejects a response bound to another snapshot", async () => {
  const { action } = harness("network-operator", "", "snapshot-2");
  await assert.rejects(
    action({
      connectionId: "connection-1",
      request: {
        forwardAccessProfile: "network-operator",
        query: "foreach device in network.devices select device.name",
      },
    }),
    /snapshot does not match/,
  );
});
