import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtemp, readdir, rm, stat, utimes, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { test } from "node:test";

import {
  acquireRunLock,
  assertApplyAllowed,
  parseArgs,
} from "./forward-cron-import.mjs";

test("parses cron runner safety and output options", () => {
  assert.deepEqual(
    parseArgs([
      "--config",
      "/etc/forward-dynatrace/connector.json",
      "--allow-apply",
      "--status-handoff-dir",
      "/handoff/latest",
    ]),
    {
      config: "/etc/forward-dynatrace/connector.json",
      "allow-apply": true,
      "status-handoff-dir": "/handoff/latest",
    },
  );
});

test("rejects scheduled apply unless the operator explicitly allows it", () => {
  assert.doesNotThrow(() => assertApplyAllowed({ apply: false }, false));
  assert.doesNotThrow(() => assertApplyAllowed({ apply: true }, true));
  assert.throws(
    () => assertApplyAllowed({ apply: true }, false),
    /reviewed dry-run/,
  );
});

test("prevents overlapping runs and reclaims stale locks", async () => {
  const workdir = await mkdtemp(path.join(tmpdir(), "forward-cron-lock-"));
  const lockPath = path.join(workdir, "state", "import.lock");
  try {
    const first = await acquireRunLock(lockPath, 120);
    assert.ok(first);
    const overlapping = await acquireRunLock(lockPath, 120);
    assert.equal(overlapping, null);
    await first.close();

    const old = new Date(Date.now() - 180 * 60_000);
    await utimes(lockPath, old, old);
    const reclaimed = await acquireRunLock(lockPath, 120);
    assert.ok(reclaimed);
    await reclaimed.close();
  } finally {
    await rm(workdir, { recursive: true, force: true });
  }
});

test("does not reclaim an old lock owned by a running process", async () => {
  const workdir = await mkdtemp(path.join(tmpdir(), "forward-cron-live-lock-"));
  const lockPath = path.join(workdir, "state", "import.lock");
  try {
    const first = await acquireRunLock(lockPath, 120);
    assert.ok(first);
    await first.close();
    await writeFile(lockPath, `${JSON.stringify({ pid: process.pid })}\n`);
    const old = new Date(Date.now() - 180 * 60_000);
    await utimes(lockPath, old, old);
    assert.equal(await acquireRunLock(lockPath, 120), null);
  } finally {
    await rm(workdir, { recursive: true, force: true });
  }
});

test("CLI blocks an apply config before invoking the importer", async () => {
  const workdir = await mkdtemp(path.join(tmpdir(), "forward-cron-apply-gate-"));
  const configPath = path.join(workdir, "connector.json");
  try {
    await writeFile(
      configPath,
      `${JSON.stringify({ schemaVersion: "forward-dynatrace-connector/v1", apply: true })}\n`,
    );
    const result = spawnSync(
      process.execPath,
      ["scripts/forward-cron-import.mjs", "--config", configPath],
      { cwd: process.cwd(), encoding: "utf8" },
    );
    assert.equal(result.status, 1);
    assert.match(result.stderr, /reviewed dry-run/);
  } finally {
    await rm(workdir, { recursive: true, force: true });
  }
});

test("CLI captures importer failure in a protected log and releases its lock", async () => {
  const workdir = await mkdtemp(path.join(tmpdir(), "forward-cron-importer-failure-"));
  const configPath = path.join(workdir, "connector.json");
  const stateDir = path.join(workdir, "state");
  const logDir = path.join(workdir, "logs");
  try {
    await writeFile(
      configPath,
      `${JSON.stringify({ schemaVersion: "forward-dynatrace-connector/v1", apply: false })}\n`,
    );
    const result = spawnSync(
      process.execPath,
      [
        "scripts/forward-cron-import.mjs",
        "--config",
        configPath,
        "--state-dir",
        stateDir,
        "--log-dir",
        logDir,
      ],
      {
        cwd: process.cwd(),
        encoding: "utf8",
        env: process.env,
      },
    );
    assert.equal(result.status, 1);
    assert.match(result.stderr, /Forward import exited 1/);
    const logs = await readdir(logDir);
    assert.equal(logs.length, 1);
    assert.equal((await stat(path.join(logDir, logs[0]))).mode & 0o777, 0o600);
    await assert.rejects(stat(path.join(stateDir, "forward-cron-import.lock")), {
      code: "ENOENT",
    });
  } finally {
    await rm(workdir, { recursive: true, force: true });
  }
});
