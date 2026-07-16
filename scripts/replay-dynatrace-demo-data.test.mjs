import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { test } from "node:test";

test("dry-run replay maps Apps URL to live OpenPipeline ingest origin", () => {
  const result = spawnSync(
    process.execPath,
    [
      "scripts/replay-dynatrace-demo-data.mjs",
      "--environment-url",
      "https://your-environment-id.apps.dynatrace.com/",
      "--run-id",
      "test-run",
    ],
    { cwd: process.cwd(), encoding: "utf8" },
  );

  assert.equal(result.status, 0, result.stderr);
  const summary = JSON.parse(result.stdout);
  assert.equal(summary.mode, "dry-run");
  assert.equal(summary.apiBaseUrl, "https://your-environment-id.live.dynatrace.com");
  assert.equal(summary.endpoint, "/platform/ingest/v1/events");
  assert.equal(summary.requiredScope, "openpipeline:events:ingest");
  assert.equal(summary.replayEvents, 100);
  assert.equal(summary.readyRows, 100);
  assert.equal(summary.reviewRows, 0);
  assert.equal(summary.needsMapRows, 0);
});

test("dry-run replay honors explicit API base override", () => {
  const result = spawnSync(
    process.execPath,
    [
      "scripts/replay-dynatrace-demo-data.mjs",
      "--environment-url",
      "https://your-environment-id.apps.dynatrace.com/",
      "--api-base-url",
      "https://example.test",
      "--run-id",
      "test-run",
    ],
    { cwd: process.cwd(), encoding: "utf8" },
  );

  assert.equal(result.status, 0, result.stderr);
  const summary = JSON.parse(result.stdout);
  assert.equal(summary.apiBaseUrl, "https://example.test");
});

test("showcase replay includes governed review and needs-map rows", () => {
  const result = spawnSync(
    process.execPath,
    [
      "scripts/replay-dynatrace-demo-data.mjs",
      "--environment-url",
      "https://your-environment-id.apps.dynatrace.com/",
      "--run-id",
      "test-showcase",
      "--showcase",
    ],
    { cwd: process.cwd(), encoding: "utf8" },
  );

  assert.equal(result.status, 0, result.stderr);
  const summary = JSON.parse(result.stdout);
  assert.equal(summary.showcase, true);
  assert.equal(summary.replayEvents, 100);
  assert.equal(summary.readyRows, 98);
  assert.equal(summary.reviewRows, 1);
  assert.equal(summary.needsMapRows, 1);
});

test("replays an explicit change-assurance dependency fixture", () => {
  const result = spawnSync(
    process.execPath,
    [
      "scripts/replay-dynatrace-demo-data.mjs",
      "--environment-url",
      "https://your-environment-id.apps.dynatrace.com/",
      "--run-id",
      "test-change-showcase",
      "--dependencies",
      "shared/demo-change-dependencies.json",
      "--fixture",
      "forward-change-showcase",
    ],
    { cwd: process.cwd(), encoding: "utf8" },
  );

  assert.equal(result.status, 0, result.stderr);
  const summary = JSON.parse(result.stdout);
  assert.equal(summary.fixture, "forward-change-showcase");
  assert.equal(summary.replayEvents, 10);
  assert.equal(summary.readyRows, 10);
  assert.equal(summary.dependenciesSource, "shared/demo-change-dependencies.json");
});

test("keeps the local ARM64 topology dependency in the Dynatrace substrate", () => {
  const result = spawnSync(
    process.execPath,
    [
      "scripts/replay-dynatrace-demo-data.mjs",
      "--environment-url",
      "https://your-environment-id.apps.dynatrace.com/",
      "--run-id",
      "test-local-arm64",
      "--dependencies",
      "shared/local-arm64-change-dependencies.json",
      "--fixture",
      "forward-change-local-arm64",
    ],
    { cwd: process.cwd(), encoding: "utf8" },
  );

  assert.equal(result.status, 0, result.stderr);
  const summary = JSON.parse(result.stdout);
  assert.equal(summary.fixture, "forward-change-local-arm64");
  assert.equal(summary.replayEvents, 1);
  assert.equal(summary.readyRows, 1);
});

test("customer flow uses neutral application dependency event names", () => {
  const result = spawnSync(
    process.execPath,
    [
      "scripts/replay-dynatrace-demo-data.mjs",
      "--environment-url",
      "https://your-environment-id.apps.dynatrace.com/",
      "--run-id",
      "change-assurance-20260712",
      "--dependencies",
      "shared/customer-trial-dependencies.json",
      "--fixture",
      "commerce-application-map",
      "--customer-flow",
    ],
    { cwd: process.cwd(), encoding: "utf8" },
  );

  assert.equal(result.status, 0, result.stderr);
  const summary = JSON.parse(result.stdout);
  assert.equal(summary.customerFlow, true);
  assert.equal(summary.provider, "forward-dynatrace");
  assert.equal(summary.eventType, "com.forward.application.dependency");
  assert.equal(summary.replayEvents, 24);
});
