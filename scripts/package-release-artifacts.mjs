#!/usr/bin/env node

import { spawn } from "node:child_process";
import { copyFile, mkdir, readFile, stat, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

const usage = `
Dynatrace app release packager

Usage:
  node scripts/package-release-artifacts.mjs \\
    --app-archive out/my.forward.zip \\
    --output-dir out/release \\
    --release-name v0.11.0

Validates and publishes one tenant-validated Dynatrace app bundle plus its SBOM and SHA256SUMS.
There is no Forward runtime, container image, service, agent, or second installable.
`;

const requiredAppMembers = [
  "manifest.yaml",
  "api/dependency-discovery.js",
  "api/run-forward-nqe-evidence.js",
  "api/sync-forward-intent-checks.js",
  "settings/schemas/forward-api-connection.schema.json",
  "settings/schemas/dependency-discovery-profile.schema.json",
  "widgets/actions/run-forward-nqe-evidence/index.js",
  "widgets/actions/sync-forward-intent-checks/index.js",
];

const parseArgs = (argv) => {
  const args = {};
  for (let index = 0; index < argv.length; index += 1) {
    const option = argv[index];
    if (option === "--help") {
      args.help = true;
      continue;
    }
    if (["--app-archive", "--output-dir", "--release-name"].includes(option)) {
      const value = argv[index + 1];
      if (!value || value.startsWith("--")) throw new Error(`Missing value for ${option}.`);
      args[option.slice(2)] = value;
      index += 1;
      continue;
    }
    throw new Error(`Unsupported option: ${option}`);
  }
  return args;
};

const run = (command, args, options = {}) => new Promise((resolve, reject) => {
  const child = spawn(command, args, {
    cwd: root,
    stdio: ["ignore", "pipe", "pipe"],
    ...options,
  });
  let stdout = "";
  let stderr = "";
  child.stdout.on("data", (value) => { stdout += value; });
  child.stderr.on("data", (value) => { stderr += value; });
  child.on("error", reject);
  child.on("close", (code) => {
    if (code !== 0) {
      reject(new Error(`${command} ${args.join(" ")} exited ${code}:\n${stderr || stdout}`));
      return;
    }
    resolve(stdout);
  });
});

const safeReleaseName = (value) => value
  .trim()
  .replace(/\/+/gu, "-")
  .replace(/[^A-Za-z0-9._-]+/gu, "-")
  .replace(/^-|-$/gu, "");

const manifestField = (manifest, name) => {
  const match = manifest.match(new RegExp(`^${name}:\\s*([^\\r\\n]+)$`, "mu"));
  return match?.[1]?.trim() || "";
};

const assertAppArchive = async (archivePath, releaseName) => {
  const archiveStat = await stat(archivePath);
  if (!archiveStat.isFile() || archiveStat.size === 0) {
    throw new Error("--app-archive must be a non-empty Dynatrace app .zip file.");
  }
  if (path.extname(archivePath).toLowerCase() !== ".zip") {
    throw new Error("--app-archive must end in .zip.");
  }
  const members = (await run("unzip", ["-Z1", archivePath]))
    .split(/\r?\n/u)
    .filter(Boolean);
  for (const member of requiredAppMembers) {
    if (!members.includes(member)) throw new Error(`Dynatrace app archive is missing ${member}.`);
  }
  const manifest = await run("unzip", ["-p", archivePath, "manifest.yaml"]);
  const appId = manifestField(manifest, "id");
  const appVersion = manifestField(manifest, "version");
  if (!new Set(["my.forward", "com.forward.dynatrace"]).has(appId)) {
    throw new Error(`Unsupported Dynatrace app ID in archive: ${appId || "missing"}.`);
  }
  const expectedVersion = releaseName.replace(/^v/u, "");
  if (appVersion !== expectedVersion) {
    throw new Error(`Dynatrace app version ${appVersion || "missing"} does not match ${releaseName}.`);
  }
  if (manifestField(manifest, "name") !== "Forward") {
    throw new Error("Dynatrace app manifest name must be Forward.");
  }
  return { appId, appVersion };
};

const main = async () => {
  const args = parseArgs(process.argv.slice(2));
  if (args.help) {
    process.stdout.write(usage);
    return;
  }
  if (!args["app-archive"]) throw new Error("--app-archive is required.");
  if (!args["release-name"]) throw new Error("--release-name is required.");
  const releaseName = safeReleaseName(args["release-name"]);
  if (!releaseName) throw new Error("Release name must contain a safe filename character.");
  const archiveInput = path.resolve(root, args["app-archive"]);
  const identity = await assertAppArchive(archiveInput, releaseName);
  const outputDir = path.resolve(root, args["output-dir"] || "out/release");
  await mkdir(outputDir, { recursive: true });

  const appArchive = path.join(outputDir, `forward-dynatrace-app-${releaseName}.zip`);
  const sbom = path.join(outputDir, `forward-dynatrace-sbom-${releaseName}.cdx.json`);
  const checksums = path.join(outputDir, "SHA256SUMS");
  if (archiveInput !== appArchive) await copyFile(archiveInput, appArchive);
  await run("npm", ["sbom", "--omit=dev", "--sbom-format=cyclonedx"])
    .then((stdout) => writeFile(sbom, stdout));
  await run(process.execPath, [
    "scripts/write-release-checksums.mjs",
    "--output",
    checksums,
    appArchive,
    sbom,
  ]);
  const checksumLines = (await readFile(checksums, "utf8")).trim().split(/\r?\n/u);
  if (checksumLines.length !== 2) {
    throw new Error(`SHA256SUMS must contain exactly two entries; found ${checksumLines.length}.`);
  }
  process.stdout.write(`${JSON.stringify({
    status: "ok",
    installable: path.basename(appArchive),
    appId: identity.appId,
    appVersion: identity.appVersion,
    outputDir,
    artifacts: [path.basename(appArchive), path.basename(sbom), path.basename(checksums)],
  }, null, 2)}\n`);
};

main().catch((error) => {
  process.stderr.write(`${error.message}\n`);
  process.stderr.write(usage);
  process.exit(1);
});
