import assert from "node:assert/strict";
import test from "node:test";
import { createHash } from "node:crypto";

import { createRunForwardNqeAction } from "../actions/run-forward-nqe-evidence.logic.ts";

const approvedQueryId = "FQ_aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa";
const normalizeQuery = (value) => value.trim().replace(/\s+/gu, " ");
const digestQuery = (query) => createHash("sha256").update(normalizeQuery(query)).digest("hex");

const connection = (profile, approvedLibraryQueryIds = "", approvedQueryDigests = "") => ({
  schemaId: "forward-api-connection",
  value: {
    name: `${profile}-connection`,
    baseUrl: "https://forward.example.com/api",
    networkId: "network-1",
    credentialVaultId: "CREDENTIALS_VAULT-0000000000000001",
    forwardAccessProfile: profile,
    approvedLibraryQueryIds,
    approvedQueryDigests,
  },
});

const vaultCredential = () => ({
  id: "CREDENTIALS_VAULT-0000000000000001",
  type: "USERNAME_PASSWORD",
  username: "service-user",
  password: "service-password",
});

const response = (value, status = 200, headers = {}) => new Response(
  JSON.stringify(value),
  {
    status,
    headers: { "content-type": "application/json", ...headers },
  },
);
const errorResponse = (status) => new Response("", { status });

const harness = (
  profile,
  approvedLibraryQueryIds = "",
  approvedQueryDigests = "",
  harnessOptions = {},
) => {
  const options = typeof harnessOptions === "string"
    ? { resultSnapshotId: harnessOptions }
    : harnessOptions;
  const {
    fetchMock,
    resultSnapshotId,
    resultCreatedAt = "2026-07-18T12:00:00Z",
    latestSnapshot = { id: "snapshot-1", state: "PROCESSED", createdAt: "2026-07-18T12:00:00Z" },
    snapshotRecords = {},
    forwardClientOptions = {},
  } = options || {};

  const calls = [];
  const state = {
    nqeStatusCalls: 0,
    nqeSubmitCalls: 0,
    asyncResultCalls: 0,
  };

  const action = createRunForwardNqeAction({
    loadConnection: async (connectionId) => {
      assert.equal(connectionId, "connection-1");
      return connection(profile, approvedLibraryQueryIds, approvedQueryDigests);
    },
    loadCredential: async (credentialVaultId) => {
      assert.equal(credentialVaultId, "CREDENTIALS_VAULT-0000000000000001");
      return vaultCredential();
    },
    forwardClientOptions,
    fetchImpl: async (url, fetchOptions) => {
      calls.push({ url, options: fetchOptions });

      if (typeof fetchMock === "function") {
        const override = await fetchMock({ url, options: fetchOptions, calls, state });
        if (override !== undefined) {
          return override;
        }
      }

      if (url.endsWith("/api/public/csrf")) {
        assert.equal(fetchOptions.headers.Authorization, undefined);
        return response({ headerName: "X-CSRF-TOKEN", token: "csrf-token" });
      }
      if (url.endsWith("/api/networks/network-1/snapshots/latestProcessed")) {
        return response(latestSnapshot);
      }
      if (url.includes("/api/networks/network-1/nqe-executions")) {
        if (fetchOptions.method === "POST") {
          state.nqeSubmitCalls += 1;
          return response({ executionKey: "X_execution01" });
        }
        state.nqeStatusCalls += 1;
        if (url.includes("/result")) {
          state.asyncResultCalls += 1;
          const snapshot = resultSnapshotId !== undefined ? resultSnapshotId : "snapshot-1";
          return response({
            snapshotId: snapshot,
            createdAt: resultCreatedAt,
            totalNumItems: 2,
            items: [
              { result: "pass", Device: "leaf-1" },
              { result: "review", Device: "leaf-2" },
            ],
          });
        }
        if (state.nqeStatusCalls === 1) return response({ status: "SUBMITTED" });
        if (state.nqeStatusCalls === 2) return response({ status: "EXECUTING" });
        return response({ status: "COMPLETED", outcome: "OK", timeoutMinutes: 10 });
      }
      if (url.includes("/api/nqe?")) {
        const snapshotId = new URL(url).searchParams.get("snapshotId");
        const effectiveSnapshotId = resultSnapshotId !== undefined
          ? resultSnapshotId
          : (snapshotId || "snapshot-1");
        return response({
          snapshotId: effectiveSnapshotId,
          createdAt: resultCreatedAt,
          totalNumItems: 2,
          items: [
            { result: "pass", Device: "leaf-1" },
            { result: "review", Device: "leaf-2" },
          ],
        });
      }
      if (url.endsWith("/api/networks/network-1/snapshots")) {
        return response({ snapshots: Object.values(snapshotRecords) });
      }
      throw new Error(`Unexpected request ${fetchOptions.method} ${url}`);
    },
  });
  return { action, calls, state };
};

