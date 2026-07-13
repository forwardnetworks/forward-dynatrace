import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";

import { buildCaptureEvidence } from "./build-demo-capture-evidence.mjs";

test("builds a complete production-shaped synthetic assurance portal", async (t) => {
  const outputDir = await mkdtemp(path.join(tmpdir(), "forward-dynatrace-capture-evidence-"));
  t.after(() => rm(outputDir, { recursive: true, force: true }));

  const evidence = await buildCaptureEvidence(outputDir);

  assert.deepEqual(
    Object.fromEntries(Object.entries(evidence).map(([key, rows]) => [key, rows.length > 0])),
    {
      ingestRows: true,
      networkRows: true,
      changeRows: true,
      healthRows: true,
      securityRows: true,
    },
  );
  assert.equal(
    evidence.ingestRows[0]["forward.dynatrace.import_state"],
    "reconciled",
  );
  assert.equal(evidence.ingestRows[0]["forward.dynatrace.count.unchanged"], 24);
  assert.equal(evidence.ingestRows[1]["forward.dynatrace.count.create"], 24);
  assert.equal(evidence.networkRows[0]["forward.dynatrace.count.blocked"], 12);
  assert.equal(evidence.networkRows[1]["forward.dynatrace.count.reachable"], 24);
  assert.deepEqual(
    evidence.changeRows.map((row) => row["forward.dynatrace.gate_decision"]),
    ["fail", "pass"],
  );
  assert.deepEqual(
    evidence.healthRows.map((row) => row["forward.dynatrace.transition"]),
    ["FAIL_TO_PASS", "PASS_TO_FAIL"],
  );
  assert.equal(evidence.securityRows[0].severity, "critical");
  assert.equal(evidence.securityRows[0]["forward.dynatrace.correlation_confidence"], "high");

  for (const rows of Object.values(evidence)) {
    for (const row of rows) {
      assert.equal(row["forward.dynatrace.synthetic"], true);
      assert.equal(
        row["forward.dynatrace.evidence_source"],
        "checked-servicenow-demo-rehearsal",
      );
    }
  }
});
