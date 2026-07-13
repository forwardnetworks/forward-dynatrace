#!/usr/bin/env node

import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const packageJson = JSON.parse(await readFile(path.join(root, "package.json"), "utf8"));
const expectedReleaseName = `v${packageJson.version}`;

const runValidator = (args = [], env = {}) =>
  spawnSync(process.execPath, ["scripts/validate-release-ref.mjs", ...args], {
    cwd: root,
    encoding: "utf8",
    env: { ...process.env, GITHUB_REF_NAME: "", ...env },
  });

test("accepts an exact v-prefixed repository version", () => {
  const result = runValidator(["--release-name", expectedReleaseName]);

  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /matches repository version/u);
});

test("accepts the GitHub ref name when no argument is supplied", () => {
  const result = runValidator([], { GITHUB_REF_NAME: expectedReleaseName });

  assert.equal(result.status, 0, result.stderr);
});

test("rejects a release ref that does not match repository metadata", () => {
  const result = runValidator(["--release-name", "v999.0.0"]);

  assert.equal(result.status, 1);
  assert.match(result.stderr, /does not match repository version/u);
  assert.match(result.stderr, new RegExp(`expected ${expectedReleaseName.replaceAll(".", "\\.")}`, "u"));
});

test("rejects inconsistent package, lockfile, and app versions", async (t) => {
  const fixtureRoot = await mkdtemp(path.join(tmpdir(), "forward-dynatrace-release-ref-"));
  t.after(() => rm(fixtureRoot, { recursive: true, force: true }));
  await Promise.all([
    writeFile(path.join(fixtureRoot, "package.json"), JSON.stringify({ version: "2.0.0" })),
    writeFile(
      path.join(fixtureRoot, "package-lock.json"),
      JSON.stringify({ version: "2.0.0", packages: { "": { version: "2.0.0" } } }),
    ),
    writeFile(
      path.join(fixtureRoot, "app.config.json"),
      JSON.stringify({ app: { version: "2.0.1" } }),
    ),
  ]);

  const result = runValidator(["--release-name", "v2.0.0", "--root", fixtureRoot]);

  assert.equal(result.status, 1);
  assert.match(result.stderr, /Release version mismatch/u);
  assert.match(result.stderr, /app\.config\.json=2\.0\.1/u);
});

test("rejects a missing release ref", () => {
  const result = runValidator();

  assert.equal(result.status, 1);
  assert.match(result.stderr, /Release name is required/u);
});
