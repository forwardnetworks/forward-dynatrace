import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import test from "node:test";

import {
  buildHandoffPublication,
  createExportForwardPackageAction,
} from "../actions/export-forward-package.logic.mjs";

const dependency = {
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
};

const connection = {
  schemaId: "forward-package-handoff-connection",
  value: {
    name: "customer-handoff",
    url: "https://handoff.example.com/v1/packages",
    token: "write-only-token-for-tests",
    retentionClass: "nonproduction-30d",
  },
};

const sha256 = (value) => createHash("sha256").update(value).digest("hex");

const harness = () => {
  const requests = [];
  const loadConnection = async (connectionId) => {
    assert.equal(connectionId, "connection-1");
    return connection;
  };
  const fetchImpl = async (url, options) => {
    requests.push({ url, options });
    const publication = JSON.parse(options.body);
    const manifestFile = publication.files.find(
      (file) => file.name === "forward-dynatrace-manifest.json",
    );
    return {
      ok: true,
      status: 201,
      text: async () => JSON.stringify({
        schemaVersion: "forward-dynatrace-handoff-receipt/v1",
        status: "published",
        packageId: publication.packageId,
        receivedAt: "2026-07-15T18:30:00.000Z",
        manifestSha256: manifestFile.sha256,
        files: publication.files.map((file) => file.name),
        immutableUrl: `https://handoff.example.com/v1/packages/${publication.packageId}/`,
        latestUrl: "https://handoff.example.com/v1/packages/latest/",
        retentionClass: publication.retentionClass,
        accessLogId: "access-log-1",
      }),
    };
  };
  return {
    action: createExportForwardPackageAction({ loadConnection, fetchImpl }),
    requests,
  };
};

test("workflow action publishes exact package bytes through a selected write-only connection", async () => {
  const { action, requests } = harness();
  const result = await action({
    connectionId: "connection-1",
    request: { syncMode: "data-connector", dependencies: [dependency] },
  });
  assert.equal(result.schemaVersion, "forward-dynatrace-workflow-action/v2");
  assert.equal(result.status, "ready");
  assert.equal(result.intentCheckCount, 1);
  assert.equal(result.boundary, "dynatrace-never-writes-forward");
  assert.equal(result.handoff.status, "published");
  assert.equal(result.handoff.packageId, result.packageId);
  assert.equal(requests.length, 1);
  assert.equal(requests[0].url, "https://handoff.example.com/v1/packages");
  assert.equal(requests[0].options.headers.Authorization, "Bearer write-only-token-for-tests");
  assert.equal(requests[0].options.headers["Idempotency-Key"], `forward-dynatrace:${result.packageId}`);
  const publication = JSON.parse(requests[0].options.body);
  assert.equal(publication.schemaVersion, "forward-dynatrace-handoff-publication/v1");
  assert.equal(publication.retentionClass, "nonproduction-30d");
  assert.deepEqual(publication.files.map((file) => file.name), [
    "forward-intent-checks.json",
    "forward-dynatrace-manifest.json",
  ]);
  for (const file of publication.files) {
    const bytes = Buffer.from(file.contentBase64, "base64");
    assert.equal(sha256(bytes), file.sha256);
  }
  assert.equal(JSON.stringify(result).includes("write-only-token-for-tests"), false);
});

test("workflow action accepts expression-resolved JSON text", async () => {
  const { action } = harness();
  const result = await action({
    connectionId: "connection-1",
    request: JSON.stringify({ syncMode: "manual-import", dependencies: [dependency] }),
  });
  assert.equal(result.intentCheckCount, 1);
  assert.equal(result.handoff.retentionClass, "nonproduction-30d");
});

test("builds deterministic complete publication bytes", () => {
  const manifestText = `${JSON.stringify({
    packageId: "package-1",
    generatedAt: "2026-07-15T18:30:00.000Z",
  }, null, 2)}\n`;
  const intentChecksText = "[]\n";
  const first = buildHandoffPublication({
    manifestText,
    intentChecksText,
    retentionClass: "nonproduction-30d",
  });
  const second = buildHandoffPublication({
    manifestText,
    intentChecksText,
    retentionClass: "nonproduction-30d",
  });
  assert.deepEqual(first, second);
  assert.equal(Buffer.from(first.files[0].contentBase64, "base64").toString("utf8"), intentChecksText);
});

