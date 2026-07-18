import assert from "node:assert/strict";
import { test } from "node:test";

import {
  buildNoShowcaseSummary,
  noShowcaseDependenciesMessage,
  parseArgs,
  selectShowcaseDependencies,
  shouldRunPathEvidence,
  validateConductorProvenance,
} from "./live-demo-conductor.mjs";

test("selects clean unique live flows while preserving governance states", () => {
  const governed = Array.from({ length: 14 }, (_, index) => ({
    id: `unit-flow-${index + 1}`,
    serviceName: index === 13 ? ":invalid" : `service-${index + 1}`,
    source: `10.0.0.${index + 1}`,
    destination: `192.0.2.${index + 1}`,
    protocol: "tcp",
    port: 443,
    mappingState: index === 1 ? "review" : index === 2 ? "needs-map" : "ready",
  }));

  const selected = selectShowcaseDependencies(governed, 12);
  assert.equal(selected.length, 12);
  assert.equal(selected.some((dependency) => dependency.mappingState === "review"), true);
  assert.equal(selected.some((dependency) => dependency.mappingState === "needs-map"), true);
  assert.equal(selected.some((dependency) => /^[_:]|:\d/u.test(dependency.serviceName)), false);
  assert.equal(
    new Set(
      selected.map((dependency) =>
        [dependency.source, dependency.destination, dependency.protocol, dependency.port].join("|"),
      ),
    ).size,
    selected.length,
  );
});

test("runs read-only path evidence by default and supports an explicit skip", () => {
  assert.equal(shouldRunPathEvidence(parseArgs([])), true);
  assert.equal(shouldRunPathEvidence(parseArgs(["--with-path-evidence"])), true);
  assert.equal(shouldRunPathEvidence(parseArgs(["--skip-path-evidence"])), false);
});

test("parses live Dynatrace status publication without a mutation bypass", () => {
  assert.deepEqual(parseArgs([
    "--publish-dynatrace-status",
    "--evidence-source", "live-instrumented-transactions",
  ]), {
    "publish-dynatrace-status": true,
    "evidence-source": "live-instrumented-transactions",
  });
  assert.throws(() => parseArgs(["--synthetic"]), /live evidence only/);
});

test("requires honest query and dependency provenance before any Forward work", () => {
  assert.throws(
    () => validateConductorProvenance({
      dependencies: [],
      provenance: { evidenceSource: "live-customer-query", synthetic: false },
    }),
    /query-file is required/,
  );
  assert.deepEqual(
    validateConductorProvenance({
      dependencies: [],
      provenance: { evidenceSource: "live-customer-query", synthetic: false },
      queryFile: "/secure/queries/customer-dependencies.dql",
    }),
    { evidenceSource: "live-customer-query", synthetic: false },
  );
  assert.throws(
    () => validateConductorProvenance({
      dependencies: [{ id: "seeded-1", synthetic: true }],
      provenance: { evidenceSource: "live-customer-query", synthetic: false },
      queryFile: "/secure/queries/customer-dependencies.dql",
    }),
    /live-only processing stopped/,
  );
});

test("fails empty live evidence with an honest no-write recovery path", () => {
  const noRows = noShowcaseDependenciesMessage({ rowCount: 0, dependencyCount: 0 });
  assert.match(noRows, /returned zero dependency rows/u);
  assert.match(noRows, /No Forward call was attempted/u);
  assert.match(noRows, /current customer-owned dependency evidence/u);

  const unusableRows = noShowcaseDependenciesMessage({ rowCount: 4, dependencyCount: 2 });
  assert.match(unusableRows, /returned 4 rows and 2 normalized dependencies/u);
  assert.match(unusableRows, /none had a clean service name and unique flow/u);

  const summary = buildNoShowcaseSummary({
    applyRequested: true,
    dependenciesPath: "/tmp/live/dynatrace-dependencies.json",
    dependencyCount: 0,
    environmentUrl: "https://tenant.example.com/",
    outputDir: "/tmp/live",
    provenance: { evidenceSource: "live-customer-query", synthetic: false },
    publishDynatraceStatusRequested: true,
    rowCount: 0,
    rowsPath: "/tmp/live/dynatrace-query-rows.json",
  });
  assert.equal(summary.status, "blocked");
  assert.equal(summary.reason, "NO_LIVE_SHOWCASE_DEPENDENCIES");
  assert.deepEqual(summary.provenance, {
    evidenceSource: "live-customer-query",
    synthetic: false,
  });
  assert.equal(summary.dynatrace.rawRows, 0);
  assert.equal(summary.dynatrace.normalizedDependencies, 0);
  assert.equal(summary.dynatrace.statusPublished, false);
  assert.equal(summary.forward.attempted, false);
  assert.equal(summary.forward.applyRequested, true);
  assert.equal(summary.artifacts.showcaseDependencies, null);
  assert.match(summary.message, /No Forward call was attempted/u);
});
