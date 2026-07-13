#!/usr/bin/env node

import { mkdir, mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";

import { buildDemoPackageRehearsal } from "./demo-rehearsal.mjs";
import { buildDemoRehearsal as buildServiceNowRehearsal } from "./servicenow-demo-rehearsal.mjs";

const SHOWCASE_SCHEMA = "forward-dynatrace-two-act-showcase/v1";
const EVIDENCE_SOURCE = "checked-two-act-demo-showcase";

const usage = `
ServiceNow, Forward, and Dynatrace two-act demo showcase

Usage:
  npm run demo:showcase
  npm run demo:showcase -- --output-dir /tmp/servicenow-forward-dynatrace-showcase

Options:
  --output-dir path  Write the complete presenter bundle to this directory.
                     Default: a new temporary directory.
  --help             Show this help.

The showcase is synthetic and credential-free. It builds the Dynatrace-to-Forward
intent package and the ServiceNow safe/regression assurance story through production
builders, performs zero external reads or writes, and labels every claim accordingly.
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

const canonicalJson = (value) => `${JSON.stringify(value, null, 2)}\n`;

const showcaseMarkdown = (summary) => {
  const intent = summary.acts.intent;
  const scenarios = summary.acts.assurance.scenarios;
  const scenarioRows = scenarios.map((scenario) => [
    scenario.change.number,
    scenario.decision.toUpperCase(),
    `${scenario.forward.beforeSnapshotId} → ${scenario.forward.afterSnapshotId}`,
    `${scenario.forward.beforeReachable} → ${scenario.forward.afterReachable}`,
    String(scenario.forward.afterBlocked),
    scenario.dynatrace.serviceHealth,
    scenario.reasonCodes.join(", "),
    scenario.serviceNow.evidenceSha256,
  ]);

  return [
    "# ServiceNow → Forward → Dynatrace Two-Act Showcase",
    "",
    "> **SYNTHETIC DEMO SHOWCASE.** This bundle contacted and changed no external system. Use it to rehearse the real workflow, never as customer acceptance evidence.",
    "",
    "## Outcome",
    "",
    "Dynatrace-observed application dependencies become Forward-reviewed intent. An approved ServiceNow change then receives one checksummed decision that binds exact Forward modeled-network snapshots to Dynatrace application health.",
    "",
    "## Act 1 — Dynatrace Dependency Evidence Becomes Forward Intent",
    "",
    `- Normalized dependency rows: **${intent.rows}**`,
    `- Explicitly synthetic dependency rows: **${intent.syntheticRows}**`,
    `- Forward-ready rows: **${intent.readyRows}**`,
    `- Generated Forward checks: **${intent.intentChecks}**`,
    `- Package ID: \`${intent.packageId}\``,
    `- Intent-check SHA-256: \`${intent.intentChecksSha256}\``,
    `- Forward-side validation: **${intent.validation.status}**; **${intent.validation.plannedChecks}** checks planned, **${Object.values(intent.validation.mutationCounts).reduce((total, count) => total + count, 0)}** mutations.`,
    "- Validation mode: **validate-only**; no Forward credential or API call was used.",
    "- Default apply policy: **create missing only**; changed and stale checks remain report-only.",
    "",
    "Presenter path:",
    "",
    "1. Open [normalized dependencies](intent/normalized-dependencies.json) and explain ready/review/needs-map governance plus explicit synthetic provenance.",
    "2. Open the [package manifest](intent/forward-dynatrace-manifest.json) and match its package ID and checksum to this page.",
    "3. Open the [Forward intent checks](intent/forward-intent-checks.json) and show the Forward-native `NewNetworkCheck[]` payload and `provenance:synthetic` tags.",
    "4. Open the [validation report](intent/validate-report.json) and [zero-mutation status](intent/forward-ingest-status.json); explain that live dry-run/apply remains Forward-side and separately approved.",
    "",
    "## Act 2 — ServiceNow Governs A Cross-Domain Change Decision",
    "",
    "| Change | Decision | Forward snapshots | Reachable pre → post | Blocked post | Dynatrace health | Reasons | ServiceNow evidence SHA-256 |",
    "| --- | --- | --- | ---: | ---: | --- | --- | --- |",
    ...scenarioRows.map((row) => `| ${row.join(" | ")} |`),
    "",
    "Presenter path:",
    "",
    "1. Start with the safe change: Forward remains reachable, Dynatrace remains healthy, and the gate supports proceeding.",
    "2. Match the ServiceNow attachment SHA-256 to `forward.dynatrace.servicenow_evidence_sha256` in the corresponding Dynatrace event.",
    "3. Switch to the regression: show the reachability loss, blocked modeled paths, unhealthy service, open problem, and explicit fail reasons.",
    "4. Show the dry-run ServiceNow receipt and deterministic idempotency key; the live retry gate must reuse the same attachment and work-note sys_ids.",
    "5. Reinforce the boundary: ServiceNow approves, the deployment system deploys or rolls back, Forward owns network intent, and Dynatrace owns application evidence.",
    "",
    "## Replace Rehearsal Evidence Before A Live Claim",
    "",
    "- authoritative current-window ServiceNow read and approved writeback;",
    "- customer-approved Forward before/after snapshots and reconciliation readback;",
    "- fresh Dynatrace deployment/health context and Grail query-back;",
    "- retry receipt proving no duplicate attachment, work note, or ledger entry;",
    "- explicit live non-production or live customer provenance.",
    "",
    "Detailed component artifacts remain in `intent/` and `assurance/`; continue the focused assurance walkthrough in [assurance/DEMO.md](assurance/DEMO.md). [showcase-summary.json](showcase-summary.json) is the machine-readable index for this bundle.",
    "",
  ].join("\n");
};