test("workflow action rejects empty scope, missing connection, and unsafe connection URLs", async () => {
  const { action } = harness();
  await assert.rejects(
    action({ connectionId: "connection-1", request: { syncMode: "data-connector", dependencies: [] } }),
    /No dependency rows selected/,
  );
  await assert.rejects(
    action({ request: { syncMode: "data-connector", dependencies: [dependency] } }),
    /connectionId.*non-empty string/,
  );
  const unsafeAction = createExportForwardPackageAction({
    loadConnection: async () => ({
      ...connection,
      value: { ...connection.value, url: "http://handoff.example.com/v1/packages" },
    }),
  });
  await assert.rejects(
    unsafeAction({
      connectionId: "connection-1",
      request: { syncMode: "data-connector", dependencies: [dependency] },
    }),
    /must use HTTPS/,
  );
  const weakTokenAction = createExportForwardPackageAction({
    loadConnection: async () => ({
      ...connection,
      value: { ...connection.value, token: "too-short" },
    }),
  });
  await assert.rejects(
    weakTokenAction({
      connectionId: "connection-1",
      request: { syncMode: "data-connector", dependencies: [dependency] },
    }),
    /at least 16 characters/,
  );
  const extendedConnectionAction = createExportForwardPackageAction({
    loadConnection: async () => ({
      ...connection,
      value: { ...connection.value, unexpected: "not-part-of-the-contract" },
    }),
  });
  await assert.rejects(
    extendedConnectionAction({
      connectionId: "connection-1",
      request: { syncMode: "data-connector", dependencies: [dependency] },
    }),
    /unsupported fields: unexpected/,
  );
});

test("workflow action fails closed on a mismatched handoff receipt", async () => {
  const action = createExportForwardPackageAction({
    loadConnection: async () => connection,
    fetchImpl: async (_url, options) => {
      const publication = JSON.parse(options.body);
      return {
        ok: true,
        status: 200,
        text: async () => JSON.stringify({
          schemaVersion: "forward-dynatrace-handoff-receipt/v1",
          status: "existing",
          packageId: "another-package",
          manifestSha256: "0".repeat(64),
          files: publication.files.map((file) => file.name),
          immutableUrl: "https://handoff.example.com/v1/packages/another-package/",
          latestUrl: "https://handoff.example.com/v1/packages/latest/",
          retentionClass: publication.retentionClass,
          accessLogId: "access-log-2",
          receivedAt: "2026-07-15T18:30:00.000Z",
        }),
      };
    },
  });
  await assert.rejects(
    action({
      connectionId: "connection-1",
      request: { syncMode: "data-connector", dependencies: [dependency] },
    }),
    /receipt changed the package ID/,
  );
});

test("workflow action rejects inconsistent or extended receipts and does not echo failure bodies", async () => {
  const request = {
    connectionId: "connection-1",
    request: { syncMode: "data-connector", dependencies: [dependency] },
  };
  const receiptAction = ({ status = 200, receiptOverrides = {} } = {}) =>
    createExportForwardPackageAction({
      loadConnection: async () => connection,
      fetchImpl: async (_url, options) => {
        const publication = JSON.parse(options.body);
        const manifestFile = publication.files.find(
          (file) => file.name === "forward-dynatrace-manifest.json",
        );
        return {
          ok: true,
          status,
          text: async () => JSON.stringify({
            schemaVersion: "forward-dynatrace-handoff-receipt/v1",
            status: "existing",
            packageId: publication.packageId,
            receivedAt: "2026-07-15T18:30:00.000Z",
            manifestSha256: manifestFile.sha256,
            files: publication.files.map((file) => file.name),
            immutableUrl: `https://handoff.example.com/v1/packages/${publication.packageId}/`,
            latestUrl: "https://handoff.example.com/v1/packages/latest/",
            retentionClass: publication.retentionClass,
            accessLogId: "access-log-3",
            ...receiptOverrides,
          }),
        };
      },
    });

  await assert.rejects(receiptAction({ status: 201 })(request), /HTTP status does not match/);
  await assert.rejects(
    receiptAction({ receiptOverrides: { unexpected: "field" } })(request),
    /unsupported fields: unexpected/,
  );
  await assert.rejects(
    receiptAction({
      receiptOverrides: { immutableUrl: "http://handoff.example.com/v1/packages/package/" },
    })(request),
    /immutableUrl must be an HTTPS URL/,
  );
  await assert.rejects(
    receiptAction({
      receiptOverrides: { latestUrl: "https://another.example.com/v1/packages/latest/" },
    })(request),
    /latestUrl does not match the selected handoff connection/,
  );
  await assert.rejects(
    receiptAction({
      receiptOverrides: { latestUrl: "https://handoff.example.com/other/v1/packages/latest/" },
    })(request),
    /latestUrl does not match the selected handoff connection/,
  );

  const failed = createExportForwardPackageAction({
    loadConnection: async () => connection,
    fetchImpl: async () => ({
      ok: false,
      status: 500,
      text: async () => "upstream reflected write-only-token-for-tests",
    }),
  });
  await assert.rejects(failed(request), (error) => {
    assert.match(error.message, /HTTP 500/);
    assert.equal(error.message.includes("write-only-token-for-tests"), false);
    return true;
  });
});
