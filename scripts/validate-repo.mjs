#!/usr/bin/env node

import { readFile, readdir, stat } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const failures = [];

const requiredFiles = [
  "AGENTS.md",
  "ARCHITECTURE.md",
  "README.md",
  "LICENSE",
  ".node-version",
  ".nvmrc",
  ".dockerignore",
  "Dockerfile.forward-importer",
  "docs/install.md",
  "docs/workflow.md",
  "docs/dynatrace-workflow-trigger.md",
  "docs/forward-ingest-contract.md",
  "docs/forward-host-resolution.md",
  "docs/forward-path-evidence.md",
  "docs/problem-network-evidence.md",
  "docs/change-validation-gate.md",
  "docs/application-change-assurance.md",
  "docs/servicenow-flow-worker.md",
  "docs/servicenow-scope-mapping.md",
  "docs/forward-nqe-preview.md",
  "docs/forward-nqe-artifacts.md",
  "docs/forward-api-compatibility.md",
  "docs/forward-importer.md",
  "docs/production-readiness.md",
  "docs/enterprise-hardening.md",
  "docs/operations-runbook.md",
  "docs/incident-response.md",
  "docs/threat-model.md",
  "docs/container-runtime.md",
  "docs/connector-runtime.md",
  "docs/cron-runtime.md",
  "docs/deployment-readiness.md",
  "docs/schema-versioning.md",
  "docs/data-handling.md",
  "docs/rbac.md",
  "docs/package-handoff.md",
  "docs/observability.md",
  "docs/dynatrace-status-dashboard.md",
  "docs/servicenow-scope-mapping.md",
  "docs/admin-operations.md",
  "docs/release.md",
  "docs/release-provenance.md",
  "docs/governance.md",
  "docs/customer-acceptance-checklist.md",
  "docs/customer-one-pager.md",
  "docs/index.md",
  "docs/validation-matrix.md",
  "docs/harness-engineering.md",
  "docs/gitops.md",
  "docs/demo-data.md",
  "docs/client-trial-plan.md",
  "docs/live-demo-runbook.md",
  "docs/prospect-talk-track.md",
  "docs/execution-roadmap.md",
  "docs/agent-guides/dynatrace-app.md",
  "docs/exec-plans/README.md",
  "docs/exec-plans/active/customer-production-readiness.md",
  "docs/exec-plans/completed/2026-07-12-non-production-evidence.md",
  "docs/exec-plans/tech-debt-tracker.md",
  "shared/demo-dependencies.json",
  "shared/demo-dynatrace-query-rows.json",
  "shared/demo-forward-ingest-status.json",
  "config/forward-connector.config.example.json",
  "config/forward-connector.signed.config.example.json",
  "config/forward-import.approval.example.json",
  "config/forward-nqe-live-smoke.approval.example.json",
  "config/forward-change-context.example.json",
  "config/servicenow-change-preflight.example.json",
  "config/servicenow-change-workflow.example.json",
  "config/servicenow-flow-run.example.json",
  "config/servicenow-scope-mapping.example.json",
  "api/forward-status.function.ts",
  "api/forward-nqe-preview.function.ts",
  "actions/export-forward-package.action.ts",
  "actions/export-forward-package.logic.mjs",
  "actions/export-forward-package.widget.tsx",
  "actions/tsconfig.action.json",
  "actions/tsconfig.widget.json",
  "assets/export-forward-package.sample-result.json",
  "ui/app/types/forward-status.ts",
  "ui/app/types/forward-nqe-preview.ts",
  "ui/app/change-outcomes.ts",
  "ui/app/components/CrossDomainEvidence.tsx",
  "scripts/sign-forward-package.mjs",
  "scripts/sign-release-checksums.mjs",
  "scripts/sign-release-checksums.test.mjs",
  "scripts/generate-release-signing-keypair.mjs",
  "scripts/generate-release-signing-keypair.test.mjs",
  "scripts/validate-release-ref.mjs",
  "scripts/validate-release-ref.test.mjs",
  "scripts/validate-release-immutability.mjs",
  "scripts/validate-release-immutability.test.mjs",
  "scripts/verify-published-release.mjs",
  "scripts/verify-published-release.test.mjs",
  "scripts/schema-validate.mjs",
  "scripts/schema-validate.test.mjs",
  "scripts/acceptance-bundle.mjs",
  "scripts/acceptance-bundle.test.mjs",
  "scripts/package-release-artifacts.mjs",
  "scripts/publish-forward-package.mjs",
  "scripts/publish-forward-package.test.mjs",
  "scripts/forward-handoff-server.mjs",
  "scripts/forward-handoff-server.test.mjs",
  "scripts/publish-forward-status.mjs",
  "scripts/publish-forward-status.test.mjs",
  "scripts/publish-dynatrace-status-event.mjs",
  "scripts/publish-dynatrace-status-event.test.mjs",
  "scripts/publish-dynatrace-network-evidence.mjs",
  "scripts/publish-dynatrace-network-evidence.test.mjs",
  "scripts/forward-change-validation-gate.mjs",
  "scripts/servicenow-change-preflight.mjs",
  "scripts/resolve-servicenow-scope.mjs",
  "scripts/resolve-servicenow-scope.test.mjs",
  "scripts/servicenow-change-feedback.mjs",
  "scripts/servicenow-change-assurance.mjs",
  "scripts/servicenow-change-workflow.mjs",
  "scripts/servicenow-flow-server.mjs",
  "scripts/validate-servicenow-flow-assets.mjs",
  "scripts/runtime-entrypoint.mjs",
  "scripts/install-systemd-runtime.mjs",
  "scripts/forward-change-validation-gate.test.mjs",
  "scripts/servicenow-change-preflight.mjs",
  "scripts/servicenow-change-preflight.test.mjs",
  "scripts/servicenow-change-feedback.test.mjs",
  "scripts/servicenow-change-assurance.test.mjs",
  "scripts/servicenow-change-workflow.test.mjs",
  "scripts/servicenow-flow-server.test.mjs",
  "scripts/runtime-entrypoint.test.mjs",
  "scripts/install-systemd-runtime.test.mjs",
  "scripts/dynatrace-export-action.test.mjs",
  "scripts/forward-check-health-transitions.mjs",
  "scripts/forward-check-health-transitions.test.mjs",
  "scripts/security-exposure-correlation.mjs",
  "scripts/security-exposure-correlation.test.mjs",
  "scripts/publish-dynatrace-security-correlation.mjs",
  "scripts/publish-dynatrace-security-correlation.test.mjs",
  "scripts/write-release-checksums.mjs",
  "scripts/release-checksums.test.mjs",
  "scripts/deploy-dynatrace-app.mjs",
  "scripts/deploy-dynatrace-app.test.mjs",
  "scripts/query-dynatrace-dependencies.mjs",
  "scripts/forward-deployment-readiness.mjs",
  "scripts/forward-deployment-readiness.test.mjs",
  "scripts/forward-resolve-hosts.mjs",
  "scripts/forward-resolve-hosts.test.mjs",
  "scripts/forward-path-evidence.mjs",
  "scripts/forward-path-evidence.test.mjs",
  "scripts/forward-nqe-live-smoke.mjs",
  "scripts/forward-nqe-live-smoke.test.mjs",
  "scripts/forward-nqe-artifacts.mjs",
  "scripts/forward-nqe-artifacts.test.mjs",
  "scripts/forward-nqe-preview.test.mjs",
  "scripts/forward-package.test.mjs",
  "scripts/forward-status.test.mjs",
  "scripts/forward-cron-import.mjs",
  "scripts/forward-cron-import.test.mjs",
  "scripts/build-forward-package.mjs",
  "scripts/normalize-dynatrace-dependencies.mjs",
  "scripts/normalize-dynatrace-dependencies.test.mjs",
  "scripts/demo-rehearsal.mjs",
  "scripts/demo-showcase.mjs",
  "scripts/demo-showcase.test.mjs",
  "scripts/servicenow-demo-rehearsal.mjs",
  "scripts/servicenow-demo-rehearsal.test.mjs",
  "scripts/change-outcomes.test.mjs",
  "scripts/load-scale-smoke.mjs",
  "scripts/runtime-slo-check.mjs",
  "scripts/runtime-slo-check.test.mjs",
  "scripts/workflow-smoke.mjs",
  "scripts/validate-runtime-manifests.mjs",
  "scripts/validate-dynatrace-workflow-examples.mjs",
  "scripts/generate-dynatrace-workflows.mjs",
  "scripts/generate-dynatrace-workflows.test.mjs",
  "scripts/replay-dynatrace-demo-data.mjs",
  "scripts/replay-dynatrace-demo-data.test.mjs",
  "scripts/live-demo-conductor.mjs",
  "scripts/live-demo-conductor.test.mjs",
  "deploy/dynatrace-dql/service-dependency-candidates-openpipeline-events.dql",
  "deploy/dynatrace-dql/service-dependencies-smartscape.dql",
  "deploy/dynatrace-dql/forward-ingest-status-latest.dql",
  "deploy/dynatrace-dql/forward-ingest-status-attention.dql",
  "deploy/dynatrace-dql/forward-network-evidence-latest.dql",
  "deploy/dynatrace-dql/forward-network-evidence-attention.dql",
  "deploy/dynatrace-dashboard/forward-ingest-status-dashboard.template.json",
  "deploy/dynatrace-workflows/forward-sync-schedule.payload.example.json",
  "deploy/dynatrace-workflows/forward-sync-problem.payload.example.json",
  "deploy/dynatrace-workflows/forward-sync-on-demand.payload.example.json",
  "deploy/systemd/forward-dynatrace-connector.service",
  "deploy/systemd/forward-dynatrace-connector.timer",
  "deploy/systemd/forward-dynatrace-servicenow-flow.service",
  "deploy/systemd/forward-dynatrace-handoff.service",
  "deploy/systemd/forward-dynatrace-check-health.service",
  "deploy/systemd/forward-dynatrace-check-health.timer",
  "deploy/systemd/forward-check-health.env.example",
  "deploy/systemd/forward-dynatrace.env.example",
  "deploy/systemd/servicenow-flow.env.example",
  "deploy/systemd/forward-handoff.env.example",
  "deploy/systemd/forward-connector.config.example.json",
  "deploy/cron/forward-connector.config.example.json",
  "deploy/cron/forward-dynatrace.env.example",
  "deploy/cron/forward-dynatrace.crontab.example",
  "deploy/docker-compose/compose.yaml",
  "deploy/docker-compose/forward-connector.config.example.json",
  "deploy/docker-compose/forward-dynatrace.env.example",
  "deploy/kubernetes/forward-dynatrace-connector-cronjob.yaml",
  "deploy/kubernetes/forward-dynatrace-check-health-cronjob.yaml",
  "deploy/servicenow-flow",
  "deploy/kubernetes/forward-dynatrace-check-health-cronjob.yaml",
  "deploy/kubernetes/forward-dynatrace-check-health-config.example.yaml",
  "deploy/kubernetes/forward-dynatrace-state-pvc.example.yaml",
  "deploy/kubernetes/forward-dynatrace-configmap.example.yaml",
  "deploy/kubernetes/forward-dynatrace-secret.example.yaml",
  "deploy/servicenow-flow/forward-change-assurance.flow.example.json",
  "deploy/servicenow-flow/start-assurance.js",
  "deploy/servicenow-flow/get-assurance-status.js",
  "deploy/servicenow-flow/complete-assurance.js",
  "deploy/servicenow-flow/README.md",
  ".github/workflows/ci.yml",
  ".github/workflows/release.yml",
  ".github/workflows/verify-release.yml",
  ".github/CODEOWNERS",
  ".github/dependabot.yml",
  ".github/pull_request_template.md",
  "schemas/connector-config.schema.json",
  "schemas/forward-package-manifest.schema.json",
  "schemas/forward-intent-checks.schema.json",
  "schemas/forward-ingest-status.schema.json",
  "schemas/forward-ingest-status-event.schema.json",
  "schemas/forward-network-evidence-event.schema.json",
  "schemas/forward-change-context.schema.json",
  "schemas/forward-change-validation-gate.schema.json",
  "schemas/servicenow-change-preflight.schema.json",
  "schemas/servicenow-change-assurance-evidence.schema.json",
  "schemas/servicenow-change-feedback.schema.json",
  "schemas/servicenow-change-assurance.schema.json",
  "schemas/servicenow-change-workflow.schema.json",
  "schemas/servicenow-flow-run.schema.json",
  "schemas/servicenow-scope-mapping.schema.json",
  "schemas/servicenow-scope-resolution.schema.json",
  "schemas/forward-approval.schema.json",
  "schemas/README.md",
];

