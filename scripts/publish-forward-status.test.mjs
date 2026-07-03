import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";

import { sanitizeStatusArtifact } from "./publish-forward-status.mjs";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

const baseStatus = {
  schemaVersion: "forward-dynatrace-status/v1",
  generatedAt: "2026-01-01T00:00:00.000Z",
  runId: "forward-dynatrace-20260101000000",
  packageId: "dynatrace-forward-demo",
  mode: "apply",
  importState: "applied",
  packageSignature: {
    status: "verified",
    publicKeySource: "/secure/path/public.pem",
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
  plannedChecks: 3,
  plannedNqeChecks: 1,
  plannedNqeDiffRequests: 1,
};

test("sanitizes status artifact to publish-safe fields", () => {
  const sanitized = sanitizeStatusArtifact(baseStatus);

  assert.equal(sanitized.schemaVersion, "forward-dynatrace-status/v1");
  assert.equal(sanitized.packageSignature.status, "verified");
  assert.equal("publicKeySource" in sanitized.packageSignature, false);
  assert.equal(sanitized.plannedNqeChecks, 1);
});

test("rejects unknown status artifact fields", () => {
  assert.throws(
    () => sanitizeStatusArtifact({ ...baseStatus, checkNames: ["checkout-vip"] }),
    /unsupported field/,
  );
});

test("rejects credential-like status artifact content", () => {
  assert.throws(
    () =>
      sanitizeStatusArtifact({
        ...baseStatus,
        packageId: "Bearer should-not-be-here",
      }),
    /forbidden credential-like content/,
  );
});

test("publishes sanitized status and checksum to a handoff directory", async () => {
  const workdir = await mkdtemp(path.join(tmpdir(), "forward-status-publish-"));
  const statusPath = path.join(workdir, "status.json");
  const outputDir = path.join(workdir, "handoff");
  await writeFile(statusPath, JSON.stringify(baseStatus, null, 2) + "\n");

  const child = spawn(
    process.execPath,
    [
      "scripts/publish-forward-status.mjs",
      "--status",
      statusPath,
      "--output-dir",
      outputDir,
    ],
    {
      cwd: root,
      stdio: ["ignore", "pipe", "pipe"],
    },
  );
  const stdout = await new Promise((resolve, reject) => {
    let output = "";
    let errorOutput = "";
    child.stdout.on("data", (chunk) => {
      output += chunk;
    });
    child.stderr.on("data", (chunk) => {
      errorOutput += chunk;
    });
    child.on("error", reject);
    child.on("close", (code) => {
      if (code !== 0) {
        reject(new Error(errorOutput || output));
        return;
      }
      resolve(output);
    });
  });

  const result = JSON.parse(stdout);
  assert.equal(result.status, "published");
  const published = JSON.parse(
    await readFile(path.join(outputDir, "forward-ingest-status.json"), "utf8"),
  );
  const checksum = await readFile(
    path.join(outputDir, "forward-ingest-status.sha256"),
    "utf8",
  );
  assert.equal(published.packageSignature.status, "verified");
  assert.match(checksum, /forward-ingest-status\.json/);
});
