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
