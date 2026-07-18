#!/usr/bin/env node

import { spawn } from "node:child_process";
import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import path from "node:path";

const DEFAULT_OUTPUT_DIR = "/tmp/forward-dynatrace-live-demo";
const DEFAULT_SHOWCASE_LIMIT = 12;
const EVIDENCE_SOURCE_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/;

const usage = `
Forward for Dynatrace live demo conductor

Usage:
  npm run demo:live -- \\
    --dynatrace-environment-url https://your-environment-id.apps.dynatrace.com/ \\
    --dynatrace-query-file /secure/queries/live-dependencies.dql \\
    --dynatrace-token-file /secure/path/platform-token \\
    --evidence-source opentelemetry-instrumented-transaction \\
    --output-dir /tmp/forward-dynatrace-live-demo

Options:
  --dynatrace-environment-url   Dynatrace Apps environment URL.
  --dynatrace-query-file        Required customer-owned DQL file for current live evidence.
  --dynatrace-token-file        Platform Token file outside the repo.
  --evidence-source             Publish-safe source label; required.
  --output-dir                  Evidence directory. Default: ${DEFAULT_OUTPUT_DIR}
  --publish-dynatrace-status    Publish sanitized aggregate reconciliation status to Dynatrace.
  --showcase-limit              Clean unique rows retained for the demo. Default: ${DEFAULT_SHOWCASE_LIMIT}
  --skip-path-evidence          Skip the default read-only Forward bulk path analysis stage.
  --help                        Show this help.

Required Forward environment:
  FORWARD_BASE_URL, FORWARD_AUTHORIZATION_FILE, FORWARD_NETWORK_ID,
  FORWARD_DYNATRACE_SOURCE_INSTANCE_ID

The conductor queries live Grail evidence, selects a concise showcase, resolves
its endpoints in Forward, evaluates modeled paths, builds the governed package,
and runs Forward reconciliation. Dry-run is the default. Dynatrace never
receives Forward credentials or check-level topology.
`;

