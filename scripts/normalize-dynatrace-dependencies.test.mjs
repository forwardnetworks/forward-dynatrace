import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { test } from "node:test";

import { normalizeDynatraceRows } from "./normalize-dynatrace-dependencies.mjs";

const demoRows = JSON.parse(
  await readFile("shared/demo-dynatrace-query-rows.json", "utf8"),
);

test("normalizes DQL-shaped rows into dependency candidates", () => {
  const dependencies = normalizeDynatraceRows(demoRows);

  assert.equal(dependencies.length, 4);
  assert.equal(dependencies[0].appName, "Checkout");
  assert.equal(dependencies[0].serviceEntityId, "SERVICE-DEMO-CHECKOUT");
  assert.equal(dependencies[0].protocol, "tcp");
  assert.equal(dependencies[0].mappingState, "ready");
  assert.equal(dependencies[2].mappingState, "review");
  assert.equal(dependencies[3].mappingState, "needs-map");
});

test("rejects non-array input", () => {
  assert.throws(() => normalizeDynatraceRows({}), /JSON array/);
});
