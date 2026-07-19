import assert from "node:assert/strict";
import test from "node:test";

import {
  correlateSecurityExposure,
  validateSecurityInputs,
} from "./security-exposure-correlation.mjs";

const finding = { findingId: "DT-VULN-1", observedAt: "2026-01-01T00:00:00Z", severity: "critical", activeExecution: true };
const exposure = { exposureId: "FWD-1", snapshotId: "s1", observedAt: "2026-01-01T00:01:00Z", modeledReachable: true, internetAddressable: true, policyFinding: false };

test("keeps evidence facts distinct and ranks a high-confidence correlation", () => {
  const result = correlateSecurityExposure({ findings: [finding], exposures: [exposure], mappings: [{ mappingId: "m1", findingId: "DT-VULN-1", exposureId: "FWD-1", confidence: "high" }], generatedAt: "2026-01-01T00:02:00Z" });
  assert.equal(result.investigationQueue[0].severity, "critical");
  assert.deepEqual(result.provenance, { source: "unspecified", synthetic: false });
  assert.deepEqual(result.investigationQueue[0].facts, { observedExecution: true, vulnerableRuntime: true, modeledReachability: true, internetAddressability: true, policyFinding: false });
  assert.equal(result.boundaries.automaticRemediation, false);
});

test("low-confidence identity cannot create high severity", () => {
  const result = correlateSecurityExposure({ findings: [finding], exposures: [exposure], mappings: [{ mappingId: "m1", findingId: "DT-VULN-1", exposureId: "FWD-1", confidence: "low" }], generatedAt: "2026-01-01T00:02:00Z" });
  assert.equal(result.investigationQueue[0].severity, "medium");
  assert.equal(result.investigationQueue[0].disposition, "identity-review-required");
});

test("rejects mappings that lack traceable source evidence", () => {
  const result = correlateSecurityExposure({ findings: [finding], exposures: [], mappings: [{ mappingId: "m1", findingId: "DT-VULN-1", exposureId: "missing", confidence: "high" }], generatedAt: "2026-01-01T00:02:00Z" });
  assert.equal(result.counts.correlated, 0);
  assert.equal(result.counts.rejectedMappings, 1);
});

test("rejects ambiguous or weakly typed source evidence before correlation", () => {
  assert.throws(
    () => validateSecurityInputs({
      findings: [finding, { ...finding }],
      exposures: [exposure],
      mappings: [],
    }),
    /duplicate findingId/,
  );
  assert.throws(
    () => validateSecurityInputs({
      findings: [{ ...finding, activeExecution: "false" }],
      exposures: [exposure],
      mappings: [],
    }),
    /activeExecution must be a boolean/,
  );
});

test("rejects synthetic provenance before correlation", () => {
  assert.throws(() => correlateSecurityExposure({
    findings: [finding],
    exposures: [exposure],
    mappings: [{ mappingId: "m1", findingId: "DT-VULN-1", exposureId: "FWD-1", confidence: "high" }],
    generatedAt: "2026-01-01T00:02:00Z",
    provenance: { source: "unit-test", synthetic: true },
  }), /rejects synthetic evidence/);
});
