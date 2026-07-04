#!/usr/bin/env node

import { createHash, verify as verifySignature } from "node:crypto";
import { readFile, writeFile } from "node:fs/promises";
import { setTimeout as sleep } from "node:timers/promises";
import { pathToFileURL } from "node:url";

import {
  DEFAULT_NQE_CHECKS_PATH,
  DEFAULT_NQE_DIFF_REQUESTS_PATH,
  parseQueryIdAllowlist,
  validateNqeChecks,
  validateNqeDiffRequests,
} from "./forward-nqe-artifacts.mjs";

const DEFAULT_CHECKS_PATH = "forward-intent-checks.json";
const DEFAULT_MANIFEST_FILE_NAME = "forward-dynatrace-manifest.json";
const DEFAULT_SIGNATURE_FILE_NAME = "forward-dynatrace-package.sig";
const DEFAULT_BATCH_SIZE = 500;
const DEFAULT_MAX_RETRIES = 3;
const DEFAULT_MAX_PACKAGE_AGE_MINUTES = 24 * 60;
const PACKAGE_SCHEMA_VERSION = "forward-dynatrace/v1";
const PACKAGE_TYPE = "forward-intent-import";
const APPROVAL_SCHEMA_VERSION = "forward-dynatrace-approval/v1";
const TRANSIENT_STATUS_CODES = new Set([408, 409, 425, 429, 500, 502, 503, 504]);
const ALLOWED_CHECK_TYPES = new Set(["Existential"]);
const LOCAL_HTTP_HOSTS = new Set(["127.0.0.1", "::1", "localhost"]);

const usage = `
Forward Integration for Dynatrace package importer

Required environment:
  FORWARD_BASE_URL       Example: https://forward.example.com
  FORWARD_USER           Forward username
  FORWARD_PASSWORD       Forward password or token accepted by the tenant
  FORWARD_NETWORK_ID     Target Forward network ID

Usage:
  node scripts/forward-import-package.mjs --config config/forward-connector.config.json
  node scripts/forward-import-package.mjs --checks forward-intent-checks.json --manifest forward-dynatrace-manifest.json
  node scripts/forward-import-package.mjs --checks forward-intent-checks.json --manifest forward-dynatrace-manifest.json --apply
  node scripts/forward-import-package.mjs --package-url https://package.example.com/dynatrace-forward/latest/ --report forward-import-report.json

Options:
  --apply              Create missing checks.
  --apply-updates      Replace approved changed generated checks. Requires --apply,
                       --require-signature, and --require-approval-file.
  --batch-size 500     Batch size for /checks?bulk.
  --change-window-id id
                       Require approval file to match this change window ID.
  --checks-url url      Pull forward-intent-checks.json from a read-only HTTPS URL.
  --config path         Load non-secret connector/importer settings from JSON.
  --deactivate-stale   Deactivate approved stale generated checks. Requires --apply,
                       --require-signature, and --require-approval-file.
  --fail-on-drift      Exit non-zero when changed or stale Dynatrace-managed checks are found.
  --manifest path      Validate the package manifest before importing.
  --manifest-url url    Pull forward-dynatrace-manifest.json from a read-only HTTPS URL.
  --max-deactivations 0
                       Maximum approved stale checks to deactivate.
  --max-package-age-minutes 1440
                       Reject manifests older than this age.
  --max-retries 3      Retry count for transient Forward API responses.
  --max-updates 0      Maximum approved changed checks to replace.
  --metrics path       Write Prometheus-style import metrics to a text file.
  --nqe-checks path     Optional forward-nqe-checks.json artifact.
  --nqe-checks-url url  Pull optional forward-nqe-checks.json from HTTPS URL.
  --nqe-diff-requests path
                       Optional forward-nqe-diff-requests.json artifact to validate/report.
  --nqe-diff-requests-url url
                       Pull optional NQE diff requests artifact from HTTPS URL.
  --nqe-query-id-allowlist FQ_...,FQ_...
                       Approved Forward-owned query IDs for optional NQE artifacts.
  --package-url url     Pull manifest and checks from a base URL.
  --public-key path     Verify detached Ed25519 package signature with PEM public key.
  --public-key-url url   Pull detached-signature public key from HTTPS URL.
  --require-approval-file path
                       Approval artifact for exact changed/stale dynatrace keys.
  --require-signature   Reject package unless signature and public key are supplied.
  --report path        Write the reconciliation report to a JSON file.
  --signature path      Verify detached package signature.
  --signature-url url    Pull detached package signature from HTTPS URL.
  --status-artifact path
                       Write sanitized read-only ingest status JSON for Dynatrace display.
  --validate-only      Validate package shape without contacting Forward.

The default mode is dry-run. The default apply policy is create-missing-only.
Approved update/stale actions are an optional Forward-side path. Non-local
package URLs must use HTTPS.
`;