test("Read Only executes an allowlisted Library NQE through async network-scoped API", async () => {
  const { action, calls, state } = harness("read-only", `${approvedQueryId}\n${approvedQueryId}`);
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

  assert.equal(state.nqeSubmitCalls, 1);
  assert.equal(result.status, "ready");
  assert.equal(result.forwardAccessProfile, "read-only");
  assert.deepEqual(result.target, { networkId: "network-1", snapshotId: "snapshot-1" });
  assert.equal(result.query.kind, "library");
  assert.equal(result.query.queryId, approvedQueryId);
  assert.equal(result.result.totalRows, 2);
  assert.deepEqual(result.result.columns, ["result", "Device"]);
  assert.equal(JSON.stringify(result).includes("leaf-1"), false);
  assert.equal(JSON.stringify(result).includes("service-password"), false);
  const nqeCall = calls.find((call) => call.url.includes("/api/networks/network-1/nqe-executions?"));
  assert.equal(!!nqeCall, true);
  assert.equal(nqeCall.options.method, "POST");
  assert.equal(nqeCall.options.headers.Authorization.startsWith("Basic "), true);
  assert.equal(nqeCall.options.headers["X-CSRF-TOKEN"], "csrf-token");
  const statusCall = calls.find((call) =>
    call.url.includes("/api/networks/network-1/nqe-executions/X_execution01") &&
    !call.url.includes("/result")
  );
  assert.equal(statusCall.options.method, "GET");
  const resultCall = calls.find((call) => call.url.includes("/api/networks/network-1/nqe-executions/X_execution01/result"));
  assert.equal(resultCall.options.method, "GET");
});

