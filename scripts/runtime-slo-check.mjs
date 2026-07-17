#!/usr/bin/env node

import { readFile } from "node:fs/promises";
import { pathToFileURL } from "node:url";

const usage = `
Forward for Dynatrace runtime SLO check

Usage:
  node scripts/runtime-slo-check.mjs --report forward-import-report.json
  node scripts/runtime-slo-check.mjs --report forward-import-report.json --metrics forward-import-metrics.prom --max-duration-ms 300000 --require-signature

Options:
  --allow-drift             Do not fail on unresolved changed/stale drift.
  --max-duration-ms 300000  Maximum importer runtime duration.
  --metrics path            Optional Prometheus metrics file to cross-check.
  --report path             Required importer JSON report.
  --require-signature       Require packageSignature.status=verified.

This reads Forward-side importer outputs only. It does not contact Forward or Dynatrace.
`;

const DEFAULT_MAX_DURATION_MS = 300000;

const parseArgs = (argv) => {
  const args = {};
  for (let index = 0; index < argv.length; index += 1) {
    const value = argv[index];
    if (value === "--help") {
      args.help = true;
      continue;
    }
    if (value === "--allow-drift" || value === "--require-signature") {
      args[value.slice(2)] = true;
      continue;
    }
    if (value === "--report" || value === "--metrics" || value === "--max-duration-ms") {
      const next = argv[index + 1];
      if (!next || next.startsWith("--")) {
        throw new Error(`Missing value for ${value}.`);
      }
      args[value.slice(2)] = next;
      index += 1;
      continue;
    }
    throw new Error(`Unsupported option: ${value}`);
  }
  return args;
};

const numeric = (value, label, errors) => {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    errors.push(`${label} must be a finite number.`);
    return 0;
  }
  return value;
};

const parseMetrics = (text) => {
  const metrics = new Map();
  for (const line of text.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) {
      continue;
    }
    const match = /^(?<name>[a-zA-Z_:][a-zA-Z0-9_:]*)(?:\{(?<labels>[^}]*)\})?\s+(?<value>-?\d+(?:\.\d+)?)$/.exec(
      trimmed,
    );
    if (!match?.groups) {
      throw new Error(`Invalid metric line: ${line}`);
    }
    const key = match.groups.labels
      ? `${match.groups.name}{${match.groups.labels}}`
      : match.groups.name;
    metrics.set(key, Number(match.groups.value));
  }
  return metrics;
};

const metricValue = (metrics, name) => {
  if (!metrics.has(name)) {
    throw new Error(`Missing metric: ${name}`);
  }
  return metrics.get(name);
};

