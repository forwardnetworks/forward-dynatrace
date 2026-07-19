#!/usr/bin/env node

import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdir, mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";

import AdmZip from "adm-zip";

const makeFixture = async ({ includeSettings = true } = {}) => {
  const root = await mkdtemp(path.join(tmpdir(), "forward-dynatrace-app-fixture-"));
  const members = [
    "api/dependency-discovery.js",
    "api/run-forward-nqe-evidence.js",
    "api/sync-forward-intent-checks.js",
    "widgets/actions/run-forward-nqe-evidence/index.js",
    "widgets/actions/sync-forward-intent-checks/index.js",
  ];
  if (includeSettings) members.push(
    "settings/schemas/forward-api-connection.schema.json",
    "settings/schemas/dependency-discovery-profile.schema.json",
  );
  for (const member of members) {
    const target = path.join(root, member);
    await mkdir(path.dirname(target), { recursive: true });
    await writeFile(target, "fixture\n");
  }
  await writeFile(path.join(root, "manifest.yaml"), [
    "app-bundle-version: 0.1.0",
    "id: my.forward",
    "name: Forward",
    "version: 0.11.0",
    "",
  ].join("\n"));
  const archive = path.join(root, "my.forward.zip");
  const zip = new AdmZip();
  for (const member of [...members, "manifest.yaml"]) {
    zip.addLocalFile(path.join(root, member), path.dirname(member) === "." ? "" : path.dirname(member));
  }
  zip.writeZip(archive);
  return { root, archive };
};

const packageFixture = ({ root, archive }) => spawnSync(process.execPath, [
  "scripts/package-release-artifacts.mjs",
  "--app-archive", archive,
  "--output-dir", path.join(root, "release"),
  "--release-name", "v0.11.0",
], { encoding: "utf8" });

test("packages one validated Dynatrace app bundle", async () => {
  const fixture = await makeFixture();
  const result = packageFixture(fixture);
  assert.equal(result.status, 0, result.stderr);
  const output = JSON.parse(result.stdout);
  assert.equal(output.installable, "forward-dynatrace-app-v0.11.0.zip");
  assert.equal(output.appId, "my.forward");
  assert.deepEqual(output.artifacts, [
    "forward-dynatrace-app-v0.11.0.zip",
    "forward-dynatrace-sbom-v0.11.0.cdx.json",
    "SHA256SUMS",
  ]);
});

test("rejects an app bundle without its Forward connection schema", async () => {
  const fixture = await makeFixture({ includeSettings: false });
  const result = packageFixture(fixture);
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /missing settings\/schemas\/forward-api-connection\.schema\.json/u);
});
