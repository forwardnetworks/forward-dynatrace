import assert from "node:assert/strict";
import { createServer } from "node:http";
import { pathToFileURL } from "node:url";
import { test } from "node:test";

const modulePath = new URL("../api/forward-status.function.ts", import.meta.url).pathname;

const loadForwardStatus = async () => {
  const href = `${pathToFileURL(modulePath).href}?cacheBust=${Date.now()}-${Math.random()}`;
  return (await import(href)).default;
};

const statusArtifact = {
  schemaVersion: "forward-dynatrace-status/v1",
  generatedAt: "2026-01-01T00:00:00.000Z",
  runId: "forward-dynatrace-20260101000000",
  packageId: "dynatrace-forward-demo",
  mode: "apply",
  importState: "applied",
  packageSignature: {
    status: "verified",
  },
  target: {
    networkId: "demo-network",
    snapshotId: "demo-snapshot",
  },
  counts: {
    create: 1,
    unchanged: 2,
    changed: 0,
    stale: 0,
  },
  mutationCounts: {
    created: 1,
    updated: 1,
    deactivated: 0,
  },
  plannedChecks: 3,
  plannedNqeChecks: 1,
  plannedNqeDiffRequests: 1,
};

const startStatusServer = async (artifact) =>
  new Promise((resolve) => {
    const server = createServer((request, response) => {
      response.writeHead(200, { "Content-Type": "application/json" });
      response.end(JSON.stringify(artifact));
    });
    server.listen(0, "127.0.0.1", () => {
      const address = server.address();
      resolve({ server, url: `http://127.0.0.1:${address.port}/status.json` });
    });
  });

test("renders supplied status artifact with aggregate NQE and mutation counts", async () => {
  const forwardStatus = await loadForwardStatus();
  const result = await forwardStatus({ statusArtifact });

  assert.equal(result.status, "ready");
  assert.equal(result.rows.find((row) => row.label === "NQE checks")?.value, "1");
  assert.equal(result.rows.find((row) => row.label === "Updated")?.value, "1");
});

test("treats reconciled Forward status as a ready import state", async () => {
  const forwardStatus = await loadForwardStatus();
  const result = await forwardStatus({
    statusArtifact: {
      ...statusArtifact,
      mode: "dry-run",
      importState: "reconciled",
      counts: {
        create: 0,
        unchanged: 100,
        changed: 0,
        stale: 0,
      },
    },
  });

  assert.equal(result.status, "ready");
  assert.equal(result.rows.find((row) => row.label === "Import state")?.value, "reconciled");
  assert.equal(result.summary, "Forward-side ingest status is ready for Dynatrace display.");
});

test("fetches a read-only status artifact URL", async () => {
  const forwardStatus = await loadForwardStatus();
  const { server, url } = await startStatusServer(statusArtifact);
  try {
    const result = await forwardStatus({ statusArtifactUrl: url });
    assert.equal(result.status, "ready");
    assert.equal(result.rows.find((row) => row.label === "Package")?.value, "dynatrace-forward-demo");
  } finally {
    await new Promise((resolve, reject) => {
      server.close((error) => (error ? reject(error) : resolve()));
    });
  }
});

test("rejects non-local HTTP status artifact URLs", async () => {
  const forwardStatus = await loadForwardStatus();
  const result = await forwardStatus({
    statusArtifactUrl: "http://package.example.com/forward-ingest-status.json",
  });

  assert.equal(result.status, "blocked");
  assert.match(result.summary, /must use HTTPS/);
});