export const parseArgs = (argv) => {
  const args = {};
  for (let index = 0; index < argv.length; index += 1) {
    const value = argv[index];
    if (value === "--synthetic") {
      throw new Error("--synthetic is not supported; the conductor accepts live evidence only.");
    }
    if (
      value === "--help" ||
      value === "--publish-dynatrace-status" ||
      value === "--skip-path-evidence" ||
      value === "--with-path-evidence"
    ) {
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

export const shouldRunPathEvidence = (args) => !args["skip-path-evidence"];

const containsNonLiveDependency = (dependencies) => dependencies.some((dependency) =>
  dependency?.synthetic === true ||
  dependency?.["demo.synthetic"] === true ||
  dependency?.["demo.replay"] === true ||
  dependency?.["forward.dynatrace.seeded"] === true ||
  dependency?.provenance?.synthetic === true ||
  dependency?.["event.provider"] === "forward-dynatrace-demo" ||
  dependency?.["event.type"] === "com.forward.demo.dependency" ||
  dependency?.owner === "dynatrace-demo" ||
  /^dynatrace-demo-/iu.test(String(dependency?.id || "")),
);

export const validateConductorProvenance = ({ dependencies = [], provenance, queryFile }) => {
  if (
    !provenance ||
    typeof provenance.evidenceSource !== "string" ||
    !EVIDENCE_SOURCE_PATTERN.test(provenance.evidenceSource) ||
    provenance.synthetic !== false
  ) {
    throw new Error(
      "Live provenance requires a publish-safe --evidence-source and synthetic=false.",
    );
  }
  if (!queryFile) {
    throw new Error("A customer-owned --dynatrace-query-file is required for live evidence.");
  }
  if (containsNonLiveDependency(dependencies)) {
    throw new Error(
      "Dynatrace query returned replay, seeded, fixture, or synthetic evidence; live-only processing stopped before any Forward write.",
    );
  }
  return provenance;
};

const conductorProvenanceFromArgs = (args) => validateConductorProvenance({
  dependencies: [],
  provenance: {
    evidenceSource: String(args["evidence-source"] || "").trim(),
    synthetic: false,
  },
  queryFile: args["dynatrace-query-file"],
});

const positiveInteger = (value, fallback, label) => {
  const parsed = Number.parseInt(value || String(fallback), 10);
  if (!Number.isInteger(parsed) || parsed <= 0) {
    throw new Error(`${label} must be a positive integer.`);
  }
  return parsed;
};

const cleanServiceName = (value) =>
  typeof value === "string" && value.trim() && !/^[_:]|:\d/u.test(value);

export const selectShowcaseDependencies = (
  dependencies,
  limit = DEFAULT_SHOWCASE_LIMIT,
) => {
  const selected = [];
  const seenFlows = new Set();

  for (const dependency of dependencies) {
    if (!cleanServiceName(dependency.serviceName)) continue;
    const flowKey = [
      dependency.source,
      dependency.destination,
      dependency.protocol,
      dependency.port,
    ].join("|");
    if (seenFlows.has(flowKey)) continue;
    seenFlows.add(flowKey);
    selected.push(dependency);
    if (selected.length === limit) break;
  }

  return selected;
};

export const noShowcaseDependenciesMessage = ({ rowCount, dependencyCount }) => {
  const observed = rowCount === 0
    ? "Live Dynatrace query returned zero dependency rows."
    : `Live Dynatrace query returned ${rowCount} rows and ${dependencyCount} normalized dependencies, but none had a clean service name and unique flow.`;
  return `${observed} No Forward call was attempted. Populate current customer-owned dependency evidence and rerun the live query.`;
};

export const buildNoShowcaseSummary = ({
  applyRequested,
  dependenciesPath,
  dependencyCount,
  environmentUrl,
  outputDir,
  provenance,
  publishDynatraceStatusRequested,
  rowCount,
  rowsPath,
}) => ({
  status: "blocked",
  reason: "NO_LIVE_SHOWCASE_DEPENDENCIES",
  message: noShowcaseDependenciesMessage({ rowCount, dependencyCount }),
  provenance,
  dynatrace: {
    environmentUrl,
    rawRows: rowCount,
    normalizedDependencies: dependencyCount,
    showcaseRows: 0,
    statusPublicationRequested: publishDynatraceStatusRequested,
    statusPublished: false,
  },
  forward: {
    attempted: false,
    applyRequested,
  },
  artifacts: {
    outputDir,
    queryRows: rowsPath,
    dependencies: dependenciesPath,
    showcaseDependencies: null,
  },
});

const run = (args, options = {}) =>
  new Promise((resolve, reject) => {
    const child = spawn(process.execPath, args, {
      cwd: process.cwd(),
      env: options.env || process.env,
      stdio: ["ignore", "pipe", "pipe"],
    });
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
        reject(new Error(`${args[0]} exited ${code}: ${(stderr || stdout).slice(0, 1200)}`));
        return;
      }
      resolve(stdout);
    });
  });

const requireForwardEnvironment = () => {
  const required = [
    "FORWARD_BASE_URL",
    "FORWARD_AUTHORIZATION_FILE",
    "FORWARD_NETWORK_ID",
    "FORWARD_DYNATRACE_SOURCE_INSTANCE_ID",
  ];
  const missing = required.filter((name) => !process.env[name]?.trim());
  if (missing.length > 0) {
    throw new Error(`Missing Forward environment: ${missing.join(", ")}.`);
  }
};

