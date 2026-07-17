#!/usr/bin/env node

import { spawn } from "node:child_process";
import { mkdir, mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";

import forwardSync from "../api/forward-sync.function.ts";
import { normalizeDynatraceRows } from "./normalize-dynatrace-dependencies.mjs";

const usage = `
Forward for Dynatrace demo rehearsal

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

const runCommand = (command, args) =>
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

export const buildDemoPackageRehearsal = async (outputDir) => {
  await mkdir(outputDir, { recursive: true });
  const rows = JSON.parse(await readFile("shared/demo-dynatrace-query-rows.json", "utf8"));
  const dependencies = normalizeDynatraceRows(
    rows.map((row) => ({ ...row, "demo.synthetic": true })),
  );
  const result = forwardSync({
    syncMode: "data-connector",
    dependencies: dependencies.filter((dependency) => dependency.mappingState !== "needs-map"),
  });

  const dependenciesPath = path.join(outputDir, "normalized-dependencies.json");
  const manifestPath = path.join(outputDir, "forward-dynatrace-manifest.json");
  const checksPath = path.join(outputDir, "forward-intent-checks.json");
  const reportPath = path.join(outputDir, "validate-report.json");
  const statusPath = path.join(outputDir, "forward-ingest-status.json");
  const manifest = JSON.parse(result.exportManifestPreview);

  await writeFile(dependenciesPath, JSON.stringify(dependencies, null, 2) + "\n");
  await writeFile(manifestPath, result.exportManifestPreview);
  await writeFile(checksPath, result.intentChecksPreview);

  await runCommand(process.execPath, [
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
  const [report, status] = await Promise.all([
    readFile(reportPath, "utf8").then(JSON.parse),
    readFile(statusPath, "utf8").then(JSON.parse),
  ]);
  if (report.status !== "valid" || status.importState !== "valid") {
    throw new Error("Forward validate-only rehearsal did not produce valid package evidence.");
  }

  return {
    schemaVersion: "forward-dynatrace-demo-package-rehearsal/v1",
    status: "ok",
    packageStatus: result.status,
    outputDir,
    provenance: {
      evidenceSource: "checked-dynatrace-demo-rehearsal",
      synthetic: true,
    },
    externalReads: 0,
    externalWrites: 0,
    packageId: manifest.packageId,
    generatedAt: manifest.generatedAt,
    intentChecksSha256: manifest.integrity.intentChecksSha256,
    rows: dependencies.length,
    syntheticRows: dependencies.filter((dependency) => dependency.synthetic === true).length,
    exportableRows: dependencies.filter((dependency) => dependency.mappingState === "ready").length,
    readyRows: dependencies.filter((dependency) => dependency.mappingState === "ready").length,
    reviewRows: dependencies.filter((dependency) => dependency.mappingState === "review").length,
    needsMapRows: dependencies.filter((dependency) => dependency.mappingState === "needs-map").length,
    intentChecks: result.intentCheckCount,
    validation: {
      mode: report.mode,
      status: report.status,
      plannedChecks: status.plannedChecks,
      mutationCounts: status.mutationCounts,
    },
    artifacts: [
      path.basename(dependenciesPath),
      path.basename(manifestPath),
      path.basename(checksPath),
      path.basename(reportPath),
      path.basename(statusPath),
    ],
  };
};

export const run = async (argv = process.argv.slice(2)) => {
  const args = parseArgs(argv);
  if (args.help) {
    process.stdout.write(usage);
    return 0;
  }

  const outputDir = args.outputDir
    ? path.resolve(args.outputDir)
    : await mkdtemp(path.join(tmpdir(), "forward-dynatrace-demo-"));
  const summary = await buildDemoPackageRehearsal(outputDir);
  process.stdout.write(`${JSON.stringify(summary, null, 2)}\n`);
  return 0;
};

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  run().then((code) => {
    process.exitCode = code;
  }).catch((error) => {
    process.stderr.write(`${error.message}\n`);
    process.exitCode = 1;
  });
}
