#!/usr/bin/env node

import { readFile } from "node:fs/promises";

const DEFAULT_CHECKS_PATH = "forward-intent-checks.json";
const DEFAULT_BATCH_SIZE = 500;

const usage = `
Forward Dynatrace package importer

Required environment:
  FORWARD_BASE_URL       Example: https://fwd.app
  FORWARD_USER           Forward username
  FORWARD_PASSWORD       Forward password or token accepted by the tenant
  FORWARD_NETWORK_ID     Target Forward network ID

Usage:
  node scripts/forward-import-package.mjs --checks forward-intent-checks.json
  node scripts/forward-import-package.mjs --checks forward-intent-checks.json --apply

The default mode is dry-run. Use --apply to write missing checks.
`;

const parseArgs = (argv) => {
  const args = { _: [] };
  for (let index = 0; index < argv.length; index += 1) {
    const value = argv[index];
    if (!value.startsWith("--")) {
      args._.push(value);
      continue;
    }
    const key = value.slice(2);
    if (key === "apply" || key === "help") {
      args[key] = true;
      continue;
    }
    const next = argv[index + 1];
    if (!next || next.startsWith("--")) {
      throw new Error(`Missing value for --${key}`);
    }
    args[key] = next;
    index += 1;
  }
  return args;
};

const requiredEnv = (name) => {
  const value = process.env[name];
  if (!value) {
    throw new Error(`Missing required environment variable: ${name}`);
  }
  return value;
};

const readJson = async (path) => JSON.parse(await readFile(path, "utf8"));

const chunk = (items, size) => {
  const chunks = [];
  for (let index = 0; index < items.length; index += size) {
    chunks.push(items.slice(index, index + size));
  }
  return chunks;
};

const dynatraceKeys = (check) =>
  (check.tags || []).filter((tag) => tag.startsWith("dynatrace-key:"));

const hasMatchingImportedCheck = (planned, existing) => {
  const plannedKeys = new Set(dynatraceKeys(planned));
  return existing.some((check) => {
    if (planned.name && check.name === planned.name) {
      return true;
    }
    return dynatraceKeys(check).some((key) => plannedKeys.has(key));
  });
};

const makeClient = ({ baseUrl, user, password }) => {
  const auth = Buffer.from(`${user}:${password}`).toString("base64");
  const root = baseUrl.replace(/\/+$/, "");

  return async (method, path, options = {}) => {
    const response = await fetch(`${root}${path}`, {
      method,
      headers: {
        Authorization: `Basic ${auth}`,
        Accept: "application/json",
        ...(options.body ? { "Content-Type": "application/json" } : {}),
        ...options.headers,
      },
      body: options.body ? JSON.stringify(options.body) : undefined,
    });

    const text = await response.text();
    if (!response.ok) {
      throw new Error(
        `${method} ${path} failed with ${response.status}: ${text.slice(0, 500)}`,
      );
    }
    if (response.status === 204 || text.length === 0) {
      return null;
    }
    try {
      return JSON.parse(text);
    } catch {
      return text;
    }
  };
};

const main = async () => {
  const args = parseArgs(process.argv.slice(2));
  if (args.help) {
    process.stdout.write(usage);
    return;
  }
  const unsupportedArgs = Object.keys(args).filter(
    (key) => !["_", "apply", "checks", "help"].includes(key),
  );
  if (unsupportedArgs.length > 0) {
    throw new Error(`Unsupported option(s): ${unsupportedArgs.map((key) => `--${key}`).join(", ")}`);
  }

  const apply = Boolean(args.apply);
  const networkId = requiredEnv("FORWARD_NETWORK_ID");
  const api = makeClient({
    baseUrl: requiredEnv("FORWARD_BASE_URL"),
    user: requiredEnv("FORWARD_USER"),
    password: requiredEnv("FORWARD_PASSWORD"),
  });

  const checksPath = args.checks || DEFAULT_CHECKS_PATH;
  const plannedChecks = await readJson(checksPath);
  if (!Array.isArray(plannedChecks)) {
    throw new Error(`${checksPath} must contain a NewNetworkCheck[] JSON array.`);
  }

  const latestSnapshot = await api(
    "GET",
    `/api/networks/${networkId}/snapshots/latestProcessed`,
  );
  const snapshotId = latestSnapshot.id;
  const existingChecks = await api(
    "GET",
    `/api/snapshots/${snapshotId}/checks?type=Existential`,
  );
  const missingChecks = plannedChecks.filter(
    (check) => !hasMatchingImportedCheck(check, existingChecks),
  );

  if (apply) {
    for (const batch of chunk(missingChecks, DEFAULT_BATCH_SIZE)) {
      await api("POST", `/api/snapshots/${snapshotId}/checks?bulk`, {
        body: batch,
      });
    }
  }

  process.stdout.write(
    JSON.stringify(
      {
        mode: apply ? "apply" : "dry-run",
        networkId,
        snapshotId,
        plannedChecks: plannedChecks.length,
        existingMatches: plannedChecks.length - missingChecks.length,
        checksToCreate: missingChecks.length,
      },
      null,
      2,
    ) + "\n",
  );
};

main().catch((error) => {
  process.stderr.write(`${error.message}\n`);
  process.stderr.write(usage);
  process.exit(1);
});
