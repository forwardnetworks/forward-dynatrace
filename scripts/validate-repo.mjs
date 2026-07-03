#!/usr/bin/env node

import { readFile, readdir, stat } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const failures = [];

const requiredFiles = [
  "AGENTS.md",
  "README.md",
  ".node-version",
  ".nvmrc",
  ".dockerignore",
  "Dockerfile.forward-importer",
  "docs/install.md",
  "docs/workflow.md",
  "docs/dynatrace-workflow-trigger.md",
  "docs/forward-ingest-contract.md",
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
  "docs/schema-versioning.md",
  "docs/data-handling.md",
  "docs/rbac.md",
  "docs/package-handoff.md",
  "docs/observability.md",
  "docs/admin-operations.md",
  "docs/release.md",
  "docs/validation-matrix.md",
  "docs/harness-engineering.md",
  "docs/gitops.md",
  "docs/demo-data.md",
  "docs/client-trial-plan.md",
  "docs/live-demo-runbook.md",
  "docs/execution-roadmap.md",
  "docs/agent-guides/dynatrace-app.md",
  "shared/demo-dependencies.json",
  "shared/demo-dynatrace-query-rows.json",
  "shared/demo-forward-ingest-status.json",
  "config/forward-connector.config.example.json",
  "config/forward-connector.signed.config.example.json",
  "config/forward-nqe-live-smoke.approval.example.json",
  "api/forward-status.function.ts",
  "api/forward-nqe-preview.function.ts",
  "ui/app/types/forward-status.ts",
  "ui/app/types/forward-nqe-preview.ts",
  "scripts/sign-forward-package.mjs",
  "scripts/package-release-artifacts.mjs",
  "scripts/publish-forward-status.mjs",
  "scripts/publish-forward-status.test.mjs",
  "scripts/write-release-checksums.mjs",
  "scripts/release-checksums.test.mjs",
  "scripts/query-dynatrace-dependencies.mjs",
  "scripts/copy-dynatrace-demo-data.mjs",
  "scripts/forward-nqe-live-smoke.mjs",
  "scripts/forward-nqe-live-smoke.test.mjs",
  "scripts/forward-nqe-artifacts.mjs",
  "scripts/forward-nqe-artifacts.test.mjs",
  "scripts/forward-nqe-preview.test.mjs",
  "scripts/forward-package.test.mjs",
  "scripts/forward-status.test.mjs",
  "scripts/build-forward-package.mjs",
  "scripts/normalize-dynatrace-dependencies.mjs",
  "scripts/normalize-dynatrace-dependencies.test.mjs",
  "scripts/demo-rehearsal.mjs",
  "scripts/load-scale-smoke.mjs",
  "scripts/workflow-smoke.mjs",
  "scripts/validate-runtime-manifests.mjs",
  "scripts/validate-dynatrace-workflow-examples.mjs",
  "scripts/seed-dynatrace-demo-data.mjs",
  "deploy/dynatrace-dql/service-dependency-candidates-openpipeline-events.dql",
  "deploy/dynatrace-dql/service-dependencies-smartscape.dql",
  "deploy/dynatrace-workflows/forward-sync-schedule.payload.example.json",
  "deploy/dynatrace-workflows/forward-sync-problem.payload.example.json",
  "deploy/dynatrace-workflows/forward-sync-on-demand.payload.example.json",
  "deploy/systemd/forward-dynatrace-connector.service",
  "deploy/systemd/forward-dynatrace-connector.timer",
  "deploy/systemd/forward-dynatrace.env.example",
  "deploy/systemd/forward-connector.config.example.json",
  "deploy/kubernetes/forward-dynatrace-connector-cronjob.yaml",
  "deploy/kubernetes/forward-dynatrace-configmap.example.yaml",
  "deploy/kubernetes/forward-dynatrace-secret.example.yaml",
  ".github/workflows/ci.yml",
  ".github/workflows/release.yml",
  ".github/CODEOWNERS",
  ".github/dependabot.yml",
  ".github/pull_request_template.md",
];

const requiredScreenshots = [
  "docs/assets/screenshots/01-overview.jpg",
  "docs/assets/screenshots/02-export-package-readiness.jpg",
  "docs/assets/screenshots/03-forward-side-api.jpg",
  "docs/assets/screenshots/04-intent-check-payload.jpg",
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
];

const expectedPublicEnvironmentUrl =
  "https://your-environment-id.apps.dynatrace.com/";
const expectedNodeVersionFile = "24";
const expectedNodeEngineRange = ">=24.0.0 <25.0.0";

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
  "README.md",
  "app.config.json",
  "package.json",
  "api/forward-sync.function.ts",
  "api/network-proof.function.ts",
  "api/forward-status.function.ts",
  "api/forward-nqe-preview.function.ts",
  "docs/harness-engineering.md",
  "docs/execution-roadmap.md",
  "docs/forward-nqe-preview.md",
  "docs/forward-nqe-artifacts.md",
  "docs/forward-api-compatibility.md",
  "docs/live-demo-runbook.md",
  "docs/install.md",
  "docs/production-readiness.md",
  "docs/enterprise-hardening.md",
  "docs/operations-runbook.md",
  "docs/incident-response.md",
  "docs/threat-model.md",
  "docs/container-runtime.md",
  "docs/connector-runtime.md",
  "docs/schema-versioning.md",
  "docs/data-handling.md",
  "docs/rbac.md",
  "docs/package-handoff.md",
  "docs/observability.md",
  "docs/admin-operations.md",
  "docs/release.md",
  "docs/screenshots.md",
  "docs/validation-matrix.md",
  "docs/workflow.md",
  "docs/dynatrace-workflow-trigger.md",
  "ui/app/pages/Home.tsx",
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
if (agentMapLineCount > 140) {
  fail(`AGENTS.md should stay compact; found ${agentMapLineCount} lines.`);
}

