#!/usr/bin/env node

import { spawn } from "node:child_process";
import {
  lstat,
  mkdtemp,
  readdir,
  readFile,
  rm,
  symlink,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const appConfigPath = path.join(root, "app.config.json");

const usage = `Usage:
  npm run dynatrace:deploy -- --environment-url URL [options]

Options:
  --environment-url URL   Target Dynatrace Apps URL.
  --app-id ID             Temporary app ID for this deploy. Use my.* for unsigned trial installs.
  --app-version VERSION   Temporary SemVer app version for iterative trial deploys.
  --uninstall             Remove the selected app identity instead of deploying it.
  --sign-archive          Sign the app archive. Required for non-my.* app IDs.
  --dry-run               Build a distributable archive without installing it.
  --no-open               Do not open a browser.
  --non-interactive       Fail instead of prompting.
  --skip-build            Pass through to dt-app deploy.
  --no-type-check         Pass through to dt-app deploy.
  --optimize              Pass through to dt-app deploy.
  --help                  Show this help.

Enterprise install:
  DT_APP_OAUTH_SIGN_CLIENT_ID=... DT_APP_OAUTH_SIGN_CLIENT_SECRET=... \\
    npm run dynatrace:deploy -- --environment-url https://your-environment-id.apps.dynatrace.com/ --sign-archive

Trial install:
  npm run dynatrace:deploy -- \\
    --environment-url https://your-environment-id.apps.dynatrace.com/ \\
    --app-id my.forward \\
    --no-open --non-interactive
`;

const booleanOptions = new Set([
  "--dry-run",
  "--help",
  "--no-open",
  "--no-type-check",
  "--non-interactive",
  "--optimize",
  "--sign-archive",
  "--skip-build",
  "--uninstall",
]);

const valueOptions = new Set(["--app-id", "--app-version", "--environment-url"]);
const tempWorkspaceSkips = new Set([".git", "app.config.json", "dist", "out", "tmp"]);

export const parseArgs = (argv) => {
  const args = {
    appId: undefined,
    appVersion: undefined,
    environmentUrl: undefined,
    dryRun: false,
    help: false,
    noOpen: false,
    noTypeCheck: false,
    nonInteractive: false,
    optimize: false,
    signArchive: false,
    skipBuild: false,
    uninstall: false,
  };

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];

    if (valueOptions.has(arg)) {
      const value = argv[index + 1];
      if (!value || value.startsWith("--")) {
        throw new Error(`${arg} requires a value.`);
      }
      index += 1;
      if (arg === "--app-id") args.appId = value;
      if (arg === "--app-version") args.appVersion = value;
      if (arg === "--environment-url") args.environmentUrl = value;
      continue;
    }

    if (booleanOptions.has(arg)) {
      if (arg === "--dry-run") args.dryRun = true;
      if (arg === "--help") args.help = true;
      if (arg === "--no-open") args.noOpen = true;
      if (arg === "--no-type-check") args.noTypeCheck = true;
      if (arg === "--non-interactive") args.nonInteractive = true;
      if (arg === "--optimize") args.optimize = true;
      if (arg === "--sign-archive") args.signArchive = true;
      if (arg === "--skip-build") args.skipBuild = true;
      if (arg === "--uninstall") args.uninstall = true;
      continue;
    }

    throw new Error(`Unknown option: ${arg}`);
  }

  return args;
};

export const validateDeployArgs = (args, defaultAppId, env = process.env) => {
  if (args.help) return;

  if (!args.environmentUrl) {
    throw new Error("--environment-url is required.");
  }

  const targetAppId = args.appId || defaultAppId;
  if (!/^[a-z][a-z0-9]*(\.[a-z0-9][a-z0-9-]*)+$/.test(targetAppId)) {
    throw new Error(`Invalid Dynatrace app ID: ${targetAppId}`);
  }
  if (args.appVersion && !/^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/.test(args.appVersion)) {
    throw new Error(`Invalid Dynatrace app version: ${args.appVersion}`);
  }

  if (args.uninstall && args.signArchive) {
    throw new Error("--uninstall cannot be combined with --sign-archive.");
  }
  if (args.uninstall && (args.optimize || args.skipBuild || args.noTypeCheck)) {
    throw new Error(
      "--uninstall cannot be combined with build-only options (--optimize, --skip-build, or --no-type-check).",
    );
  }

  const isUnsignedDeployAllowed = targetAppId.startsWith("my.") || args.dryRun || args.uninstall;
  if (!args.signArchive && !isUnsignedDeployAllowed) {
    throw new Error(
      [
        `App ID ${targetAppId} is outside the my.* namespace.`,
        "Use --sign-archive for an enterprise install, or pass --app-id my.forward for an unsigned sandbox install.",
      ].join(" "),
    );
  }

  if (args.signArchive) {
    const hasClientId = Boolean(env.DT_APP_OAUTH_SIGN_CLIENT_ID || env.DT_APP_OAUTH_CLIENT_ID);
    const hasClientSecret = Boolean(
      env.DT_APP_OAUTH_SIGN_CLIENT_SECRET || env.DT_APP_OAUTH_CLIENT_SECRET,
    );
    if (!hasClientId || !hasClientSecret) {
      throw new Error(
        "--sign-archive requires DT_APP_OAUTH_SIGN_CLIENT_ID/DT_APP_OAUTH_SIGN_CLIENT_SECRET or DT_APP_OAUTH_CLIENT_ID/DT_APP_OAUTH_CLIENT_SECRET.",
      );
    }
  }
};

