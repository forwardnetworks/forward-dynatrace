import assert from "node:assert/strict";
import test from "node:test";

import {
  findMatchingExecution,
  parseExecutionContext,
  sanitizeReadback,
} from "./query-dynatrace-guardian-execution.mjs";

const execution = {
  id: "5b58cf7c-1712-4faf-a458-ca2522576abd",
  state: "SUCCESS",
  startedAt: "2026-07-17T21:22:11Z",
  endedAt: "2026-07-17T21:22:48Z",
  params: {
    event: {
      "forward.dynatrace.gate_decision": "pass",
      execution_context: JSON.stringify({
        correlationId: "gate-run-001",
        gateRunId: "gate-run-001",
        changeId: "CHG0000006",
        deploymentId: "network-change-recovery",
        network: {
          networkId: "12345",
          beforeSnapshotId: "67890",
          afterSnapshotId: "67891",
        },
      }),
    },
  },
};

const task = {
  state: "SUCCESS",
  startedAt: "2026-07-17T21:22:42Z",
  endedAt: "2026-07-17T21:22:48Z",
  result: {
    validation_id: "4828ae93-42e2-4164-8a9b-89c0b6eee460",
    validation_status: "pass",
    validation_summary: { pass: 4, warning: 0, fail: 0, error: 0, info: 2 },
    validation_details: [
      { name: "Forward validation evidence", value: 1, status: "pass", target: 1 },
    ],
  },
};

test("parses string and object execution context", () => {
  const parsed = parseExecutionContext(execution);
  assert.equal(parsed.changeId, "CHG0000006");
  assert.deepEqual(parseExecutionContext({ params: { event: { execution_context: parsed } } }), parsed);
});

test("finds execution by trigger correlation", () => {
  assert.equal(findMatchingExecution([{ id: "other" }, execution], "gate-run-001"), execution);
});

test("joins trigger context with Guardian action result", () => {
  const output = sanitizeReadback(execution, task);
  assert.equal(output.correlationId, "gate-run-001");
  assert.equal(output.validationStatus, "pass");
  assert.equal(output.validationSummary.pass, 4);
  assert.equal(output.waitBeforeSeconds, 31);
  assert.equal(output.afterSnapshotId, "67891");
  assert.equal(output.objectives[0].name, "Forward validation evidence");
});
