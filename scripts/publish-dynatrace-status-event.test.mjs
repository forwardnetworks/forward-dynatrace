import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { test } from "node:test";

import {
  publishStatusEvent,
  toOpenPipelineApiBaseUrl,
  toOpenPipelineEventRecord,
  validateStatusEvent,
} from "./publish-dynatrace-status-event.mjs";

const baseEvent = {
  schemaVersion: "forward-dynatrace-status-event/v1",
  timestamp: "2026-01-01T00:00:00.000Z",
  eventType: "forward.dynatrace.ingest.status",
  severity: "INFO",
  title: "forward.dynatrace ingest reconciled",
  properties: {
    "forward.dynatrace.run_id": "forward-dynatrace-20260101000000",
    "forward.dynatrace.package_id": "dynatrace-forward-demo",
    "forward.dynatrace.import_state": "reconciled",
    "forward.dynatrace.planned_checks": 100,
  },
};

test("maps Apps URL to live OpenPipeline ingest origin", () => {
  assert.equal(
    toOpenPipelineApiBaseUrl("https://your-environment-id.apps.dynatrace.com/"),
    "https://your-environment-id.live.dynatrace.com",
  );
});

test("validates status event schema and rejects credential-like content", () => {
  assert.equal(validateStatusEvent(baseEvent).eventType, "forward.dynatrace.ingest.status");
  assert.throws(
    () =>
      validateStatusEvent({
        ...baseEvent,
        properties: {
          ...baseEvent.properties,
          token: "Bearer abcdef",
        },
      }),
    /forbidden credential-like content/,
  );
});

test("converts status event to OpenPipeline event record", () => {
  const record = toOpenPipelineEventRecord(baseEvent, "publisher-run");

  assert.equal(record["event.provider"], "forward-dynatrace");
  assert.equal(record["event.type"], "forward.dynatrace.ingest.status");
  assert.equal(record["forward.dynatrace.publisher_run_id"], "publisher-run");
  assert.equal(record["forward.dynatrace.planned_checks"], 100);
});

test("publishes one status event record with bearer auth", async () => {
  const calls = [];
  const fetchImpl = async (url, options) => {
    calls.push({ url, options });
    return {
      ok: true,
      status: 202,
      text: async () => "",
    };
  };

  const result = await publishStatusEvent({
    event: baseEvent,
    environmentUrl: "https://your-environment-id.apps.dynatrace.com/",
    token: "test-token",
    publisherRunId: "publisher-run",
    fetchImpl,
  });

  assert.equal(result.responseStatus, 202);
  assert.equal(calls.length, 1);
  assert.equal(
    calls[0].url,
    "https://your-environment-id.live.dynatrace.com/platform/ingest/v1/events",
  );
  assert.equal(calls[0].options.headers.Authorization, "Bearer test-token");
  assert.equal(JSON.parse(calls[0].options.body).length, 1);
});

test("dry-run CLI emits publish plan without requiring a token", async () => {
  const workdir = await mkdtemp(path.join(tmpdir(), "forward-status-event-"));
  const eventPath = path.join(workdir, "event.json");
  await writeFile(eventPath, JSON.stringify(baseEvent, null, 2) + "\n");

  const result = spawnSync(
    process.execPath,
    [
      "scripts/publish-dynatrace-status-event.mjs",
      "--event",
      eventPath,
      "--environment-url",
      "https://your-environment-id.apps.dynatrace.com/",
      "--run-id",
      "publisher-run",
    ],
    { cwd: process.cwd(), encoding: "utf8" },
  );

  assert.equal(result.status, 0, result.stderr);
  const summary = JSON.parse(result.stdout);
  assert.equal(summary.mode, "dry-run");
  assert.equal(summary.apiBaseUrl, "https://your-environment-id.live.dynatrace.com");
  assert.equal(summary.endpoint, "/platform/ingest/v1/events");
  assert.equal(summary.requiredScope, "openpipeline:events:ingest");
  assert.equal(summary.eventType, "forward.dynatrace.ingest.status");
  assert.equal(summary.plannedChecks, 100);
});
