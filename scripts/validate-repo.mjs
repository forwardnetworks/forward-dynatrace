#!/usr/bin/env node

import { lstat, readFile, readdir } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const failures = [];
const fail = (message) => failures.push(message);

const requiredFiles = [
  "README.md",
  "ARCHITECTURE.md",
  "CONTRIBUTING.md",
  "SECURITY.md",
  "SUPPORT.md",
  "LICENSE",
  "app.config.json",
  "package.json",
  "package-lock.json",
  ".node-version",
  ".nvmrc",
  "api/forward-sync.function.ts",
  "api/dependency-discovery.function.ts",
  "actions/sync-forward-intent-checks.action.ts",
  "actions/sync-forward-intent-checks.logic.ts",
  "actions/sync-forward-intent-checks.widget.tsx",
  "actions/run-forward-nqe-evidence.action.ts",
  "actions/run-forward-nqe-evidence.logic.ts",
  "actions/run-forward-nqe-evidence.widget.tsx",
  "settings/schemas/forward-api-connection.schema.json",
  "settings/schemas/dependency-discovery-profile.schema.json",
  "lib/dependency-discovery.ts",
  "lib/dependency-discovery-handler.ts",
  "lib/managed-check-identity.ts",
  "lib/forward-access-profile.ts",
  "lib/forward-authorization.ts",
  "lib/forward-client.ts",
  "lib/forward-connection.ts",
  "lib/forward-evidence.ts",
  "lib/forward-nqe-preview.ts",
  "lib/intent-builder.ts",
  "lib/reconciliation.ts",
  "lib/run-forward-nqe-evidence-action.ts",
  "lib/sync-forward-intent-action.ts",
  "lib/types/index.ts",
  "lib/types/forward.ts",
  "lib/types/nqe.ts",
  "scripts/dynatrace-export-action.test.mjs",
  "scripts/plan-digest-stability.test.mjs",
  "scripts/deploy-dynatrace-app.mjs",
  "scripts/install-release-app.mjs",
  "scripts/package-release-artifacts.mjs",
  "docs/index.md",
  "docs/install.md",
  "docs/evaluation-guide.md",
  "docs/dependency-discovery.md",
  "docs/compatibility-policy.md",
  "docs/ownership.md",
  "docs/release-communication.md",
  "docs/soak-and-recovery.md",
  "docs/release.md",
  "docs/release-provenance.md",
  "docs/rbac.md",
  "docs/workflow.md",
  "docs/dynatrace-workflow-trigger.md",
  ".github/workflows/ci.yml",
  ".github/workflows/release.yml",
  ".github/workflows/verify-release.yml",
];

const forbiddenFiles = [
  ".dockerignore",
  "Dockerfile.forward-importer",
  "docs/connector-runtime.md",
  "docs/container-runtime.md",
  "docs/cron-runtime.md",
  "docs/forward-importer.md",
  "docs/package-handoff.md",
  "schemas/connector-config.schema.json",
  "schemas/forward-approval.schema.json",
  "schemas/forward-import-plan.schema.json",
  "scripts/forward-cron-import.mjs",
  "scripts/forward-handoff-server.mjs",
  "scripts/forward-import-package.mjs",
  "scripts/forward-import-plan.mjs",
  "scripts/install-systemd-runtime.mjs",
  "scripts/publish-forward-package.mjs",
  "scripts/runtime-entrypoint.mjs",
];

const activeProductDocs = [
  "README.md",
  "ARCHITECTURE.md",
  "api/forward-nqe-preview.function.ts",
  "actions/run-forward-nqe-evidence.logic.ts",
  ".github/pull_request_template.md",
  "docs/index.md",
  "docs/install.md",
  "docs/evaluation-guide.md",
  "docs/dependency-discovery.md",
  "docs/release.md",
  "docs/release-provenance.md",
  "docs/rbac.md",
  "docs/workflow.md",
  "docs/dynatrace-workflow-trigger.md",
  "docs/dynatrace-app-development.md",
  "docs/problem-network-evidence.md",
  "docs/site-reliability-guardian.md",
  "docs/templates/customer-acceptance-record.md",
  "SECURITY.md",
  "SUPPORT.md",
  "docs/compatibility-policy.md",
  "docs/ownership.md",
  "docs/release-communication.md",
  "docs/soak-and-recovery.md",
];

const skippedDirectories = new Set([".git", ".dt-app", ".state", "build", "dist", "node_modules", "out", "tmp"]);
const textExtensions = new Set([".css", ".dql", ".html", ".js", ".json", ".md", ".mjs", ".ts", ".tsx", ".txt", ".yaml", ".yml"]);

const exists = async (relativePath) => {
  try {
    await lstat(path.join(root, relativePath));
    return true;
  } catch (error) {
    if (error?.code === "ENOENT") return false;
    throw error;
  }
};

