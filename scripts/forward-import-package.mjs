#!/usr/bin/env node

import { createHash } from "node:crypto";
import { readFile, writeFile } from "node:fs/promises";
import { setTimeout as sleep } from "node:timers/promises";
import { pathToFileURL } from "node:url";

const DEFAULT_CHECKS_PATH = "forward-intent-checks.json";
const DEFAULT_BATCH_SIZE = 500;
const DEFAULT_MAX_RETRIES = 3;
const TRANSIENT_STATUS_CODES = new Set([408, 409, 425, 429, 500, 502, 503, 504]);
const ALLOWED_CHECK_TYPES = new Set(["Existential"]);

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
  node scripts/forward-import-package.mjs --checks forward-intent-checks.json --report forward-import-report.json

Options:
  --apply              Create missing checks. Changed and stale checks are still report-only.
  --batch-size 500     Batch size for /checks?bulk.
  --fail-on-drift      Exit non-zero when changed or stale Dynatrace-managed checks are found.
  --max-retries 3      Retry count for transient Forward API responses.
  --report path        Write the reconciliation report to a JSON file.
  --validate-only      Validate package shape without contacting Forward.

The default mode is dry-run. The apply policy is create-missing-only.
`;

const SUPPORTED_ARGS = new Set([
  "_",
  "apply",
  "batch-size",
  "checks",
  "fail-on-drift",
  "help",
  "max-retries",
  "report",
  "validate-only",
]);

const parseArgs = (argv) => {
  const args = { _: [] };
  for (let index = 0; index < argv.length; index += 1) {
    const value = argv[index];
    if (!value.startsWith("--")) {
      args._.push(value);
      continue;
    }
    const key = value.slice(2);
    if (
      key === "apply" ||
      key === "fail-on-drift" ||
      key === "help" ||
      key === "validate-only"
    ) {
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

const validateArgs = (args) => {
  const unsupportedArgs = Object.keys(args).filter((key) => !SUPPORTED_ARGS.has(key));
  if (unsupportedArgs.length > 0) {
    throw new Error(
      `Unsupported option(s): ${unsupportedArgs.map((key) => `--${key}`).join(", ")}`,
    );
  }
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

const sortObject = (value) => {
  if (Array.isArray(value)) {
    return value.map(sortObject);
  }
  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value)
        .sort(([left], [right]) => left.localeCompare(right))
        .map(([key, child]) => [key, sortObject(child)]),
    );
  }
  return value;
};

const stableJson = (value) => JSON.stringify(sortObject(value));

const parseResponseBody = (text) => {
  if (text.length === 0) {
    return null;
  }
  try {
    return JSON.parse(text);
  } catch {
    return text;
  }
};

const retryDelayMs = (attempt, retryAfter) => {
  if (retryAfter) {
    const parsed = Number.parseFloat(retryAfter);
    if (Number.isFinite(parsed) && parsed >= 0) {
      return parsed * 1000;
    }
  }
  return Math.min(250 * 2 ** attempt, 4000);
};

export const dynatraceKeys = (check) =>
  (check.tags || []).filter((tag) => tag.startsWith("dynatrace-key:"));

export const reconciliationKey = (check) => dynatraceKeys(check)[0] || check.name || "";

const sortedTags = (check) => [...(check.tags || [])].sort();

export const canonicalizeCheck = (check) => ({
  definition: check.definition,
  enabled: check.enabled !== false,
  name: check.name || "",
  note: check.note || "",
  priority: check.priority || "NOT_SET",
  tags: sortedTags(check),
});

export const fingerprintCheck = (check) =>
  createHash("sha256").update(stableJson(canonicalizeCheck(check))).digest("hex");

const changedFields = (planned, existing) =>
  Object.keys(canonicalizeCheck(planned)).filter((field) => {
    const plannedValue = canonicalizeCheck(planned)[field];
    const existingValue = canonicalizeCheck(existing)[field];
    return stableJson(plannedValue) !== stableJson(existingValue);
  });

const indexExistingChecks = (existingChecks) => {
  const byKey = new Map();
  const byName = new Map();

  for (const check of existingChecks) {
    for (const key of dynatraceKeys(check)) {
      byKey.set(key, check);
    }
    if (check.name) {
      byName.set(check.name, check);
    }
  }

  return { byKey, byName };
};

const summarizeCheck = (check) => ({
  fingerprint: fingerprintCheck(check),
  id: check.id,
  key: reconciliationKey(check),
  name: check.name || "",
});

export const reconcileChecks = (plannedChecks, existingChecks) => {
  const { byKey, byName } = indexExistingChecks(existingChecks);
  const plannedKeys = new Set();
  const plannedNames = new Set();
  const create = [];
  const unchanged = [];
  const changed = [];

  for (const planned of plannedChecks) {
    const key = reconciliationKey(planned);
    const existing = (key && byKey.get(key)) || (planned.name && byName.get(planned.name));

    if (key) {
      plannedKeys.add(key);
    }
    if (planned.name) {
      plannedNames.add(planned.name);
    }

    if (!existing) {
      create.push({ ...summarizeCheck(planned), check: planned });
      continue;
    }

    const plannedFingerprint = fingerprintCheck(planned);
    const existingFingerprint = fingerprintCheck(existing);
    if (plannedFingerprint === existingFingerprint) {
      unchanged.push({
        existingId: existing.id,
        ...summarizeCheck(planned),
      });
      continue;
    }

    changed.push({
      existingId: existing.id,
      fields: changedFields(planned, existing),
      key,
      name: planned.name || existing.name || "",
      planned: {
        fingerprint: plannedFingerprint,
        check: planned,
      },
      existing: {
        fingerprint: existingFingerprint,
        check: existing,
      },
    });
  }

  const stale = existingChecks
    .filter((check) => dynatraceKeys(check).length > 0)
    .filter((check) => {
      const keys = dynatraceKeys(check);
      return (
        keys.every((key) => !plannedKeys.has(key)) &&
        (!check.name || !plannedNames.has(check.name))
      );
    })
    .map(summarizeCheck);

  return { create, unchanged, changed, stale };
};

const makeClient = ({ baseUrl, user, password, maxRetries }) => {
  const auth = Buffer.from(`${user}:${password}`).toString("base64");
  const root = baseUrl.replace(/\/+$/, "");

  return async (method, path, options = {}) => {
    for (let attempt = 0; attempt <= maxRetries; attempt += 1) {
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
      if (response.ok) {
        return response.status === 204 ? null : parseResponseBody(text);
      }

      if (TRANSIENT_STATUS_CODES.has(response.status) && attempt < maxRetries) {
        await sleep(retryDelayMs(attempt, response.headers.get("retry-after")));
        continue;
      }

      throw new Error(
        `${method} ${path} failed with ${response.status}: ${text.slice(0, 500)}`,
      );
    }

    throw new Error(`${method} ${path} failed after retry budget was exhausted.`);
  };
};

const toPositiveInteger = (value, label) => {
  const parsed = Number.parseInt(value, 10);
  if (!Number.isInteger(parsed) || parsed <= 0) {
    throw new Error(`${label} must be a positive integer.`);
  }
  return parsed;
};

const toNonNegativeInteger = (value, label) => {
  const parsed = Number.parseInt(value, 10);
  if (!Number.isInteger(parsed) || parsed < 0) {
    throw new Error(`${label} must be a non-negative integer.`);
  }
  return parsed;
};

const requireString = (value) => typeof value === "string" && value.trim().length > 0;

export const validatePlannedChecks = (checks) => {
  if (!Array.isArray(checks)) {
    throw new Error("forward-intent-checks.json must contain a NewNetworkCheck[] JSON array.");
  }

  const errors = [];
  const keys = new Map();
  const names = new Map();

  checks.forEach((check, index) => {
    const prefix = `check[${index}]`;
    if (!check || typeof check !== "object" || Array.isArray(check)) {
      errors.push(`${prefix} must be an object.`);
      return;
    }

    if (!requireString(check.name)) {
      errors.push(`${prefix}.name is required.`);
    } else if (names.has(check.name)) {
      errors.push(`${prefix}.name duplicates check[${names.get(check.name)}].name.`);
    } else {
      names.set(check.name, index);
    }

    if (!check.definition || typeof check.definition !== "object") {
      errors.push(`${prefix}.definition is required.`);
    } else if (!ALLOWED_CHECK_TYPES.has(check.definition.checkType)) {
      errors.push(
        `${prefix}.definition.checkType must be one of ${[...ALLOWED_CHECK_TYPES].join(", ")}.`,
      );
    }

    const keyTags = dynatraceKeys(check);
    if (keyTags.length !== 1) {
      errors.push(`${prefix}.tags must contain exactly one dynatrace-key:* tag.`);
    } else if (keys.has(keyTags[0])) {
      errors.push(`${prefix} dynatrace-key duplicates check[${keys.get(keyTags[0])}].`);
    } else {
      keys.set(keyTags[0], index);
    }
  });

  if (errors.length > 0) {
    throw new Error(`Invalid Forward intent package:\n${errors.map((error) => `- ${error}`).join("\n")}`);
  }
};

const main = async () => {
  const args = parseArgs(process.argv.slice(2));
  if (args.help) {
    process.stdout.write(usage);
    return;
  }
  validateArgs(args);

  const apply = Boolean(args.apply);
  const batchSize = args["batch-size"]
    ? toPositiveInteger(args["batch-size"], "--batch-size")
    : DEFAULT_BATCH_SIZE;
  const maxRetries = args["max-retries"]
    ? toNonNegativeInteger(args["max-retries"], "--max-retries")
    : DEFAULT_MAX_RETRIES;

  const checksPath = args.checks || DEFAULT_CHECKS_PATH;
  const plannedChecks = await readJson(checksPath);
  validatePlannedChecks(plannedChecks);

  if (args["validate-only"]) {
    const report = {
      mode: "validate-only",
      checksPath,
      plannedChecks: plannedChecks.length,
      status: "valid",
    };

    if (args.report) {
      await writeFile(args.report, JSON.stringify(report, null, 2) + "\n");
    }

    process.stdout.write(JSON.stringify(report, null, 2) + "\n");
    return;
  }

  const networkId = requiredEnv("FORWARD_NETWORK_ID");
  const api = makeClient({
    baseUrl: requiredEnv("FORWARD_BASE_URL"),
    user: requiredEnv("FORWARD_USER"),
    password: requiredEnv("FORWARD_PASSWORD"),
    maxRetries,
  });

  const latestSnapshot = await api(
    "GET",
    `/api/networks/${networkId}/snapshots/latestProcessed`,
  );
  const snapshotId = latestSnapshot.id;
  const existingChecks = await api(
    "GET",
    `/api/snapshots/${snapshotId}/checks?type=Existential`,
  );
  const reconciliation = reconcileChecks(plannedChecks, existingChecks);

  if (apply) {
    for (const batch of chunk(reconciliation.create.map((item) => item.check), batchSize)) {
      await api("POST", `/api/snapshots/${snapshotId}/checks?bulk`, {
        body: batch,
      });
    }
  }

  const report = {
    mode: apply ? "apply" : "dry-run",
    applyPolicy: "create-missing-only",
    settings: {
      batchSize,
      maxRetries,
    },
    networkId,
    snapshotId,
    plannedChecks: plannedChecks.length,
    existingDynatraceManagedChecks: existingChecks.filter((check) => dynatraceKeys(check).length > 0).length,
    counts: {
      create: reconciliation.create.length,
      unchanged: reconciliation.unchanged.length,
      changed: reconciliation.changed.length,
      stale: reconciliation.stale.length,
    },
    create: reconciliation.create.map(({ check: _check, ...item }) => item),
    unchanged: reconciliation.unchanged,
    changed: reconciliation.changed.map(({ planned, existing, ...item }) => ({
      ...item,
      plannedFingerprint: planned.fingerprint,
      existingFingerprint: existing.fingerprint,
    })),
    stale: reconciliation.stale,
  };

  if (args.report) {
    await writeFile(args.report, JSON.stringify(report, null, 2) + "\n");
  }

  process.stdout.write(JSON.stringify(report, null, 2) + "\n");

  if (args["fail-on-drift"] && (reconciliation.changed.length > 0 || reconciliation.stale.length > 0)) {
    process.exitCode = 2;
  }
};

if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((error) => {
    process.stderr.write(`${error.message}\n`);
    process.stderr.write(usage);
    process.exit(1);
  });
}
