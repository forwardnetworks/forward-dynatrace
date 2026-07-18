#!/usr/bin/env node

import { createHash } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";

import forwardSync from "../api/forward-sync.function.ts";
import { isForwardAccessProfile } from "../lib/forward-access-profile.mjs";
import {
  DEFAULT_NQE_CHECKS_PATH,
  DEFAULT_NQE_DIFF_REQUESTS_PATH,
  buildNqeChecksFromDependencies,
  buildNqeDiffRequestsFromDependencies,
  validateNqeChecks,
  validateNqeDiffRequests,
} from "./forward-nqe-artifacts.mjs";

const usage = `
Forward package builder

Usage:
  node --experimental-strip-types scripts/build-forward-package.mjs --dependencies dependencies.json --output-dir out/package

Options:
  --dependencies path             Normalized dependency candidates JSON.
  --source-instance-id id         Stable opaque Dynatrace environment/source ID. Required.
  --forward-base-url URL          Optional Forward URL metadata only.
  --forward-network-id id         Optional Forward network ID metadata only.
  --nqe-query-id FQ_...           Optional Forward-owned query ID for persistent NQE checks.
  --nqe-diff-query-id FQ_...      Optional Forward-owned query ID for NQE diff requests.
  --nqe-diff-before-snapshot-id id
                                  Snapshot ID for optional NQE diff base.
  --nqe-diff-after-snapshot-id id Snapshot ID for optional NQE diff target.
  --output-dir path               Output directory. Defaults to current directory.
  --eligibility-report path        Optional dependency eligibility report JSON.
  --include-review                Explicit override: include mappingState=review rows in intent-check artifacts.
  --sync-mode manual-import       manual-import, data-connector, or intent-package.
  --forward-access-profile name   read-only, network-operator, or network-admin. Default: read-only.

Writes:
  forward-dynatrace-manifest.json
  forward-intent-checks.json
  forward-nqe-checks.json         Only when --nqe-query-id is supplied.
  forward-nqe-diff-requests.json  Only when --nqe-diff-query-id and snapshot IDs are supplied.

This does not contact Forward. Forward writes happen only through the Forward-side importer or connector.
`;

