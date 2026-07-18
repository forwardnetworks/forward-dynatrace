import assert from "node:assert/strict";
import { test } from "node:test";

import { evaluateRuntimeSlo } from "./runtime-slo-check.mjs";

const baseReport = {
  mode: "apply",
  runId: "forward-dynatrace-20260703080000",
  startedAt: "2026-07-03T08:00:00.000Z",
  finishedAt: "2026-07-03T08:00:03.000Z",
  durationMs: 3000,
  packageId: "dynatrace-forward-20260703080000",
  packageSignature: {
    status: "verified",
  },
  plannedChecks: 42,
  counts: {
    create: 0,
    unchanged: 42,
    changed: 0,
    stale: 0,
    collision: 0,
  },
  unresolvedCounts: {
    changed: 0,
    stale: 0,
  },
  postApplyVerification: {
    state: "verified",
  },
};

test("accepts report within runtime SLO", () => {
  const result = evaluateRuntimeSlo(baseReport, {
    maxDurationMs: 5000,
    requireSignature: true,
  });

  assert.equal(result.status, "ok");
  assert.equal(result.durationMs, 3000);
  assert.equal(result.plannedChecks, 42);
});

test("rejects slow runtime", () => {
  const result = evaluateRuntimeSlo(
    {
      ...baseReport,
      durationMs: 6000,
    },
    {
      maxDurationMs: 5000,
    },
  );

  assert.equal(result.status, "failed");
  assert.match(result.errors.join("\n"), /exceeds SLO/);
});

test("rejects unresolved drift unless allowed", () => {
  const driftReport = {
    ...baseReport,
    unresolvedCounts: {
      changed: 1,
      stale: 2,
    },
  };

  assert.equal(evaluateRuntimeSlo(driftReport).status, "failed");
  assert.equal(evaluateRuntimeSlo(driftReport, { allowDrift: true }).status, "ok");
});

test("rejects missing signature when required", () => {
  const result = evaluateRuntimeSlo(
    {
      ...baseReport,
      packageSignature: {
        status: "not-provided",
      },
    },
    {
      requireSignature: true,
    },
  );

  assert.equal(result.status, "failed");
  assert.match(result.errors.join("\n"), /signature must be verified/);
});

test("rejects collisions and partial mutation failures", () => {
  const collision = evaluateRuntimeSlo({
    ...baseReport,
    counts: { ...baseReport.counts, collision: 1 },
  });
  assert.equal(collision.status, "failed");
  assert.match(collision.errors.join("\n"), /collisions must be zero/u);

  const partialApply = evaluateRuntimeSlo({
    ...baseReport,
    mutationFailure: {
      phase: "replace-create",
      recoveryRequired: true,
    },
  });
  assert.equal(partialApply.status, "failed");
  assert.match(partialApply.errors.join("\n"), /requires reconciliation/u);

  const missingReadback = evaluateRuntimeSlo({
    ...baseReport,
    postApplyVerification: { state: "unavailable" },
  });
  assert.equal(missingReadback.status, "failed");
  assert.match(missingReadback.errors.join("\n"), /post-apply reconciliation/u);
});

test("checks metrics match report", () => {
  const result = evaluateRuntimeSlo(baseReport, {
    metricsText: [
      "# HELP forward_dynatrace_import_planned_checks Planned Forward checks in package.",
      "forward_dynatrace_import_planned_checks 42",
      "forward_dynatrace_import_duration_ms 3000",
    ].join("\n"),
  });

  assert.equal(result.status, "ok");
  assert.equal(
    evaluateRuntimeSlo(baseReport, {
      metricsText: [
        "forward_dynatrace_import_planned_checks 41",
        "forward_dynatrace_import_duration_ms 3000",
      ].join("\n"),
    }).status,
    "failed",
  );
});
