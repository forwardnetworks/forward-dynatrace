import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdtemp, mkdir, readFile, readlink, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import { publishPackageHandoff } from "./publish-forward-package.mjs";

const check = (port = "443") => ({
  name: `[Dynatrace] Checkout prod: source -> destination tcp/${port}`,
  enabled: true,
  priority: "HIGH",
  tags: ["dynatrace", `dynatrace-key:dt:checkout:prod:source:destination:tcp:${port}`],
  definition: {
    checkType: "Existential",
    filters: {
      from: {
        location: { type: "HostFilter", value: "10.0.0.1" },
        headers: [{ type: "PacketFilter", values: { ip_proto: ["6"], tp_dst: [port] } }],
      },
      to: { location: { type: "HostFilter", value: "10.0.0.2" } },
      flowTypes: ["VALID"],
    },
    headerFieldsWithDefaults: ["url"],
    noiseTypes: [],
    returnPath: "ANY",
  },
});

const writePackage = async (directory, { packageId = "package-1", port = "443", signature } = {}) => {
  await mkdir(directory, { recursive: true });
  const checks = [check(port)];
  const checksText = `${JSON.stringify(checks, null, 2)}\n`;
  const manifest = {
    schemaVersion: "forward-dynatrace/v1",
    packageType: "forward-intent-import",
    packageId,
    generatedAt: new Date().toISOString(),
    requestedIngestPath: "data-connector",
    source: { platform: "dynatrace", app: "forward-dynatrace", writePolicy: "dynatrace-never-writes-forward" },
    artifacts: { manifest: "forward-dynatrace-manifest.json", intentChecks: "forward-intent-checks.json" },
    integrity: {
      algorithm: "sha256",
      intentChecksSha256: createHash("sha256").update(checksText).digest("hex"),
    },
    intentChecks: {
      count: checks.length,
      checkType: "Existential",
      payloadShape: "NewNetworkCheck[]",
      bulkEndpoint: "/api/snapshots/{snapshotId}/checks?bulk",
      dedupeRequiredBeforePost: true,
    },
    validation: { requiredTagPrefix: "dynatrace-key:", requiredTagsPerCheck: 1, credentialPolicy: "no-forward-credentials-in-dynatrace" },
    reconciliation: { defaultApplyPolicy: "create-missing-only", changedChecks: "report-only", staleChecks: "report-only" },
  };
  await writeFile(path.join(directory, "forward-intent-checks.json"), checksText);
  await writeFile(path.join(directory, "forward-dynatrace-manifest.json"), `${JSON.stringify(manifest, null, 2)}\n`);
  if (signature) await writeFile(path.join(directory, "forward-dynatrace-package.sig"), signature);
};

test("publishes immutable package bytes and atomically points latest", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "forward-handoff-"));
  const packageDir = path.join(root, "input");
  const handoffRoot = path.join(root, "handoff");
  await writePackage(packageDir, { signature: "detached-signature" });

  const first = await publishPackageHandoff({ packageDir, handoffRoot, requireSignature: true });
  assert.equal(first.created, true);
  assert.equal(first.signature, "present");
  assert.equal(await readlink(path.join(handoffRoot, "latest")), "packages/package-1");
  assert.deepEqual(
    JSON.parse(await readFile(path.join(handoffRoot, "latest", "forward-intent-checks.json"), "utf8")),
    [check()],
  );

  await writeFile(
    path.join(handoffRoot, "latest", "forward-ingest-status.json"),
    '{"schemaVersion":"forward-dynatrace-status/v1"}\n',
  );

  const second = await publishPackageHandoff({ packageDir, handoffRoot, requireSignature: true });
  assert.equal(second.created, false);
});

test("rejects immutable package ID reuse with different valid bytes", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "forward-handoff-conflict-"));
  const firstDir = path.join(root, "first");
  const secondDir = path.join(root, "second");
  const handoffRoot = path.join(root, "handoff");
  await writePackage(firstDir, { packageId: "same-package", port: "443" });
  await writePackage(secondDir, { packageId: "same-package", port: "8443" });
  await publishPackageHandoff({ packageDir: firstDir, handoffRoot });

  await assert.rejects(
    publishPackageHandoff({ packageDir: secondDir, handoffRoot }),
    /Immutable package conflict/,
  );
  assert.equal(await readlink(path.join(handoffRoot, "latest")), "packages/same-package");
});

test("requires a signature before publishing when configured", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "forward-handoff-signature-"));
  const packageDir = path.join(root, "input");
  await writePackage(packageDir);
  await assert.rejects(
    publishPackageHandoff({ packageDir, handoffRoot: path.join(root, "handoff"), requireSignature: true }),
    /signature is required/,
  );
});

test("rejects unknown files added to an immutable package", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "forward-handoff-extra-"));
  const packageDir = path.join(root, "input");
  const handoffRoot = path.join(root, "handoff");
  await writePackage(packageDir);
  await publishPackageHandoff({ packageDir, handoffRoot });
  await writeFile(path.join(handoffRoot, "latest", "unexpected.txt"), "unexpected\n");
  await assert.rejects(
    publishPackageHandoff({ packageDir, handoffRoot }),
    /Immutable package conflict/,
  );
});
