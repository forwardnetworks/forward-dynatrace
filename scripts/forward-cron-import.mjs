#!/usr/bin/env node

import { spawn } from "node:child_process";
import { mkdir, open, readFile, rm, stat } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const DEFAULT_STATE_DIR = "/var/lib/forward-dynatrace";
const DEFAULT_LOG_DIR = "/var/log/forward-dynatrace";
const DEFAULT_LOCK_MAX_AGE_MINUTES = 120;

const usage = `
Forward for Dynatrace cron importer

Usage:
  node scripts/forward-cron-import.mjs \\
    --config /etc/forward-dynatrace/forward-connector.config.json \\
    --state-dir /var/lib/forward-dynatrace \\
    --log-dir /var/log/forward-dynatrace

Options:
  --allow-apply                 Permit a connector config with apply=true.
  --config path                Non-secret connector config JSON.
  --lock-max-age-minutes n     Reclaim an abandoned lock after n minutes. Default: ${DEFAULT_LOCK_MAX_AGE_MINUTES}
  --log-dir path               Per-run log directory. Default: ${DEFAULT_LOG_DIR}
  --state-dir path             Lock/state directory. Default: ${DEFAULT_STATE_DIR}
  --status-handoff-dir path    Optionally publish sanitized status after a successful import.
  --help                       Show this help.

FORWARD_AUTHORIZATION_FILE must point to a mounted, protected authorization-header
file. Config apply defaults to false. A config with
apply=true is rejected unless --allow-apply or
FORWARD_DYNATRACE_ALLOW_APPLY=true is explicitly supplied.
`;

export const parseArgs = (argv) => {
  const args = {};
  for (let index = 0; index < argv.length; index += 1) {
    const value = argv[index];
    if (value === "--allow-apply" || value === "--help") {
      args[value.slice(2)] = true;
      continue;
    }
    if (!value.startsWith("--")) {
      throw new Error(`Unexpected positional argument: ${value}`);
    }
    const next = argv[index + 1];
    if (!next || next.startsWith("--")) {
      throw new Error(`Missing value for ${value}.`);
    }
    args[value.slice(2)] = next;
    index += 1;
  }
  return args;
};

const positiveInteger = (value, fallback, label) => {
  const parsed = Number.parseInt(value || String(fallback), 10);
  if (!Number.isInteger(parsed) || parsed <= 0) {
    throw new Error(`${label} must be a positive integer.`);
  }
  return parsed;
};

export const assertApplyAllowed = (config, allowApply) => {
  if (config.apply === true && !allowApply) {
    throw new Error(
      "Connector config has apply=true. Re-run with --allow-apply only after a reviewed dry-run.",
    );
  }
};

export const acquireRunLock = async (lockPath, maxAgeMinutes, now = Date.now()) => {
  await mkdir(path.dirname(lockPath), { recursive: true, mode: 0o700 });
  try {
    return await open(lockPath, "wx", 0o600);
  } catch (error) {
    if (error?.code !== "EEXIST") throw error;
  }

  const lockStat = await stat(lockPath).catch(() => null);
  if (!lockStat || now - lockStat.mtimeMs <= maxAgeMinutes * 60_000) {
    return null;
  }

  let lockOwner = {};
  try {
    lockOwner = JSON.parse(await readFile(lockPath, "utf8"));
  } catch {
    lockOwner = {};
  }
  if (Number.isInteger(lockOwner.pid) && lockOwner.pid > 0) {
    try {
      process.kill(lockOwner.pid, 0);
      return null;
    } catch (error) {
      if (error?.code !== "ESRCH") return null;
    }
  }

  await rm(lockPath, { force: true });
  try {
    return await open(lockPath, "wx", 0o600);
  } catch (error) {
    if (error?.code === "EEXIST") return null;
    throw error;
  }
};

const runChild = (script, args, logHandle) =>
  new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [script, ...args], {
      cwd: root,
      env: process.env,
      stdio: ["ignore", logHandle.fd, logHandle.fd],
    });
    child.on("error", reject);
    child.on("close", (code) => resolve(code ?? 1));
  });

const safeTimestamp = () => new Date().toISOString().replace(/[:.]/g, "-");

const main = async () => {
  const args = parseArgs(process.argv.slice(2));
  if (args.help) {
    process.stdout.write(usage);
    return 0;
  }
  if (!args.config) {
    throw new Error("Missing required option: --config");
  }

  const configPath = path.resolve(args.config);
  const config = JSON.parse(await readFile(configPath, "utf8"));
  const allowApply =
    Boolean(args["allow-apply"]) || process.env.FORWARD_DYNATRACE_ALLOW_APPLY === "true";
  assertApplyAllowed(config, allowApply);

  const stateDir = path.resolve(args["state-dir"] || DEFAULT_STATE_DIR);
  const logDir = path.resolve(args["log-dir"] || DEFAULT_LOG_DIR);
  const lockPath = path.join(stateDir, "forward-cron-import.lock");
  const maxLockAgeMinutes = positiveInteger(
    args["lock-max-age-minutes"],
    DEFAULT_LOCK_MAX_AGE_MINUTES,
    "--lock-max-age-minutes",
  );
  await mkdir(logDir, { recursive: true, mode: 0o700 });

  const lockHandle = await acquireRunLock(lockPath, maxLockAgeMinutes);
  if (!lockHandle) {
    process.stdout.write(
      `${JSON.stringify({ status: "skipped", reason: "another import is running", lockPath })}\n`,
    );
    return 0;
  }

  const logPath = path.join(logDir, `forward-import-${safeTimestamp()}.log`);
  let logHandle;

  try {
    logHandle = await open(logPath, "a", 0o600);
    await lockHandle.writeFile(
      `${JSON.stringify({ pid: process.pid, startedAt: new Date().toISOString(), configPath })}\n`,
    );
    const importerCode = await runChild(
      path.join(root, "scripts/forward-import-package.mjs"),
      ["--config", configPath],
      logHandle,
    );
    if (importerCode !== 0) {
      process.stderr.write(`Forward import exited ${importerCode}; see ${logPath}.\n`);
      return importerCode;
    }

    if (args["status-handoff-dir"]) {
      if (!config.statusArtifactPath) {
        throw new Error(
          "--status-handoff-dir requires statusArtifactPath in the connector config.",
        );
      }
      const publisherCode = await runChild(
        path.join(root, "scripts/publish-forward-status.mjs"),
        [
          "--status",
          path.resolve(config.statusArtifactPath),
          "--output-dir",
          path.resolve(args["status-handoff-dir"]),
        ],
        logHandle,
      );
      if (publisherCode !== 0) {
        process.stderr.write(`Status handoff exited ${publisherCode}; see ${logPath}.\n`);
        return publisherCode;
      }
    }

    process.stdout.write(
      `${JSON.stringify({
        status: "ok",
        mode: config.apply === true ? "apply" : "dry-run",
        configPath,
        logPath,
        statusHandoffDir: args["status-handoff-dir"]
          ? path.resolve(args["status-handoff-dir"])
          : null,
      })}\n`,
    );
    return 0;
  } finally {
    if (logHandle) await logHandle.close();
    await lockHandle.close();
    await rm(lockPath, { force: true });
  }
};

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main()
    .then((code) => {
      process.exitCode = code;
    })
    .catch((error) => {
      process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
      process.stderr.write(usage);
      process.exitCode = 1;
    });
}