export const evaluateRuntimeSlo = (
  report,
  {
    allowDrift = false,
    maxDurationMs = DEFAULT_MAX_DURATION_MS,
    metricsText,
    requireSignature = false,
  } = {},
) => {
  const errors = [];
  const checks = [];

  if (!report || typeof report !== "object" || Array.isArray(report)) {
    throw new Error("Runtime report must be a JSON object.");
  }

  if (typeof report.runId !== "string" || !report.runId.trim()) {
    errors.push("report.runId is required.");
  }
  if (typeof report.startedAt !== "string" || !Number.isFinite(Date.parse(report.startedAt))) {
    errors.push("report.startedAt must be an ISO timestamp.");
  }
  if (typeof report.finishedAt !== "string" || !Number.isFinite(Date.parse(report.finishedAt))) {
    errors.push("report.finishedAt must be an ISO timestamp.");
  }

  const durationMs = numeric(report.durationMs, "report.durationMs", errors);
  if (durationMs < 0) {
    errors.push("report.durationMs must not be negative.");
  } else if (durationMs > maxDurationMs) {
    errors.push(`duration ${durationMs}ms exceeds SLO ${maxDurationMs}ms.`);
  } else {
    checks.push(`duration<=${maxDurationMs}ms`);
  }

  const plannedChecks = numeric(report.plannedChecks, "report.plannedChecks", errors);
  if (plannedChecks < 0) {
    errors.push("report.plannedChecks must not be negative.");
  } else {
    checks.push("planned-check-count-present");
  }

  const unresolvedChanged = report.unresolvedCounts?.changed ?? report.counts?.changed ?? 0;
  const unresolvedStale = report.unresolvedCounts?.stale ?? report.counts?.stale ?? 0;
  const collisions = report.counts?.collision ?? 0;
  numeric(unresolvedChanged, "unresolved changed count", errors);
  numeric(unresolvedStale, "unresolved stale count", errors);
  numeric(collisions, "collision count", errors);
  if (collisions > 0) {
    errors.push(`managed identity collisions must be zero; found ${collisions}.`);
  } else {
    checks.push("no-managed-identity-collisions");
  }
  if (!allowDrift && (unresolvedChanged > 0 || unresolvedStale > 0)) {
    errors.push(
      `unresolved drift exceeds SLO: changed=${unresolvedChanged}, stale=${unresolvedStale}.`,
    );
  } else {
    checks.push(allowDrift ? "drift-allowed" : "no-unresolved-drift");
  }

  if (report.mutationFailure) {
    errors.push(
      `mutation failure requires reconciliation: phase=${report.mutationFailure.phase || "unknown"}.`,
    );
  } else {
    checks.push("no-mutation-failure");
  }

  if (
    report.mode === "apply" &&
    report.postApplyVerification?.state !== "verified"
  ) {
    errors.push("apply requires a verified post-apply reconciliation.");
  } else if (report.mode === "apply") {
    checks.push("post-apply-reconciliation-verified");
  }

  if (requireSignature && report.packageSignature?.status !== "verified") {
    errors.push("package signature must be verified.");
  } else if (requireSignature) {
    checks.push("signature-verified");
  }

  if (metricsText !== undefined) {
    const metrics = parseMetrics(metricsText);
    const metricDuration = metricValue(metrics, "forward_dynatrace_import_duration_ms");
    const metricPlannedChecks = metricValue(
      metrics,
      "forward_dynatrace_import_planned_checks",
    );
    if (metricDuration !== durationMs) {
      errors.push(
        `metrics duration ${metricDuration} does not match report duration ${durationMs}.`,
      );
    }
    if (metricPlannedChecks !== plannedChecks) {
      errors.push(
        `metrics planned checks ${metricPlannedChecks} does not match report planned checks ${plannedChecks}.`,
      );
    }
    checks.push("metrics-match-report");
  }

  if (errors.length > 0) {
    return {
      status: "failed",
      errors,
      checks,
    };
  }

  return {
    status: "ok",
    checks,
    runId: report.runId,
    packageId: report.packageId || null,
    durationMs,
    plannedChecks,
  };
};

const toPositiveInteger = (value, label) => {
  const parsed = Number.parseInt(value, 10);
  if (!Number.isInteger(parsed) || parsed <= 0) {
    throw new Error(`${label} must be a positive integer.`);
  }
  return parsed;
};

const main = async () => {
  const args = parseArgs(process.argv.slice(2));
  if (args.help) {
    process.stdout.write(usage);
    return;
  }
  if (!args.report) {
    throw new Error("Missing required --report path.");
  }

  const result = evaluateRuntimeSlo(JSON.parse(await readFile(args.report, "utf8")), {
    allowDrift: Boolean(args["allow-drift"]),
    maxDurationMs: args["max-duration-ms"]
      ? toPositiveInteger(args["max-duration-ms"], "--max-duration-ms")
      : DEFAULT_MAX_DURATION_MS,
    metricsText: args.metrics ? await readFile(args.metrics, "utf8") : undefined,
    requireSignature: Boolean(args["require-signature"]),
  });

  process.stdout.write(JSON.stringify(result, null, 2) + "\n");
  if (result.status !== "ok") {
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
