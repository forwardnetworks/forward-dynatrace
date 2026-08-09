#!/usr/bin/env node

import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const read = (relativePath) => readFile(path.join(root, relativePath), "utf8");

const packageJson = JSON.parse(await read("package.json"));
const appConfig = JSON.parse(await read("app.config.json"));
const runbook = await read("docs/sandbox-enablement-runbook.md");
const failures = [];

if (packageJson.version !== appConfig.app?.version) {
  failures.push("package.json and app.config.json versions must match.");
}

const requiredText = [
  `Source build: **v${packageJson.version}**.`,
  "oneagent-network-flow-dependencies.dql",
  "forward-sync-on-demand.payload.example.json",
  "Use staged plan request",
  "mutationCounts.created = 0",
  "mutationCounts.updated = 0",
  "Test connection",
  "Smartscape nodes and edges",
  "NQE proves the NQE surface only",
];
for (const text of requiredText) {
  if (!runbook.includes(text)) failures.push(`Sandbox runbook is missing required text: ${text}`);
}

for (const forbidden of [["Cost", "co"].join(""), "CREDENTIALS_VAULT-000", "10.215.", "Bearer "]) {
  if (runbook.includes(forbidden)) failures.push(`Sandbox runbook contains customer-specific or secret-like text: ${forbidden}`);
}

if (failures.length > 0) {
  for (const failure of failures) process.stderr.write(`${failure}\n`);
  process.exitCode = 1;
} else {
  process.stdout.write(`Operator documentation validation passed for source v${packageJson.version}.\n`);
}
