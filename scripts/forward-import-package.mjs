#!/usr/bin/env node

import { createHash, verify as verifySignature } from "node:crypto";
import { open, readFile, unlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { setTimeout as sleep } from "node:timers/promises";
import { pathToFileURL } from "node:url";

import {
  CONTRACT_VERSION_TAG,
  MANAGED_BY_TAG,
  SOURCE_INSTANCE_TAG_PREFIX,
  SOURCE_KEY_TAG_PREFIX,
  inspectManagedIdentity,
  managedSourceKey,
  sourceInstanceTag,
} from "../lib/managed-check-identity.mjs";
import { loadForwardAuthorization } from "../lib/forward-authorization.mjs";
import {
  DEFAULT_NQE_CHECKS_PATH,
  DEFAULT_NQE_DIFF_REQUESTS_PATH,
  parseQueryIdAllowlist,
  validateNqeChecks,
  validateNqeDiffRequests,
} from "./forward-nqe-artifacts.mjs";
import {
  assertImportPlanMatches,
  buildImportPlan,
  validateImportPlan,
} from "./forward-import-plan.mjs";

const DEFAULT_CHECKS_PATH = "forward-intent-checks.json";
const DEFAULT_MANIFEST_FILE_NAME = "forward-dynatrace-manifest.json";
const DEFAULT_SIGNATURE_FILE_NAME = "forward-dynatrace-package.sig";
const DEFAULT_BATCH_SIZE = 500;
const DEFAULT_MAX_RETRIES = 3;
const DEFAULT_MAX_PACKAGE_AGE_MINUTES = 24 * 60;
const PACKAGE_SCHEMA_VERSION = "forward-dynatrace/v1";
const PACKAGE_TYPE = "forward-intent-import";
const APPROVAL_SCHEMA_VERSION = "forward-dynatrace-import-approval/v1";
const TRANSIENT_STATUS_CODES = new Set([408, 409, 425, 429, 500, 502, 503, 504]);
const ALLOWED_CHECK_TYPES = new Set(["Existential"]);
const LOCAL_HTTP_HOSTS = new Set(["127.0.0.1", "::1", "localhost"]);

const usage = `
Forward for Dynatrace package importer

Required environment:
  FORWARD_BASE_URL       Example: https://forward.example.com
  FORWARD_AUTHORIZATION_FILE
                         Protected file containing one Basic or Bearer Authorization value
  FORWARD_NETWORK_ID     Target Forward network ID

Usage:
  node scripts/forward-import-package.mjs --config config/forward-connector.config.json
  node scripts/forward-import-package.mjs --checks forward-intent-checks.json --manifest forward-dynatrace-manifest.json
  node scripts/forward-import-package.mjs --checks forward-intent-checks.json --manifest forward-dynatrace-manifest.json --require-signature --signature forward-dynatrace-package.sig --public-key forward-dynatrace-public.pem --stage-plan import-plan.json
  node scripts/forward-import-package.mjs --package-url https://package.example.com/dynatrace-forward/latest/ --report forward-import-report.json

Options:
  --stage-plan path     Write an immutable, snapshot-bound import plan. Requires
                       a verified package signature and performs no Forward writes.
  --apply              Apply an immutable approved plan. Requires --apply-plan,
                       --require-approval-file, and --require-signature.
  --apply-plan path     Previously staged immutable plan to verify before apply.
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
  --lock-path path      Apply lock file. Defaults to a source/network-scoped file in
                       the operating-system runtime directory.
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
  --package-token-file path
                       Read a dedicated handoff Bearer token from a protected file. The token
                       is sent only to HTTPS artifacts below --package-url.
  --public-key path     Verify detached Ed25519 package signature with PEM public key.
  --public-key-url url   Pull detached-signature public key from HTTPS URL.
  --require-approval-file path
                       Approval artifact bound to the exact immutable plan.
  --require-signature   Reject package unless signature and public key are supplied.
  --report path        Write the reconciliation report to a JSON file.
  --signature path      Verify detached package signature.
  --signature-url url    Pull detached package signature from HTTPS URL.
  --snapshot-id id       Dry-run reconciliation against an explicit historical snapshot.
                         Forbidden with --apply; apply always targets latest processed.
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
  "apply-plan",
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
  "lock-path",
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
  "package-token-file",
  "public-key",
  "public-key-url",
  "require-approval-file",
  "require-signature",
  "report",
  "signature",
  "signature-url",
  "snapshot-id",
  "status-artifact",
  "stage-plan",
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

export const validatePolicyArgs = (args) => {
  const hasMutationFlag = Boolean(args["apply-updates"] || args["deactivate-stale"]);
  const staging = Boolean(args["stage-plan"]);
  if (hasMutationFlag && !args.apply && !staging) {
    throw new Error(
      "--apply-updates and --deactivate-stale require --stage-plan or --apply.",
    );
  }
  if ((args.apply || staging) && !args["require-signature"]) {
    throw new Error("Staging and apply require --require-signature.");
  }
  if (args.apply && !args["apply-plan"]) {
    throw new Error("--apply requires --apply-plan.");
  }
  if (args.apply && !args["require-approval-file"]) {
    throw new Error(
      "--apply requires --require-approval-file.",
    );
  }
  if (args["apply-plan"] && !args.apply) {
    throw new Error("--apply-plan requires --apply.");
  }
  if (staging && args.apply) {
    throw new Error("Use --stage-plan and --apply as separate runs.");
  }
  if (staging && args["validate-only"]) {
    throw new Error("--stage-plan requires live Forward reconciliation, not --validate-only.");
  }
  if (args["snapshot-id"] && args.apply) {
    throw new Error("--snapshot-id is dry-run only; Forward apply always targets latest processed.");
  }
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

const readTextFromLocator = async (locator, label, requestHeaders = {}) => {
  if (!isUrlLocator(locator)) {
    return readFile(locator, "utf8");
  }

  validatePackageUrl(locator);
  const response = await fetch(locator, {
    headers: { Accept: "text/plain,application/octet-stream", ...requestHeaders },
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
  if (url.username || url.password || url.search || url.hash) {
    throw new Error(`Package URL must not contain credentials, query parameters, or fragments: ${locator}`);
  }
  if (url.protocol === "https:") {
    return;
  }
  if (url.protocol === "http:" && LOCAL_HTTP_HOSTS.has(url.hostname)) {
    return;
  }
  throw new Error(`Package URL must use HTTPS unless it is localhost: ${locator}`);
};

export const loadPackageAccess = async ({ packageUrl, tokenFile }) => {
  if (!tokenFile) return null;
  if (!packageUrl) throw new Error("--package-token-file requires --package-url.");
  validatePackageUrl(packageUrl);
  const baseUrl = new URL(packageUrl);
  if (baseUrl.protocol !== "https:") {
    throw new Error("--package-token-file requires an HTTPS --package-url.");
  }
  let token;
  try {
    token = (await readFile(tokenFile, "utf8")).trim();
  } catch {
    throw new Error("Package handoff token file could not be read.");
  }
  if (token.length < 16 || token.length > 4096 || /\s/u.test(token)) {
    throw new Error("Package handoff token must contain 16 to 4096 non-whitespace characters.");
  }
  const pathname = baseUrl.pathname.endsWith("/") ? baseUrl.pathname : `${baseUrl.pathname}/`;
  return { origin: baseUrl.origin, pathname, authorization: `Bearer ${token}` };
};

export const packageRequestHeaders = (locator, access) => {
  if (!access || !isUrlLocator(locator)) return {};
  const url = new URL(locator);
  if (url.origin !== access.origin || !url.pathname.startsWith(access.pathname)) return {};
  return { Authorization: access.authorization };
};

const readJsonFromLocator = async (locator, label, requestHeaders = {}) => {
  if (!isUrlLocator(locator)) {
    return readJsonWithText(locator);
  }

  validatePackageUrl(locator);
  const response = await fetch(locator, {
    headers: { Accept: "application/json", ...requestHeaders },
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
  "applyPlanPath",
  "applyUpdates",
  "approvalFile",
  "batchSize",
  "changeWindowId",
  "checks",
  "checksUrl",
  "deactivateStale",
  "failOnDrift",
  "forwardBaseUrl",
  "forwardAuthorizationFile",
  "forwardNetworkId",
  "manifest",
  "manifestUrl",
  "lockPath",
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
  "packageTokenFile",
  "publicKey",
  "publicKeyUrl",
  "requireSignature",
  "reportPath",
  "schemaVersion",
  "signature",
  "signatureUrl",
  "statusArtifactPath",
  "stagePlanPath",
  "validateOnly",
]);
const FORBIDDEN_CONNECTOR_CONFIG_KEYS = new Set([
  "authorization",
  "authorizationHeader",
  "forwardAuthorization",
  "forwardPassword",
  "forwardToken",
  "forwardUser",
  "packageToken",
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
    applyPlanPath: config.applyPlanPath,
    changeWindowId: config.changeWindowId,
    manifest: config.manifest,
    lockPath: config.lockPath,
    metricsPath: config.metricsPath,
    nqeChecks: config.nqeChecks,
    nqeChecksUrl: config.nqeChecksUrl,
    nqeDiffRequests: config.nqeDiffRequests,
    nqeDiffRequestsUrl: config.nqeDiffRequestsUrl,
    nqeQueryIdAllowlist: config.nqeQueryIdAllowlist,
    packageTokenFile: config.packageTokenFile,
    forwardAuthorizationFile: config.forwardAuthorizationFile,
    forwardNetworkId: config.forwardNetworkId,
    publicKey: config.publicKey,
    reportPath: config.reportPath,
    signature: config.signature,
    statusArtifactPath: config.statusArtifactPath,
    stagePlanPath: config.stagePlanPath,
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
  ...(config.applyPlanPath ? { "apply-plan": config.applyPlanPath } : {}),
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
  ...(config.lockPath ? { "lock-path": config.lockPath } : {}),
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
  ...(config.packageTokenFile ? { "package-token-file": config.packageTokenFile } : {}),
  ...(config.publicKey ? { "public-key": config.publicKey } : {}),
  ...(config.publicKeyUrl ? { "public-key-url": config.publicKeyUrl } : {}),
  ...(config.requireSignature ? { "require-signature": true } : {}),
  ...(config.reportPath ? { report: config.reportPath } : {}),
  ...(config.signature ? { signature: config.signature } : {}),
  ...(config.signatureUrl ? { "signature-url": config.signatureUrl } : {}),
  ...(config.statusArtifactPath ? { "status-artifact": config.statusArtifactPath } : {}),
  ...(config.stagePlanPath ? { "stage-plan": config.stagePlanPath } : {}),
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
    "# HELP forward_dynatrace_import_mutation_failure Whether an apply stopped during a Forward write.",
    "# TYPE forward_dynatrace_import_mutation_failure gauge",
    toMetricLine(
      "forward_dynatrace_import_mutation_failure",
      report.mutationFailure ? 1 : 0,
      { phase: report.mutationFailure?.phase || "none" },
    ),
    "# HELP forward_dynatrace_import_post_apply_verified Whether post-apply reconciliation matched the approved plan.",
    "# TYPE forward_dynatrace_import_post_apply_verified gauge",
    toMetricLine(
      "forward_dynatrace_import_post_apply_verified",
      report.postApplyVerification?.state === "verified" ? 1 : 0,
      { state: report.postApplyVerification?.state || "not-run" },
    ),
  );

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
  if (report.mutationFailure) {
    return "failed";
  }
  if (report.mode === "stage") {
    return report.counts?.collision > 0 ? "needs-review" : "staged";
  }
  const unresolvedChanged = report.unresolvedCounts?.changed ?? report.counts?.changed ?? 0;
  const unresolvedStale = report.unresolvedCounts?.stale ?? report.counts?.stale ?? 0;
  if (unresolvedChanged > 0 || unresolvedStale > 0 || (report.counts?.collision || 0) > 0) {
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
        planId: approval.planId,
        planSha256: approval.planSha256,
        packageId: approval.packageId,
        networkId: approval.networkId,
        snapshotId: approval.snapshotId,
        changeWindowId: approval.changeWindowId,
        approvedAt: approval.approvedAt,
        expiresAt: approval.expiresAt,
        approvedBy: approval.approvedBy,
        reason: approval.reason,
        approvedUpdateCount: approval.approvedUpdateSourceKeys.length,
        approvedRetireCount: approval.approvedRetireSourceKeys.length,
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
    collision: 0,
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
  mutationFailure: report.mutationFailure
    ? {
        phase: report.mutationFailure.phase,
        statusCode: report.mutationFailure.statusCode,
        affectedCount: report.mutationFailure.affectedCount,
        recoveryRequired: true,
      }
    : null,
  postApplyVerification: report.postApplyVerification
    ? {
        state: report.postApplyVerification.state,
        planned: report.postApplyVerification.planned,
        counts: report.postApplyVerification.counts,
      }
    : {
        state: "not-run",
        planned: report.plannedChecks || 0,
        counts: null,
      },
  approval: report.approval
    ? {
        schemaVersion: report.approval.schemaVersion,
        planId: report.approval.planId,
        planSha256: report.approval.planSha256,
        packageId: report.approval.packageId,
        changeWindowId: report.approval.changeWindowId,
        approvedAt: report.approval.approvedAt,
        expiresAt: report.approval.expiresAt,
        approvedUpdateCount: report.approval.approvedUpdateCount,
        approvedRetireCount: report.approval.approvedRetireCount,
      }
    : null,
  importPlan: report.importPlan
    ? {
        planId: report.importPlan.planId,
        planSha256: report.importPlan.planSha256,
        state: report.importPlan.state,
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

export const sourceKeys = (check) =>
  (Array.isArray(check.tags) ? check.tags : []).filter((tag) =>
    tag.startsWith(SOURCE_KEY_TAG_PREFIX),
  );

export const reconciliationKey = (check) => managedSourceKey(check) || "";

const sortedTags = (check) => [...(check.tags || [])].sort();

const canonicalizeSubnetLocationValue = (value) => {
  if (typeof value !== "string") return value;
  if (/^(?:\d{1,3}\.){3}\d{1,3}\/32$/u.test(value)) {
    return value.slice(0, -3);
  }
  if (/^[A-Fa-f0-9:]+\/128$/u.test(value)) {
    return value.slice(0, -4);
  }
  return value;
};

const canonicalizeDefinition = (definition) => {
  if (!definition || typeof definition !== "object") return definition;
  const canonical = structuredClone(definition);
  for (const endpoint of [canonical.filters?.from, canonical.filters?.to]) {
    if (endpoint?.location?.type === "SubnetLocationFilter") {
      endpoint.location.value = canonicalizeSubnetLocationValue(endpoint.location.value);
    }
  }
  return canonical;
};

export const canonicalizeCheck = (check) => ({
  definition: canonicalizeDefinition(check.definition),
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
    const identity = inspectManagedIdentity(check);
    if (identity.sourceKey) {
      const matches = byKey.get(identity.sourceKey) || [];
      matches.push({ check, identity });
      byKey.set(identity.sourceKey, matches);
    }
    if (check.name) {
      const matches = byName.get(check.name) || [];
      matches.push(check);
      byName.set(check.name, matches);
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

export const reconcileChecks = (plannedChecks, existingChecks, options = {}) => {
  const { byKey, byName } = indexExistingChecks(existingChecks);
  const plannedKeys = new Set();
  const plannedSourceInstances = new Set(
    plannedChecks
      .map((check) => inspectManagedIdentity(check).sourceInstance)
      .filter(Boolean),
  );
  if (options.sourceInstanceTag) plannedSourceInstances.add(options.sourceInstanceTag);
  const create = [];
  const unchanged = [];
  const changed = [];
  const collision = [];

  for (const planned of plannedChecks) {
    const key = reconciliationKey(planned);
    const plannedIdentity = inspectManagedIdentity(planned);
    const keyMatches = key ? byKey.get(key) || [] : [];
    const nameMatches = planned.name ? byName.get(planned.name) || [] : [];
    let existing = null;

    if (key) {
      plannedKeys.add(key);
    }

    if (keyMatches.length > 1) {
      collision.push({
        key,
        name: planned.name || "",
        reason: "duplicate-source-key",
        existingIds: keyMatches.map(({ check }) => check.id).filter(Boolean),
      });
      continue;
    }
    if (keyMatches.length === 1) {
      const match = keyMatches[0];
      if (
        !match.identity.managed ||
        match.identity.sourceInstance !== plannedIdentity.sourceInstance
      ) {
        collision.push({
          key,
          name: planned.name || "",
          reason: "source-key-owned-by-incompatible-check",
          existingIds: [match.check.id].filter(Boolean),
        });
        continue;
      }
      const conflictingNameMatches = nameMatches.filter(
        (check) =>
          check !== match.check &&
          (!check.id || !match.check.id || String(check.id) !== String(match.check.id)),
      );
      if (conflictingNameMatches.length > 0) {
        collision.push({
          key,
          name: planned.name || "",
          reason: "name-already-exists-with-different-source-key",
          existingIds: conflictingNameMatches
            .map((check) => check.id)
            .filter(Boolean),
        });
        continue;
      }
      existing = match.check;
    } else if (nameMatches.length > 0) {
      collision.push({
        key,
        name: planned.name || "",
        reason: "name-already-exists-with-different-source-key",
        existingIds: nameMatches.map((check) => check.id).filter(Boolean),
      });
      continue;
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
    .map((check) => ({ check, identity: inspectManagedIdentity(check) }))
    .filter(({ identity }) => identity.managed)
    .filter(({ identity }) => plannedSourceInstances.has(identity.sourceInstance))
    .filter((check) => {
      return !plannedKeys.has(check.identity.sourceKey);
    })
    .map(({ check }) => summarizeCheck(check));

  return { create, unchanged, changed, stale, collision };
};

const annotateReconciliation = (reconciliation, artifactType) => ({
  create: reconciliation.create.map((item) => ({ ...item, artifactType })),
  unchanged: reconciliation.unchanged.map((item) => ({ ...item, artifactType })),
  changed: reconciliation.changed.map((item) => ({ ...item, artifactType })),
  stale: reconciliation.stale.map((item) => ({ ...item, artifactType })),
  collision: reconciliation.collision.map((item) => ({ ...item, artifactType })),
});

const mergeReconciliations = (...reconciliations) => ({
  create: reconciliations.flatMap((reconciliation) => reconciliation.create),
  unchanged: reconciliations.flatMap((reconciliation) => reconciliation.unchanged),
  changed: reconciliations.flatMap((reconciliation) => reconciliation.changed),
  stale: reconciliations.flatMap((reconciliation) => reconciliation.stale),
  collision: reconciliations.flatMap((reconciliation) => reconciliation.collision),
});

const reconciliationCounts = (reconciliation) => ({
  create: reconciliation.create.length,
  unchanged: reconciliation.unchanged.length,
  changed: reconciliation.changed.length,
  stale: reconciliation.stale.length,
  collision: reconciliation.collision.length,
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
        "Optional NQE checks must not duplicate intent-check names or managed source keys.",
        duplicateNames.length > 0 ? `Duplicate names: ${duplicateNames.join(", ")}` : "",
        duplicateKeys.length > 0 ? `Duplicate keys: ${duplicateKeys.join(", ")}` : "",
      ]
        .filter(Boolean)
        .join(" "),
    );
  }
};

const makeClient = ({ baseUrl, authorization, maxRetries }) => {
  const root = baseUrl.replace(/\/+$/, "");

  return async (method, path, options = {}) => {
    for (let attempt = 0; attempt <= maxRetries; attempt += 1) {
      const response = await fetch(`${root}${path}`, {
        method,
        headers: {
          Authorization: authorization,
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

const exactSourceKeyArray = (approval, key, errors) => {
  const value = approval[key] === undefined ? [] : approval[key];
  if (!Array.isArray(value)) {
    errors.push(`${key} must be an array when supplied.`);
    return [];
  }

  const seen = new Set();
  value.forEach((item, index) => {
    if (!requireString(item)) {
      errors.push(`${key}[${index}] must be a non-empty string.`);
    } else if (!/^source-key:sha256:[a-f0-9]{64}$/u.test(item)) {
      errors.push(`${key}[${index}] must be a source-key:sha256:<64 hex> value.`);
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
    plan,
    packageId,
    networkId,
    snapshotId,
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
    "approvedAt",
    "actions",
    "changeWindowId",
    "expiresAt",
    "networkId",
    "packageId",
    "planId",
    "planSha256",
    "reason",
    "schemaVersion",
    "snapshotId",
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
  if (!requireString(approval.planId)) {
    errors.push("planId is required.");
  } else if (plan && approval.planId !== plan.planId) {
    errors.push(`planId must match staged plan ${plan.planId}.`);
  }
  if (!/^[a-f0-9]{64}$/u.test(approval.planSha256 || "")) {
    errors.push("planSha256 must be a SHA-256 digest.");
  } else if (plan && approval.planSha256 !== plan.planSha256) {
    errors.push("planSha256 must match the staged plan digest.");
  }
  if (!requireString(approval.networkId)) {
    errors.push("networkId is required.");
  } else if (networkId && String(approval.networkId) !== String(networkId)) {
    errors.push(`networkId must match ${networkId}.`);
  }
  if (!requireString(approval.snapshotId)) {
    errors.push("snapshotId is required.");
  } else if (snapshotId && String(approval.snapshotId) !== String(snapshotId)) {
    errors.push(`snapshotId must match ${snapshotId}.`);
  }
  if (changeWindowId && approval.changeWindowId !== changeWindowId) {
    errors.push(`changeWindowId must match ${changeWindowId}.`);
  }
  if (approval.changeWindowId !== undefined && !requireString(approval.changeWindowId)) {
    errors.push("changeWindowId must be a non-empty string when supplied.");
  }
  if (!requireString(approval.approvedBy)) {
    errors.push("approvedBy is required.");
  }
  if (!requireString(approval.reason)) {
    errors.push("reason is required.");
  }

  const nowMs = now.getTime();
  const maxClockSkewMs = 5 * 60 * 1000;
  const maxApprovalLifetimeMs = 24 * 60 * 60 * 1000;
  let approvedAtMs = Number.NaN;
  if (!requireString(approval.approvedAt)) {
    errors.push("approvedAt is required.");
  } else {
    approvedAtMs = Date.parse(approval.approvedAt);
    if (!Number.isFinite(approvedAtMs)) {
      errors.push("approvedAt must be an ISO timestamp.");
    } else if (approvedAtMs > nowMs + maxClockSkewMs) {
      errors.push("approvedAt must not be more than five minutes in the future.");
    }
  }

  if (!requireString(approval.expiresAt)) {
    errors.push("expiresAt is required.");
  } else {
    const expiresAtMs = Date.parse(approval.expiresAt);
    if (!Number.isFinite(expiresAtMs)) {
      errors.push("expiresAt must be an ISO timestamp.");
    } else if (expiresAtMs <= nowMs) {
      errors.push("expiresAt must be in the future.");
    } else if (Number.isFinite(approvedAtMs) && expiresAtMs <= approvedAtMs) {
      errors.push("expiresAt must be later than approvedAt.");
    } else if (
      Number.isFinite(approvedAtMs) &&
      expiresAtMs - approvedAtMs > maxApprovalLifetimeMs
    ) {
      errors.push("Approval lifetime must not exceed 24 hours.");
    }
  }

  const actions = requireObject(approval.actions, "actions", errors)
    ? approval.actions
    : {};
  const actionKeys = new Set(["createMissing", "updateSourceKeys", "retireSourceKeys"]);
  for (const key of Object.keys(actions)) {
    if (!actionKeys.has(key)) errors.push(`Unsupported approval action: ${key}.`);
  }
  if (actions.createMissing !== true) {
    errors.push("actions.createMissing must be true.");
  }
  const approvedUpdateSourceKeys = exactSourceKeyArray(
    actions,
    "updateSourceKeys",
    errors,
  );
  const approvedRetireSourceKeys = exactSourceKeyArray(
    actions,
    "retireSourceKeys",
    errors,
  );

  if (plan) {
    const plannedUpdateSourceKeys = (plan.actions?.update || [])
      .map((item) => item.sourceKey)
      .sort();
    const plannedRetireSourceKeys = (plan.actions?.retire || [])
      .map((item) => item.sourceKey)
      .sort();
    if (JSON.stringify([...approvedUpdateSourceKeys].sort()) !== JSON.stringify(plannedUpdateSourceKeys)) {
      errors.push("actions.updateSourceKeys must exactly match the staged plan.");
    }
    if (JSON.stringify([...approvedRetireSourceKeys].sort()) !== JSON.stringify(plannedRetireSourceKeys)) {
      errors.push("actions.retireSourceKeys must exactly match the staged plan.");
    }
  }

  if (errors.length > 0) {
    throw new Error(
      `Invalid Forward approval file:\n${errors
        .map((error) => `- ${error}`)
        .join("\n")}`,
    );
  }

  return {
    schemaVersion: APPROVAL_SCHEMA_VERSION,
    planId: approval.planId,
    planSha256: approval.planSha256,
    packageId: approval.packageId,
    networkId: approval.networkId,
    snapshotId: approval.snapshotId,
    changeWindowId: approval.changeWindowId || null,
    approvedAt: approval.approvedAt,
    expiresAt: approval.expiresAt,
    approvedBy: approval.approvedBy,
    reason: approval.reason,
    approvedUpdateSourceKeys,
    approvedRetireSourceKeys,
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
  const approvedUpdateSourceKeys = new Set(approval?.approvedUpdateSourceKeys || []);
  const approvedRetireSourceKeys = new Set(approval?.approvedRetireSourceKeys || []);
  const currentChangedKeys = new Set(reconciliation.changed.map((item) => item.key));
  const currentStaleKeys = new Set(reconciliation.stale.map((item) => item.key));

  if (applyUpdates) {
    assertApprovalKeysMatchCurrentDrift(
      [...approvedUpdateSourceKeys],
      currentChangedKeys,
      "Changed-check",
    );
  }
  if (deactivateStale) {
    assertApprovalKeysMatchCurrentDrift(
      [...approvedRetireSourceKeys],
      currentStaleKeys,
      "Stale-check",
    );
  }

  const update = applyUpdates
    ? reconciliation.changed.filter((item) => approvedUpdateSourceKeys.has(item.key))
    : [];
  const deactivate = deactivateStale
    ? reconciliation.stale.filter((item) => approvedRetireSourceKeys.has(item.key))
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

    const identity = inspectManagedIdentity(check);
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

    for (const identityError of identity.errors) {
      errors.push(`${prefix}.tags ${identityError}.`);
    }
    if (identity.sourceKey && keys.has(identity.sourceKey)) {
      errors.push(`${prefix} source-key duplicates check[${keys.get(identity.sourceKey)}].`);
    } else if (identity.managed) {
      keys.set(identity.sourceKey, index);
    }
    if (
      identity.managed &&
      !check.tags.includes(
        sourceInstanceTag(identity.sourceInstance.slice(SOURCE_INSTANCE_TAG_PREFIX.length)),
      )
    ) {
      errors.push(`${prefix}.tags contains a non-canonical source-instance tag.`);
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
    if (manifest.source.app !== "com.forward.dynatrace") {
      errors.push("manifest.source.app must be com.forward.dynatrace.");
    }
    if (!requireString(manifest.source.instanceId)) {
      errors.push("manifest.source.instanceId is required.");
    } else {
      try {
        const expectedTag = sourceInstanceTag(manifest.source.instanceId);
        if (manifest.source.instanceTag !== expectedTag) {
          errors.push(`manifest.source.instanceTag must be ${expectedTag}.`);
        }
      } catch (error) {
        errors.push(error.message);
      }
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
    if (manifest.intentChecks.dedupe !== "managed-source-key") {
      errors.push("manifest.intentChecks.dedupe must be managed-source-key.");
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
      if (manifest.nqeChecks.dedupe !== "managed-source-key") {
        errors.push("manifest.nqeChecks.dedupe must be managed-source-key.");
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
    if (manifest.validation.managedByTag !== MANAGED_BY_TAG) {
      errors.push(`manifest.validation.managedByTag must be ${MANAGED_BY_TAG}.`);
    }
    if (manifest.validation.contractVersionTag !== CONTRACT_VERSION_TAG) {
      errors.push(
        `manifest.validation.contractVersionTag must be ${CONTRACT_VERSION_TAG}.`,
      );
    }
    if (manifest.validation.sourceInstanceTagPrefix !== SOURCE_INSTANCE_TAG_PREFIX) {
      errors.push(
        `manifest.validation.sourceInstanceTagPrefix must be ${SOURCE_INSTANCE_TAG_PREFIX}.`,
      );
    }
    if (manifest.validation.sourceKeyTagPrefix !== SOURCE_KEY_TAG_PREFIX) {
      errors.push(
        `manifest.validation.sourceKeyTagPrefix must be ${SOURCE_KEY_TAG_PREFIX}.`,
      );
    }
    if (manifest.validation.ownershipTagsPerCheck !== 4) {
      errors.push("manifest.validation.ownershipTagsPerCheck must be 4.");
    }
    if (manifest.validation.identityPolicy !== "strict-ownership-tuple") {
      errors.push("manifest.validation.identityPolicy must be strict-ownership-tuple.");
    }
    if (manifest.validation.credentialPolicy !== "no-forward-credentials-in-dynatrace") {
      errors.push("manifest.validation.credentialPolicy must be no-forward-credentials-in-dynatrace.");
    }
  }

  if (requireObject(manifest.reconciliation, "manifest.reconciliation", errors)) {
    if (manifest.reconciliation.strategy !== "source-scoped-desired-state") {
      errors.push(
        "manifest.reconciliation.strategy must be source-scoped-desired-state.",
      );
    }
    if (manifest.reconciliation.defaultApplyPolicy !== "create-missing-only") {
      errors.push("manifest.reconciliation.defaultApplyPolicy must be create-missing-only.");
    }
    if (manifest.reconciliation.changedChecks !== "report-only") {
      errors.push("manifest.reconciliation.changedChecks must be report-only.");
    }
    if (manifest.reconciliation.staleChecks !== "report-only") {
      errors.push("manifest.reconciliation.staleChecks must be report-only.");
    }
    if (manifest.reconciliation.collisionPolicy !== "reject") {
      errors.push("manifest.reconciliation.collisionPolicy must be reject.");
    }
  }

  const expectedSourceInstanceTag = manifest.source?.instanceTag;
  if (expectedSourceInstanceTag) {
    plannedChecks.forEach((check, index) => {
      const identity = inspectManagedIdentity(check);
      if (identity.managed && identity.sourceInstance !== expectedSourceInstanceTag) {
        errors.push(
          `check[${index}] source-instance does not match manifest.source.instanceTag.`,
        );
      }
    });
  }

  if (errors.length > 0) {
    throw invalidManifestError(errors);
  }
};

export const acquireApplyLock = async ({
  networkId,
  sourceInstanceTag: scopedSourceInstanceTag,
  lockPath,
  now = new Date(),
}) => {
  const scope = `${String(networkId)}\n${String(scopedSourceInstanceTag)}`;
  const resolvedPath = lockPath || path.join(
    tmpdir(),
    `forward-dynatrace-apply-${sha256Hex(scope).slice(0, 24)}.lock`,
  );
  let handle;
  try {
    handle = await open(resolvedPath, "wx", 0o600);
  } catch (error) {
    if (error?.code === "EEXIST") {
      throw new Error(
        `Another Forward apply holds the source/network lock ${resolvedPath}. Wait for it to finish or investigate the stale lock before retrying.`,
      );
    }
    throw error;
  }
  await handle.writeFile(
    `${JSON.stringify(
      {
        schemaVersion: "forward-dynatrace-apply-lock/v1",
        acquiredAt: now.toISOString(),
        processId: process.pid,
        networkId: String(networkId),
        sourceInstanceTag: scopedSourceInstanceTag,
      },
      null,
      2,
    )}\n`,
    "utf8",
  );
  return {
    path: resolvedPath,
    async release() {
      await handle.close();
      await unlink(resolvedPath).catch((error) => {
        if (error?.code !== "ENOENT") throw error;
      });
    },
  };
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
  const packageAccess = await loadPackageAccess({
    packageUrl: args["package-url"],
    tokenFile: args["package-token-file"],
  });

  const locators = resolvePackageLocators(args);
  const plannedPackage = await readJsonFromLocator(
    locators.checks,
    "Forward checks package",
    packageRequestHeaders(locators.checks, packageAccess),
  );
  const plannedChecks = plannedPackage.value;
  validatePlannedChecks(plannedChecks);
  let manifest = null;
  let manifestText = "";
  if (locators.manifest) {
    const manifestPackage = await readJsonFromLocator(
      locators.manifest,
      "Forward package manifest",
      packageRequestHeaders(locators.manifest, packageAccess),
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
      packageRequestHeaders(optionalLocators.nqeChecks, packageAccess),
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
      packageRequestHeaders(optionalLocators.nqeDiffRequests, packageAccess),
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
  const approvalDocument = args["require-approval-file"]
    ? await readJson(args["require-approval-file"])
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
      packageRequestHeaders(signatureLocators.signature, packageAccess),
    );
    const publicKeyText = await readTextFromLocator(
      signatureLocators.publicKey,
      "Forward package signature public key",
      packageRequestHeaders(signatureLocators.publicKey, packageAccess),
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
      approval: null,
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
    authorization: await loadForwardAuthorization(
      requiredRuntimeValue(
        "FORWARD_AUTHORIZATION_FILE",
        connectorConfig.forwardAuthorizationFile,
      ),
    ),
    maxRetries,
  });

  const applyLock = apply
    ? await acquireApplyLock({
        networkId,
        sourceInstanceTag: manifest?.source?.instanceTag,
        lockPath: args["lock-path"],
      })
    : null;

  try {
  let snapshotId;
  if (args["snapshot-id"]) {
    const snapshots = await api(
      "GET",
      `/api/networks/${networkId}/snapshots?includeArchived=true&limit=1000`,
    );
    const explicitSnapshot = snapshots?.snapshots?.find(
      (snapshot) => String(snapshot.id) === String(args["snapshot-id"]),
    );
    if (!explicitSnapshot || explicitSnapshot.state !== "PROCESSED") {
      throw new Error(
        `Explicit snapshot ${args["snapshot-id"]} is not a processed snapshot in network ${networkId}.`,
      );
    }
    snapshotId = String(explicitSnapshot.id);
  } else {
    const latestSnapshot = await api(
      "GET",
      `/api/networks/${networkId}/snapshots/latestProcessed`,
    );
    snapshotId = String(latestSnapshot.id);
  }
  const existingChecks = await api(
    "GET",
    `/api/snapshots/${snapshotId}/checks?type=Existential`,
  );
  const existingNqeChecks =
    plannedNqeChecks.length > 0
      ? await api("GET", `/api/snapshots/${snapshotId}/checks?type=NQE`)
      : [];
  const intentReconciliation = annotateReconciliation(
    reconcileChecks(plannedChecks, existingChecks, {
      sourceInstanceTag: manifest?.source?.instanceTag,
    }),
    "intentChecks",
  );
  const nqeReconciliation = annotateReconciliation(
    reconcileChecks(plannedNqeChecks, existingNqeChecks, {
      sourceInstanceTag: manifest?.source?.instanceTag,
    }),
    "nqeChecks",
  );
  const reconciliation = mergeReconciliations(intentReconciliation, nqeReconciliation);
  if (!manifest || !manifestText) {
    throw new Error("Reconciliation requires a validated package manifest.");
  }
  const storedPlan = args["apply-plan"]
    ? validateImportPlan(await readJson(args["apply-plan"]))
    : null;
  const importPlan = buildImportPlan({
    createdAt: storedPlan?.createdAt || startedAt,
    manifest,
    manifestText,
    packageSignatureStatus: signatureStatus,
    networkId,
    snapshotId,
    reconciliation,
    policy: {
      applyUpdates: Boolean(args["apply-updates"]),
      deactivateStale: Boolean(args["deactivate-stale"]),
      maxUpdates,
      maxDeactivations,
    },
  });
  if (storedPlan) {
    assertImportPlanMatches(storedPlan, importPlan);
  }
  if (args["stage-plan"]) {
    await writeFile(args["stage-plan"], `${JSON.stringify(importPlan, null, 2)}\n`, {
      flag: "wx",
      mode: 0o600,
    });
  }
  const approval = approvalDocument
    ? validateApprovalFile(approvalDocument, {
        plan: importPlan,
        packageId: manifest.packageId,
        networkId,
        snapshotId,
        changeWindowId: args["change-window-id"],
      })
    : null;
  if (apply && reconciliation.collision.length > 0) {
    throw new Error(
      `Forward apply rejected ${reconciliation.collision.length} managed identity or name collision(s). Run dry-run and resolve every collision before apply.`,
    );
  }
  const approvedMutations = planApprovedMutations(reconciliation, approval, {
    applyUpdates: Boolean(args["apply-updates"]),
    deactivateStale: Boolean(args["deactivate-stale"]),
    maxUpdates,
    maxDeactivations,
  });

  const mutationOutcomes = {
    created: [],
    updated: [],
    deactivated: [],
  };
  let mutationFailure = null;
  let mutationError = null;
  let activeMutation = null;
  let postApplyVerification = {
    state: apply ? "pending" : "not-run",
    planned: plannedChecks.length + plannedNqeChecks.length,
    counts: null,
  };
  if (apply) {
    try {
      for (const batch of chunk(reconciliation.create, batchSize)) {
        activeMutation = {
          phase: "create-missing",
          sourceKeys: batch.map((item) => item.key),
          existingCheckIds: [],
          existingCheckDeleted: false,
        };
        await api("POST", `/api/snapshots/${snapshotId}/checks?bulk`, {
          body: batch.map((item) => item.check),
        });
        mutationOutcomes.created.push(
          ...batch.map((item) => ({ sourceKey: item.key, status: "created" })),
        );
      }

      for (const item of approvedMutations.update) {
        activeMutation = {
          phase: "replace-delete",
          sourceKeys: [item.key],
          existingCheckIds: [String(item.existingId)],
          existingCheckDeleted: false,
        };
        await api("DELETE", `/api/snapshots/${snapshotId}/checks/${item.existingId}`);
        activeMutation.existingCheckDeleted = true;
        activeMutation.phase = "replace-create";
        await api("POST", `/api/snapshots/${snapshotId}/checks?bulk`, {
          body: [item.planned.check],
        });
        mutationOutcomes.updated.push({
          sourceKey: item.key,
          existingCheckId: String(item.existingId),
          status: "replaced",
        });
      }

      for (const item of approvedMutations.deactivate) {
        activeMutation = {
          phase: "retire-stale",
          sourceKeys: [item.key],
          existingCheckIds: [String(item.id)],
          existingCheckDeleted: false,
        };
        await api("DELETE", `/api/snapshots/${snapshotId}/checks/${item.id}`);
        activeMutation.existingCheckDeleted = true;
        mutationOutcomes.deactivated.push({
          sourceKey: item.key,
          existingCheckId: String(item.id),
          status: "retired",
        });
      }
    } catch (error) {
      mutationError = error;
      const statusMatch = String(error?.message || "").match(/failed with (\d{3})/u);
      mutationFailure = {
        phase: activeMutation?.phase || "unknown",
        category: "forward-api-request-failed",
        statusCode: statusMatch ? Number.parseInt(statusMatch[1], 10) : null,
        affectedCount: activeMutation?.sourceKeys.length || 0,
        sourceKeys: activeMutation?.sourceKeys || [],
        existingCheckIds: activeMutation?.existingCheckIds || [],
        existingCheckDeleted: Boolean(activeMutation?.existingCheckDeleted),
        recoveryRequired: true,
      };
    }
  }

  if (apply) {
    try {
      const verifiedIntentChecks = await api(
        "GET",
        `/api/snapshots/${snapshotId}/checks?type=Existential`,
      );
      const verifiedNqeChecks =
        plannedNqeChecks.length > 0
          ? await api("GET", `/api/snapshots/${snapshotId}/checks?type=NQE`)
          : [];
      const verifiedReconciliation = mergeReconciliations(
        reconcileChecks(plannedChecks, verifiedIntentChecks, {
          sourceInstanceTag: manifest.source.instanceTag,
        }),
        reconcileChecks(plannedNqeChecks, verifiedNqeChecks, {
          sourceInstanceTag: manifest.source.instanceTag,
        }),
      );
      const verifiedCounts = reconciliationCounts(verifiedReconciliation);
      const unexpectedCount =
        verifiedCounts.create +
        verifiedCounts.changed +
        verifiedCounts.collision +
        (args["deactivate-stale"] ? verifiedCounts.stale : 0);
      postApplyVerification = {
        state: unexpectedCount === 0 ? "verified" : "failed",
        planned: plannedChecks.length + plannedNqeChecks.length,
        counts: verifiedCounts,
      };
      if (unexpectedCount > 0 && !mutationFailure) {
        mutationError = new Error("Post-apply reconciliation did not match the approved plan.");
        mutationFailure = {
          phase: "post-apply-verification",
          category: "reconciliation-mismatch",
          statusCode: null,
          affectedCount: unexpectedCount,
          sourceKeys: [],
          existingCheckIds: [],
          existingCheckDeleted: false,
          recoveryRequired: true,
        };
      }
    } catch (error) {
      postApplyVerification = {
        state: "unavailable",
        planned: plannedChecks.length + plannedNqeChecks.length,
        counts: null,
      };
      if (!mutationFailure) {
        mutationError = error;
        const statusMatch = String(error?.message || "").match(/failed with (\d{3})/u);
        mutationFailure = {
          phase: "post-apply-verification",
          category: "forward-api-request-failed",
          statusCode: statusMatch ? Number.parseInt(statusMatch[1], 10) : null,
          affectedCount: plannedChecks.length + plannedNqeChecks.length,
          sourceKeys: [],
          existingCheckIds: [],
          existingCheckDeleted: false,
          recoveryRequired: true,
        };
      }
    }
  }

  const finishedAt = new Date().toISOString();
  const report = {
    mode: apply ? "apply" : args["stage-plan"] ? "stage" : "dry-run",
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
    importPlan: {
      planId: importPlan.planId,
      planSha256: importPlan.planSha256,
      path: args["stage-plan"] || args["apply-plan"] || null,
      state: mutationFailure
        ? "failed"
        : apply
          ? "applied"
          : args["stage-plan"]
            ? "staged"
            : "preview",
    },
    networkId,
    snapshotId,
    plannedChecks: plannedChecks.length,
    plannedNqeChecks: plannedNqeChecks.length,
    plannedNqeDiffRequests: plannedNqeDiffRequests.length,
    existingDynatraceManagedChecks: [
      ...existingChecks,
      ...existingNqeChecks,
    ].filter((check) => inspectManagedIdentity(check).managed).length,
    artifactCounts: {
      intentChecks: {
        planned: plannedChecks.length,
        create: intentReconciliation.create.length,
        unchanged: intentReconciliation.unchanged.length,
        changed: intentReconciliation.changed.length,
        stale: intentReconciliation.stale.length,
        collision: intentReconciliation.collision.length,
      },
      nqeChecks: {
        planned: plannedNqeChecks.length,
        create: nqeReconciliation.create.length,
        unchanged: nqeReconciliation.unchanged.length,
        changed: nqeReconciliation.changed.length,
        stale: nqeReconciliation.stale.length,
        collision: nqeReconciliation.collision.length,
      },
      nqeDiffRequests: {
        planned: plannedNqeDiffRequests.length,
      },
    },
    counts: reconciliationCounts(reconciliation),
    unresolvedCounts: {
      changed: reconciliation.changed.length - mutationOutcomes.updated.length,
      stale: reconciliation.stale.length - mutationOutcomes.deactivated.length,
    },
    mutationCounts: {
      created: mutationOutcomes.created.length,
      updated: mutationOutcomes.updated.length,
      deactivated: mutationOutcomes.deactivated.length,
    },
    mutationOutcomes,
    mutationFailure,
    postApplyVerification,
    create: reconciliation.create.map(({ check: _check, ...item }) => item),
    unchanged: reconciliation.unchanged,
    changed: reconciliation.changed.map(({ planned, existing, ...item }) => ({
      ...item,
      plannedFingerprint: planned.fingerprint,
      existingFingerprint: existing.fingerprint,
    })),
    stale: reconciliation.stale,
    collision: reconciliation.collision,
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

  if (mutationError) {
    process.stderr.write(
      `Forward apply stopped during ${mutationFailure.phase}; inspect the private import report and reconcile the target snapshot before staging a new plan.\n`,
    );
    process.exitCode = 1;
    return;
  }

  if (
    args["fail-on-drift"] &&
    (
      report.unresolvedCounts.changed > 0 ||
      report.unresolvedCounts.stale > 0 ||
      report.counts.collision > 0
    )
  ) {
    process.exitCode = 2;
  }
  } finally {
    await applyLock?.release();
  }
};

if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((error) => {
    process.stderr.write(`${error.message}\n`);
    process.stderr.write(usage);
    process.exit(1);
  });
}
