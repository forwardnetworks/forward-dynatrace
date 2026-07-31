#!/usr/bin/env node

import { mkdir, readFile, writeFile } from "node:fs/promises";
import Module from "node:module";
import path from "node:path";
import { fileURLToPath } from "node:url";

import {
  _GetDtAppFileConfig as getDtAppFileConfig,
  _MergeOptions as mergeOptions,
  getDefaultCliOptions,
} from "dt-app";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const REQUIRED_ENTRIES = Object.freeze([
  "manifest.yaml",
  "icon.svg",
  "ui/index.html",
  "ui/main.js",
  "api/dependency-discovery.js",
  "api/forward-sync.js",
  "api/run-forward-nqe-evidence.js",
  "api/sync-forward-intent-checks.js",
  "settings/schemas/dependency-discovery-profile.schema.json",
  "settings/schemas/forward-api-connection.schema.json",
]);
const EXPECTED_TOOLKIT_VERSION = "1.13.1";

const usage = `Usage:
  npm run dynatrace:archive -- --app-id ID --app-version VERSION --output FILE

Builds the installable Dynatrace app archive from the existing pinned-toolkit build.
The command is tenant-independent and performs no network requests.
`;

export const parseArgs = (argv) => {
  const args = { appId: undefined, appVersion: undefined, output: undefined };
  for (let index = 0; index < argv.length; index += 1) {
    const option = argv[index];
    if (option === "--help") return { ...args, help: true };
    if (!new Set(["--app-id", "--app-version", "--output"]).has(option)) {
      throw new Error(`Unknown option: ${option}`);
    }
    const value = argv[index + 1];
    if (!value || value.startsWith("--")) throw new Error(`${option} requires a value.`);
    index += 1;
    if (option === "--app-id") args.appId = value;
    if (option === "--app-version") args.appVersion = value;
    if (option === "--output") args.output = value;
  }
  return args;
};

export const validateArgs = (args) => {
  if (args.help) return;
  if (!args.appId || !/^[a-z][a-z0-9]*(\.[a-z0-9][a-z0-9-]*)+$/u.test(args.appId)) {
    throw new Error("--app-id must be a valid Dynatrace app ID.");
  }
  if (!args.appVersion || !/^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/u.test(args.appVersion)) {
    throw new Error("--app-version must be valid SemVer.");
  }
  if (!args.output) throw new Error("--output is required.");
};

const manifestField = (manifest, name) => {
  const match = manifest.match(new RegExp(`^${name}:\\s*([^\\n]+)$`, "mu"));
  return match?.[1]?.trim();
};

const loadPinnedToolkitArtifactBuilder = async () => {
  const toolkitPackagePath = import.meta.resolve("dt-app/package.json");
  const toolkitPackage = JSON.parse(await readFile(fileURLToPath(toolkitPackagePath), "utf8"));
  if (toolkitPackage.version !== EXPECTED_TOOLKIT_VERSION) {
    throw new Error(
      `Unsupported dt-app version ${toolkitPackage.version}; expected ${EXPECTED_TOOLKIT_VERSION}. Review the archive builder before upgrading.`,
    );
  }

  const require = Module.createRequire(import.meta.url);
  const toolkitBin = require.resolve("dt-app/lib/src/bin.js");
  const source = await readFile(toolkitBin, "utf8");
  if (!source.includes("async function ba(") || !source.includes("if(require.main===module)")) {
    throw new Error("Pinned dt-app archive preparation entry point is unavailable.");
  }

  // dt-app keeps its typed prepareArtifact implementation private to the CLI bundle.
  // Export that pinned implementation in memory so releases use the toolkit's own
  // manifest, dependency, settings-schema, and ZIP preparation without tenant I/O.
  const loaded = new Module(toolkitBin);
  loaded.filename = toolkitBin;
  loaded.paths = Module._nodeModulePaths(path.dirname(toolkitBin));
  loaded._compile(`${source}\nmodule.exports.__forwardPrepareArtifact = ba;\n`, toolkitBin);
  if (typeof loaded.exports.__forwardPrepareArtifact !== "function") {
    throw new Error("Pinned dt-app archive preparation entry point did not load.");
  }
  return loaded.exports.__forwardPrepareArtifact;
};

export const buildArchive = async ({ appId, appVersion, output }) => {
  const prepareArtifact = await loadPinnedToolkitArtifactBuilder();
  const defaults = getDefaultCliOptions(false, "./", root);
  const fileConfig = await getDtAppFileConfig(root);
  const options = mergeOptions(defaults, fileConfig);
  options.app.id = appId;
  options.app.version = appVersion;

  const { appArtifact } = await prepareArtifact(options, {
    shouldBuild: false,
    shouldValidateManifest: false,
  });
  const entries = new Set(appArtifact.getEntries().map((entry) => entry.entryName));
  for (const required of REQUIRED_ENTRIES) {
    if (!entries.has(required)) throw new Error(`Dynatrace app archive is missing ${required}.`);
  }
  for (const entry of entries) {
    if (entry.startsWith("/") || entry.includes("\\") || entry.split("/").includes("..")) {
      throw new Error(`Dynatrace app archive contains an unsafe member: ${entry}`);
    }
  }

  const manifest = appArtifact.readAsText("manifest.yaml");
  if (manifestField(manifest, "id") !== appId) throw new Error("Archive app ID is incorrect.");
  if (manifestField(manifest, "version") !== appVersion) {
    throw new Error("Archive app version is incorrect.");
  }
  if (manifestField(manifest, "name") !== "Forward") throw new Error("Archive app name is incorrect.");

  const outputPath = path.resolve(root, output);
  await mkdir(path.dirname(outputPath), { recursive: true });
  const bytes = appArtifact.toBuffer();
  await writeFile(outputPath, bytes, { mode: 0o600 });
  return { appId, appVersion, archive: path.basename(outputPath), bytes: bytes.length };
};

const main = async () => {
  const args = parseArgs(process.argv.slice(2));
  if (args.help) {
    process.stdout.write(usage);
    return;
  }
  validateArgs(args);
  const result = await buildArchive(args);
  process.stdout.write(`${JSON.stringify(result)}\n`);
};

if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch((error) => {
    process.stderr.write(`${error instanceof Error ? error.message : "Dynatrace archive build failed."}\n`);
    process.exitCode = 1;
  });
}
