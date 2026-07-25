import assert from "node:assert/strict";
import path from "node:path";
import test from "node:test";
import { fileURLToPath, pathToFileURL } from "node:url";

const repositoryRoot = process.env.FORWARD_DIGEST_PRODUCT_ROOT
  ? path.resolve(process.env.FORWARD_DIGEST_PRODUCT_ROOT)
  : path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const actionModuleUrl = pathToFileURL(
  path.join(repositoryRoot, "actions/sync-forward-intent-checks.logic.ts"),
).href;
const {
  createSyncForwardIntentAction,
} = await import(actionModuleUrl);

const EXPECTED_PLAN_DIGEST =
  "cc3de7281cdc5303bdf747075768171ac639ab2e384294ac192a7123d0d5f5f8";

const response = (value) => new Response(JSON.stringify(value), {
  status: 200,
  headers: { "content-type": "application/json" },
});

const fetchImpl = async (url, options) => {
  if (url.endsWith("/api/public/csrf")) {
    return response({
      headerName: "X-CSRF-TOKEN",
      token: "csrf-digest-fixture",
    });
  }
  if (url.endsWith("/networks/network-digest/snapshots/latestProcessed")) {
    return response({
      id: "snapshot-digest",
      state: "PROCESSED",
      createdAt: "2026-07-25T12:00:00Z",
    });
  }
  if (url.endsWith("/networks/network-digest/paths-bulk?snapshotId=snapshot-digest")) {
    const body = JSON.parse(options.body);
    return response(body.queries.map(() => ({
      info: {
        paths: [{
          forwardingOutcome: "DELIVERED",
          securityOutcome: "PERMITTED",
        }],
      },
    })));
  }
  if (url.endsWith("/snapshots/snapshot-digest/checks?type=Existential")) {
    return response({ checks: [] });
  }
  throw new Error(`Unexpected request: ${options.method} ${url}`);
};

const action = createSyncForwardIntentAction({
  loadConnection: async () => ({
    schemaId: "forward-api-connection",
    value: {
      name: "digest-fixture",
      baseUrl: "https://forward.example.com/api",
      networkId: "network-digest",
      username: "fixture-user",
      password: "fixture-password",
      forwardAccessProfile: "network-admin",
    },
  }),
  fetchImpl,
});

test("plan digest stays byte-identical for the approval fixture", async () => {
  const result = await action({
    connectionId: "connection-digest",
    request: {
      sourceInstanceId: "dt-digest-fixture",
      syncMode: "direct-api",
      forwardAccessProfile: "network-admin",
      operation: "plan",
      maxCreates: 7,
      maxUpdates: 3,
      dependencies: [{
        id: "checkout-orders",
        appName: "Checkout",
        environment: "prod",
        serviceEntityId: "SERVICE-CHECKOUT",
        serviceName: "checkout-api",
        source: "10.0.0.1",
        destination: "10.0.0.2",
        protocol: "tcp",
        port: "443",
        owner: "commerce-platform",
        criticality: "critical",
        confidence: 100,
        mappingState: "ready",
      }],
    },
  });

  process.stdout.write(`plan digest (${repositoryRoot}): ${result.planDigest}\n`);
  assert.equal(result.planDigest, EXPECTED_PLAN_DIGEST);
});