const parseArgs = (argv) => {
  const args = {};
  for (let index = 0; index < argv.length; index += 1) {
    const value = argv[index];
    if (!value.startsWith("--")) {
      throw new Error(`Unexpected positional argument: ${value}`);
    }
    const key = value.slice(2);
    if (key === "help" || key === "include-review") {
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

const validSyncModes = new Set(["manual-import", "data-connector", "intent-package"]);

const sha256Hex = (text) => createHash("sha256").update(text, "utf8").digest("hex");

const requiredDependencyFields = [
  "source",
  "destination",
  "protocol",
  "port",
  "serviceEntityId",
];

const missingFields = (dependency) =>
  requiredDependencyFields.filter((field) => !String(dependency[field] ?? "").trim());

const eligibilityReason = (dependency, includeReviewRows) => {
  const missing = missingFields(dependency);
  if (missing.length > 0) {
    return `Missing required field(s): ${missing.join(", ")}.`;
  }
  if (dependency.mappingState === "ready") {
    return "Ready: both endpoints are marked Forward-resolvable.";
  }
  if (dependency.mappingState === "review") {
    return includeReviewRows
      ? "Included by explicit review-row override; Forward apply can still reject unresolved locations."
      : "Held for review: run read-only endpoint-resolution before export.";
  }
  if (dependency.mappingState === "needs-map") {
    return "Blocked: source or destination is not mapped to a Forward-resolvable location.";
  }
  return `Blocked: unsupported mappingState ${dependency.mappingState}.`;
};

const isEligible = (dependency, includeReviewRows) =>
  missingFields(dependency).length === 0 &&
  (dependency.mappingState === "ready" ||
    (includeReviewRows && dependency.mappingState === "review"));

const buildEligibilityReport = ({ dependencies, includeReviewRows, generatedAt }) => {
  const rows = dependencies.map((dependency) => ({
    id: dependency.id,
    appName: dependency.appName,
    environment: dependency.environment,
    serviceEntityId: dependency.serviceEntityId,
    serviceName: dependency.serviceName,
    source: dependency.source,
    sourceFilterType: dependency.sourceFilterType || "HostFilter",
    destination: dependency.destination,
    destinationFilterType: dependency.destinationFilterType || "HostFilter",
    protocol: dependency.protocol,
    port: dependency.port,
    owner: dependency.owner,
    criticality: dependency.criticality,
    confidence: dependency.confidence,
    mappingState: dependency.mappingState,
    eligible: isEligible(dependency, includeReviewRows),
    reason: eligibilityReason(dependency, includeReviewRows),
  }));

  const count = (predicate) => rows.filter(predicate).length;
  return {
    schemaVersion: "forward-dynatrace-dependency-eligibility/v1",
    generatedAt,
    includeReviewRows,
    counts: {
      total: rows.length,
      ready: count((row) => row.mappingState === "ready"),
      review: count((row) => row.mappingState === "review"),
      needsMap: count((row) => row.mappingState === "needs-map"),
      eligible: count((row) => row.eligible),
      blocked: count((row) => !row.eligible),
    },
    rows,
  };
};

const main = async () => {
  const args = parseArgs(process.argv.slice(2));
  if (args.help) {
    process.stdout.write(usage);
    return;
  }
  if (!args.dependencies) {
    throw new Error("Missing required --dependencies path.");
  }
  if (!args["source-instance-id"]) {
    throw new Error("Missing required --source-instance-id.");
  }

  const syncMode = args["sync-mode"] || "manual-import";
  if (!validSyncModes.has(syncMode)) {
    throw new Error(`Unsupported --sync-mode ${syncMode}.`);
  }
  const forwardAccessProfile = args["forward-access-profile"] || "read-only";
  if (!isForwardAccessProfile(forwardAccessProfile)) {
    throw new Error(`Unsupported --forward-access-profile ${forwardAccessProfile}.`);
  }

  const dependencies = JSON.parse(await readFile(args.dependencies, "utf8"));
  if (!Array.isArray(dependencies)) {
    throw new Error("--dependencies must contain a JSON array.");
  }

  const includeReviewRows = Boolean(args["include-review"]);
  const generatedAt = new Date().toISOString();
  const selectedDependencies = dependencies.filter((dependency) =>
    dependency.mappingState === "ready" ||
      (includeReviewRows && dependency.mappingState === "review"),
  );

  const result = forwardSync({
    sourceInstanceId: args["source-instance-id"],
    forwardBaseUrl: args["forward-base-url"],
    forwardNetworkId: args["forward-network-id"],
    syncMode,
    forwardAccessProfile,
    includeReviewRows,
    dependencies,
  });

  if (result.status !== "ready") {
    throw new Error(result.summary);
  }

  const outputDir = args["output-dir"] || ".";
  await mkdir(outputDir, { recursive: true });
  const manifestPath = path.join(outputDir, "forward-dynatrace-manifest.json");
  const checksPath = path.join(outputDir, "forward-intent-checks.json");
  const manifest = JSON.parse(result.exportManifestPreview);
  let nqeChecks = [];
  let nqeDiffRequests = [];

  if (args["nqe-query-id"]) {
    nqeChecks = buildNqeChecksFromDependencies(selectedDependencies, {
      queryId: args["nqe-query-id"],
      sourceInstanceId: args["source-instance-id"],
    });
    validateNqeChecks(nqeChecks, {
      allowedQueryIds: new Set([args["nqe-query-id"]]),
    });
    const nqeChecksText = JSON.stringify(nqeChecks, null, 2) + "\n";
    await writeFile(path.join(outputDir, DEFAULT_NQE_CHECKS_PATH), nqeChecksText);
    manifest.artifacts.nqeChecks = DEFAULT_NQE_CHECKS_PATH;
    manifest.integrity.nqeChecksSha256 = sha256Hex(nqeChecksText);
    manifest.nqeChecks = {
      count: nqeChecks.length,
      checkType: "NQE",
      payloadShape: "NewNetworkCheck[]",
      bulkEndpoint: "/api/snapshots/{snapshotId}/checks?bulk",
      dedupeRequiredBeforePost: true,
      dedupe: "managed-source-key",
      queryIdPolicy: "forward-owned-allowlist",
      parameterSource: "dynatrace-app-environment",
    };
  }

  if (
    args["nqe-diff-query-id"] ||
    args["nqe-diff-before-snapshot-id"] ||
    args["nqe-diff-after-snapshot-id"]
  ) {
    nqeDiffRequests = buildNqeDiffRequestsFromDependencies(selectedDependencies, {
      queryId: args["nqe-diff-query-id"],
      sourceInstanceId: args["source-instance-id"],
      beforeSnapshotId: args["nqe-diff-before-snapshot-id"],
      afterSnapshotId: args["nqe-diff-after-snapshot-id"],
    });
    validateNqeDiffRequests(nqeDiffRequests, {
      allowedQueryIds: new Set([args["nqe-diff-query-id"]]),
    });
    const nqeDiffRequestsText = JSON.stringify(nqeDiffRequests, null, 2) + "\n";
    await writeFile(
      path.join(outputDir, DEFAULT_NQE_DIFF_REQUESTS_PATH),
      nqeDiffRequestsText,
    );
    manifest.artifacts.nqeDiffRequests = DEFAULT_NQE_DIFF_REQUESTS_PATH;
    manifest.integrity.nqeDiffRequestsSha256 = sha256Hex(nqeDiffRequestsText);
    manifest.nqeDiffRequests = {
      count: nqeDiffRequests.length,
      payloadShape: "ForwardDynatraceNqeDiffRequest[]",
      endpoint: "/api/nqe-diffs/{before}/{after}",
      queryIdPolicy: "forward-owned-allowlist",
      executionPolicy: "read-only-forward-side-optional",
      parameterSource: "dynatrace-app-environment",
    };
  }

  await writeFile(manifestPath, JSON.stringify(manifest, null, 2) + "\n");
  await writeFile(checksPath, result.intentChecksPreview);
  if (args["eligibility-report"]) {
    await writeFile(
      args["eligibility-report"],
      `${JSON.stringify(
        buildEligibilityReport({ dependencies, includeReviewRows, generatedAt }),
        null,
        2,
      )}\n`,
    );
  }

  process.stdout.write(
    JSON.stringify(
      {
        status: "ok",
        dependencies: dependencies.length,
        selectedDependencies: selectedDependencies.length,
        includeReviewRows,
        intentChecks: result.intentCheckCount,
        nqeChecks: nqeChecks.length,
        nqeDiffRequests: nqeDiffRequests.length,
        rejectedDependencies: result.rejectedDependencyCount,
        manifest: manifestPath,
        checks: checksPath,
        eligibilityReport: args["eligibility-report"] || null,
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
