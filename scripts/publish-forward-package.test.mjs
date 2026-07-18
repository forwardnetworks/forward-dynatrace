import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdtemp, mkdir, readFile, readlink, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import {
  requiredOwnershipTags,
  sourceInstanceTag,
  sourceKeyTag,
} from "../lib/managed-check-identity.mjs";
import { publishPackageHandoff } from "./publish-forward-package.mjs";

const sourceInstanceId = "dt-package-publish-test";
const check = (port = "443") => {
  const sourceKey = sourceKeyTag({
    sourceInstanceId,
    identity: { kind: "intent", source: "source", destination: "destination", protocol: "tcp", port },
  });
  return ({
  name: `[Dynatrace] Checkout prod: source -> destination tcp/${port}`,
  enabled: true,
  priority: "HIGH",
  tags: ["dynatrace", ...requiredOwnershipTags({ sourceInstanceId, sourceKey })],
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
};

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
    requestedForwardAccessProfile: "read-only",
    source: {
      platform: "dynatrace",
      app: "com.forward.dynatrace",
      instanceId: sourceInstanceId,
      instanceTag: sourceInstanceTag(sourceInstanceId),
      writePolicy: "dynatrace-never-writes-forward",
    },
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
      dedupe: "managed-source-key",
    },
    validation: {
      managedByTag: "managed-by:com.forward.dynatrace",
      contractVersionTag: "contract-version:1",
      sourceInstanceTagPrefix: "source-instance:",
      sourceKeyTagPrefix: "source-key:sha256:",
      ownershipTagsPerCheck: 4,
      identityPolicy: "strict-ownership-tuple",
      credentialPolicy: "no-forward-credentials-in-dynatrace",
    },
    reconciliation: {
      strategy: "source-scoped-desired-state",
      defaultApplyPolicy: "create-missing-only",
      changedChecks: "report-only",
      staleChecks: "report-only",
      collisionPolicy: "reject",
    },
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
