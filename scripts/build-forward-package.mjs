#!/usr/bin/env node

import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";

import forwardSync from "../api/forward-sync.function.ts";

const usage = `
Forward package builder

Usage:
  node --experimental-strip-types scripts/build-forward-package.mjs --dependencies dependencies.json --output-dir out/package

Options:
  --dependencies path             Normalized dependency candidates JSON.
  --forward-base-url URL          Optional Forward URL metadata only.
  --forward-network-id id         Optional Forward network ID metadata only.
  --output-dir path               Output directory. Defaults to current directory.
  --ready-only                    Exclude mappingState=review rows. By default ready and review rows are exportable.
  --sync-mode manual-import       manual-import, data-connector, or intent-package.

Writes:
  forward-dynatrace-manifest.json
  forward-intent-checks.json

This does not contact Forward. Forward writes happen only through the Forward-side importer or connector.
`;

const parseArgs = (argv) => {
  const args = {};
  for (let index = 0; index < argv.length; index += 1) {
    const value = argv[index];
    if (!value.startsWith("--")) {
      throw new Error(`Unexpected positional argument: ${value}`);
    }
    const key = value.slice(2);
    if (key === "help" || key === "ready-only") {
      args[key] = true;
      continue;
    }
    const next = argv[index + 1];
    if (!next || next.startsWith("--")) {
      throw new Error(`Missing value for --${key}`);
    }
    args[key] = next;
    index += 1;
  }
  return args;
};

const validSyncModes = new Set(["manual-import", "data-connector", "intent-package"]);

const main = async () => {
  const args = parseArgs(process.argv.slice(2));
  if (args.help) {
    process.stdout.write(usage);
    return;
  }
  if (!args.dependencies) {
    throw new Error("Missing required --dependencies path.");
  }

  const syncMode = args["sync-mode"] || "manual-import";
  if (!validSyncModes.has(syncMode)) {
    throw new Error(`Unsupported --sync-mode ${syncMode}.`);
  }

  const dependencies = JSON.parse(await readFile(args.dependencies, "utf8"));
  if (!Array.isArray(dependencies)) {
    throw new Error("--dependencies must contain a JSON array.");
  }

  const selectedDependencies = dependencies.filter((dependency) =>
    args["ready-only"]
      ? dependency.mappingState === "ready"
      : dependency.mappingState !== "needs-map",
  );
  const packageDependencies = args["ready-only"]
    ? selectedDependencies
    : dependencies;

  const result = forwardSync({
    forwardBaseUrl: args["forward-base-url"],
    forwardNetworkId: args["forward-network-id"],
    syncMode,
    dependencies: packageDependencies,
  });

  if (result.status !== "ready") {
    throw new Error(result.summary);
  }

  const outputDir = args["output-dir"] || ".";
  await mkdir(outputDir, { recursive: true });
  const manifestPath = path.join(outputDir, "forward-dynatrace-manifest.json");
  const checksPath = path.join(outputDir, "forward-intent-checks.json");
  await writeFile(manifestPath, result.exportManifestPreview);
  await writeFile(checksPath, result.intentChecksPreview);

  process.stdout.write(
    JSON.stringify(
      {
        status: "ok",
        dependencies: dependencies.length,
        selectedDependencies: selectedDependencies.length,
        intentChecks: result.intentCheckCount,
        rejectedDependencies: result.rejectedDependencyCount,
        manifest: manifestPath,
        checks: checksPath,
      },
      null,
      2,
    ) + "\n",
  );
};

main().catch((error) => {
  process.stderr.write(`${error.message}\n`);
  process.stderr.write(usage);
  process.exit(1);
});