const requiredScreenshots = [
  "docs/assets/screenshots/01-overview.jpg",
  "docs/assets/screenshots/02-export-package-readiness.jpg",
  "docs/assets/screenshots/03-forward-side-api.jpg",
  "docs/assets/screenshots/04-intent-check-payload.jpg",
  "docs/assets/screenshots/05-servicenow-change-assurance.jpg",
];

const skippedDirectories = new Set([
  ".git",
  ".dt-app",
  "build",
  "dist",
  "node_modules",
  "out",
  "tmp",
]);

const textExtensions = new Set([
  ".css",
  ".html",
  ".js",
  ".json",
  ".dql",
  ".md",
  ".mjs",
  ".ts",
  ".tsx",
  ".txt",
  ".yml",
  ".yaml",
]);

const legacyTerms = [
  "Data File",
  "data file",
  "data-file",
  "dataFile",
  "csvPreview",
  "forward-data-file",
  "dynatrace_service_dependencies",
  "/api/data-files",
  "data-files",
  "Optional CSV",
];

const secretPatterns = [
  {
    name: "Dynatrace token-shaped secret",
    regex: /dt0[a-z0-9]{2,}\.[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{20,}/i,
  },
  {
    name: "Concrete Forward password export",
    regex: /FORWARD_PASSWORD=(?!<password-or-token>)[^\s]+/,
  },
  {
    name: "Concrete Forward user export",
    regex: /FORWARD_USER=(?!<user>)[^\s]+/,
  },
  {
    name: "Concrete ServiceNow password export",
    regex: /SERVICENOW_PASSWORD=(?!<runtime-secret>)[^\s]+/,
  },
  {
    name: "Concrete ServiceNow user export",
    regex: /SERVICENOW_USER=(?!<read-only-integration-user>)[^\s]+/,
  },
];

const expectedPublicEnvironmentUrl =
  "https://your-environment-id.apps.dynatrace.com/";
const expectedNodeVersionFile = "24";
const expectedNodeEngineRange = ">=24.0.0 <25.0.0";
const expectedDtAppVersion = "1.11.2";

const escapeRegExp = (value) => value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
const localMachineUser = process.env.USER || process.env.LOGNAME || "";
const genericMachineUsers = new Set(["runner", "root", "node"]);

const publicHygienePatterns = [
  {
    name: "OAuth callback or login URL",
    regex: /\b(localhost:5343|auth\/login|oAuth2CtxUuid|oAuth2RedirectUri)\b/i,
  },
  {
    name: "Local private token file path",
    regex: /\bdynatrace\.token\b/i,
  },
  {
    name: "Personal or customer email reference",
    regex: /\b[A-Z0-9._%+-]+@forwardnetworks\.com\b/i,
  },
  {
    name: "Local macOS user path",
    regex: /\/Users\/(?!your-)[A-Za-z0-9._-]+\b/i,
  },
  {
    name: "Concrete Forward SaaS host example",
    regex: /https:\/\/fwd\.app\b/i,
  },
  {
    name: "Deprecated connector ownership wording",
    regex: /Forward-owned connector/i,
  },
];

const dynamicLocalHygienePatterns =
  localMachineUser && !genericMachineUsers.has(localMachineUser.toLowerCase())
  ? [
      {
        name: "Local machine user name",
        regex: new RegExp(`\\b${escapeRegExp(localMachineUser)}\\b`, "i"),
      },
    ]
  : [];

const publicBrandingFiles = [
  "AGENTS.md",
  "ARCHITECTURE.md",
  "README.md",
  "app.config.json",
  "package.json",
  "api/forward-sync.function.ts",
  "api/forward-status.function.ts",
  "api/forward-nqe-preview.function.ts",
  "docs/harness-engineering.md",
  "docs/index.md",
  "docs/execution-roadmap.md",
  "docs/exec-plans/README.md",
  "docs/exec-plans/active/customer-production-readiness.md",
  "docs/exec-plans/completed/2026-07-12-non-production-evidence.md",
  "docs/exec-plans/tech-debt-tracker.md",
  "docs/forward-nqe-preview.md",
  "docs/forward-nqe-artifacts.md",
  "docs/forward-api-compatibility.md",
  "docs/problem-network-evidence.md",
  "docs/change-validation-gate.md",
  "docs/application-change-assurance.md",
  "docs/live-demo-runbook.md",
  "docs/prospect-talk-track.md",
  "docs/install.md",
  "docs/production-readiness.md",
  "docs/enterprise-hardening.md",
  "docs/operations-runbook.md",
  "docs/incident-response.md",
  "docs/threat-model.md",
  "docs/container-runtime.md",
  "docs/connector-runtime.md",
  "docs/cron-runtime.md",
  "docs/deployment-readiness.md",
  "docs/schema-versioning.md",
  "docs/data-handling.md",
  "docs/rbac.md",
  "docs/package-handoff.md",
  "docs/observability.md",
  "docs/dynatrace-status-dashboard.md",
  "docs/admin-operations.md",
  "docs/release.md",
  "docs/release-provenance.md",
  "docs/governance.md",
  "docs/customer-acceptance-checklist.md",
  "docs/customer-one-pager.md",
  "docs/screenshots.md",
  "docs/validation-matrix.md",
  "docs/workflow.md",
  "docs/dynatrace-workflow-trigger.md",
  "ui/app/pages/Home.tsx",
  "schemas/README.md",
];

const retiredBrandingPatterns = [
  {
    name: "Retired art-of-the-possible wording",
    regex: /art-of-the-possible/i,
  },
  {
    name: "Incorrect field-supported wording",
    regex: /field[- ]supported/i,
  },
  {
    name: "Retired scaffold wording",
    regex: /production-oriented scaffold/i,
  },
  {
    name: "Ambiguous supported-integration wording",
    regex: /turnkey supported integration/i,
  },
  {
    name: "Retired mock proof wording",
    regex: /mock proof/i,
  },
  {
    name: "Retired proof action label",
    regex: /\b(run proof|proof result|no proof result|demo guardrail|prove)\b/i,
  },
  {
    name: "Retired app title",
    regex: /Forward Network Proof/i,
  },
];

const dynatraceEnvironmentUrlRegex =
  /https:\/\/([a-z0-9-]+)\.apps\.dynatrace\.com\/?/gi;

const fail = (message) => {
  failures.push(message);
};

const readText = async (relativePath) =>
  readFile(path.join(root, relativePath), "utf8");

const readJson = async (relativePath) => JSON.parse(await readText(relativePath));

const exists = async (relativePath) => {
  try {
    await stat(path.join(root, relativePath));
    return true;
  } catch {
    return false;
  }
};

const walkTextFiles = async (directory = root) => {
  const entries = await readdir(directory, { withFileTypes: true });
  const files = [];

  for (const entry of entries) {
    const absolutePath = path.join(directory, entry.name);
    const relativePath = path.relative(root, absolutePath);

    if (entry.isDirectory()) {
      if (!skippedDirectories.has(entry.name)) {
        files.push(...(await walkTextFiles(absolutePath)));
      }
      continue;
    }

    if (
      entry.isFile() &&
      (textExtensions.has(path.extname(entry.name)) ||
        entry.name === "CODEOWNERS" ||
        entry.name.startsWith("Dockerfile")) &&
      relativePath !== "scripts/validate-repo.mjs" &&
      relativePath !== "scripts/validate-runtime-manifests.mjs"
    ) {
      files.push(relativePath);
    }
  }

  return files;
};

for (const requiredFile of requiredFiles) {
  if (!(await exists(requiredFile))) {
    fail(`Missing required repository file: ${requiredFile}`);
  }
}

for (const screenshot of requiredScreenshots) {
  const absolutePath = path.join(root, screenshot);
  try {
    const details = await stat(absolutePath);
    if (details.size < 10_000) {
      fail(`Screenshot is unexpectedly small: ${screenshot}`);
    }
  } catch {
    fail(`Missing required screenshot: ${screenshot}`);
  }
}

const agentMap = await readText("AGENTS.md");
const agentMapLineCount = agentMap.trimEnd().split("\n").length;
if (agentMapLineCount > 80) {
  fail(`AGENTS.md should stay compact; found ${agentMapLineCount} lines.`);
}

for (const target of [
  "README.md",
  "ARCHITECTURE.md",
  "docs/index.md",
  "docs/exec-plans/README.md",
  "docs/exec-plans/active/customer-production-readiness.md",
  "docs/validation-matrix.md",
  "docs/harness-engineering.md",
]) {
  if (!agentMap.includes(target)) {
    fail(`AGENTS.md does not point to ${target}.`);
  }
}

const architectureMap = await readText("ARCHITECTURE.md");
for (const requiredArchitectureSection of [
  "## System Boundary",
  "## Component Map",
  "## Dependency And Ownership Rules",
  "## Primary Data Paths",
  "## Change Routes",
]) {
  if (!architectureMap.includes(requiredArchitectureSection)) {
    fail(`ARCHITECTURE.md must contain ${requiredArchitectureSection}.`);
  }
}

const docsIndex = await readText("docs/index.md");
const topLevelDocEntries = await readdir(path.join(root, "docs"), {
  withFileTypes: true,
});
for (const entry of topLevelDocEntries) {
  if (!entry.isFile() || path.extname(entry.name) !== ".md" || entry.name === "index.md") {
    continue;
  }
  if (!docsIndex.includes(`(${entry.name})`)) {
    fail(`docs/index.md does not point to docs/${entry.name}.`);
  }
}
if (!docsIndex.includes("(agent-guides/dynatrace-app.md)")) {
  fail("docs/index.md does not point to the Dynatrace app agent guide.");
}
if (!docsIndex.includes("(exec-plans/README.md)")) {
  fail("docs/index.md does not point to the execution-plan index.");
}

const executionPlanIndex = await readText("docs/exec-plans/README.md");
for (const target of [
  "active/customer-production-readiness.md",
  "completed/2026-07-12-non-production-evidence.md",
  "tech-debt-tracker.md",
]) {
  if (!executionPlanIndex.includes(`(${target})`)) {
    fail(`docs/exec-plans/README.md does not point to ${target}.`);
  }
}

const activeExecutionPlan = await readText(
  "docs/exec-plans/active/customer-production-readiness.md",
);
for (const requiredPlanContent of [
  "Status: active",
  "Owner:",
  "Last updated:",
  "## Objective",
  "## Non-Goals",
  "## Progress",
  "## Plan",
  "## Verification",
  "## Decision Log",
  "## Evidence To Capture",
]) {
  if (!activeExecutionPlan.includes(requiredPlanContent)) {
    fail(`Active execution plan must contain ${requiredPlanContent}.`);
  }
}

for (const [file, requiredReleaseBoundary] of [
  ["README.md", "not included in `v1.0.0`"],
  ["docs/install.md", "not included in `v1.0.0`"],
  ["docs/customer-one-pager.md", "not included in `v1.0.0`"],
  ["docs/container-runtime.md", "`v1.0.0` digest predates them"],
]) {
  if (!(await readText(file)).includes(requiredReleaseBoundary)) {
    fail(`${file} must preserve the published-release versus release-candidate boundary.`);
  }
}

const releaseWorkflowSource = await readText(".github/workflows/release.yml");
for (const requiredReleaseGate of [
  "actions: read",
  "Validate release immutability before writes",
  "scripts/validate-release-immutability.mjs",
  "GITHUB_RUN_ID",
  "Validate release tag and repository version",
  "npm run release:ref:validate",
]) {
  if (!releaseWorkflowSource.includes(requiredReleaseGate)) {
    fail(`Release workflow must preserve ${requiredReleaseGate}.`);
  }
}
const releaseImmutabilityStep = releaseWorkflowSource.indexOf("Validate release immutability before writes");
for (const firstReleaseWriteBoundary of [
  "Install dependencies",
  "Attest release artifacts",
  "Build and publish GHCR importer image",
  "Publish GitHub release",
]) {
  const boundaryIndex = releaseWorkflowSource.indexOf(firstReleaseWriteBoundary);
  if (releaseImmutabilityStep < 0 || boundaryIndex < 0 || releaseImmutabilityStep > boundaryIndex) {
    fail(`Release immutability guard must run before ${firstReleaseWriteBoundary}.`);
  }
}

const releaseVerificationWorkflow = await readText(".github/workflows/verify-release.yml");
for (const requiredVerificationText of [
  "workflow_run:",
  "workflows: [release]",
  "attestations: read",
  "packages: read",
  "npm run release:published:verify",
  "published-release-verification.json",
]) {
  if (!releaseVerificationWorkflow.includes(requiredVerificationText)) {
    fail(`Release verification workflow must preserve ${requiredVerificationText}.`);
  }
}

const releaseImmutabilityGuard = await readText("scripts/validate-release-immutability.mjs");
for (const requiredImmutabilityBoundary of [
  "workflow_runs",
  "tag_name",
  "docker",
  "imagetools",
  "already has workflow history",
  "already exists",
  "Unable to prove GHCR tag absence",
]) {
  if (!releaseImmutabilityGuard.includes(requiredImmutabilityBoundary)) {
    fail(`Release immutability guard must preserve ${requiredImmutabilityBoundary}.`);
  }
}
const publishedReleaseVerifier = await readText("scripts/verify-published-release.mjs");
for (const requiredVerifierBoundary of [
  "--signer-workflow",
  "--source-digest",
  "--source-ref",
  "--deny-self-hosted-runners",
  "validateAttestationResults",
  "runInvocationURI",
  "runnerEnvironment",
  "tool?.driver?.name",
  "tag immutability is violated",
  "withRetries",
  "--clobber",
]) {
  if (!publishedReleaseVerifier.includes(requiredVerifierBoundary)) {
    fail(`Published release verifier must preserve ${requiredVerifierBoundary}.`);
  }
}

const customerAcceptanceChecklist = await readText("docs/customer-acceptance-checklist.md");
for (const requiredAcceptanceLane of [
  "## 8. ServiceNow Change Assurance",
  "--verify-servicenow-retry",
  "query the matching aggregate event",
  "## 9. Check-Health Feedback",
  "failure and recovery transition",
  "## 10. Security Correlation",
  "low-confidence identity mappings cannot create automatic high severity",
]) {
  if (!customerAcceptanceChecklist.includes(requiredAcceptanceLane)) {
    fail(`Customer acceptance checklist must preserve ${requiredAcceptanceLane}.`);
  }
}

const crossDomainEvidence = await readText("ui/app/components/CrossDomainEvidence.tsx");
for (const requiredProvenanceContract of [
  "`forward.dynatrace.evidence_source`, `forward.dynatrace.synthetic`",
  "SYNTHETIC DEMO",
  "provenanceLabel(row)",
  "forward.dynatrace.servicenow_evidence_sha256",
  "All validation passed",
  "Blocked paths",
  "Path regression",
  "Service unhealthy",
  "Open problems",
]) {
  if (!crossDomainEvidence.includes(requiredProvenanceContract)) {
    fail(
      `Cross-domain portal must render explicit live/synthetic provenance: ${requiredProvenanceContract}`,
    );
  }
}

const serviceNowFeedback = await readText("scripts/servicenow-change-feedback.mjs");
for (const requiredRetryContract of [
  "--verify-retry",
  "ServiceNow retry changed the exact evidence attachment bytes.",
  "must report existing",
  "servicenow-change-feedback-retry.json",
]) {
  if (!serviceNowFeedback.includes(requiredRetryContract)) {
    fail(`ServiceNow live retry verifier must contain ${requiredRetryContract}.`);
  }
}
for (const file of [
  "scripts/servicenow-change-assurance.mjs",
  "scripts/servicenow-change-workflow.mjs",
]) {
  if (!(await readText(file)).includes("--verify-servicenow-retry")) {
    fail(`${file} must preserve the explicit ServiceNow retry-verification gate.`);
  }
}
if (
  crossDomainEvidence.includes(
    "filter isNull(`forward.dynatrace.synthetic`) or `forward.dynatrace.synthetic` == false",
  )
) {
  fail("Cross-domain portal must label synthetic demo evidence instead of silently hiding it.");
}

for (const file of publicBrandingFiles) {
  const content = await readText(file);
  for (const pattern of retiredBrandingPatterns) {
    if (pattern.regex.test(content)) {
      fail(`${pattern.name} found in ${file}.`);
    }
  }
}

const packageJson = await readJson("package.json");
const packageLock = await readJson("package-lock.json");
const appConfig = await readJson("app.config.json");
if (packageJson.scripts?.["release:immutability:validate"] !==
    "node scripts/validate-release-immutability.mjs") {
  fail("package.json must expose the checked release immutability command.");
}
const versions = new Map([
  ["package.json", packageJson.version],
  ["package-lock.json", packageLock.version],
  ["package-lock root package", packageLock.packages?.[""]?.version],
  ["app.config.json", appConfig.app?.version],
]);
const uniqueVersions = new Set(versions.values());
if (uniqueVersions.size !== 1) {
  fail(
    `Version mismatch: ${[...versions.entries()]
      .map(([source, version]) => `${source}=${version}`)
      .join(", ")}`,
  );
}

const exportAction = appConfig.app?.actions?.find(
  (action) => action.name === "export-forward-package",
);
if (!exportAction) {
  fail("app.config.json must register the export-forward-package Workflow action.");
} else if (!/no Forward writes/i.test(exportAction.description || "")) {
  fail("export-forward-package action description must state the no-Forward-write boundary.");
}

if (appConfig.environmentUrl !== expectedPublicEnvironmentUrl) {
  fail(
    `app.config.json environmentUrl must use the public placeholder ${expectedPublicEnvironmentUrl}`,
  );
}

if (packageJson.engines?.node !== expectedNodeEngineRange) {
  fail("package.json engines.node must match the Dynatrace App Toolkit Node 24 baseline.");
}

if (packageLock.packages?.[""]?.engines?.node !== packageJson.engines.node) {
  fail("package-lock root engines.node must match package.json.");
}

if (packageJson.devDependencies?.["dt-app"] !== expectedDtAppVersion) {
  fail(`package.json must pin dt-app exactly to ${expectedDtAppVersion}.`);
}
if (packageLock.packages?.[""]?.devDependencies?.["dt-app"] !== expectedDtAppVersion) {
  fail(`package-lock root devDependencies must pin dt-app exactly to ${expectedDtAppVersion}.`);
}

for (const nodeVersionFile of [".nvmrc", ".node-version"]) {
  const nodeVersion = (await readText(nodeVersionFile)).trim();
  if (nodeVersion !== expectedNodeVersionFile) {
    fail(`${nodeVersionFile} must pin Node ${expectedNodeVersionFile}.`);
  }
}

for (const scriptName of [
  "release:checksums:test",
  "release:sign:test",
  "release:signing-key:test",
  "release:ref:test",
  "release:immutability:test",
  "release:published:test",
  "schemas:validate",
  "schemas:validate:test",
  "acceptance:bundle:test",
  "forward:handoff:test",
  "forward:handoff:server:test",
  "forward:cron:test",
  "forward:change-gate:test",
  "servicenow:change-preflight:test",
  "servicenow:scope:test",
  "servicenow:change-feedback:test",
  "servicenow:change-assurance:test",
  "servicenow:change-workflow:test",
  "servicenow:flow-server:test",
  "servicenow:flow-assets:validate",
  "runtime:entrypoint:test",
  "systemd:install:test",
  "forward:nqe-preview:test",
  "forward:nqe-live-smoke:test",
  "forward:resolve-hosts:test",
  "forward:path-evidence:test",
  "forward:readiness:test",
  "dynatrace:status:publish:test",
  "dynatrace:network-evidence:publish:test",
  "dynatrace:normalize:test",
  "dynatrace:deploy:test",
  "dynatrace:action:test",
  "runtime:validate",
  "runtime:slo:test",
  "dynatrace:workflow:validate",
  "dynatrace:workflow:generate:test",
  "demo:rehearsal",
  "demo:servicenow",
  "demo:servicenow:test",
  "demo:showcase",
  "demo:showcase:test",
  "load:scale",
  "release:package:smoke",
  "security:audit",
  "sbom:check",
  "whitespace:check",
]) {
  if (!packageJson.scripts?.[scriptName]) {
    fail(`package.json must define npm script ${scriptName}.`);
  } else if (!packageJson.scripts.ci?.includes(`npm run ${scriptName}`)) {
    fail(`package.json ci script must run ${scriptName}.`);
  }
}
if (!packageJson.scripts?.["systemd:install"]) {
  fail("package.json must define npm script systemd:install.");
}
if (!packageJson.scripts?.["forward:sign"]) {
  fail("package.json must define npm script forward:sign.");
}
if (!packageJson.scripts?.["release:checksums"]) {
  fail("package.json must define npm script release:checksums.");
}
if (!packageJson.scripts?.["release:sign"]) {
  fail("package.json must define npm script release:sign.");
}
if (!packageJson.scripts?.["release:package"]) {
  fail("package.json must define npm script release:package.");
}
if (!packageJson.scripts?.["schemas:validate"]) {
  fail("package.json must define npm script schemas:validate.");
}
if (!packageJson.scripts?.["acceptance:bundle"]) {
  fail("package.json must define npm script acceptance:bundle.");
}
if (!packageJson.scripts?.["dynatrace:normalize"]) {
  fail("package.json must define npm script dynatrace:normalize.");
}
if (!packageJson.scripts?.["dynatrace:query"]) {
  fail("package.json must define npm script dynatrace:query.");
}
if (!packageJson.scripts?.["dynatrace:deploy"]) {
  fail("package.json must define npm script dynatrace:deploy.");
}
if (!packageJson.scripts?.["dynatrace:replay-demo"]) {
  fail("package.json must define npm script dynatrace:replay-demo.");
}
if (!packageJson.scripts?.["dynatrace:status:publish"]) {
  fail("package.json must define npm script dynatrace:status:publish.");
}
if (!packageJson.scripts?.["dynatrace:bundle"]) {
  fail("package.json must define npm script dynatrace:bundle.");
}
if (!packageJson.scripts?.["forward:package"]) {
  fail("package.json must define npm script forward:package.");
}
if (!packageJson.scripts?.["forward:nqe-live-smoke"]) {
  fail("package.json must define npm script forward:nqe-live-smoke.");
}
if (!packageJson.scripts?.["forward:resolve-hosts"]) {
  fail("package.json must define npm script forward:resolve-hosts.");
}
if (!packageJson.scripts?.["forward:path-evidence"]) {
  fail("package.json must define npm script forward:path-evidence.");
}
if (!packageJson.scripts?.["forward:status:publish"]) {
  fail("package.json must define npm script forward:status:publish.");
}
if (!packageJson.scripts?.["forward:readiness"]) {
  fail("package.json must define npm script forward:readiness.");
}
if (!packageJson.scripts?.["forward:cron"]) {
  fail("package.json must define npm script forward:cron.");
}
if (!packageJson.scripts?.["forward:handoff:server"]) {
  fail("package.json must define npm script forward:handoff:server.");
}
if (!packageJson.scripts?.["servicenow:scope:resolve"]) {
  fail("package.json must define npm script servicenow:scope:resolve.");
}
if (!packageJson.scripts?.["forward:change-gate"]) {
  fail("package.json must define npm script forward:change-gate.");
}

const releaseWorkflow = await readText(".github/workflows/release.yml");
for (const requiredReleaseWorkflowText of [
  "artifact-metadata: write",
  "npm run ci",
  "npm run release:package",
  "RELEASE_SIGNING_PRIVATE_KEY_PEM",
  "npm run release:sign",
  "SHA256SUMS",
  "actions/attest@v4",
  "aquasecurity/trivy-action@v0.36.0",
  "github/codeql-action/upload-sarif@v4",
  "security-events: write",
  "exit-code: \"1\"",
  "actions/upload-artifact",
  "docker/build-push-action",
  "ghcr.io/${{ github.repository_owner }}/forward-dynatrace-importer",
  "gh release create",
]) {
  if (!releaseWorkflow.includes(requiredReleaseWorkflowText)) {
    fail(`release workflow must contain ${requiredReleaseWorkflowText}.`);
  }
}

const releasePackager = await readText("scripts/package-release-artifacts.mjs");
for (const requiredPackagerText of [
  "forward-dynatrace-app-",
  "forward-dynatrace-importer-",
  "LICENSE",
  "deploy/dynatrace-workflows",
  "deploy/dynatrace-dql",
  "deploy/dynatrace-dashboard",
  "service-dependency-candidates-openpipeline-events.dql",
  "service-dependencies-smartscape.dql",
  "forward-ingest-status-latest.dql",
  "forward-ingest-status-attention.dql",
  "forward-ingest-status-dashboard.template.json",
  "forward-sync-on-demand.payload.example.json",
  "config/servicenow-scope-mapping.example.json",
  "docs/assets/screenshots",
  "docs/dynatrace-workflow-trigger.md",
  "docs/forward-ingest-contract.md",
  "docs/forward-host-resolution.md",
  "docs/forward-path-evidence.md",
  "docs/forward-nqe-preview.md",
  "docs/forward-nqe-artifacts.md",
  "docs/forward-api-compatibility.md",
  "docs/live-demo-runbook.md",
  "docs/prospect-talk-track.md",
  "docs/execution-roadmap.md",
  "ARCHITECTURE.md",
  "docs/index.md",
  "docs/harness-engineering.md",
  "docs/exec-plans",
  "docs/release-provenance.md",
  "docs/governance.md",
  "docs/customer-acceptance-checklist.md",
  "docs/customer-one-pager.md",
  "docs/dynatrace-status-dashboard.md",
  "schemas",
  "docs/connector-runtime.md",
  "docs/cron-runtime.md",
  "docs/deployment-readiness.md",
  "deploy/systemd/forward-dynatrace-connector.service",
  "deploy/cron",
  "deploy/docker-compose/compose.yaml",
  "deploy/kubernetes/forward-dynatrace-connector-cronjob.yaml",
  "scripts/write-release-checksums.mjs",
  "scripts/sign-release-checksums.mjs",
  "scripts/generate-release-signing-keypair.mjs",
  "scripts/validate-release-immutability.mjs",
  "scripts/validate-release-immutability.test.mjs",
  "scripts/verify-published-release.mjs",
  "scripts/verify-published-release.test.mjs",
  "scripts/schema-validate.mjs",
  "scripts/acceptance-bundle.mjs",
  "scripts/query-dynatrace-dependencies.mjs",
  "scripts/deploy-dynatrace-app.mjs",
  "scripts/generate-dynatrace-workflows.mjs",
  "scripts/forward-deployment-readiness.mjs",
  "scripts/publish-forward-package.mjs",
  "scripts/forward-handoff-server.mjs",
  "scripts/forward-cron-import.mjs",
  "scripts/forward-resolve-hosts.mjs",
  "scripts/forward-path-evidence.mjs",
  "scripts/forward-change-validation-gate.mjs",
  "scripts/forward-check-health-transitions.mjs",
  "scripts/security-exposure-correlation.mjs",
  "scripts/servicenow-change-preflight.mjs",
  "scripts/servicenow-change-feedback.mjs",
  "scripts/servicenow-change-assurance.mjs",
  "scripts/servicenow-change-workflow.mjs",
  "scripts/runtime-entrypoint.mjs",
  "scripts/install-systemd-runtime.mjs",
  "scripts/install-systemd-runtime.test.mjs",
  "scripts/publish-dynatrace-change-gate.mjs",
  "scripts/publish-dynatrace-security-correlation.mjs",
  "scripts/validate-servicenow-flow-assets.mjs",
  "scripts/replay-dynatrace-demo-data.mjs",
  "scripts/live-demo-conductor.mjs",
  "scripts/build-forward-package.mjs",
  "scripts/normalize-dynatrace-dependencies.mjs",
  "scripts/demo-rehearsal.mjs",
  "scripts/demo-showcase.mjs",
  "scripts/demo-showcase.test.mjs",
  "scripts/servicenow-demo-rehearsal.mjs",
  "scripts/load-scale-smoke.mjs",
  "scripts/runtime-slo-check.mjs",
  "forward-dynatrace-sbom-",
  "SHA256SUMS",
]) {
  if (!releasePackager.includes(requiredPackagerText)) {
    fail(`release packager must contain ${requiredPackagerText}.`);
  }
}

const importerDockerfile = await readText("Dockerfile.forward-importer");
for (const requiredDockerfileText of [
  "scripts/forward-import-package.mjs",
  "scripts/publish-forward-package.mjs",
  "scripts/forward-handoff-server.mjs",
  "scripts/forward-cron-import.mjs",
  "scripts/forward-resolve-hosts.mjs",
  "scripts/forward-path-evidence.mjs",
  "scripts/forward-change-validation-gate.mjs",
  "scripts/forward-check-health-transitions.mjs",
  "scripts/security-exposure-correlation.mjs",
  "scripts/resolve-servicenow-scope.mjs",
  "scripts/servicenow-change-feedback.mjs",
  "scripts/servicenow-change-assurance.mjs",
  "scripts/servicenow-change-workflow.mjs",
  "scripts/runtime-entrypoint.mjs",
  "scripts/publish-forward-status.mjs",
  "scripts/publish-dynatrace-status-event.mjs",
  "scripts/publish-dynatrace-change-gate.mjs",
  "scripts/publish-dynatrace-security-correlation.mjs",
]) {
  if (!importerDockerfile.includes(requiredDockerfileText)) {
    fail(`Dockerfile.forward-importer must contain ${requiredDockerfileText}.`);
  }
}

const pullRequestTemplate = await readText(".github/pull_request_template.md");
for (const requiredPullRequestTemplateText of [
  "npm run ci",
  "git diff --check",
  "Forward write boundary unchanged",
]) {
  if (!pullRequestTemplate.includes(requiredPullRequestTemplateText)) {
    fail(`pull request template must contain ${requiredPullRequestTemplateText}.`);
  }
}

for (const connectorConfigPath of [
  "config/forward-connector.config.example.json",
  "config/forward-connector.signed.config.example.json",
  "deploy/docker-compose/forward-connector.config.example.json",
  "deploy/systemd/forward-connector.config.example.json",
]) {
  const connectorConfig = await readJson(connectorConfigPath);
  if (connectorConfig.schemaVersion !== "forward-dynatrace-connector/v1") {
    fail(`${connectorConfigPath} must use schemaVersion forward-dynatrace-connector/v1.`);
  }
  if (!connectorConfig.statusArtifactPath?.endsWith("forward-ingest-status.json")) {
    fail(`${connectorConfigPath} must define statusArtifactPath ending in forward-ingest-status.json.`);
  }
  if (
    connectorConfigPath.startsWith("config/") &&
    connectorConfig.statusArtifactPath !== "forward-ingest-status.json"
  ) {
    fail(`${connectorConfigPath} must define local statusArtifactPath forward-ingest-status.json.`);
  }
  for (const forbiddenKey of [
    "forwardPassword",
    "forwardToken",
    "forwardUser",
    "password",
    "token",
    "user",
  ]) {
    if (Object.hasOwn(connectorConfig, forbiddenKey)) {
      fail(`${connectorConfigPath} must not contain ${forbiddenKey}.`);
    }
  }
}

const dashboardTemplatePath =
  "deploy/dynatrace-dashboard/forward-ingest-status-dashboard.template.json";
const dashboardTemplate = await readJson(dashboardTemplatePath);
if (dashboardTemplate.schemaVersion !== "forward-dynatrace-dashboard-template/v1") {
  fail(`${dashboardTemplatePath} must use schemaVersion forward-dynatrace-dashboard-template/v1.`);
}
if (!Array.isArray(dashboardTemplate.queries) || dashboardTemplate.queries.length === 0) {
  fail(`${dashboardTemplatePath} must define dashboard queries.`);
} else {
  for (const query of dashboardTemplate.queries) {
    if (!query.queryFile) {
      fail(`${dashboardTemplatePath} query ${query.id || "<unknown>"} must define queryFile.`);
      continue;
    }
    const queryPath = path.normalize(
      path.join(path.dirname(dashboardTemplatePath), query.queryFile),
    );
    if (!queryPath.startsWith("deploy/dynatrace-dql/") || !(await exists(queryPath))) {
      fail(`${dashboardTemplatePath} queryFile must point at an existing DQL file: ${query.queryFile}.`);
    }
  }
}

const textFiles = await walkTextFiles();
for (const file of textFiles) {
  const content = await readText(file);

  for (const term of legacyTerms) {
    if (content.includes(term)) {
      fail(`Legacy export term "${term}" found in ${file}.`);
    }
  }

  if (
    (file.startsWith("api/") || file.startsWith("ui/app/")) &&
    /(?:implementation is intentionally stubbed|API call implementation is intentionally stubbed)/iu.test(content)
  ) {
    fail(`Customer-facing demo dead end found in ${file}.`);
  }

  for (const pattern of secretPatterns) {
    if (pattern.regex.test(content)) {
      fail(`${pattern.name} found in ${file}.`);
    }
  }

  for (const pattern of publicHygienePatterns) {
    if (pattern.regex.test(content)) {
      fail(`${pattern.name} found in ${file}.`);
    }
  }

  for (const pattern of dynamicLocalHygienePatterns) {
    if (pattern.regex.test(content)) {
      fail(`${pattern.name} found in ${file}.`);
    }
  }

  const dynatraceEnvironmentUrls = content.matchAll(dynatraceEnvironmentUrlRegex);
  for (const match of dynatraceEnvironmentUrls) {
    if (match[1] !== "your-environment-id") {
      fail(`Concrete Dynatrace Apps environment URL found in ${file}: ${match[0]}`);
    }
  }
}

if (failures.length > 0) {
  process.stderr.write(`Repository validation failed:\n`);
  for (const failure of failures) {
    process.stderr.write(`- ${failure}\n`);
  }
  process.exit(1);
}

process.stdout.write("Repository validation passed.\n");
