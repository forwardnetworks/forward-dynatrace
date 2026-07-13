import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { test } from "node:test";

import {
  buildNoShowcaseSummary,
  forwardReadOnlyAuthorization,
  noShowcaseDependenciesMessage,
  parseArgs,
  selectShowcaseDependencies,
  shouldRunPathEvidence,
} from "./live-demo-conductor.mjs";

test("selects clean unique showcase flows while preserving governance states", async () => {
  const dependencies = JSON.parse(
    await readFile("shared/demo-dependencies.json", "utf8"),
  );
  const governed = dependencies.map((dependency) => {
    if (dependency.serviceName === "astroshop-shipping") {
      return { ...dependency, mappingState: "review" };
    }
    if (dependency.serviceName === "easytrade-accountservice (AccountControllerV2)") {
      return { ...dependency, mappingState: "needs-map" };
    }
    return dependency;
  });

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

test("parses explicit mutation and Dynatrace status publication gates", () => {
  assert.deepEqual(parseArgs(["--apply", "--publish-dynatrace-status"]), {
    apply: true,
    "publish-dynatrace-status": true,
  });
});

test("prefers dedicated read-only Forward authorization", () => {
  assert.equal(
    forwardReadOnlyAuthorization({
      FORWARD_USER: "write-user",
      FORWARD_PASSWORD: "write-password",
      FORWARD_READONLY_AUTHORIZATION: "Bearer readonly-token",
    }),
    "Bearer readonly-token",
  );
  assert.equal(
    forwardReadOnlyAuthorization({
      FORWARD_USER: "demo-user",
      FORWARD_PASSWORD: "demo-password",
    }),
    `Basic ${Buffer.from("demo-user:demo-password").toString("base64")}`,
  );
});

test("fails empty live evidence with an honest no-write recovery path", () => {
  const noRows = noShowcaseDependenciesMessage({ rowCount: 0, dependencyCount: 0 });
  assert.match(noRows, /returned zero dependency rows/u);
  assert.match(noRows, /No Forward call was attempted/u);
  assert.match(noRows, /approved non-production demo tenant only/u);
  assert.match(noRows, /replay evidence must remain visibly synthetic/u);

  const unusableRows = noShowcaseDependenciesMessage({ rowCount: 4, dependencyCount: 2 });
  assert.match(unusableRows, /returned 4 rows and 2 normalized dependencies/u);
  assert.match(unusableRows, /none had a clean service name and unique flow/u);

  const summary = buildNoShowcaseSummary({
    applyRequested: true,
    dependenciesPath: "/tmp/live/dynatrace-dependencies.json",
    dependencyCount: 0,
    environmentUrl: "https://tenant.example.com/",
    outputDir: "/tmp/live",
    publishDynatraceStatusRequested: true,
    rowCount: 0,
    rowsPath: "/tmp/live/dynatrace-query-rows.json",
  });
  assert.equal(summary.status, "blocked");
  assert.equal(summary.reason, "NO_LIVE_SHOWCASE_DEPENDENCIES");
  assert.deepEqual(summary.provenance, {
    evidenceSource: "live-dynatrace-query",
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
