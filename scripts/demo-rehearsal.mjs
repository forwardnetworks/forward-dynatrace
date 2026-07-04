#!/usr/bin/env node

import { spawn } from "node:child_process";
import { mkdir, mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

import forwardSync from "../api/forward-sync.function.ts";
import { normalizeDynatraceRows } from "./normalize-dynatrace-dependencies.mjs";

const usage = `
Forward Integration for Dynatrace demo rehearsal

Usage:
  node --experimental-strip-types scripts/demo-rehearsal.mjs
  node --experimental-strip-types scripts/demo-rehearsal.mjs --output-dir /tmp/forward-dynatrace-demo

Generates a Dynatrace-shaped dependency export, builds the Forward package, and
validates the package without Forward credentials.
`;

const parseArgs = (argv) => {
  const args = {};
  for (let index = 0; index < argv.length; index += 1) {
    const value = argv[index];
    if (value === "--help") {
      args.help = true;
      continue;
    }
    if (value === "--output-dir") {
      const next = argv[index + 1];
      if (!next || next.startsWith("--")) {
        throw new Error("Missing value for --output-dir.");
      }
      args.outputDir = next;
      index += 1;
      continue;
    }
    throw new Error(`Unsupported option: ${value}`);
  }
  return args;
};

const run = (command, args) =>
  new Promise((resolve, reject) => {
    const child = spawn(command, args, { stdio: ["ignore", "pipe", "pipe"] });
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (chunk) => {
      stdout += chunk;
    });
    child.stderr.on("data", (chunk) => {
      stderr += chunk;
    });
    child.on("error", reject);
    child.on("close", (code) => {
      if (code !== 0) {
        reject(new Error(`${command} ${args.join(" ")} exited ${code}: ${stderr || stdout}`));
        return;
      }
      resolve(stdout);
    });
  });

const main = async () => {
  const args = parseArgs(process.argv.slice(2));
  if (args.help) {
    process.stdout.write(usage);
    return;
  }

  const outputDir = args.outputDir || await mkdtemp(path.join(tmpdir(), "forward-dynatrace-demo-"));
  await mkdir(outputDir, { recursive: true });
  const rows = JSON.parse(await readFile("shared/demo-dynatrace-query-rows.json", "utf8"));
  const dependencies = normalizeDynatraceRows(rows);
  const result = forwardSync({
    syncMode: "data-connector",
    dependencies: dependencies.filter((dependency) => dependency.mappingState !== "needs-map"),
  });

  const dependenciesPath = path.join(outputDir, "normalized-dependencies.json");
  const manifestPath = path.join(outputDir, "forward-dynatrace-manifest.json");
  const checksPath = path.join(outputDir, "forward-intent-checks.json");
  const reportPath = path.join(outputDir, "validate-report.json");
  const statusPath = path.join(outputDir, "forward-ingest-status.json");

  await writeFile(dependenciesPath, JSON.stringify(dependencies, null, 2) + "\n");
  await writeFile(manifestPath, result.exportManifestPreview);
  await writeFile(checksPath, result.intentChecksPreview);

  await run(process.execPath, [
    "scripts/forward-import-package.mjs",
    "--checks",
    checksPath,
    "--manifest",
    manifestPath,
    "--validate-only",
    "--report",
    reportPath,
    "--status-artifact",
    statusPath,
  ]);

  process.stdout.write(
    JSON.stringify(
      {
        status: "ok",
        packageStatus: result.status,
        outputDir,
        rows: dependencies.length,
        exportableRows: dependencies.filter((dependency) => dependency.mappingState === "ready").length,
        readyRows: dependencies.filter((dependency) => dependency.mappingState === "ready").length,
        reviewRows: dependencies.filter((dependency) => dependency.mappingState === "review").length,
        needsMapRows: dependencies.filter((dependency) => dependency.mappingState === "needs-map").length,
        intentChecks: result.intentCheckCount,
        artifacts: [
          path.basename(dependenciesPath),
          path.basename(manifestPath),
          path.basename(checksPath),
          path.basename(reportPath),
          path.basename(statusPath),
        ],
      },
      null,
      2,
    ) + "\n",
  );
};

main().catch((error) => {
  process.stderr.write(`${error.message}\n`);
  process.exit(1);
});