const SUPPORTED_ARGS = new Set([
  "_",
  "apply",
  "apply-updates",
  "batch-size",
  "change-window-id",
  "checks",
  "checks-url",
  "config",
  "deactivate-stale",
  "fail-on-drift",
  "help",
  "manifest",
  "manifest-url",
  "max-deactivations",
  "max-package-age-minutes",
  "max-retries",
  "max-updates",
  "metrics",
  "nqe-checks",
  "nqe-checks-url",
  "nqe-diff-requests",
  "nqe-diff-requests-url",
  "nqe-query-id-allowlist",
  "package-url",
  "public-key",
  "public-key-url",
  "require-approval-file",
  "require-signature",
  "report",
  "signature",
  "signature-url",
  "status-artifact",
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
      key === "apply-updates" ||
      key === "deactivate-stale" ||
      key === "fail-on-drift" ||
      key === "help" ||
      key === "require-signature" ||
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
  if (args.signature && args["signature-url"]) {
    throw new Error("Use either --signature or --signature-url, not both.");
  }
  if (args["public-key"] && args["public-key-url"]) {
    throw new Error("Use either --public-key or --public-key-url, not both.");
  }
  if (args["nqe-checks"] && args["nqe-checks-url"]) {
    throw new Error("Use either --nqe-checks or --nqe-checks-url, not both.");
  }
  if (args["nqe-diff-requests"] && args["nqe-diff-requests-url"]) {
    throw new Error(
      "Use either --nqe-diff-requests or --nqe-diff-requests-url, not both.",
    );
  }
};

const validatePolicyArgs = (args) => {
  const hasMutationFlag = Boolean(args["apply-updates"] || args["deactivate-stale"]);
  if (hasMutationFlag && !args.apply) {
    throw new Error("--apply-updates and --deactivate-stale require --apply.");
  }
  if (hasMutationFlag && !args["require-signature"]) {
    throw new Error("--apply-updates and --deactivate-stale require --require-signature.");
  }
  if (hasMutationFlag && !args["require-approval-file"]) {
    throw new Error(
      "--apply-updates and --deactivate-stale require --require-approval-file.",
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

const requiredRuntimeValue = (envName, configValue) => {
  const value = process.env[envName] || configValue;
  if (!value) {
    throw new Error(
      `Missing required environment variable or connector config value: ${envName}`,
    );
  }
  return value;
};

const readJson = async (path) => JSON.parse(await readFile(path, "utf8"));

const readJsonWithText = async (path) => {
  const text = await readFile(path, "utf8");
  return { value: JSON.parse(text), text };
};

const readTextFromLocator = async (locator, label) => {
  if (!isUrlLocator(locator)) {
    return readFile(locator, "utf8");
  }

  validatePackageUrl(locator);
  const response = await fetch(locator, {
    headers: { Accept: "text/plain,application/octet-stream" },
  });
  const text = await response.text();
  if (!response.ok) {
    throw new Error(`${label} fetch failed with ${response.status}: ${text.slice(0, 500)}`);
  }
  return text;
};

const sha256Hex = (text) => createHash("sha256").update(text, "utf8").digest("hex");

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
    return readJsonWithText(locator);
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
    return { value: JSON.parse(text), text };
  } catch (error) {
    throw new Error(`${label} did not contain valid JSON: ${error.message}`);
  }
};

const CONNECTOR_CONFIG_SCHEMA_VERSION = "forward-dynatrace-connector/v1";
const CONNECTOR_CONFIG_KEYS = new Set([
  "apply",
  "applyUpdates",
  "approvalFile",
  "batchSize",
  "changeWindowId",
  "checks",
  "checksUrl",
  "deactivateStale",
  "failOnDrift",
  "forwardBaseUrl",
  "forwardNetworkId",
  "manifest",
  "manifestUrl",
  "maxDeactivations",
  "maxPackageAgeMinutes",
  "maxRetries",
  "maxUpdates",
  "metricsPath",
  "nqeChecks",
  "nqeChecksUrl",
  "nqeDiffRequests",
  "nqeDiffRequestsUrl",
  "nqeQueryIdAllowlist",
  "packageUrl",
  "publicKey",
  "publicKeyUrl",
  "requireSignature",
  "reportPath",
  "schemaVersion",
  "signature",
  "signatureUrl",
  "statusArtifactPath",
  "validateOnly",
]);
const FORBIDDEN_CONNECTOR_CONFIG_KEYS = new Set([
  "forwardPassword",
  "forwardToken",
  "forwardUser",
  "password",
  "token",
  "user",
]);

export const validateConnectorConfig = (config) => {
  const errors = [];
  if (!config || typeof config !== "object" || Array.isArray(config)) {
    throw new Error("Connector config must be a JSON object.");
  }
  if (config.schemaVersion !== CONNECTOR_CONFIG_SCHEMA_VERSION) {
    errors.push(`schemaVersion must be ${CONNECTOR_CONFIG_SCHEMA_VERSION}.`);
  }

  for (const key of Object.keys(config)) {
    if (FORBIDDEN_CONNECTOR_CONFIG_KEYS.has(key)) {
      errors.push(`${key} must not be stored in connector config.`);
    } else if (!CONNECTOR_CONFIG_KEYS.has(key)) {
      errors.push(`Unsupported connector config field: ${key}.`);
    }
  }

  for (const [key, value] of Object.entries({
    packageUrl: config.packageUrl,
    checksUrl: config.checksUrl,
    manifestUrl: config.manifestUrl,
    forwardBaseUrl: config.forwardBaseUrl,
    publicKeyUrl: config.publicKeyUrl,
    signatureUrl: config.signatureUrl,
  })) {
    if (value !== undefined && !requireString(value)) {
      errors.push(`${key} must be a non-empty string when supplied.`);
    }
  }

  for (const [key, value] of Object.entries({
    checks: config.checks,
    approvalFile: config.approvalFile,
    changeWindowId: config.changeWindowId,
    manifest: config.manifest,
    metricsPath: config.metricsPath,
    nqeChecks: config.nqeChecks,
    nqeChecksUrl: config.nqeChecksUrl,
    nqeDiffRequests: config.nqeDiffRequests,
    nqeDiffRequestsUrl: config.nqeDiffRequestsUrl,
    nqeQueryIdAllowlist: config.nqeQueryIdAllowlist,
    forwardNetworkId: config.forwardNetworkId,
    publicKey: config.publicKey,
    reportPath: config.reportPath,
    signature: config.signature,
    statusArtifactPath: config.statusArtifactPath,
  })) {
    if (value !== undefined && !requireString(value)) {
      errors.push(`${key} must be a non-empty string when supplied.`);
    }
  }

  for (const [key, value] of Object.entries({
    apply: config.apply,
    applyUpdates: config.applyUpdates,
    deactivateStale: config.deactivateStale,
    failOnDrift: config.failOnDrift,
    requireSignature: config.requireSignature,
    validateOnly: config.validateOnly,
  })) {
    if (value !== undefined && typeof value !== "boolean") {
      errors.push(`${key} must be a boolean when supplied.`);
    }
  }

  for (const [key, value] of Object.entries({
    batchSize: config.batchSize,
    maxDeactivations: config.maxDeactivations,
    maxPackageAgeMinutes: config.maxPackageAgeMinutes,
    maxRetries: config.maxRetries,
    maxUpdates: config.maxUpdates,
  })) {
    if (value !== undefined && (!Number.isInteger(value) || value < 0)) {
      errors.push(`${key} must be a non-negative integer when supplied.`);
    }
  }

  if (config.batchSize === 0 || config.maxPackageAgeMinutes === 0) {
    errors.push("batchSize and maxPackageAgeMinutes must be greater than zero.");
  }

  if (errors.length > 0) {
    throw new Error(
      `Invalid connector config:\n${errors.map((error) => `- ${error}`).join("\n")}`,
    );
  }
};

const toArgsFromConnectorConfig = (config) => ({
  ...(config.apply ? { apply: true } : {}),
  ...(config.applyUpdates ? { "apply-updates": true } : {}),
  ...(config.approvalFile ? { "require-approval-file": config.approvalFile } : {}),
  ...(config.batchSize !== undefined ? { "batch-size": String(config.batchSize) } : {}),
  ...(config.changeWindowId ? { "change-window-id": config.changeWindowId } : {}),
  ...(config.checks ? { checks: config.checks } : {}),
  ...(config.checksUrl ? { "checks-url": config.checksUrl } : {}),
  ...(config.deactivateStale ? { "deactivate-stale": true } : {}),
  ...(config.failOnDrift ? { "fail-on-drift": true } : {}),
  ...(config.manifest ? { manifest: config.manifest } : {}),
  ...(config.manifestUrl ? { "manifest-url": config.manifestUrl } : {}),
  ...(config.maxDeactivations !== undefined
    ? { "max-deactivations": String(config.maxDeactivations) }
    : {}),
  ...(config.maxPackageAgeMinutes !== undefined
    ? { "max-package-age-minutes": String(config.maxPackageAgeMinutes) }
    : {}),
  ...(config.maxRetries !== undefined ? { "max-retries": String(config.maxRetries) } : {}),
  ...(config.maxUpdates !== undefined ? { "max-updates": String(config.maxUpdates) } : {}),
  ...(config.metricsPath ? { metrics: config.metricsPath } : {}),
  ...(config.nqeChecks ? { "nqe-checks": config.nqeChecks } : {}),
  ...(config.nqeChecksUrl ? { "nqe-checks-url": config.nqeChecksUrl } : {}),
  ...(config.nqeDiffRequests ? { "nqe-diff-requests": config.nqeDiffRequests } : {}),
  ...(config.nqeDiffRequestsUrl
    ? { "nqe-diff-requests-url": config.nqeDiffRequestsUrl }
    : {}),
  ...(config.nqeQueryIdAllowlist
    ? { "nqe-query-id-allowlist": config.nqeQueryIdAllowlist }
    : {}),
  ...(config.packageUrl ? { "package-url": config.packageUrl } : {}),
  ...(config.publicKey ? { "public-key": config.publicKey } : {}),
  ...(config.publicKeyUrl ? { "public-key-url": config.publicKeyUrl } : {}),
  ...(config.requireSignature ? { "require-signature": true } : {}),
  ...(config.reportPath ? { report: config.reportPath } : {}),
  ...(config.signature ? { signature: config.signature } : {}),
  ...(config.signatureUrl ? { "signature-url": config.signatureUrl } : {}),
  ...(config.statusArtifactPath ? { "status-artifact": config.statusArtifactPath } : {}),
  ...(config.validateOnly ? { "validate-only": true } : {}),
});

export const loadConnectorConfig = async (configPath) => {
  const config = await readJson(configPath);
  validateConnectorConfig(config);
  return config;
};

const mergeConfigArgs = (args, config) => ({
  ...toArgsFromConnectorConfig(config),
  ...args,
});

const toRunId = (startedAt) =>
  `forward-dynatrace-${startedAt.replace(/[^0-9]/g, "").slice(0, 14)}`;

const toMetricLine = (name, value, labels = {}) => {
  const labelText = Object.entries(labels)
    .map(([key, labelValue]) => `${key}="${String(labelValue).replace(/\\/g, "\\\\").replace(/"/g, '\\"')}"`)
    .join(",");
  return `${name}${labelText ? `{${labelText}}` : ""} ${value}`;
};

const toMetricsText = (report) => {
  const lines = [
    "# HELP forward_dynatrace_import_planned_checks Planned Forward checks in package.",
    "# TYPE forward_dynatrace_import_planned_checks gauge",
    toMetricLine("forward_dynatrace_import_planned_checks", report.plannedChecks),
    "# HELP forward_dynatrace_import_result_count Reconciliation result counts.",
    "# TYPE forward_dynatrace_import_result_count gauge",
  ];

  for (const [result, value] of Object.entries(report.counts || {})) {
    lines.push(toMetricLine("forward_dynatrace_import_result_count", value, { result }));
  }
  lines.push(
    "# HELP forward_dynatrace_import_mutation_count Forward mutation counts performed by the importer.",
    "# TYPE forward_dynatrace_import_mutation_count gauge",
  );
  for (const [mutation, value] of Object.entries(report.mutationCounts || {})) {
    lines.push(toMetricLine("forward_dynatrace_import_mutation_count", value, { mutation }));
  }

  lines.push(
    "# HELP forward_dynatrace_import_duration_ms Import runtime duration in milliseconds.",
    "# TYPE forward_dynatrace_import_duration_ms gauge",
    toMetricLine("forward_dynatrace_import_duration_ms", report.durationMs),
    "# HELP forward_dynatrace_import_signature_verified Package signature verification state.",
    "# TYPE forward_dynatrace_import_signature_verified gauge",
    toMetricLine(
      "forward_dynatrace_import_signature_verified",
      report.packageSignature?.status === "verified" ? 1 : 0,
      { status: report.packageSignature?.status || "not-provided" },
    ),
  );

  return `${lines.join("\n")}\n`;
};

const toImportState = (report) => {
  if (report.status === "valid") {
    return "valid";
  }
  const unresolvedChanged = report.unresolvedCounts?.changed ?? report.counts?.changed ?? 0;
  const unresolvedStale = report.unresolvedCounts?.stale ?? report.counts?.stale ?? 0;
  if (unresolvedChanged > 0 || unresolvedStale > 0) {
    return "needs-review";
  }
  if (
    report.mode === "apply" &&
    ((report.counts?.create || 0) > 0 ||
      (report.mutationCounts?.updated || 0) > 0 ||
      (report.mutationCounts?.deactivated || 0) > 0)
  ) {
    return "applied";
  }
  return "reconciled";
};

const toApprovalSummary = (approval) =>
  approval
    ? {
        schemaVersion: approval.schemaVersion,
        packageId: approval.packageId,
        changeWindowId: approval.changeWindowId,
        expiresAt: approval.expiresAt,
        approvedBy: approval.approvedBy,
        reason: approval.reason,
        approvedChangedCount: approval.approvedChangedKeys.length,
        approvedStaleCount: approval.approvedStaleKeys.length,
      }
    : null;

export const toStatusArtifact = (report) => ({
  schemaVersion: "forward-dynatrace-status/v1",
  generatedAt: report.finishedAt,
  runId: report.runId,
  packageId: report.packageId || null,
  mode: report.mode,
  importState: toImportState(report),
  applyPolicy: report.applyPolicy || "validate-only",
  packageIntegrity: report.packageIntegrity || null,
  packageSignature: {
    status: report.packageSignature?.status || "not-provided",
  },
  target: {
    networkId: report.networkId || null,
    snapshotId: report.snapshotId || null,
  },
  counts: report.counts || {
    create: 0,
    unchanged: 0,
    changed: 0,
    stale: 0,
  },
  unresolvedCounts: report.unresolvedCounts || {
    changed: report.counts?.changed || 0,
    stale: report.counts?.stale || 0,
  },
  mutationCounts: report.mutationCounts || {
    created: 0,
    updated: 0,
    deactivated: 0,
  },
  approval: report.approval
    ? {
        schemaVersion: report.approval.schemaVersion,
        packageId: report.approval.packageId,
        changeWindowId: report.approval.changeWindowId,
        expiresAt: report.approval.expiresAt,
        approvedChangedCount: report.approval.approvedChangedCount,
        approvedStaleCount: report.approval.approvedStaleCount,
      }
    : null,
  plannedChecks: report.plannedChecks,
  plannedNqeChecks: report.plannedNqeChecks || 0,
  plannedNqeDiffRequests: report.plannedNqeDiffRequests || 0,
  durationMs: report.durationMs,
});

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

const resolveOptionalPackageLocators = (args, manifest) => ({
  nqeChecks:
    args["nqe-checks-url"] ||
    args["nqe-checks"] ||
    (args["package-url"] && manifest?.artifacts?.nqeChecks
      ? joinUrl(args["package-url"], manifest.artifacts.nqeChecks)
      : undefined),
  nqeDiffRequests:
    args["nqe-diff-requests-url"] ||
    args["nqe-diff-requests"] ||
    (args["package-url"] && manifest?.artifacts?.nqeDiffRequests
      ? joinUrl(args["package-url"], manifest.artifacts.nqeDiffRequests)
      : undefined),
});

const resolveSignatureLocators = (args) => {
  const signature =
    args["signature-url"] ||
    args.signature ||
    (args["package-url"] && args["require-signature"]
      ? joinUrl(args["package-url"], DEFAULT_SIGNATURE_FILE_NAME)
      : undefined);

  return {
    publicKey: args["public-key-url"] || args["public-key"],
    signature,
  };
};

export const packageSigningPayload = ({
  checksText,
  manifestText,
  extraArtifacts = {},
}) =>
  [
    "forward-dynatrace-package-signature/v1",
    `manifest-sha256:${sha256Hex(manifestText)}`,
    `checks-sha256:${sha256Hex(checksText)}`,
    ...Object.entries(extraArtifacts)
      .filter(([, text]) => text !== undefined)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([label, text]) => `${label}-sha256:${sha256Hex(text)}`),
    "",
  ].join("\n");

export const verifyPackageSignature = ({
  checksText,
  manifestText,
  publicKeyText,
  signatureText,
  extraArtifacts,
}) => {
  const signatureBytes = Buffer.from(signatureText.trim(), "base64");
  if (signatureBytes.length === 0) {
    throw new Error("Package signature must be base64-encoded Ed25519 signature bytes.");
  }
  const ok = verifySignature(
    null,
    Buffer.from(
      packageSigningPayload({ checksText, manifestText, extraArtifacts }),
      "utf8",
    ),
    publicKeyText,
    signatureBytes,
  );
  if (!ok) {
    throw new Error("Package signature verification failed.");
  }
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
  (Array.isArray(check.tags) ? check.tags : []).filter((tag) =>
    tag.startsWith("dynatrace-key:"),
  );

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

const annotateReconciliation = (reconciliation, artifactType) => ({
  create: reconciliation.create.map((item) => ({ ...item, artifactType })),
  unchanged: reconciliation.unchanged.map((item) => ({ ...item, artifactType })),
  changed: reconciliation.changed.map((item) => ({ ...item, artifactType })),
  stale: reconciliation.stale.map((item) => ({ ...item, artifactType })),
});

const mergeReconciliations = (...reconciliations) => ({
  create: reconciliations.flatMap((reconciliation) => reconciliation.create),
  unchanged: reconciliations.flatMap((reconciliation) => reconciliation.unchanged),
  changed: reconciliations.flatMap((reconciliation) => reconciliation.changed),
  stale: reconciliations.flatMap((reconciliation) => reconciliation.stale),
});

const validateNoCrossArtifactDuplicates = (intentChecks, nqeChecks) => {
  const intentNames = new Set(intentChecks.map((check) => check.name).filter(Boolean));
  const intentKeys = new Set(intentChecks.map(reconciliationKey).filter(Boolean));
  const duplicateNames = nqeChecks
    .map((check) => check.name)
    .filter((name) => name && intentNames.has(name));
  const duplicateKeys = nqeChecks
    .map(reconciliationKey)
    .filter((key) => key && intentKeys.has(key));

  if (duplicateNames.length > 0 || duplicateKeys.length > 0) {
    throw new Error(
      [
        "Optional NQE checks must not duplicate intent-check names or dynatrace keys.",
        duplicateNames.length > 0 ? `Duplicate names: ${duplicateNames.join(", ")}` : "",
        duplicateKeys.length > 0 ? `Duplicate keys: ${duplicateKeys.join(", ")}` : "",
      ]
        .filter(Boolean)
        .join(" "),
    );
  }
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

      const responsePreview = text.slice(0, 500);
      const unresolvedLocationHint =
        method === "POST" &&
        path.includes("/checks?bulk") &&
        response.status === 400 &&
        /No .*matching|No hosts matching|alias|location|HostFilter|DeviceFilter|SubnetLocationFilter/i.test(text)
          ? " Forward rejected one or more check locations. This usually means a Dynatrace source or destination does not resolve in the target Forward snapshot; run the Dynatrace read-only endpoint-resolution preflight and mark unresolved rows needs-map before apply."
          : "";
      throw new Error(
        `${method} ${path} failed with ${response.status}: ${responsePreview}${unresolvedLocationHint}`,
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

const hasWhitespace = (value) => /\s/.test(value);

const requireObject = (value, label, errors) => {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    errors.push(`${label} must be an object.`);
    return false;
  }
  return true;
};

const exactDynatraceKeyArray = (approval, key, errors) => {
  const value = approval[key] === undefined ? [] : approval[key];
  if (!Array.isArray(value)) {
    errors.push(`${key} must be an array when supplied.`);
    return [];
  }

  const seen = new Set();
  value.forEach((item, index) => {
    if (!requireString(item)) {
      errors.push(`${key}[${index}] must be a non-empty string.`);
    } else if (!item.startsWith("dynatrace-key:")) {
      errors.push(`${key}[${index}] must start with dynatrace-key:.`);
    } else if (hasWhitespace(item)) {
      errors.push(`${key}[${index}] must not contain whitespace.`);
    } else if (seen.has(item)) {
      errors.push(`${key}[${index}] duplicates an earlier key.`);
    } else {
      seen.add(item);
    }
  });
  return [...seen];
};

export const validateApprovalFile = (
  approval,
  {
    packageId,
    changeWindowId,
    now = new Date(),
  } = {},
) => {
  const errors = [];
  if (!requireObject(approval, "approval", errors)) {
    throw new Error(
      `Invalid Forward approval file:\n${errors.map((error) => `- ${error}`).join("\n")}`,
    );
  }

  const allowedKeys = new Set([
    "approvedBy",
    "approvedChangedKeys",
    "approvedStaleKeys",
    "changeWindowId",
    "expiresAt",
    "packageId",
    "reason",
    "schemaVersion",
  ]);
  for (const key of Object.keys(approval)) {
    if (!allowedKeys.has(key)) {
      errors.push(`Unsupported approval field: ${key}.`);
    }
  }

  if (approval.schemaVersion !== APPROVAL_SCHEMA_VERSION) {
    errors.push(`schemaVersion must be ${APPROVAL_SCHEMA_VERSION}.`);
  }
  if (!requireString(approval.packageId)) {
    errors.push("packageId is required.");
  } else if (packageId && approval.packageId !== packageId) {
    errors.push(`packageId must match manifest packageId ${packageId}.`);
  }
  if (changeWindowId && approval.changeWindowId !== changeWindowId) {
    errors.push(`changeWindowId must match ${changeWindowId}.`);
  }
  if (approval.changeWindowId !== undefined && !requireString(approval.changeWindowId)) {
    errors.push("changeWindowId must be a non-empty string when supplied.");
  }
  if (approval.approvedBy !== undefined && !requireString(approval.approvedBy)) {
    errors.push("approvedBy must be a non-empty string when supplied.");
  }
  if (approval.reason !== undefined && !requireString(approval.reason)) {
    errors.push("reason must be a non-empty string when supplied.");
  }

  if (!requireString(approval.expiresAt)) {
    errors.push("expiresAt is required.");
  } else {
    const expiresAtMs = Date.parse(approval.expiresAt);
    if (!Number.isFinite(expiresAtMs)) {
      errors.push("expiresAt must be an ISO timestamp.");
    } else if (expiresAtMs <= now.getTime()) {
      errors.push("expiresAt must be in the future.");
    }
  }

  const approvedChangedKeys = exactDynatraceKeyArray(
    approval,
    "approvedChangedKeys",
    errors,
  );
  const approvedStaleKeys = exactDynatraceKeyArray(
    approval,
    "approvedStaleKeys",
    errors,
  );

  if (errors.length > 0) {
    throw new Error(
      `Invalid Forward approval file:\n${errors
        .map((error) => `- ${error}`)
        .join("\n")}`,
    );
  }

  return {
    schemaVersion: APPROVAL_SCHEMA_VERSION,
    packageId: approval.packageId,
    changeWindowId: approval.changeWindowId || null,
    expiresAt: approval.expiresAt,
    approvedBy: approval.approvedBy || null,
    reason: approval.reason || null,
    approvedChangedKeys,
    approvedStaleKeys,
  };
};

const assertApprovalKeysMatchCurrentDrift = (approvedKeys, currentKeys, label) => {
  const unknownKeys = approvedKeys.filter((key) => !currentKeys.has(key));
  if (unknownKeys.length > 0) {
    throw new Error(
      `${label} approval references key(s) not present in current reconciliation: ${unknownKeys.join(", ")}`,
    );
  }
};

export const planApprovedMutations = (
  reconciliation,
  approval,
  {
    applyUpdates = false,
    deactivateStale = false,
    maxUpdates = 0,
    maxDeactivations = 0,
  } = {},
) => {
  const approvedChangedKeys = new Set(approval?.approvedChangedKeys || []);
  const approvedStaleKeys = new Set(approval?.approvedStaleKeys || []);
  const currentChangedKeys = new Set(reconciliation.changed.map((item) => item.key));
  const currentStaleKeys = new Set(reconciliation.stale.map((item) => item.key));

  if (applyUpdates) {
    assertApprovalKeysMatchCurrentDrift(
      [...approvedChangedKeys],
      currentChangedKeys,
      "Changed-check",
    );
  }
  if (deactivateStale) {
    assertApprovalKeysMatchCurrentDrift(
      [...approvedStaleKeys],
      currentStaleKeys,
      "Stale-check",
    );
  }

  const update = applyUpdates
    ? reconciliation.changed.filter((item) => approvedChangedKeys.has(item.key))
    : [];
  const deactivate = deactivateStale
    ? reconciliation.stale.filter((item) => approvedStaleKeys.has(item.key))
    : [];

  if (update.length > maxUpdates) {
    throw new Error(
      `Approved update count ${update.length} exceeds --max-updates ${maxUpdates}.`,
    );
  }
  if (deactivate.length > maxDeactivations) {
    throw new Error(
      `Approved deactivation count ${deactivate.length} exceeds --max-deactivations ${maxDeactivations}.`,
    );
  }

  return { update, deactivate };
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
    if (!Array.isArray(check.tags)) {
      errors.push(`${prefix}.tags must be an array.`);
    } else {
      check.tags.forEach((tag, tagIndex) => {
        if (!requireString(tag)) {
          errors.push(`${prefix}.tags[${tagIndex}] must be a non-empty string.`);
        } else if (hasWhitespace(tag)) {
          errors.push(`${prefix}.tags[${tagIndex}] must not contain whitespace.`);
        }
      });
    }

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
  {
    checksText,
    nqeChecks = [],
    nqeChecksText,
    nqeDiffRequests = [],
    nqeDiffRequestsText,
    maxPackageAgeMinutes = DEFAULT_MAX_PACKAGE_AGE_MINUTES,
  } = {},
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
    if (
      nqeChecks.length > 0 &&
      manifest.artifacts.nqeChecks !== DEFAULT_NQE_CHECKS_PATH
    ) {
      errors.push(`manifest.artifacts.nqeChecks must be ${DEFAULT_NQE_CHECKS_PATH}.`);
    }
    if (
      nqeDiffRequests.length > 0 &&
      manifest.artifacts.nqeDiffRequests !== DEFAULT_NQE_DIFF_REQUESTS_PATH
    ) {
      errors.push(
        `manifest.artifacts.nqeDiffRequests must be ${DEFAULT_NQE_DIFF_REQUESTS_PATH}.`,
      );
    }
  }

  if (requireObject(manifest.integrity, "manifest.integrity", errors)) {
    if (manifest.integrity.algorithm !== "sha256") {
      errors.push("manifest.integrity.algorithm must be sha256.");
    }
    if (!/^[a-f0-9]{64}$/.test(manifest.integrity.intentChecksSha256 || "")) {
      errors.push("manifest.integrity.intentChecksSha256 must be a SHA-256 hex digest.");
    } else if (
      checksText !== undefined &&
      manifest.integrity.intentChecksSha256 !== sha256Hex(checksText)
    ) {
      errors.push("manifest.integrity.intentChecksSha256 does not match forward-intent-checks.json.");
    }
    if (nqeChecks.length > 0) {
      if (!/^[a-f0-9]{64}$/.test(manifest.integrity.nqeChecksSha256 || "")) {
        errors.push("manifest.integrity.nqeChecksSha256 must be a SHA-256 hex digest.");
      } else if (
        nqeChecksText !== undefined &&
        manifest.integrity.nqeChecksSha256 !== sha256Hex(nqeChecksText)
      ) {
        errors.push("manifest.integrity.nqeChecksSha256 does not match forward-nqe-checks.json.");
      }
    }
    if (nqeDiffRequests.length > 0) {
      if (!/^[a-f0-9]{64}$/.test(manifest.integrity.nqeDiffRequestsSha256 || "")) {
        errors.push("manifest.integrity.nqeDiffRequestsSha256 must be a SHA-256 hex digest.");
      } else if (
        nqeDiffRequestsText !== undefined &&
        manifest.integrity.nqeDiffRequestsSha256 !== sha256Hex(nqeDiffRequestsText)
      ) {
        errors.push(
          "manifest.integrity.nqeDiffRequestsSha256 does not match forward-nqe-diff-requests.json.",
        );
      }
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

  if (manifest.nqeChecks || nqeChecks.length > 0) {
    if (requireObject(manifest.nqeChecks, "manifest.nqeChecks", errors)) {
      if (manifest.nqeChecks.count !== nqeChecks.length) {
        errors.push(
          `manifest.nqeChecks.count ${manifest.nqeChecks.count} does not match package count ${nqeChecks.length}.`,
        );
      }
      if (manifest.nqeChecks.payloadShape !== "NewNetworkCheck[]") {
        errors.push("manifest.nqeChecks.payloadShape must be NewNetworkCheck[].");
      }
      if (manifest.nqeChecks.checkType !== "NQE") {
        errors.push("manifest.nqeChecks.checkType must be NQE.");
      }
      if (manifest.nqeChecks.bulkEndpoint !== "/api/snapshots/{snapshotId}/checks?bulk") {
        errors.push("manifest.nqeChecks.bulkEndpoint must target /checks?bulk.");
      }
      if (manifest.nqeChecks.dedupeRequiredBeforePost !== true) {
        errors.push("manifest.nqeChecks.dedupeRequiredBeforePost must be true.");
      }
      if (manifest.nqeChecks.queryIdPolicy !== "forward-owned-allowlist") {
        errors.push("manifest.nqeChecks.queryIdPolicy must be forward-owned-allowlist.");
      }
    }
  }

  if (manifest.nqeDiffRequests || nqeDiffRequests.length > 0) {
    if (requireObject(manifest.nqeDiffRequests, "manifest.nqeDiffRequests", errors)) {
      if (manifest.nqeDiffRequests.count !== nqeDiffRequests.length) {
        errors.push(
          `manifest.nqeDiffRequests.count ${manifest.nqeDiffRequests.count} does not match package count ${nqeDiffRequests.length}.`,
        );
      }
      if (
        manifest.nqeDiffRequests.payloadShape !==
        "ForwardDynatraceNqeDiffRequest[]"
      ) {
        errors.push(
          "manifest.nqeDiffRequests.payloadShape must be ForwardDynatraceNqeDiffRequest[].",
        );
      }
      if (manifest.nqeDiffRequests.endpoint !== "/api/nqe-diffs/{before}/{after}") {
        errors.push("manifest.nqeDiffRequests.endpoint must target /nqe-diffs/{before}/{after}.");
      }
      if (manifest.nqeDiffRequests.queryIdPolicy !== "forward-owned-allowlist") {
        errors.push(
          "manifest.nqeDiffRequests.queryIdPolicy must be forward-owned-allowlist.",
        );
      }
      if (
        manifest.nqeDiffRequests.executionPolicy !==
        "read-only-forward-side-optional"
      ) {
        errors.push(
          "manifest.nqeDiffRequests.executionPolicy must be read-only-forward-side-optional.",
        );
      }
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
  const startedAt = new Date().toISOString();
  const runId = toRunId(startedAt);
  const rawArgs = parseArgs(process.argv.slice(2));
  if (rawArgs.help) {
    process.stdout.write(usage);
    return;
  }
  validateArgs(rawArgs);
  const connectorConfig = rawArgs.config
    ? await loadConnectorConfig(rawArgs.config)
    : {};
  const args = mergeConfigArgs(rawArgs, connectorConfig);
  validateArgs(args);
  validatePolicyArgs(args);

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
  const maxUpdates = args["max-updates"]
    ? toNonNegativeInteger(args["max-updates"], "--max-updates")
    : 0;
  const maxDeactivations = args["max-deactivations"]
    ? toNonNegativeInteger(args["max-deactivations"], "--max-deactivations")
    : 0;

  const locators = resolvePackageLocators(args);
  const plannedPackage = await readJsonFromLocator(locators.checks, "Forward checks package");
  const plannedChecks = plannedPackage.value;
  validatePlannedChecks(plannedChecks);
  let manifest = null;
  let manifestText = "";
  if (locators.manifest) {
    const manifestPackage = await readJsonFromLocator(
      locators.manifest,
      "Forward package manifest",
    );
    manifest = manifestPackage.value;
    manifestText = manifestPackage.text;
  }

  const optionalLocators = resolveOptionalPackageLocators(args, manifest);
  const nqeQueryIdAllowlist = parseQueryIdAllowlist(args["nqe-query-id-allowlist"]);
  let plannedNqeChecks = [];
  let nqeChecksText;
  if (optionalLocators.nqeChecks) {
    const nqeChecksPackage = await readJsonFromLocator(
      optionalLocators.nqeChecks,
      "Forward NQE checks package",
    );
    plannedNqeChecks = nqeChecksPackage.value;
    nqeChecksText = nqeChecksPackage.text;
    validateNqeChecks(plannedNqeChecks, {
      allowedQueryIds: nqeQueryIdAllowlist,
    });
  }

  let plannedNqeDiffRequests = [];
  let nqeDiffRequestsText;
  if (optionalLocators.nqeDiffRequests) {
    const nqeDiffRequestsPackage = await readJsonFromLocator(
      optionalLocators.nqeDiffRequests,
      "Forward NQE diff requests package",
    );
    plannedNqeDiffRequests = nqeDiffRequestsPackage.value;
    nqeDiffRequestsText = nqeDiffRequestsPackage.text;
    validateNqeDiffRequests(plannedNqeDiffRequests, {
      allowedQueryIds: nqeQueryIdAllowlist,
    });
  }
  validateNoCrossArtifactDuplicates(plannedChecks, plannedNqeChecks);

  if (manifest) {
    validateManifest(manifest, plannedChecks, {
      checksText: plannedPackage.text,
      nqeChecks: plannedNqeChecks,
      nqeChecksText,
      nqeDiffRequests: plannedNqeDiffRequests,
      nqeDiffRequestsText,
      maxPackageAgeMinutes,
    });
  }
  const approval = args["require-approval-file"]
    ? validateApprovalFile(await readJson(args["require-approval-file"]), {
        packageId: manifest?.packageId,
        changeWindowId: args["change-window-id"],
      })
    : null;
  const signatureLocators = resolveSignatureLocators(args);
  const signatureRequired = Boolean(args["require-signature"]);
  if (
    signatureRequired &&
    (!signatureLocators.signature || !signatureLocators.publicKey)
  ) {
    throw new Error(
      "Package signature is required; supply --signature/--signature-url and --public-key/--public-key-url.",
    );
  }
  if (signatureLocators.signature || signatureLocators.publicKey) {
    if (!locators.manifest || !manifestText) {
      throw new Error("Package signature verification requires a manifest.");
    }
    if (!signatureLocators.signature || !signatureLocators.publicKey) {
      throw new Error(
        "Package signature verification requires both signature and public key.",
      );
    }
    const signatureText = await readTextFromLocator(
      signatureLocators.signature,
      "Forward package signature",
    );
    const publicKeyText = await readTextFromLocator(
      signatureLocators.publicKey,
      "Forward package signature public key",
    );
    verifyPackageSignature({
      checksText: plannedPackage.text,
      manifestText,
      publicKeyText,
      signatureText,
      extraArtifacts: {
        "nqe-checks": nqeChecksText,
        "nqe-diff-requests": nqeDiffRequestsText,
      },
    });
  }
  const signatureStatus =
    signatureLocators.signature && signatureLocators.publicKey ? "verified" : "not-provided";
  if (
    (args["apply-updates"] || args["deactivate-stale"]) &&
    signatureStatus !== "verified"
  ) {
    throw new Error("Approved update/stale actions require a verified package signature.");
  }

  if (args["validate-only"]) {
    const finishedAt = new Date().toISOString();
    const report = {
      mode: "validate-only",
      runId,
      startedAt,
      finishedAt,
      durationMs: Date.parse(finishedAt) - Date.parse(startedAt),
      packageId: manifest?.packageId || null,
      packageIntegrity: manifest?.integrity || null,
      packageSignature: {
        status: signatureStatus,
        publicKeySource: signatureLocators.publicKey || null,
        signatureSource: signatureLocators.signature || null,
      },
      approval: toApprovalSummary(approval),
      checksSource: locators.checks,
      manifestSource: locators.manifest || null,
      nqeChecksSource: optionalLocators.nqeChecks || null,
      nqeDiffRequestsSource: optionalLocators.nqeDiffRequests || null,
      plannedChecks: plannedChecks.length,
      plannedNqeChecks: plannedNqeChecks.length,
      plannedNqeDiffRequests: plannedNqeDiffRequests.length,
      status: "valid",
    };

    if (args.report) {
      await writeFile(args.report, JSON.stringify(report, null, 2) + "\n");
    }
    if (args.metrics) {
      await writeFile(args.metrics, toMetricsText(report));
    }
    if (args["status-artifact"]) {
      await writeFile(args["status-artifact"], JSON.stringify(toStatusArtifact(report), null, 2) + "\n");
    }

    process.stdout.write(JSON.stringify(report, null, 2) + "\n");
    return;
  }

  const networkId = requiredRuntimeValue(
    "FORWARD_NETWORK_ID",
    connectorConfig.forwardNetworkId,
  );
  const api = makeClient({
    baseUrl: requiredRuntimeValue("FORWARD_BASE_URL", connectorConfig.forwardBaseUrl),
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
  const existingNqeChecks =
    plannedNqeChecks.length > 0
      ? await api("GET", `/api/snapshots/${snapshotId}/checks?type=NQE`)
      : [];
  const intentReconciliation = annotateReconciliation(
    reconcileChecks(plannedChecks, existingChecks),
    "intentChecks",
  );
  const nqeReconciliation = annotateReconciliation(
    reconcileChecks(plannedNqeChecks, existingNqeChecks),
    "nqeChecks",
  );
  const reconciliation = mergeReconciliations(intentReconciliation, nqeReconciliation);
  const approvedMutations = planApprovedMutations(reconciliation, approval, {
    applyUpdates: Boolean(args["apply-updates"]),
    deactivateStale: Boolean(args["deactivate-stale"]),
    maxUpdates,
    maxDeactivations,
  });

  let createdCount = 0;
  let updatedCount = 0;
  let deactivatedCount = 0;
  if (apply) {
    for (const batch of chunk(reconciliation.create.map((item) => item.check), batchSize)) {
      await api("POST", `/api/snapshots/${snapshotId}/checks?bulk`, {
        body: batch,
      });
      createdCount += batch.length;
    }

    for (const item of approvedMutations.update) {
      await api("DELETE", `/api/snapshots/${snapshotId}/checks/${item.existingId}`);
    }
    for (const batch of chunk(
      approvedMutations.update.map((item) => item.planned.check),
      batchSize,
    )) {
      await api("POST", `/api/snapshots/${snapshotId}/checks?bulk`, {
        body: batch,
      });
      updatedCount += batch.length;
    }

    for (const item of approvedMutations.deactivate) {
      await api("DELETE", `/api/snapshots/${snapshotId}/checks/${item.id}`);
      deactivatedCount += 1;
    }
  }

  const finishedAt = new Date().toISOString();
  const report = {
    mode: apply ? "apply" : "dry-run",
    runId,
    startedAt,
    finishedAt,
    durationMs: Date.parse(finishedAt) - Date.parse(startedAt),
    packageId: manifest?.packageId || null,
    packageIntegrity: manifest?.integrity || null,
    packageSignature: {
      status: signatureStatus,
      publicKeySource: signatureLocators.publicKey || null,
      signatureSource: signatureLocators.signature || null,
    },
    sources: {
      checks: locators.checks,
      manifest: locators.manifest || null,
      nqeChecks: optionalLocators.nqeChecks || null,
      nqeDiffRequests: optionalLocators.nqeDiffRequests || null,
    },
    applyPolicy:
      args["apply-updates"] || args["deactivate-stale"]
        ? "create-missing-with-approved-updates-and-retirements"
        : "create-missing-only",
    settings: {
      batchSize,
      maxRetries,
      maxUpdates,
      maxDeactivations,
      changeWindowId: args["change-window-id"] || null,
    },
    approval: toApprovalSummary(approval),
    networkId,
    snapshotId,
    plannedChecks: plannedChecks.length,
    plannedNqeChecks: plannedNqeChecks.length,
    plannedNqeDiffRequests: plannedNqeDiffRequests.length,
    existingDynatraceManagedChecks: [
      ...existingChecks,
      ...existingNqeChecks,
    ].filter((check) => dynatraceKeys(check).length > 0).length,
    artifactCounts: {
      intentChecks: {
        planned: plannedChecks.length,
        create: intentReconciliation.create.length,
        unchanged: intentReconciliation.unchanged.length,
        changed: intentReconciliation.changed.length,
        stale: intentReconciliation.stale.length,
      },
      nqeChecks: {
        planned: plannedNqeChecks.length,
        create: nqeReconciliation.create.length,
        unchanged: nqeReconciliation.unchanged.length,
        changed: nqeReconciliation.changed.length,
        stale: nqeReconciliation.stale.length,
      },
      nqeDiffRequests: {
        planned: plannedNqeDiffRequests.length,
      },
    },
    counts: {
      create: reconciliation.create.length,
      unchanged: reconciliation.unchanged.length,
      changed: reconciliation.changed.length,
      stale: reconciliation.stale.length,
    },
    unresolvedCounts: {
      changed: reconciliation.changed.length - approvedMutations.update.length,
      stale: reconciliation.stale.length - approvedMutations.deactivate.length,
    },
    mutationCounts: {
      created: createdCount,
      updated: updatedCount,
      deactivated: deactivatedCount,
    },
    create: reconciliation.create.map(({ check: _check, ...item }) => item),
    unchanged: reconciliation.unchanged,
    changed: reconciliation.changed.map(({ planned, existing, ...item }) => ({
      ...item,
      plannedFingerprint: planned.fingerprint,
      existingFingerprint: existing.fingerprint,
    })),
    stale: reconciliation.stale,
    mutations: {
      updated: approvedMutations.update.map(({ planned, existing, ...item }) => ({
        ...item,
        plannedFingerprint: planned.fingerprint,
        existingFingerprint: existing.fingerprint,
      })),
      deactivated: approvedMutations.deactivate,
    },
  };

  if (args.report) {
    await writeFile(args.report, JSON.stringify(report, null, 2) + "\n");
  }
  if (args.metrics) {
    await writeFile(args.metrics, toMetricsText(report));
  }
  if (args["status-artifact"]) {
    await writeFile(args["status-artifact"], JSON.stringify(toStatusArtifact(report), null, 2) + "\n");
  }

  process.stdout.write(JSON.stringify(report, null, 2) + "\n");

  if (
    args["fail-on-drift"] &&
    (report.unresolvedCounts.changed > 0 || report.unresolvedCounts.stale > 0)
  ) {
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
