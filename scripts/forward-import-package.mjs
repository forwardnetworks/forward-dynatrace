#!/usr/bin/env node

import { createHash } from "node:crypto";
import { readFile, writeFile } from "node:fs/promises";
import { setTimeout as sleep } from "node:timers/promises";
import { pathToFileURL } from "node:url";

const DEFAULT_CHECKS_PATH = "forward-intent-checks.json";
const DEFAULT_MANIFEST_FILE_NAME = "forward-dynatrace-manifest.json";
const DEFAULT_BATCH_SIZE = 500;
const DEFAULT_MAX_RETRIES = 3;
const DEFAULT_MAX_PACKAGE_AGE_MINUTES = 24 * 60;
const PACKAGE_SCHEMA_VERSION = "forward-dynatrace/v1";
const PACKAGE_TYPE = "forward-intent-import";
const TRANSIENT_STATUS_CODES = new Set([408, 409, 425, 429, 500, 502, 503, 504]);
const ALLOWED_CHECK_TYPES = new Set(["Existential"]);
const LOCAL_HTTP_HOSTS = new Set(["127.0.0.1", "::1", "localhost"]);

const usage = `
Forward Dynatrace package importer

Required environment:
  FORWARD_BASE_URL       Example: https://forward.example.com
  FORWARD_USER           Forward username
  FORWARD_PASSWORD       Forward password or token accepted by the tenant
  FORWARD_NETWORK_ID     Target Forward network ID

Usage:
  node scripts/forward-import-package.mjs --checks forward-intent-checks.json --manifest forward-dynatrace-manifest.json
  node scripts/forward-import-package.mjs --checks forward-intent-checks.json --manifest forward-dynatrace-manifest.json --apply
  node scripts/forward-import-package.mjs --package-url https://package.example.com/dynatrace-forward/latest/ --report forward-import-report.json

Options:
  --apply              Create missing checks. Changed and stale checks are still report-only.
  --batch-size 500     Batch size for /checks?bulk.
  --checks-url url      Pull forward-intent-checks.json from a read-only HTTPS URL.
  --fail-on-drift      Exit non-zero when changed or stale Dynatrace-managed checks are found.
  --manifest path      Validate the package manifest before importing.
  --manifest-url url    Pull forward-dynatrace-manifest.json from a read-only HTTPS URL.
  --max-package-age-minutes 1440
                       Reject manifests older than this age.
  --max-retries 3      Retry count for transient Forward API responses.
  --package-url url     Pull manifest and checks from a base URL.
  --report path        Write the reconciliation report to a JSON file.
  --validate-only      Validate package shape without contacting Forward.

The default mode is dry-run. The apply policy is create-missing-only. Non-local
package URLs must use HTTPS.
`;