const main = async () => {
  const args = parseArgs(process.argv.slice(2));
  if (args.help) {
    process.stdout.write(usage);
    return;
  }

  const provenance = conductorProvenanceFromArgs(args);

  requireForwardEnvironment();
  const environmentUrl =
    args["dynatrace-environment-url"] || process.env.DYNATRACE_ENVIRONMENT_URL;
  const tokenFile = args["dynatrace-token-file"] || process.env.DYNATRACE_TOKEN_FILE;
  if (!environmentUrl) {
    throw new Error("Missing --dynatrace-environment-url or DYNATRACE_ENVIRONMENT_URL.");
  }
  if (!tokenFile && !process.env.DYNATRACE_TOKEN) {
    throw new Error("Missing --dynatrace-token-file, DYNATRACE_TOKEN_FILE, or DYNATRACE_TOKEN.");
  }

  const outputDir = path.resolve(args["output-dir"] || DEFAULT_OUTPUT_DIR);
  const showcaseLimit = positiveInteger(
    args["showcase-limit"],
    DEFAULT_SHOWCASE_LIMIT,
    "--showcase-limit",
  );
  const rowsPath = path.join(outputDir, "dynatrace-query-rows.json");
  const dependenciesPath = path.join(outputDir, "dynatrace-dependencies.json");
  const showcasePath = path.join(outputDir, "showcase-dependencies.json");
  const resolvedShowcasePath = path.join(outputDir, "resolved-showcase-dependencies.json");
  const hostResolutionReportPath = path.join(outputDir, "forward-host-resolution-report.json");
  const packageDir = path.join(outputDir, "forward-package");
  const reportPath = path.join(
    outputDir,
    "forward-dry-run-report.json",
  );
  const statusPath = path.join(outputDir, "forward-ingest-status.json");
  const statusHandoffDir = path.join(outputDir, "dynatrace-status-handoff");
  const statusEventPath = path.join(statusHandoffDir, "forward-ingest-status-event.json");
  const pathEvidencePath = path.join(outputDir, "forward-path-evidence.json");
  const summaryPath = path.join(outputDir, "demo-summary.json");
  await mkdir(outputDir, { recursive: true });
  if (!shouldRunPathEvidence(args)) {
    await rm(pathEvidencePath, { force: true });
  }

  await run([
    "scripts/query-dynatrace-dependencies.mjs",
    "--environment-url",
    environmentUrl,
    ...(tokenFile ? ["--token-file", tokenFile] : []),
    ...(args["dynatrace-query-file"]
      ? ["--query-file", path.resolve(args["dynatrace-query-file"])]
      : []),
    "--output",
    rowsPath,
    "--dependencies-output",
    dependenciesPath,
  ]);

  const rows = JSON.parse(await readFile(rowsPath, "utf8"));
  const dependencies = JSON.parse(await readFile(dependenciesPath, "utf8"));
  validateConductorProvenance({
    dependencies,
    provenance,
    queryFile: args["dynatrace-query-file"],
  });
  const showcase = selectShowcaseDependencies(dependencies, showcaseLimit);
  if (showcase.length === 0) {
    const blockedSummary = buildNoShowcaseSummary({
      applyRequested: false,
      dependenciesPath,
      dependencyCount: dependencies.length,
      environmentUrl,
      outputDir,
      provenance,
      publishDynatraceStatusRequested: Boolean(args["publish-dynatrace-status"]),
      rowCount: rows.length,
      rowsPath,
    });
    await writeFile(summaryPath, `${JSON.stringify(blockedSummary, null, 2)}\n`);
    throw new Error(`${blockedSummary.message} Evidence: ${summaryPath}`);
  }
  await writeFile(showcasePath, `${JSON.stringify(showcase, null, 2)}\n`);

  await run(
    [
      "scripts/forward-resolve-hosts.mjs",
      "--dependencies",
      showcasePath,
      "--execute",
      "--output",
      resolvedShowcasePath,
      "--report",
      hostResolutionReportPath,
      "--authorization-file",
      process.env.FORWARD_AUTHORIZATION_FILE,
    ],
  );
  const hostResolution = JSON.parse(await readFile(hostResolutionReportPath, "utf8"));
  const resolvedShowcase = JSON.parse(await readFile(resolvedShowcasePath, "utf8"));
  if (!resolvedShowcase.some((dependency) => dependency.mappingState === "ready")) {
    throw new Error(
      "Forward host resolution returned no ready showcase dependencies; review the host-resolution report.",
    );
  }

  let pathEvidence = null;
  if (shouldRunPathEvidence(args)) {
    await run(
      [
        "scripts/forward-path-evidence.mjs",
        "--dependencies",
        resolvedShowcasePath,
        "--execute",
        "--snapshot-id",
        hostResolution.target.snapshotId,
        "--output",
        pathEvidencePath,
        "--authorization-file",
        process.env.FORWARD_AUTHORIZATION_FILE,
      ],
    );
    pathEvidence = JSON.parse(await readFile(pathEvidencePath, "utf8"));
  }

  await run([
    "scripts/build-forward-package.mjs",
    "--dependencies",
    resolvedShowcasePath,
    "--output-dir",
    packageDir,
    "--sync-mode",
    "manual-import",
    "--source-instance-id",
    process.env.FORWARD_DYNATRACE_SOURCE_INSTANCE_ID,
  ]);

  await run([
    "scripts/forward-import-package.mjs",
    "--checks",
    path.join(packageDir, "forward-intent-checks.json"),
    "--manifest",
    path.join(packageDir, "forward-dynatrace-manifest.json"),
    "--report",
    reportPath,
    "--status-artifact",
    statusPath,
  ]);

  const report = JSON.parse(await readFile(reportPath, "utf8"));
  const status = JSON.parse(await readFile(statusPath, "utf8"));
  await run([
    "scripts/publish-forward-status.mjs",
    "--status",
    statusPath,
    "--output-dir",
    statusHandoffDir,
    "--evidence-source",
    provenance.evidenceSource,
  ]);

  let dynatraceStatusPublished = false;
  if (args["publish-dynatrace-status"]) {
    await run([
      "scripts/publish-dynatrace-status-event.mjs",
      "--event",
      statusEventPath,
      "--environment-url",
      environmentUrl,
      ...(tokenFile ? ["--token-file", tokenFile] : []),
      "--run-id",
      status.runId || `forward-dynatrace-live-${Date.now()}`,
      "--apply",
    ]);
    dynatraceStatusPublished = true;
  }

  const stateCounts = Object.fromEntries(
    ["ready", "review", "needs-map"].map((state) => [
      state,
      resolvedShowcase.filter((dependency) => dependency.mappingState === state).length,
    ]),
  );
  const summary = {
    status: "ok",
    mode: "dry-run",
    provenance,
    dynatrace: {
      environmentUrl,
      liveRows: dependencies.length,
      showcaseRows: showcase.length,
      stateCounts,
      statusPublished: dynatraceStatusPublished,
      hostResolution: {
        status: "completed",
        counts: hostResolution.counts,
      },
      pathEvidence: pathEvidence
        ? {
            status: pathEvidence.status,
            counts: pathEvidence.counts,
          }
        : null,
    },
    forward: {
      baseUrl: process.env.FORWARD_BASE_URL,
      networkId: report.networkId,
      snapshotId: report.snapshotId,
      plannedChecks: report.plannedChecks,
      counts: report.counts,
      mutationCounts: report.mutationCounts,
    },
    artifacts: {
      outputDir,
      showcaseDependencies: showcasePath,
      resolvedShowcaseDependencies: resolvedShowcasePath,
      hostResolutionReport: hostResolutionReportPath,
      packageDir,
      report: reportPath,
      status: statusPath,
      statusHandoff: statusHandoffDir,
      statusEvent: statusEventPath,
      pathEvidence: pathEvidence ? pathEvidencePath : null,
    },
  };
  await writeFile(summaryPath, `${JSON.stringify(summary, null, 2)}\n`);
  process.stdout.write(`${JSON.stringify(summary, null, 2)}\n`);
};

if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch((error) => {
    process.stderr.write(`${error.message}\n`);
    process.exit(1);
  });
}