for (const file of requiredFiles) {
  if (!await exists(file)) fail(`Missing required file: ${file}`);
}
for (const file of forbiddenFiles) {
  if (await exists(file)) fail(`Obsolete external-runtime file must be removed: ${file}`);
}
for (const directory of ["deploy/systemd", "deploy/kubernetes", "deploy/cron", "deploy/docker-compose"]) {
  if (await exists(directory)) fail(`External runtime directory must be removed: ${directory}`);
}

const readText = async (relativePath) => readFile(path.join(root, relativePath), "utf8");
const appConfig = JSON.parse(await readText("app.config.json"));
if (appConfig.app?.id !== "com.forward.dynatrace") fail("Dynatrace app ID must be com.forward.dynatrace.");
if (appConfig.app?.name !== "Forward") fail("Dynatrace app display name must be Forward.");
const actionNames = (appConfig.app?.actions || []).map((action) => action.name).sort();
if (JSON.stringify(actionNames) !== JSON.stringify([
  "run-forward-nqe-evidence",
  "sync-forward-intent-checks",
])) {
  fail("The app must register exactly the bundled synchronization and NQE evidence actions.");
}

const connectionSchema = JSON.parse(await readText("settings/schemas/forward-api-connection.schema.json"));
if (connectionSchema.schemaId !== "forward-api-connection") fail("Forward connection schema ID is invalid.");
if (connectionSchema.version !== "2.1.0") fail("Forward connection schema must use the additive v2.1 contract.");
if (connectionSchema.properties?.password?.type !== "secret") fail("Forward password must be a secret setting.");
if (connectionSchema.properties?.approvedLibraryQueryIds?.type !== "text") {
  fail("Forward connection must expose a bounded Read Only Library-query allowlist.");
}
if (
  connectionSchema.properties?.approvedQueryDigests?.type !== "text" ||
  connectionSchema.properties?.approvedQueryDigests?.nullable !== true
) {
  fail("Forward connection arbitrary-query digest allowlist must remain optional and nullable.");
}
if (connectionSchema.properties?.baseUrl?.default !== "https://fwd.app/api") {
  fail("Forward API connection must default to the public Forward API root.");
}

const discoverySchema = JSON.parse(await readText("settings/schemas/dependency-discovery-profile.schema.json"));
if (discoverySchema.schemaId !== "dependency-discovery-profile") {
  fail("Dependency discovery profile schema ID is invalid.");
}
if (discoverySchema.version !== "1.0.0") {
  fail("Dependency discovery profile must use the initial v1 contract.");
}
if (!String(discoverySchema.properties?.query?.default || "").startsWith("fetch spans")) {
  fail("Dependency discovery profile must default to a spans-only query template.");
}
const localMockSettings = JSON.parse(await readText("settings/local-mock-data/values.json"));
const localMockDiscovery = Array.isArray(localMockSettings)
  ? localMockSettings.find((object) => object?.schemaId === "dependency-discovery-profile")
  : undefined;
const localMockDiscoveryQuery = String(localMockDiscovery?.value?.query || "");
if (!localMockDiscoveryQuery.includes("`dependency.observed_at` = start_time")) {
  fail("Local dependency discovery must project the live span start_time as its evidence timestamp.");
}
if (!localMockDiscoveryQuery.includes("`dependency.evidence_source` = \"dynatrace-live-spans\"")) {
  fail("Local dependency discovery must label its spans-only evidence source.");
}

const packageJson = JSON.parse(await readText("package.json"));
if (packageJson.engines?.node !== ">=24.0.0 <25.0.0") fail("Node 24 must be the exact supported major.");
for (const name of Object.keys(packageJson.scripts || {})) {
  if (/^(?:systemd|forward:(?:handoff|import|cron)|runtime:)/u.test(name)) {
    fail(`Obsolete external-runtime npm script must be removed: ${name}`);
  }
}
if (packageJson.scripts?.["plan-digest:test"] !==
  "node --test --disable-warning=MODULE_TYPELESS_PACKAGE_JSON --experimental-strip-types scripts/plan-digest-stability.test.mjs") {
  fail("The byte-stable plan digest regression test must remain available as plan-digest:test.");
}
if (!String(packageJson.scripts?.ci || "").includes("npm run plan-digest:test")) {
  fail("CI must run the byte-stable plan digest regression test.");
}

