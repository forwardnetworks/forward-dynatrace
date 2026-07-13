#!/usr/bin/env node

import { mkdir, mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";

import { buildAssuranceArtifacts } from "./servicenow-change-assurance.mjs";
import { buildFeedbackReceipt } from "./servicenow-change-feedback.mjs";

const REHEARSAL_SCHEMA = "forward-dynatrace-servicenow-demo-rehearsal/v1";
const SCENARIO_SCHEMA = "forward-dynatrace-servicenow-demo-scenario/v1";
const EVIDENCE_SOURCE = "checked-servicenow-demo-rehearsal";
const GENERATED_AT = "2026-07-13T03:30:00.000Z";

const usage = `
ServiceNow, Forward, and Dynatrace synthetic demo rehearsal

Usage:
  npm run demo:servicenow
  npm run demo:servicenow -- --output-dir /tmp/servicenow-forward-dynatrace-demo

Options:
  --output-dir path  Write the deterministic rehearsal artifacts to this directory.
                     Default: a new temporary directory.
  --help             Show this help.

The rehearsal is synthetic and read-only. It contacts no external system, performs no
Forward writes, and creates no ServiceNow or Dynatrace records. Its artifacts exercise
the same gate, evidence-attachment, receipt, and Dynatrace-event builders as the live flow.
`;

const parseArgs = (argv) => {
  const args = {};
  for (let index = 0; index < argv.length; index += 1) {
    const value = argv[index];
    if (value === "--help") {
      args.help = true;
      continue;
    }
    if (value !== "--output-dir") throw new Error(`Unexpected argument: ${value}`);
    const next = argv[index + 1];
    if (!next || next.startsWith("--")) throw new Error("Missing value for --output-dir.");
    args.outputDir = next;
    index += 1;
  }
  return args;
};

const canonicalJson = (value) => `${JSON.stringify(value, null, 2)}\n`;
const asText = canonicalJson;

const preflight = ({ number, sysId, deploymentId }) => ({
  schemaVersion: "forward-dynatrace-servicenow-change-preflight/v1",
  observedAt: "2026-07-13T03:00:00.000Z",
  mode: "read-only",
  source: {
    instanceAlias: "synthetic-demo-itsm",
    table: "change_request",
    authoritativeRead: true,
  },
  change: {
    number,
    sysId,
    deploymentId,
    approval: { value: "approved", display: "Approved" },
    state: { value: "-2", display: "Scheduled" },
    risk: { value: "3", display: "Moderate" },
    assignmentGroup: {
      value: "89abcdef0123456789abcdef01234567",
      display: "Commerce Platform",
    },
    window: {
      startsAt: "2026-07-13T02:00:00.000Z",
      endsAt: "2026-07-13T05:00:00.000Z",
    },
  },
  scope: {
    forwardNetworkId: "network-synthetic-rehearsal",
    serviceEntityIds: ["SERVICE-CHECKOUT-API", "SERVICE-PAYMENTS-API"],
  },
  authorization: {
    status: "eligible",
    reasons: [],
    eligibleStateValues: ["-2", "-1"],
    approvedValues: ["approved"],
  },
  nextStages: [
    "dynatrace-baseline",
    "forward-before-evidence",
    "customer-deployment",
    "dynatrace-post-change-health",
    "forward-after-evidence",
    "forward-reconciliation-dry-run",
    "combined-change-gate",
    "servicenow-evidence-feedback",
  ],
});

const context = ({ number, deploymentId, dynatrace }) => ({
  schemaVersion: "forward-dynatrace-change-context/v1",
  changeId: number,
  deploymentId,
  observedAt: GENERATED_AT,
  serviceEntityIds: ["SERVICE-CHECKOUT-API", "SERVICE-PAYMENTS-API"],
  dynatrace,
});

const pathEvidence = ({ snapshotId, reachable, blocked }) => ({
  schemaVersion: "forward-dynatrace-path-evidence/v1",
  generatedAt: GENERATED_AT,
  mode: "execute",
  status: "completed",
  source: "forward-path-search-bulk",
  endpoint: "POST /api/networks/{networkId}/paths-bulk",
  modeledReachabilityAssessment: blocked > 0
    ? "consistent-with-network-policy-block"
    : "no-modeled-policy-block",
  hostResolution: null,
  target: { networkId: "network-synthetic-rehearsal", snapshotId },
  request: {
    intent: "PREFER_DELIVERED",
    maxCandidates: 5000,
    maxResults: 1,
    maxReturnPathResults: 0,
    maxSeconds: 30,
    queryCount: 24,
  },
  counts: {
    total: 24,
    queryable: 24,
    reachable,
    blocked,
    ambiguous: 0,
    unmapped: 0,
    failed: 0,
  },
  rows: [],
});

const reconciliation = ({ scenario, snapshotId }) => ({
  schemaVersion: "forward-dynatrace-status/v1",
  generatedAt: GENERATED_AT,
  runId: `reconcile-${scenario}-synthetic`,
  packageId: `package-${scenario}-synthetic`,
  mode: "dry-run",
  importState: "reconciled",
  applyPolicy: "create-missing-only",
  packageSignature: { status: "verified" },
  target: { networkId: "network-synthetic-rehearsal", snapshotId },
  counts: { create: 0, unchanged: 24, changed: 0, stale: 0 },
  unresolvedCounts: { changed: 0, stale: 0 },
  mutationCounts: { created: 0, updated: 0, deactivated: 0 },
  plannedChecks: 24,
});

const scenarioDefinitions = [
  {
    id: "safe-change",
    label: "Approved change remains healthy",
    number: "CHG9000101",
    sysId: "11111111111111111111111111111111",
    deploymentId: "checkout-safe-20260713-1",
    beforeSnapshotId: "snapshot-safe-before",
    afterSnapshotId: "snapshot-safe-after",
    before: { reachable: 24, blocked: 0 },
    after: { reachable: 24, blocked: 0 },
    dynatrace: {
      deploymentState: "SUCCEEDED",
      serviceHealth: "HEALTHY",
      openProblemCount: 0,
    },
    expectedDecision: "pass",
  },
  {
    id: "regressed-change",
    label: "Approved change regresses network and application health",
    number: "CHG9000102",
    sysId: "22222222222222222222222222222222",
    deploymentId: "checkout-regression-20260713-1",
    beforeSnapshotId: "snapshot-regression-before",
    afterSnapshotId: "snapshot-regression-after",
    before: { reachable: 24, blocked: 0 },
    after: { reachable: 12, blocked: 12 },
    dynatrace: {
      deploymentState: "SUCCEEDED",
      serviceHealth: "UNHEALTHY",
      openProblemCount: 1,
    },
    expectedDecision: "fail",
  },
];

const writeScenario = async (outputDir, definition) => {
  const scenarioDir = path.join(outputDir, definition.id);
  const inputDir = path.join(scenarioDir, "inputs");
  await mkdir(inputDir, { recursive: true });

  const values = {
    preflight: preflight(definition),
    context: context(definition),
    beforeEvidence: pathEvidence({
      snapshotId: definition.beforeSnapshotId,
      ...definition.before,
    }),
    afterEvidence: pathEvidence({
      snapshotId: definition.afterSnapshotId,
      ...definition.after,
    }),
    reconciliationStatus: reconciliation({
      scenario: definition.id,
      snapshotId: definition.afterSnapshotId,
    }),
  };

  const artifacts = buildAssuranceArtifacts({
    ...values,
    inputTexts: {
      context: asText(values.context),
      beforeEvidence: asText(values.beforeEvidence),
      afterEvidence: asText(values.afterEvidence),
      reconciliationStatus: asText(values.reconciliationStatus),
    },
    provenance: { evidenceSource: EVIDENCE_SOURCE, synthetic: true },
  });
  if (artifacts.gate.decision !== definition.expectedDecision) {
    throw new Error(
      `${definition.id} expected ${definition.expectedDecision} but produced ${artifacts.gate.decision}.`,
    );
  }

  const feedback = buildFeedbackReceipt({
    plan: artifacts.serviceNowPlan,
    mode: "dry-run",
    publication: {
      workNote: { status: "planned", sysId: null },
      attachment: { status: "planned", sysId: null },
    },
  });
  const summary = {
    schemaVersion: SCENARIO_SCHEMA,
    id: definition.id,
    label: definition.label,
    provenance: { evidenceSource: EVIDENCE_SOURCE, synthetic: true },
    runId: artifacts.runId,
    change: { number: definition.number, deploymentId: definition.deploymentId },
    decision: artifacts.gate.decision,
    reasonCodes: artifacts.gate.reasons.map((reason) => reason.code),
    forward: {
      networkId: artifacts.gate.forward.networkId,
      beforeSnapshotId: definition.beforeSnapshotId,
      afterSnapshotId: definition.afterSnapshotId,
      beforeReachable: artifacts.gate.forward.before.counts.reachable,
      afterReachable: artifacts.gate.forward.after.counts.reachable,
      afterBlocked: artifacts.gate.forward.after.counts.blocked,
    },
    dynatrace: { ...definition.dynatrace },
    serviceNow: {
      evidenceSha256: artifacts.serviceNowPlan.evidenceSha256,
      idempotencyKey: artifacts.serviceNowPlan.idempotencyKey,
      attachmentFileName: artifacts.serviceNowPlan.attachmentFileName,
      publication: feedback.publication,
    },
  };

  await Promise.all([
    writeFile(path.join(inputDir, "servicenow-change-preflight.json"), asText(values.preflight)),
    writeFile(path.join(inputDir, "forward-change-context.json"), asText(values.context)),
    writeFile(path.join(inputDir, "forward-before-path-evidence.json"), asText(values.beforeEvidence)),
    writeFile(path.join(inputDir, "forward-after-path-evidence.json"), asText(values.afterEvidence)),
    writeFile(path.join(inputDir, "forward-reconciliation-status.json"), asText(values.reconciliationStatus)),
    writeFile(path.join(scenarioDir, "forward-change-validation-gate.json"), artifacts.gateText),
    writeFile(path.join(scenarioDir, "forward-change-validation-event.json"), asText(artifacts.dynatraceEvent)),
    writeFile(
      path.join(scenarioDir, artifacts.serviceNowPlan.attachmentFileName),
      artifacts.serviceNowPlan.attachmentText,
    ),
    writeFile(
      path.join(scenarioDir, "servicenow-work-note.preview.txt"),
      `SYNTHETIC DEMO REHEARSAL — NOT A LIVE SERVICENOW RESULT\n\n${artifacts.serviceNowPlan.workNote}\n`,
    ),
    writeFile(path.join(scenarioDir, "servicenow-change-feedback.json"), asText(feedback)),
    writeFile(path.join(scenarioDir, "scenario-summary.json"), asText(summary)),
  ]);
  return summary;
};

const demoMarkdown = (summary) => {
  const rows = summary.scenarios.map((scenario) => [
    scenario.label,
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
    "# ServiceNow → Forward → Dynatrace Demo Rehearsal",
    "",
    "> **SYNTHETIC DEMO REHEARSAL.** No ServiceNow, Forward, or Dynatrace system was contacted or changed.",
    "",
    "Both scenarios use the production gate, ServiceNow evidence-attachment, idempotency-receipt, and Dynatrace event builders. The synthetic provenance label must remain visible if these events are replayed.",
    "",
    "| Scenario | Change | Decision | Forward snapshots | Reachable pre → post | Blocked post | Dynatrace health | Reasons | ServiceNow evidence SHA-256 |",
    "| --- | --- | --- | --- | ---: | ---: | --- | --- | --- |",
    ...rows.map((row) => `| ${row.join(" | ")} |`),
    "",
    "## Presenter Sequence",
    "",
    "1. Start with the safe change: approval and scope are identical, Forward stays 24/24 reachable, Dynatrace stays healthy, and the gate passes.",
    "2. Match the ServiceNow evidence SHA-256 to the same field in the scenario's Dynatrace event.",
    "3. Switch to the regressed change: reachability falls from 24 to 12, 12 modeled paths block, Dynatrace is unhealthy with one open problem, and the gate fails.",
    "4. Point to the reason codes. The integration explains the evidence; it does not claim root cause or perform rollback.",
    "5. Show the dry-run ServiceNow receipt: publication remains planned and the deterministic idempotency key proves retry identity.",
    "",
    "For a customer claim, replace this rehearsal with an authoritative ServiceNow read, customer-approved Forward snapshots, fresh Dynatrace context, publication readback, and Grail query-back evidence.",
    "",
  ].join("\n");
};

export const buildDemoRehearsal = async (outputDir) => {
  await mkdir(outputDir, { recursive: true });
  const scenarios = [];
  for (const definition of scenarioDefinitions) {
    scenarios.push(await writeScenario(outputDir, definition));
  }
  const summary = {
    schemaVersion: REHEARSAL_SCHEMA,
    generatedAt: GENERATED_AT,
    status: "ok",
    outputDir,
    provenance: { evidenceSource: EVIDENCE_SOURCE, synthetic: true },
    externalReads: 0,
    externalWrites: 0,
    scenarios,
  };
  await Promise.all([
    writeFile(path.join(outputDir, "demo-summary.json"), asText(summary)),
    writeFile(path.join(outputDir, "DEMO.md"), `${demoMarkdown(summary)}\n`),
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
    : await mkdtemp(path.join(tmpdir(), "forward-dynatrace-servicenow-demo-"));
  const summary = await buildDemoRehearsal(outputDir);
  process.stdout.write(asText(summary));
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