for (const target of [
  "docs/workflow.md",
  "docs/validation-matrix.md",
  "docs/enterprise-hardening.md",
  "docs/operations-runbook.md",
  "docs/incident-response.md",
  "docs/threat-model.md",
  "docs/container-runtime.md",
  "docs/connector-runtime.md",
  "docs/schema-versioning.md",
  "docs/data-handling.md",
  "docs/rbac.md",
  "docs/package-handoff.md",
  "docs/observability.md",
  "docs/admin-operations.md",
  "docs/release.md",
  "docs/demo-data.md",
  "docs/client-trial-plan.md",
  "docs/live-demo-runbook.md",
  "docs/execution-roadmap.md",
  "docs/forward-nqe-preview.md",
  "docs/forward-nqe-artifacts.md",
  "docs/forward-api-compatibility.md",
  "docs/harness-engineering.md",
  "docs/agent-guides/dynatrace-app.md",
]) {
  if (!agentMap.includes(target)) {
    fail(`AGENTS.md does not point to ${target}.`);
  }
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

for (const nodeVersionFile of [".nvmrc", ".node-version"]) {
  const nodeVersion = (await readText(nodeVersionFile)).trim();
  if (nodeVersion !== expectedNodeVersionFile) {
    fail(`${nodeVersionFile} must pin Node ${expectedNodeVersionFile}.`);
  }
}

for (const scriptName of [
  "release:checksums:test",
  "forward:nqe-preview:test",
  "forward:nqe-live-smoke:test",
  "dynatrace:normalize:test",
  "runtime:validate",
  "dynatrace:workflow:validate",
  "demo:rehearsal",
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
if (!packageJson.scripts?.["forward:sign"]) {
  fail("package.json must define npm script forward:sign.");
}
if (!packageJson.scripts?.["release:checksums"]) {
  fail("package.json must define npm script release:checksums.");
}
if (!packageJson.scripts?.["release:package"]) {
  fail("package.json must define npm script release:package.");
}
if (!packageJson.scripts?.["dynatrace:normalize"]) {
  fail("package.json must define npm script dynatrace:normalize.");
}
if (!packageJson.scripts?.["dynatrace:query"]) {
  fail("package.json must define npm script dynatrace:query.");
}
if (!packageJson.scripts?.["dynatrace:copy-demo"]) {
  fail("package.json must define npm script dynatrace:copy-demo.");
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
if (!packageJson.scripts?.["forward:status:publish"]) {
  fail("package.json must define npm script forward:status:publish.");
}

const releaseWorkflow = await readText(".github/workflows/release.yml");
for (const requiredReleaseWorkflowText of [
  "npm run ci",
  "npm run release:package",
  "SHA256SUMS",
  "actions/upload-artifact",
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
  "deploy/dynatrace-workflows",
  "deploy/dynatrace-dql",
  "service-dependency-candidates-openpipeline-events.dql",
  "service-dependencies-smartscape.dql",
  "forward-sync-on-demand.payload.example.json",
  "docs/dynatrace-workflow-trigger.md",
  "docs/forward-ingest-contract.md",
  "docs/forward-nqe-preview.md",
  "docs/forward-nqe-artifacts.md",
  "docs/forward-api-compatibility.md",
  "docs/live-demo-runbook.md",
  "docs/execution-roadmap.md",
  "docs/connector-runtime.md",
  "deploy/systemd/forward-dynatrace-connector.service",
  "deploy/kubernetes/forward-dynatrace-connector-cronjob.yaml",
  "scripts/write-release-checksums.mjs",
  "scripts/query-dynatrace-dependencies.mjs",
  "scripts/copy-dynatrace-demo-data.mjs",
  "scripts/build-forward-package.mjs",
  "scripts/normalize-dynatrace-dependencies.mjs",
  "scripts/demo-rehearsal.mjs",
  "scripts/load-scale-smoke.mjs",
  "SHA256SUMS",
]) {
  if (!releasePackager.includes(requiredPackagerText)) {
    fail(`release packager must contain ${requiredPackagerText}.`);
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
]) {
  const connectorConfig = await readJson(connectorConfigPath);
  if (connectorConfig.schemaVersion !== "forward-dynatrace-connector/v1") {
    fail(`${connectorConfigPath} must use schemaVersion forward-dynatrace-connector/v1.`);
  }
  if (connectorConfig.statusArtifactPath !== "forward-ingest-status.json") {
    fail(`${connectorConfigPath} must define statusArtifactPath forward-ingest-status.json.`);
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

const textFiles = await walkTextFiles();
for (const file of textFiles) {
  const content = await readText(file);

  for (const term of legacyTerms) {
    if (content.includes(term)) {
      fail(`Legacy export term "${term}" found in ${file}.`);
    }
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