export const buildDemoShowcase = async (outputDir) => {
  const intentDir = path.join(outputDir, "intent");
  const assuranceDir = path.join(outputDir, "assurance");
  await mkdir(outputDir, { recursive: true });

  const [intent, assurance] = await Promise.all([
    buildDemoPackageRehearsal(intentDir),
    buildServiceNowRehearsal(assuranceDir),
  ]);
  if (intent.externalReads !== 0 || intent.externalWrites !== 0) {
    throw new Error("Intent rehearsal must perform zero external I/O.");
  }
  if (assurance.externalReads !== 0 || assurance.externalWrites !== 0) {
    throw new Error("ServiceNow assurance rehearsal must perform zero external I/O.");
  }

  const summary = {
    schemaVersion: SHOWCASE_SCHEMA,
    generatedAt: intent.generatedAt,
    status: "ok",
    outputDir,
    provenance: { evidenceSource: EVIDENCE_SOURCE, synthetic: true },
    externalReads: 0,
    externalWrites: 0,
    acts: {
      intent: {
        packageStatus: intent.packageStatus,
        packageId: intent.packageId,
        intentChecksSha256: intent.intentChecksSha256,
        rows: intent.rows,
        syntheticRows: intent.syntheticRows,
        readyRows: intent.readyRows,
        reviewRows: intent.reviewRows,
        needsMapRows: intent.needsMapRows,
        intentChecks: intent.intentChecks,
        validation: intent.validation,
        artifacts: intent.artifacts.map((artifact) => `intent/${artifact}`),
      },
      assurance: {
        scenarios: assurance.scenarios,
        presenterArtifact: "assurance/DEMO.md",
      },
    },
  };

  await Promise.all([
    writeFile(path.join(outputDir, "showcase-summary.json"), canonicalJson(summary)),
    writeFile(path.join(outputDir, "SHOWCASE.md"), `${showcaseMarkdown(summary)}\n`),
  ]);
  return summary;
};

export const run = async (argv = process.argv.slice(2)) => {
  const args = parseArgs(argv);
  if (args.help) {
    process.stdout.write(usage);
    return 0;
  }
  const outputDir = args.outputDir
    ? path.resolve(args.outputDir)
    : await mkdtemp(path.join(tmpdir(), "forward-dynatrace-showcase-"));
  const summary = await buildDemoShowcase(outputDir);
  process.stdout.write(canonicalJson(summary));
  return 0;
};

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  run().then((code) => {
    process.exitCode = code;
  }).catch((error) => {
    process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
    process.stderr.write(usage);
    process.exitCode = 1;
  });
}
