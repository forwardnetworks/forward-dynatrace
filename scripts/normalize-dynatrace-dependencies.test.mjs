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
  assert.equal(dependencies[0].source, "192.168.10.14/32");
  assert.equal(dependencies[0].destination, "192.168.10.16/32");
  assert.equal(dependencies[0].mappingState, "ready");
  assert.equal(
    dependencies.filter((dependency) => dependency.mappingState === "ready").length,
    100,
  );
  assert.ok(
    dependencies.some((dependency) =>
      dependency.source === "192.168.10.14/32" &&
      dependency.destination === "192.168.10.16/32" &&
      dependency.serviceEntityId === "SERVICE-95D96EDE93AA13DB",
    ),
  );
});

test("honors explicit dependency mapping state from DQL rows", () => {
  const [dependency] = normalizeDynatraceRows([
    {
      "app.name": "Dynatrace Demo",
      "app.environment": "demo",
      "dt.entity.service": "SERVICE-EXPLICIT",
      "service.name": "checkout",
      "network.source.label": "branch-01",
      "network.source": "10.0.0.10/32",
      "network.destination.label": "checkout-api",
      "network.destination": "10.0.0.20/32",
      "network.protocol": "tcp",
      "network.port": "443",
      "dependency.confidence": "80",
      "dependency.mapping_state": "ready",
      "demo.synthetic": true,
    },
  ]);

  assert.equal(dependency.mappingState, "ready");
  assert.equal(dependency.synthetic, true);
  assert.equal(dependency.sourceLabel, "branch-01");
  assert.equal(dependency.destinationLabel, "checkout-api");
});

test("preserves replay provenance and rejects ambiguous synthetic markers", () => {
  const baseRow = {
    "dt.entity.service": "SERVICE-SEEDED",
    "network.source": "10.0.0.10/32",
    "network.destination": "10.0.0.20/32",
    "network.port": "443",
    "forward.dynatrace.seeded": "true",
  };
  const [dependency] = normalizeDynatraceRows([baseRow]);
  assert.equal(dependency.synthetic, true);
  assert.throws(
    () => normalizeDynatraceRows([{ ...baseRow, "forward.dynatrace.seeded": "unknown" }]),
    /must be a boolean when supplied/,
  );
  assert.throws(
    () => normalizeDynatraceRows([{
      ...baseRow,
      "demo.synthetic": false,
    }]),
    /conflicting live and synthetic provenance markers/,
  );

  const [providerMarked] = normalizeDynatraceRows([{
    ...baseRow,
    "forward.dynatrace.seeded": undefined,
    "event.provider": "forward-dynatrace-demo",
  }]);
  assert.equal(providerMarked.synthetic, true);

  const [replayMarked] = normalizeDynatraceRows([{
    ...baseRow,
    "forward.dynatrace.seeded": undefined,
    "demo.replay": "true",
  }]);
  assert.equal(replayMarked.synthetic, true);
});

test("rejects non-array input", () => {
  assert.throws(() => normalizeDynatraceRows({}), /JSON array/);
});
