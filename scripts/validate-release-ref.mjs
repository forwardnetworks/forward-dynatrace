#!/usr/bin/env node

import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

const usage = `
Release ref validator

Usage:
  node scripts/validate-release-ref.mjs --release-name v1.2.3 [--root path]

Requires an exact match between the release ref, package.json, package-lock.json,
and app.config.json. GITHUB_REF_NAME is used when --release-name is omitted.
`;

const parseArgs = (argv) => {
  const args = {};
  for (let index = 0; index < argv.length; index += 1) {
    const value = argv[index];
    if (value === "--help" || value === "-h") {
      args.help = true;
      continue;
    }
    if (value === "--release-name") {
      if (!argv[index + 1]) {
        throw new Error("--release-name requires a value.");
      }
      args.releaseName = argv[index + 1];
      index += 1;
      continue;
    }
    if (value === "--root") {
      if (!argv[index + 1]) {
        throw new Error("--root requires a value.");
      }
      args.root = argv[index + 1];
      index += 1;
      continue;
    }
    throw new Error(`Unknown argument: ${value}`);
  }
  return args;
};

const readJson = async (repositoryRoot, relativePath) =>
  JSON.parse(await readFile(path.join(repositoryRoot, relativePath), "utf8"));

const main = async () => {
  const args = parseArgs(process.argv.slice(2));
  if (args.help) {
    process.stdout.write(usage);
    return;
  }

  const releaseName = args.releaseName || process.env.GITHUB_REF_NAME;
  if (!releaseName) {
    throw new Error("Release name is required through --release-name or GITHUB_REF_NAME.");
  }

  const repositoryRoot = args.root ? path.resolve(args.root) : root;
  const packageJson = await readJson(repositoryRoot, "package.json");
  const packageLock = await readJson(repositoryRoot, "package-lock.json");
  const appConfig = await readJson(repositoryRoot, "app.config.json");
  const versions = new Map([
    ["package.json", packageJson.version],
    ["package-lock.json", packageLock.version],
    ["package-lock root package", packageLock.packages?.[""]?.version],
    ["app.config.json", appConfig.app?.version],
  ]);
  const uniqueVersions = new Set(versions.values());
  if (uniqueVersions.size !== 1 || uniqueVersions.has(undefined)) {
    throw new Error(
      `Release version mismatch: ${[...versions.entries()]
        .map(([source, version]) => `${source}=${version ?? "missing"}`)
        .join(", ")}`,
    );
  }

  const version = packageJson.version;
  const expectedReleaseName = `v${version}`;
  if (releaseName !== expectedReleaseName) {
    throw new Error(
      `Release ref ${releaseName} does not match repository version ${version}; expected ${expectedReleaseName}. Update package.json, package-lock.json, and app.config.json before tagging.`,
    );
  }

  process.stdout.write(`Release ref ${releaseName} matches repository version ${version}.\n`);
};

main().catch((error) => {
  process.stderr.write(`${error.message}\n${usage}`);
  process.exitCode = 1;
});