const SUPPORTED_ARGS = new Set([
  "_",
  "apply",
  "batch-size",
  "checks",
  "checks-url",
  "fail-on-drift",
  "help",
  "manifest",
  "manifest-url",
  "max-package-age-minutes",
  "max-retries",
  "package-url",
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
  if (args.checks && args["checks-url"]) {
    throw new Error("Use either --checks or --checks-url, not both.");
  }
  if (args.manifest && args["manifest-url"]) {
    throw new Error("Use either --manifest or --manifest-url, not both.");
  }
  if (args["package-url"] && (args.checks || args.manifest)) {
    throw new Error(
      "Use --checks-url or --manifest-url to override files when --package-url is set.",
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

const isUrlLocator = (locator) => /^https?:\/\//i.test(locator);

const joinUrl = (baseUrl, fileName) => `${baseUrl.replace(/\/+$/, "")}/${fileName}`;

const validatePackageUrl = (locator) => {
  const url = new URL(locator);
  if (url.protocol === "https:") {
    return;
  }
  if (url.protocol === "http:" && LOCAL_HTTP_HOSTS.has(url.hostname)) {
    return;
  }
  throw new Error(`Package URL must use HTTPS unless it is localhost: ${locator}`);
};

const readJsonFromLocator = async (locator, label) => {
  if (!isUrlLocator(locator)) {
    return readJson(locator);
  }

  validatePackageUrl(locator);
  const response = await fetch(locator, {
    headers: { Accept: "application/json" },
  });
  const text = await response.text();
  if (!response.ok) {
    throw new Error(`${label} fetch failed with ${response.status}: ${text.slice(0, 500)}`);
  }
  try {
    return JSON.parse(text);
  } catch (error) {
    throw new Error(`${label} did not contain valid JSON: ${error.message}`);
  }
};

const resolvePackageLocators = (args) => {
  if (args["package-url"]) {
    return {
      checks: args["checks-url"] || joinUrl(args["package-url"], DEFAULT_CHECKS_PATH),
      manifest:
        args["manifest-url"] ||
        joinUrl(args["package-url"], DEFAULT_MANIFEST_FILE_NAME),
    };
  }

  return {
    checks: args["checks-url"] || args.checks || DEFAULT_CHECKS_PATH,
    manifest: args["manifest-url"] || args.manifest,
  };
};

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

const requireObject = (value, label, errors) => {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    errors.push(`${label} must be an object.`);
    return false;
  }
  return true;
};

export const validatePlannedChecks = (checks) => {
  if (!Array.isArray(checks)) {
    throw new Error(
      "forward-intent-checks.json must contain a NewNetworkCheck[] JSON array.",
    );
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
    throw new Error(
      `Invalid Forward intent package:\n${errors
        .map((error) => `- ${error}`)
        .join("\n")}`,
    );
  }
};

const invalidManifestError = (errors) =>
  new Error(
    `Invalid Forward intent manifest:\n${errors
      .map((error) => `- ${error}`)
      .join("\n")}`,
  );

export const validateManifest = (
  manifest,
  plannedChecks,
  { maxPackageAgeMinutes = DEFAULT_MAX_PACKAGE_AGE_MINUTES } = {},
) => {
  const errors = [];
  if (!requireObject(manifest, "manifest", errors)) {
    throw invalidManifestError(errors);
  }

  if (manifest.schemaVersion !== PACKAGE_SCHEMA_VERSION) {
    errors.push(`manifest.schemaVersion must be ${PACKAGE_SCHEMA_VERSION}.`);
  }
  if (manifest.packageType !== PACKAGE_TYPE) {
    errors.push(`manifest.packageType must be ${PACKAGE_TYPE}.`);
  }
  if (!requireString(manifest.packageId)) {
    errors.push("manifest.packageId is required.");
  }
  if (!requireString(manifest.generatedAt)) {
    errors.push("manifest.generatedAt is required.");
  } else {
    const generatedAtMs = Date.parse(manifest.generatedAt);
    if (!Number.isFinite(generatedAtMs)) {
      errors.push("manifest.generatedAt must be an ISO timestamp.");
    } else {
      const maxAgeMs = maxPackageAgeMinutes * 60 * 1000;
      if (Date.now() - generatedAtMs > maxAgeMs) {
        errors.push(`manifest.generatedAt is older than ${maxPackageAgeMinutes} minutes.`);
      }
    }
  }

  if (requireObject(manifest.source, "manifest.source", errors)) {
    if (manifest.source.platform !== "dynatrace") {
      errors.push("manifest.source.platform must be dynatrace.");
    }
    if (manifest.source.writePolicy !== "dynatrace-never-writes-forward") {
      errors.push("manifest.source.writePolicy must be dynatrace-never-writes-forward.");
    }
  }

  if (requireObject(manifest.artifacts, "manifest.artifacts", errors)) {
    if (manifest.artifacts.intentChecks !== DEFAULT_CHECKS_PATH) {
      errors.push(`manifest.artifacts.intentChecks must be ${DEFAULT_CHECKS_PATH}.`);
    }
    if (manifest.artifacts.manifest !== DEFAULT_MANIFEST_FILE_NAME) {
      errors.push(`manifest.artifacts.manifest must be ${DEFAULT_MANIFEST_FILE_NAME}.`);
    }
  }

  if (requireObject(manifest.intentChecks, "manifest.intentChecks", errors)) {
    if (manifest.intentChecks.count !== plannedChecks.length) {
      errors.push(
        `manifest.intentChecks.count ${manifest.intentChecks.count} does not match package count ${plannedChecks.length}.`,
      );
    }
    if (manifest.intentChecks.payloadShape !== "NewNetworkCheck[]") {
      errors.push("manifest.intentChecks.payloadShape must be NewNetworkCheck[].");
    }
    if (manifest.intentChecks.checkType !== "Existential") {
      errors.push("manifest.intentChecks.checkType must be Existential.");
    }
    if (manifest.intentChecks.bulkEndpoint !== "/api/snapshots/{snapshotId}/checks?bulk") {
      errors.push("manifest.intentChecks.bulkEndpoint must target /checks?bulk.");
    }
    if (manifest.intentChecks.dedupeRequiredBeforePost !== true) {
      errors.push("manifest.intentChecks.dedupeRequiredBeforePost must be true.");
    }
  }

  if (requireObject(manifest.validation, "manifest.validation", errors)) {
    if (manifest.validation.requiredTagPrefix !== "dynatrace-key:") {
      errors.push("manifest.validation.requiredTagPrefix must be dynatrace-key:.");
    }
    if (manifest.validation.requiredTagsPerCheck !== 1) {
      errors.push("manifest.validation.requiredTagsPerCheck must be 1.");
    }
    if (manifest.validation.credentialPolicy !== "no-forward-credentials-in-dynatrace") {
      errors.push("manifest.validation.credentialPolicy must be no-forward-credentials-in-dynatrace.");
    }
  }

  if (requireObject(manifest.reconciliation, "manifest.reconciliation", errors)) {
    if (manifest.reconciliation.defaultApplyPolicy !== "create-missing-only") {
      errors.push("manifest.reconciliation.defaultApplyPolicy must be create-missing-only.");
    }
    if (manifest.reconciliation.changedChecks !== "report-only") {
      errors.push("manifest.reconciliation.changedChecks must be report-only.");
    }
    if (manifest.reconciliation.staleChecks !== "report-only") {
      errors.push("manifest.reconciliation.staleChecks must be report-only.");
    }
  }

  if (errors.length > 0) {
    throw invalidManifestError(errors);
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
  const maxPackageAgeMinutes = args["max-package-age-minutes"]
    ? toPositiveInteger(args["max-package-age-minutes"], "--max-package-age-minutes")
    : DEFAULT_MAX_PACKAGE_AGE_MINUTES;

  const locators = resolvePackageLocators(args);
  const plannedChecks = await readJsonFromLocator(locators.checks, "Forward checks package");
  validatePlannedChecks(plannedChecks);
  if (locators.manifest) {
    const manifest = await readJsonFromLocator(locators.manifest, "Forward package manifest");
    validateManifest(manifest, plannedChecks, { maxPackageAgeMinutes });
  }

  if (args["validate-only"]) {
    const report = {
      mode: "validate-only",
      checksSource: locators.checks,
      manifestSource: locators.manifest || null,
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
