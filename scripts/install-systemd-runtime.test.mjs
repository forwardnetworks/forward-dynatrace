import assert from "node:assert/strict";
import { mkdir, mkdtemp, readFile, stat, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";

import {
  applyInstallPlan,
  assertNode24,
  buildInstallPlan,
  parseArgs,
} from "./install-systemd-runtime.mjs";

const repositoryRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const underRoot = (root, logicalPath) => path.join(root, logicalPath.slice(1));
const modeOf = async (filePath) => (await stat(filePath)).mode & 0o777;

test("parses dry-run, apply, root, and replacement controls", () => {
  assert.deepEqual(
    parseArgs([
      "--source-dir", "/release",
      "--root", "/stage",
      "--output", "/tmp/install.json",
      "--apply",
      "--replace-existing",
    ]),
    {
      "source-dir": "/release",
      root: "/stage",
      output: "/tmp/install.json",
      apply: true,
      "replace-existing": true,
    },
  );
  assert.throws(() => parseArgs(["--root"]), /Missing value/u);
  assert.throws(() => parseArgs(["--activate"]), /Unsupported option/u);
});

test("enforces the supported Node major", () => {
  assert.doesNotThrow(() => assertNode24("24.18.0"));
  assert.throws(() => assertNode24("26.5.0"), /requires Node 24/u);
});

test("stages a secret-free, idempotent systemd runtime", async () => {
  const rootDir = await mkdtemp(path.join(tmpdir(), "forward-dynatrace-systemd-install-"));
  const plan = await buildInstallPlan({ sourceDir: repositoryRoot, rootDir });

  assert.equal(plan.schemaVersion, "forward-dynatrace-systemd-install-plan/v1");
  assert.equal(plan.status, "planned");
  assert.equal(plan.sourceVersion, "1.0.0");
  assert.equal(plan.activationReady, false);
  assert.equal(plan.configurationStatus, "placeholders-require-operator-review");
  assert.ok(plan.files.length > 100);
  assert.ok(plan.files.every((file) => file.action === "create"));
  assert.ok(plan.files.every((file) => /^[a-f0-9]{64}$/u.test(file.sha256)));
  assert.ok(plan.requiredOperatorInputs.some((input) =>
    input.path === "/etc/forward-dynatrace/handoff-read-token"));
  assert.ok(!plan.files.some((file) =>
    plan.requiredOperatorInputs.some((input) => input.path === file.destination)));

  const tamperedPlan = {
    ...plan,
    files: plan.files.map((file, index) =>
      index === 0 ? { ...file, sha256: "0".repeat(64) } : file),
  };
  await assert.rejects(() => applyInstallPlan(tamperedPlan), /changed after plan creation/u);

  const report = await applyInstallPlan(plan);
  assert.equal(report.status, "installed");
  assert.match(report.installedAt, /^\d{4}-\d{2}-\d{2}T/u);
  assert.equal(
    await readFile(
      underRoot(rootDir, "/opt/forward-dynatrace/scripts/forward-import-package.mjs"),
      "utf8",
    ),
    await readFile(path.join(repositoryRoot, "scripts/forward-import-package.mjs"), "utf8"),
  );
  assert.equal(
    await readFile(
      underRoot(rootDir, "/etc/systemd/system/forward-dynatrace-handoff.service"),
      "utf8",
    ),
    await readFile(path.join(repositoryRoot, "deploy/systemd/forward-dynatrace-handoff.service"), "utf8"),
  );
  assert.equal(
    await modeOf(underRoot(rootDir, "/etc/forward-dynatrace/forward-dynatrace.env")),
    0o600,
  );
  assert.equal(await modeOf(underRoot(rootDir, "/etc/forward-dynatrace")), 0o750);
  assert.equal(await modeOf(underRoot(rootDir, "/var/lib/forward-dynatrace")), 0o750);
  for (const input of plan.requiredOperatorInputs) {
    await assert.rejects(() => stat(underRoot(rootDir, input.path)), /ENOENT/u);
  }

  const repeated = await buildInstallPlan({ sourceDir: repositoryRoot, rootDir });
  assert.ok(repeated.files.every((file) => file.action === "unchanged"));
});

test("preserves operator configuration and replaces managed files only when explicit", async () => {
  const rootDir = await mkdtemp(path.join(tmpdir(), "forward-dynatrace-systemd-conflict-"));
  await applyInstallPlan(await buildInstallPlan({ sourceDir: repositoryRoot, rootDir }));
  const operatorConfig = underRoot(rootDir, "/etc/forward-dynatrace/forward-connector.config.json");
  const managedUnit = underRoot(
    rootDir,
    "/etc/systemd/system/forward-dynatrace-handoff.service",
  );
  await writeFile(operatorConfig, "operator-edited\n", { mode: 0o640 });
  await writeFile(managedUnit, "managed-file-drift\n", { mode: 0o644 });

  await assert.rejects(
    () => buildInstallPlan({ sourceDir: repositoryRoot, rootDir }),
    /Managed destination differs/u,
  );
  const replacement = await buildInstallPlan({
    sourceDir: repositoryRoot,
    rootDir,
    replaceExisting: true,
  });
  assert.equal(
    replacement.files.find((file) =>
      file.destination === "/etc/forward-dynatrace/forward-connector.config.json")?.action,
    "preserve",
  );
  const changed = replacement.files.filter((file) => file.action === "replace");
  assert.deepEqual(changed.map((file) => file.destination), [
    "/etc/systemd/system/forward-dynatrace-handoff.service",
  ]);
  await applyInstallPlan(replacement);
  assert.equal(await readFile(operatorConfig, "utf8"), "operator-edited\n");
  assert.equal(
    await readFile(managedUnit, "utf8"),
    await readFile(
      path.join(repositoryRoot, "deploy/systemd/forward-dynatrace-handoff.service"),
      "utf8",
    ),
  );
});

test("rejects a destination path that traverses a symlink", async () => {
  const rootDir = await mkdtemp(path.join(tmpdir(), "forward-dynatrace-systemd-symlink-"));
  const outside = await mkdtemp(path.join(tmpdir(), "forward-dynatrace-systemd-outside-"));
  await mkdir(path.join(outside, "forward-dynatrace"));
  await symlink(outside, path.join(rootDir, "etc"));
  await assert.rejects(
    () => buildInstallPlan({ sourceDir: repositoryRoot, rootDir }),
    /must not contain symlinks/u,
  );
});
