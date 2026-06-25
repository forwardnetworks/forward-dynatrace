#!/usr/bin/env node

import { readFile, readdir, stat } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const failures = [];

const requiredFiles = [
  "AGENTS.md",
  "README.md",
  "docs/workflow.md",
  "docs/forward-ingest-contract.md",
  "docs/forward-importer.md",
  "docs/production-readiness.md",
  "docs/validation-matrix.md",
  "docs/harness-engineering.md",
  "docs/gitops.md",
  "docs/agent-guides/dynatrace-app.md",
  ".github/workflows/ci.yml",
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
];

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
      textExtensions.has(path.extname(entry.name)) &&
      relativePath !== "scripts/validate-repo.mjs"
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
  "docs/harness-engineering.md",
  "docs/agent-guides/dynatrace-app.md",
]) {
  if (!agentMap.includes(target)) {
    fail(`AGENTS.md does not point to ${target}.`);
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
}

if (failures.length > 0) {
  process.stderr.write(`Repository validation failed:\n`);
  for (const failure of failures) {
    process.stderr.write(`- ${failure}\n`);
  }
  process.exit(1);
}

process.stdout.write("Repository validation passed.\n");