test("Read Only rejects arbitrary or non-allowlisted NQE", async () => {
  const { action } = harness("read-only", approvedQueryId);
  await assert.rejects(
    action({
      connectionId: "connection-1",
      request: { forwardAccessProfile: "read-only", query: "foreach device in network.devices select device.name" },
    }),
    /approvedQueryDigest is required for arbitrary NQE/,
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

test("Network Operator requires an approved query digest for arbitrary NQE and returns no query text or rows", async () => {
  const query = "foreach device in network.devices select { Device: device.name }";
  const digest = digestQuery(query);
  const { action, calls } = harness("network-operator", "", digest);
  const result = await action({
    connectionId: "connection-1",
    request: {
      forwardAccessProfile: "network-operator",
      templateId: "endpoint-inventory-smoke",
      query,
      approvedQueryDigest: digest,
      maxRows: 10,
    },
  });

  assert.equal(result.query.kind, "arbitrary");
  assert.equal(result.query.queryId, undefined);
  assert.equal(JSON.stringify(result).includes(query), false);
  assert.equal(JSON.stringify(result).includes("leaf-2"), false);
  const body = JSON.parse(calls.find((call) => call.url.includes("/api/networks/network-1/nqe-executions?")).options.body);
  assert.equal(body.query, query);
  assert.equal(body.queryOptions, undefined);
  assert.equal(body.limit, undefined);
  assert.equal(body.offset, undefined);
  assert.equal(body.queryOptions, undefined);
});

test("Network Operator arbitrary NQE is rejected when digest is missing or not allowlisted", async () => {
  const query = "foreach device in network.devices select { Device: device.name }";
  const digest = digestQuery(query);

  const { action } = harness("network-operator");
  await assert.rejects(
    action({
      connectionId: "connection-1",
      request: {
        forwardAccessProfile: "network-operator",
        query,
      },
    }),
    /approvedQueryDigest is required for arbitrary NQE/,
  );

  const denylist = harness("network-operator", "", "");
  await assert.rejects(
    denylist.action({
      connectionId: "connection-1",
      request: {
        forwardAccessProfile: "network-operator",
        query,
        approvedQueryDigest: digest,
      },
    }),
    /Arbitrary NQE execution requires a matching approved query digest from the connection allowlist/,
  );

  const normalized = "  foreach   device in   network.devices   select {   Device: device.name   }  ";
  const normalizedDigest = digestQuery(normalized);
  const allowlisted = harness("network-operator", "", `${normalizedDigest}`);
  await assert.rejects(
    allowlisted.action({
      connectionId: "connection-1",
      request: {
        forwardAccessProfile: "network-operator",
        query,
        approvedQueryDigest: digestQuery("SELECT something else"),
      },
    }),
    /approvedQueryDigest does not match the normalized query text/,
  );
  const result = await allowlisted.action({
    connectionId: "connection-1",
    request: {
      forwardAccessProfile: "network-operator",
      query: normalized,
      approvedQueryDigest: normalizedDigest,
    },
  });
  assert.equal(result.query.kind, "arbitrary");
  assert.equal(result.forwardAccessProfile, "network-operator");
});

test("Network Operator arbitrary NQE requires a processed, fresh caller-supplied snapshot", async () => {
  const query = "foreach device in network.devices select device.name";
  const digest = digestQuery(query);

  const stale = harness("network-operator", "", digest, {
    snapshotRecords: {
      "snapshot-stale": {
          id: "snapshot-stale",
          state: "PROCESSED",
          createdAt: "2026-07-01T00:00:00Z",
      },
    },
  });
  await assert.rejects(
    stale.action({
      connectionId: "connection-1",
      request: {
        forwardAccessProfile: "network-operator",
        query,
        snapshotId: "snapshot-stale",
        approvedQueryDigest: digest,
      },
    }),
    /Forward snapshot is older than the configured freshness window/,
  );

  const fresh = harness("network-operator", "", digest, {
    resultSnapshotId: "snapshot-fresh",
    snapshotRecords: {
      "snapshot-fresh": {
          id: "snapshot-fresh",
          state: "PROCESSED",
          createdAt: "2026-07-17T12:00:00Z",
      },
    },
  });
  const freshResult = await fresh.action({
    connectionId: "connection-1",
    request: {
      forwardAccessProfile: "network-operator",
      query,
      snapshotId: "snapshot-fresh",
      approvedQueryDigest: digest,
    },
  });
  assert.equal(freshResult.target.snapshotId, "snapshot-fresh");
  assert.equal(
    fresh.calls.some((call) => call.url.endsWith("/api/networks/network-1/snapshots")),
    true,
  );
  assert.equal(
    fresh.calls.some((call) => call.url.includes("/api/snapshots/snapshot-fresh")),
    false,
  );
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
  const { action } = harness("read-only", approvedQueryId, "", {
    resultSnapshotId: "snapshot-different",
    latestSnapshot: { id: "snapshot-1", state: "PROCESSED", createdAt: "2026-07-18T12:00:00Z" },
  });
  await assert.rejects(
    action({
      connectionId: "connection-1",
      request: {
        forwardAccessProfile: "read-only",
        queryId: approvedQueryId,
      },
    }),
    /response snapshot does not match the requested snapshot/,
  );
});

test("resume flow skips submit and still returns result rows", async () => {
  const { action, state, calls } = harness("network-operator", approvedQueryId, "", {
    resultSnapshotId: "snapshot-resumed",
  });
  const result = await action({
    connectionId: "connection-1",
    request: {
      forwardAccessProfile: "network-operator",
      executionKey: "X_execution01",
      maxRows: 2,
    },
  });
  assert.equal(state.nqeSubmitCalls, 0);
  assert.equal(result.target.snapshotId, "snapshot-resumed");
  assert.equal(result.result.totalRows, 2);
  assert.equal(result.query.kind, "resumed");
  assert.equal(result.execution.resumed, true);
  assert.equal(result.execution.executionKey, "X_execution01");
  const statusCall = calls.find((call) =>
    call.url.includes("/api/networks/network-1/nqe-executions/X_execution01") &&
    !call.url.includes("/result")
  );
  const resultCall = calls.find((call) =>
    call.url.includes("/api/networks/network-1/nqe-executions/X_execution01/result")
  );
  assert.equal(statusCall.options.method, "GET");
  assert.equal(resultCall.options.method, "GET");
});

test("resume does not require approvedQueryDigest and still enforces limit", async () => {
  const { action, calls } = harness("network-operator", "", "", {
    fetchMock: ({ url, options: _options }) => {
      if (url.includes("/api/networks/network-1/nqe-executions/X_execution01/result")) {
        return response({
          snapshotId: "snapshot-1",
          totalNumItems: 1,
          items: [{ result: "pass" }],
        });
      }
      return undefined;
    },
  });
  const result = await action({
    connectionId: "connection-1",
    request: {
      forwardAccessProfile: "network-operator",
      executionKey: "X_execution01",
      maxRows: 1,
    },
  });
  assert.equal(result.result.returnedRows, 1);
  const resultCall = calls.find((call) =>
    call.url.includes("/api/networks/network-1/nqe-executions/X_execution01/result")
  );
  const params = new URL(resultCall.url).searchParams;
  assert.equal(params.get("offset"), "0");
  assert.equal(params.get("limit"), "1");
});

test("resume rejects executionKey combined with query / queryId / commitId / executeSync", async () => {
  const digest = digestQuery("foreach device in network.devices select device.name");
  const { action } = harness("network-operator", approvedQueryId, digest);
  for (const request of [
    { query: "foreach device in network.devices select device.name", approvedQueryDigest: digest },
    { queryId: approvedQueryId },
    { commitId: "commit-1", query: "ignored" },
    { executeSync: true },
  ]) {
    await assert.rejects(
      action({
        connectionId: "connection-1",
        request: {
          forwardAccessProfile: "network-operator",
          executionKey: "X_execution01",
          ...request,
        },
      }),
      /executionKey is mutually exclusive/,
    );
  }
});

test("resume with an expired executionKey returns a 404 message", async () => {
  const { action } = harness("read-only", approvedQueryId, "", {
    fetchMock: ({ url }) => {
      if (
        url.includes("/api/networks/network-1/nqe-executions/") &&
        !url.includes("/result")
      ) {
        return errorResponse(404);
      }
      return undefined;
    },
  });
  await assert.rejects(
    action({
      connectionId: "connection-1",
      request: {
        forwardAccessProfile: "read-only",
        executionKey: "X_executionexpired01",
      },
    }),
    /executionKey X_executionexpired01 is unknown, expired/,
  );
});

test("resume enforces snapshot binding only when snapshotId is supplied", async () => {
  const { action: mismatchedAction } = harness("read-only", approvedQueryId, "", {
    resultSnapshotId: "snapshot-different",
    snapshotRecords: {
      "snapshot-requested": {
        id: "snapshot-requested",
        state: "PROCESSED",
        createdAt: "2026-07-17T12:00:00Z",
      },
    },
  });
  await assert.rejects(
    mismatchedAction({
      connectionId: "connection-1",
      request: {
        forwardAccessProfile: "read-only",
        snapshotId: "snapshot-requested",
        executionKey: "X_execution01",
      },
    }),
    /response snapshot does not match the requested snapshot/,
  );

  const { action: unconstrainedAction } = harness("read-only", approvedQueryId, "", {
    resultSnapshotId: "snapshot-different",
    snapshotRecords: {
      "snapshot-requested": {
        id: "snapshot-requested",
        state: "PROCESSED",
        createdAt: "2026-07-17T12:00:00Z",
      },
    },
    latestSnapshot: {
      id: "snapshot-1",
      state: "PROCESSED",
      createdAt: "2026-07-18T12:00:00Z",
    },
  });
  const unconstrained = await unconstrainedAction({
    connectionId: "connection-1",
    request: {
      forwardAccessProfile: "read-only",
      executionKey: "X_execution01",
    },
  });
  assert.equal(unconstrained.target.snapshotId, "snapshot-different");
});

test("deadline exhaustion during resumed polling still includes executionKey", async () => {
  const { action } = harness("read-only", approvedQueryId, "", {
    forwardClientOptions: {
      invocationTimeoutMs: 500,
      maxRetries: 0,
    },
  });
  let error;
  try {
    await action({
      connectionId: "connection-1",
      request: {
        forwardAccessProfile: "read-only",
        executionKey: "X_execution01",
      },
    });
    assert.fail("deadline exhaustion did not reject the action");
  } catch (actual) {
    error = actual;
  }
  assert.match(String(error), /executionKey/);
  assert.equal(String(error).includes("X_execution01"), true);
  assert.equal(String(error).includes("continues server-side"), true);
});

test("profile mismatch is still rejected on resume", async () => {
  const { action } = harness("network-operator");
  await assert.rejects(
    action({
      connectionId: "connection-1",
      request: {
        forwardAccessProfile: "read-only",
        executionKey: "X_execution01",
      },
    }),
    /profiles must match exactly/,
  );
});

test("submit is never retried on 429", async () => {
  let submissionAttempts = 0;
  const { action } = harness("read-only", approvedQueryId, "", {
    fetchMock: ({ url, options }) => {
      if (url.includes("/api/networks/network-1/nqe-executions?") && options.method === "POST") {
        submissionAttempts += 1;
        return errorResponse(429);
      }
      return undefined;
    },
  });
  await assert.rejects(
    action({
      connectionId: "connection-1",
      request: { forwardAccessProfile: "read-only", queryId: approvedQueryId },
    }),
  );
  assert.equal(submissionAttempts, 1);
});

test("submit is never retried on 503", async () => {
  let submissionAttempts = 0;
  const { action } = harness("read-only", approvedQueryId, "", {
    fetchMock: ({ url, options }) => {
      if (url.includes("/api/networks/network-1/nqe-executions?") && options.method === "POST") {
        submissionAttempts += 1;
        return errorResponse(503);
      }
      return undefined;
    },
  });
  await assert.rejects(
    action({
      connectionId: "connection-1",
      request: { forwardAccessProfile: "read-only", queryId: approvedQueryId },
    }),
  );
  assert.equal(submissionAttempts, 1);
});

test("status polling retries on transient while eventually completing", async () => {
  let statusAttempts = 0;
  const { action, state } = harness("read-only", approvedQueryId, "", {
    fetchMock: ({ url, options, state }) => {
      if (
        url.includes("/api/networks/network-1/nqe-executions/X_execution01") &&
        options.method === "GET" &&
        !url.includes("/result")
      ) {
        statusAttempts += 1;
        if (statusAttempts === 1) {
          return errorResponse(503);
        }
        if (state.nqeStatusCalls === 1) {
          return response({ status: "SUBMITTED" });
        }
        if (state.nqeStatusCalls === 2) {
          return response({ status: "EXECUTING" });
        }
        return response({ status: "COMPLETED", outcome: "OK", timeoutMinutes: 10 });
      }
      return undefined;
    },
  });
  const result = await action({
    connectionId: "connection-1",
    request: {
      forwardAccessProfile: "read-only",
      queryId: approvedQueryId,
      maxRows: 2,
    },
  });
  assert.equal(result.result.totalRows, 2);
  assert.equal(state.nqeSubmitCalls, 1);
  assert.equal(statusAttempts >= 2, true);
});

test("happy async path SUBMITTED→EXECUTING→COMPLETED/OK reaches result", async () => {
  const { action, calls } = harness("read-only", approvedQueryId, "", {
    fetchMock: ({ url, options: _options }) => {
      if (url.includes("/api/networks/network-1/nqe-executions/X_execution01/result")) {
        return response({
          snapshotId: "snapshot-1",
          totalNumItems: 1,
          items: [{ result: "pass", Device: "leaf-1" }],
        });
      }
      return undefined;
    },
  });
  const result = await action({
    connectionId: "connection-1",
    request: {
      forwardAccessProfile: "read-only",
      queryId: approvedQueryId,
      maxRows: 1,
    },
  });
  const resultCall = calls.find((call) => call.url.includes("/nqe-executions/X_execution01/result"));
  const resultParams = new URL(resultCall.url).searchParams;
  assert.equal(resultParams.get("offset"), "0");
  assert.equal(resultParams.get("limit"), "1");
  assert.equal(result.result.totalRows, 1);
  assert.equal(result.result.returnedRows, 1);
});

test("USER_ERROR surfaces diagnostics without query text", async () => {
  const query = "foreach device in network.devices select { Device: secretPassword }";
  const digest = digestQuery(query);
  const expectedLeak = "SELECT * FROM secret";
  const { action } = harness("network-operator", "", digest, {
    fetchMock: ({ url, options }) => {
      if (url.includes("/api/networks/network-1/nqe-executions/X_execution01") && options.method === "GET" && !url.includes("/result")) {
        return response({ status: "COMPLETED", outcome: "USER_ERROR", error: { message: `Syntax error near ${expectedLeak}: ${query}` } });
      }
      return undefined;
    },
  });
  const rejection = await assert.rejects(
    action({
      connectionId: "connection-1",
      request: {
        forwardAccessProfile: "network-operator",
        query,
        approvedQueryDigest: digest,
        maxRows: 1,
      },
    }),
    /USER_ERROR/,
  );
  assert.equal(String(rejection).includes(query), false);
  assert.equal(String(rejection).includes(expectedLeak), false);
});

test("TIMED_OUT outcome is surfaced with timeoutMinutes", async () => {
  const { action } = harness("read-only", approvedQueryId, "", {
    fetchMock: ({ url, options }) => {
      if (url.includes("/api/networks/network-1/nqe-executions/X_execution01") && options.method === "GET" && !url.includes("/result")) {
        return response({ status: "COMPLETED", outcome: "TIMED_OUT", timeoutMinutes: 4 });
      }
      return undefined;
    },
  });
  await assert.rejects(
    action({
      connectionId: "connection-1",
      request: { forwardAccessProfile: "read-only", queryId: approvedQueryId },
    }),
    /timeoutMinutes=4/,
  );
});

test("SYSTEM_ERROR outcome is surfaced distinctly", async () => {
  const { action } = harness("read-only", approvedQueryId, "", {
    fetchMock: ({ url, options }) => {
      if (url.includes("/api/networks/network-1/nqe-executions/X_execution01") && options.method === "GET" && !url.includes("/result")) {
        return response({ status: "COMPLETED", outcome: "SYSTEM_ERROR" });
      }
      return undefined;
    },
  });
  await assert.rejects(
    action({
      connectionId: "connection-1",
      request: { forwardAccessProfile: "read-only", queryId: approvedQueryId },
    }),
    /SYSTEM_ERROR/,
  );
});

test("404 on status or result reports expired execution key distinctly", async () => {
  const { action } = harness("read-only", approvedQueryId, "", {
    fetchMock: ({ url }) => {
      if (url.includes("/api/networks/network-1/nqe-executions/X_execution01") && url.includes("/result") === false) {
        return errorResponse(404);
      }
      return undefined;
    },
  });
  await assert.rejects(
    action({
      connectionId: "connection-1",
      request: { forwardAccessProfile: "read-only", queryId: approvedQueryId },
    }),
    /executionKey/,
  );
});

test("deadline exhaustion during polling includes executionKey and server-side continuation", async () => {
  const { action } = harness("read-only", approvedQueryId, "", {
    forwardClientOptions: {
      invocationTimeoutMs: 500,
      maxRetries: 0,
    },
  });
  let error;
  try {
    await action({
      connectionId: "connection-1",
      request: { forwardAccessProfile: "read-only", queryId: approvedQueryId },
    });
    assert.fail("deadline exhaustion did not reject the action");
  } catch (actual) {
    error = actual;
  }
  assert.match(String(error), /executionKey/);
  assert.equal(String(error).includes("X_execution01"), true);
  assert.equal(String(error).includes("continues server-side"), true);
});

test("limit is sent to the async result endpoint", async () => {
  const { action, calls } = harness("read-only", approvedQueryId, "", {
    fetchMock: ({ url, options: _options }) => {
      if (url.includes("/api/networks/network-1/nqe-executions/X_execution01/result")) {
        return response({
          snapshotId: "snapshot-1",
          totalNumItems: 0,
          items: [],
        });
      }
      return undefined;
    },
  });
  await action({
    connectionId: "connection-1",
    request: {
      forwardAccessProfile: "read-only",
      queryId: approvedQueryId,
      maxRows: 7,
    },
  });
  const resultCall = calls.find((call) => call.url.includes("/nqe-executions/X_execution01/result"));
  const params = new URL(resultCall.url).searchParams;
  assert.equal(params.get("offset"), "0");
  assert.equal(params.get("limit"), "7");
});

test("sync NQE path still works when executeSync is explicitly selected", async () => {
  const { action, calls } = harness("read-only", `${approvedQueryId}\n${approvedQueryId}`);
  const result = await action({
    connectionId: "connection-1",
    request: {
      forwardAccessProfile: "read-only",
      templateId: "approved-library-query",
      queryId: approvedQueryId,
      executeSync: true,
      maxRows: 25,
    },
  });
  const syncCall = calls.find((call) => call.url.includes("/api/nqe?"));
  assert.equal(!!syncCall, true);
  assert.equal(syncCall.options.method, "POST");
  assert.equal(syncCall.url.includes("/api/networks/network-1/nqe-executions"), false);
  assert.equal(result.status, "ready");
});

test("deadline exhaustion exposes executionKey structurally, not only in the message", async () => {
  const { action } = harness("read-only", approvedQueryId, "", {
    fetchMock: ({ url, options }) => {
      if (url.includes("/nqe-executions?") && options.method === "POST") {
        return response({ executionKey: "X_execstructured01", status: "SUBMITTED" });
      }
      if (/\/nqe-executions\/X_execstructured01$/u.test(url)) {
        return response({}, 504);
      }
      return undefined;
    },
  });
  const error = await action({
    connectionId: "connection-1",
    request: { forwardAccessProfile: "read-only", queryId: approvedQueryId },
  }).then(() => null, (thrown) => thrown);
  assert.ok(error, "expected the action to reject");
  // A caller resuming must read the key from a property, never by parsing prose.
  assert.equal(error.executionKey, "X_execstructured01");
  assert.equal(error.resumable, true);
});

test("expired executionKey is reported as not resumable", async () => {
  const { action } = harness("read-only", approvedQueryId, "", {
    fetchMock: ({ url, options }) => {
      if (/\/nqe-executions\/X_execexpired01$/u.test(url) && options.method === "GET") {
        return response({}, 404);
      }
      return undefined;
    },
  });
  const error = await action({
    connectionId: "connection-1",
    request: { forwardAccessProfile: "read-only", executionKey: "X_execexpired01" },
  }).then(() => null, (thrown) => thrown);
  assert.ok(error, "expected the action to reject");
  assert.equal(error.executionKey, "X_execexpired01");
  assert.equal(error.resumable, false);
});