const buildDtAppArgs = (args) => {
  const dtArgs = [args.uninstall ? "uninstall" : "deploy", "--environment-url", args.environmentUrl];
  if (args.signArchive) dtArgs.push("--sign-archive");
  if (args.dryRun) dtArgs.push("--dry-run");
  if (args.noOpen) dtArgs.push("--no-open");
  if (args.noTypeCheck) dtArgs.push("--no-type-check");
  if (args.nonInteractive) dtArgs.push("--non-interactive");
  if (args.optimize) dtArgs.push("--optimize");
  if (args.skipBuild) dtArgs.push("--skip-build");
  return dtArgs;
};

const createDeployWorkspace = async (appConfig, targetAppId, appVersion) => {
  const deployRoot = await mkdtemp(path.join(tmpdir(), "forward-dynatrace-deploy-"));
  const deployConfig = structuredClone(appConfig);
  deployConfig.app.id = targetAppId;
  if (appVersion) deployConfig.app.version = appVersion;

  for (const entry of await readdir(root)) {
    if (tempWorkspaceSkips.has(entry)) continue;

    const source = path.join(root, entry);
    const destination = path.join(deployRoot, entry);
    const details = await lstat(source);
    await symlink(source, destination, details.isDirectory() ? "dir" : "file");
  }

  await writeFile(
    path.join(deployRoot, "app.config.json"),
    `${JSON.stringify(deployConfig, null, 2)}\n`,
  );
  return deployRoot;
};

const run = async () => {
  const args = parseArgs(process.argv.slice(2));
  if (args.help) {
    process.stdout.write(usage);
    return;
  }

  const appConfig = JSON.parse(await readFile(appConfigPath, "utf8"));
  const defaultAppId = appConfig.app?.id;
  validateDeployArgs(args, defaultAppId);

  const targetAppId = args.appId || defaultAppId;
  let childProcess;
  let deployRoot;
  let cleanedUp = false;
  let shuttingDown = false;
  const cleanup = async () => {
    if (!cleanedUp && deployRoot) {
      await rm(deployRoot, { recursive: true, force: true });
      cleanedUp = true;
    }
  };

  const handleSignal = async (signal) => {
    if (shuttingDown) return;
    shuttingDown = true;
    if (childProcess && !childProcess.killed) {
      childProcess.kill(signal);
    }
    await cleanup();
    process.exit(signal === "SIGINT" ? 130 : 143);
  };

  process.once("SIGINT", () => {
    void handleSignal("SIGINT");
  });
  process.once("SIGTERM", () => {
    void handleSignal("SIGTERM");
  });

  try {
    deployRoot = await createDeployWorkspace(appConfig, targetAppId, args.appVersion);

    childProcess = spawn(path.join(root, "node_modules/.bin/dt-app"), buildDtAppArgs(args), {
      cwd: deployRoot,
      env: process.env,
      stdio: "inherit",
    });

    const exitCode = await new Promise((resolve) => {
      childProcess.on("close", (code, signal) => {
        if (signal) {
          resolve(1);
          return;
        }
        resolve(code ?? 1);
      });
    });

    process.exitCode = exitCode;
  } finally {
    await cleanup();
  }
};

if (import.meta.url === `file://${process.argv[1]}`) {
  run().catch((error) => {
    process.stderr.write(`${error.message}\n`);
    process.exitCode = 1;
  });
}
