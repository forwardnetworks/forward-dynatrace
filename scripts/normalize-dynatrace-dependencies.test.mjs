import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { test } from "node:test";

import { normalizeDynatraceRows } from "./normalize-dynatrace-dependencies.mjs";

const demoRows = JSON.parse(
  await readFile("shared/demo-dynatrace-query-rows.json", "utf8"),
);

test("normalizes DQL-shaped rows into dependency candidates", () => {
  const dependencies = normalizeDynatraceRows(demoRows);

  assert.equal(dependencies.length, 100);
  assert.equal(dependencies[0].appName, "Dynatrace Demo");
  assert.equal(dependencies[0].serviceEntityId, "SERVICE-00677FCCD8F24235");
  assert.equal(dependencies[0].protocol, "tcp");
  assert.equal(dependencies[0].mappingState, "review");
  assert.equal(
    dependencies.filter((dependency) => dependency.mappingState === "review").length,
    100,
  );
  assert.ok(
    dependencies.some((dependency) =>
      dependency.source === "frontend-web" &&
      dependency.destination === "frontend-proxy" &&
      dependency.serviceEntityId === "SERVICE-95D96EDE93AA13DB",
    ),
  );
});

test("rejects non-array input", () => {
  assert.throws(() => normalizeDynatraceRows({}), /JSON array/);
});