const adapterFiles = [
  "api/dependency-discovery.function.ts",
  "api/forward-nqe-preview.function.ts",
  "api/forward-sync.function.ts",
  "actions/run-forward-nqe-evidence.logic.ts",
  "actions/sync-forward-intent-checks.logic.ts",
];
for (const file of adapterFiles) {
  const text = await readText(file);
  if (/from\s+["'][^"']*(?:\/api\/|\/actions\/|\.\.\/api\/|\.\.\/actions\/|\.\.\/sync-forward-intent-checks\.logic)/u.test(text)) {
    fail(`${file} must depend on lib modules, not another API or action adapter.`);
  }
}
const syncAction = await readText("actions/sync-forward-intent-checks.logic.ts");
if (!syncAction.includes('from "../lib/sync-forward-intent-action.ts"')) {
  fail("The synchronization action must remain a thin adapter over lib/sync-forward-intent-action.ts.");
}
const syncActionImplementation = await readText("lib/sync-forward-intent-action.ts");
if (!syncActionImplementation.includes('from "./intent-builder.ts"')) {
  fail("The synchronization implementation must build typed intent packages through lib/intent-builder.ts.");
}
if (
  syncActionImplementation.includes("exportManifestPreview") ||
  syncActionImplementation.includes("intentChecksPreview")
) {
  fail("The synchronization runtime must not stringify and reparse generated intent artifacts.");
}
const nqeAction = await readText("actions/run-forward-nqe-evidence.logic.ts");
if (!nqeAction.includes('from "../lib/run-forward-nqe-evidence-action.ts"')) {
  fail("The NQE action must remain a thin adapter over lib/run-forward-nqe-evidence-action.ts.");
}
const discoveryFunction = await readText("api/dependency-discovery.function.ts");
if (!discoveryFunction.includes('from "../lib/dependency-discovery-handler.ts"')) {
  fail("The dependency discovery app function must remain a thin adapter over lib/dependency-discovery-handler.ts.");
}
const syncFunction = await readText("api/forward-sync.function.ts");
if (!syncFunction.includes('from "../lib/intent-builder.ts"')) {
  fail("The Forward sync app function must remain an adapter over lib/intent-builder.ts.");
}
const nqePreviewFunction = await readText("api/forward-nqe-preview.function.ts");
if (!nqePreviewFunction.includes('from "../lib/forward-nqe-preview.ts"')) {
  fail("The Forward NQE preview app function must remain an adapter over lib/forward-nqe-preview.ts.");
}

const releaseWorkflow = await readText(".github/workflows/release.yml");
for (const forbidden of ["ghcr.io", "Dockerfile", "docker/", "Trivy", "importer image", "packages: write"]) {
  if (releaseWorkflow.includes(forbidden)) fail(`Release workflow must be app-only; found ${forbidden}.`);
}

for (const file of activeProductDocs) {
  const text = await readText(file);
  for (const forbidden of [
    "Forward-side importer",
    "forward-dynatrace-importer",
    "forward-package-handoff-connection",
    "customer-owned handoff",
    "GHCR",
    "ghcr.io",
    "Dynatrace exports, Forward imports",
    "Dynatrace contains no Forward credential",
    "performs no Forward network call",
    "protected mounted header file",
    "Importer image digest",
    "Package writer and reader identities",
    "Forward-controlled runtime",
  ]) {
    if (text.includes(forbidden)) fail(`${file} contains obsolete architecture term: ${forbidden}`);
  }
}

const secretPatterns = [
  ["Dynatrace token", /dt0[a-z0-9]{2,}\.[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{20,}/giu],
  ["PEM private key", /-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----/gu],
  ["GitHub token", /gh[opusr]_[A-Za-z0-9]{30,}/gu],
  ["AWS access key", /AKIA[0-9A-Z]{16}/gu],
];

const walk = async (directory) => {
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    if (entry.name === "AGENTS.md" || entry.name === "CLAUDE.md") {
      fail(`Repository-local agent instruction file must be removed: ${path.relative(root, path.join(directory, entry.name))}`);
      continue;
    }
    if (entry.isDirectory() && skippedDirectories.has(entry.name)) continue;
    const entryPath = path.join(directory, entry.name);
    if (entry.isDirectory()) {
      await walk(entryPath);
      continue;
    }
    if (!entry.isFile() || !textExtensions.has(path.extname(entry.name))) continue;
    const relativePath = path.relative(root, entryPath);
    const text = await readFile(entryPath, "utf8");
    if (/\bcostco\b/iu.test(text)) fail(`${relativePath} contains customer-specific naming.`);
    for (const [label, pattern] of secretPatterns) {
      pattern.lastIndex = 0;
      if (pattern.test(text)) fail(`${relativePath} contains a ${label}-shaped value.`);
    }
  }
};

await walk(root);

if (failures.length > 0) {
  for (const failure of failures) process.stderr.write(`- ${failure}\n`);
  process.exit(1);
}
process.stdout.write("Repository validation passed: one Dynatrace app, direct Forward APIs, no external runtime.\n");
