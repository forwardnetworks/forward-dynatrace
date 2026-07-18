import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { test } from "node:test";

import {
  buildNetworkEvidenceEvent,
  publishNetworkEvidenceEvent,
  toOpenPipelineNetworkEvidenceRecord,
} from "./publish-dynatrace-network-evidence.mjs";

const baseEvidence = {
  schemaVersion: "forward-dynatrace-path-evidence/v1",
  generatedAt: "2026-01-01T00:00:00.000Z",
  source: "forward-path-search-bulk",
  modeledReachabilityAssessment: "consistent-with-network-policy-block",
  target: { networkId: "network-1", snapshotId: "snapshot-1" },
  counts: {
    total: 2,
    queryable: 2,
    reachable: 1,
    blocked: 1,
    ambiguous: 0,
    unmapped: 0,
    failed: 0,
  },
  rows: [
    {
      id: "private-dependency-id",
      status: "reachable",
      queryUrl: "https://forward.example.com/private-path",
      forwardingOutcomes: ["DELIVERED"],
      securityOutcomes: ["PERMITTED"],
      maxHopCount: 3,
    },
    {
      id: "another-private-id",
      status: "blocked",
      queryUrl: "https://forward.example.com/another-private-path",
      forwardingOutcomes: ["DELIVERED"],
      securityOutcomes: ["DENIED"],
      maxHopCount: 4,
    },
  ],
};

const liveEvidence = {
  ...baseEvidence,
  mode: "execute",
  modeledReachabilityAssessment: "no-modeled-policy-block",
  counts: { ...baseEvidence.counts, reachable: 2, blocked: 0 },
};

test("builds aggregate problem evidence without topology details", () => {
  const event = buildNetworkEvidenceEvent(baseEvidence, {
    problemId: "P-DEMO-001",
    serviceEntityId: "SERVICE-DEMO",
    runId: "diagnosis-run",
  });
  assert.equal(event.severity, "WARN");
  assert.equal(
    event.properties["forward.dynatrace.network_assessment"],
    "consistent-with-network-policy-block",
  );
  assert.equal(event.properties["forward.dynatrace.count.blocked"], 1);
  assert.equal(event.properties["forward.dynatrace.max_hop_count"], 4);
  const text = JSON.stringify(event);
  assert.equal(text.includes("private-dependency-id"), false);
  assert.equal(text.includes("private-path"), false);
});

test("marks executed Forward path evidence explicitly live", () => {
  const event = buildNetworkEvidenceEvent(liveEvidence, {
    problemId: "FWD-LIVE-SNAPSHOT-1",
    serviceEntityId: "SERVICE-LIVE",
    runId: "live-network-run",
  });
  assert.equal(event.properties["forward.dynatrace.evidence_source"], "forward-path-search-bulk");
  assert.equal(event.properties["forward.dynatrace.synthetic"], false);
});

test("converts and publishes one OpenPipeline event record", async () => {
  const event = buildNetworkEvidenceEvent(baseEvidence, {
    problemId: "P-DEMO-001",
    runId: "diagnosis-run",
  });
  const record = toOpenPipelineNetworkEvidenceRecord(event);
  assert.equal(record["event.type"], "forward.dynatrace.network.evidence");
  const calls = [];
  const result = await publishNetworkEvidenceEvent({
    event,
    apiBaseUrl: "https://your-environment-id.live.dynatrace.com",
    token: "test-token",
    fetchImpl: async (url, options) => {
      calls.push({ url, options });
      return { ok: true, status: 202, text: async () => "" };
    },
  });
  assert.equal(result.responseStatus, 202);
  assert.equal(calls.length, 1);
  assert.equal(JSON.parse(calls[0].options.body).length, 1);
});

test("CLI writes a sanitized dry-run event artifact", async () => {
  const workdir = await mkdtemp(path.join(tmpdir(), "forward-network-evidence-"));
  const evidencePath = path.join(workdir, "evidence.json");
  const eventPath = path.join(workdir, "event.json");
  await writeFile(evidencePath, `${JSON.stringify(baseEvidence, null, 2)}\n`);
  const result = spawnSync(
    process.execPath,
    [
      "scripts/publish-dynatrace-network-evidence.mjs",
      "--evidence",
      evidencePath,
      "--problem-id",
      "P-DEMO-001",
      "--environment-url",
      "https://your-environment-id.apps.dynatrace.com/",
      "--output",
      eventPath,
    ],
    { cwd: process.cwd(), encoding: "utf8" },
  );
  assert.equal(result.status, 0, result.stderr);
  const summary = JSON.parse(result.stdout);
  assert.equal(summary.mode, "dry-run");
  assert.equal(summary.assessment, "consistent-with-network-policy-block");
  const event = JSON.parse(await readFile(eventPath, "utf8"));
  assert.equal(event.eventType, "forward.dynatrace.network.evidence");
  assert.equal(JSON.stringify(event).includes("private-path"), false);
});
