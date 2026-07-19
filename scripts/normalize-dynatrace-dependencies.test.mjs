import assert from "node:assert/strict";
import { test } from "node:test";

import { normalizeDynatraceRows } from "./normalize-dynatrace-dependencies.mjs";

const liveRows = [{
  "app.name": "Instrumented Application",
  "app.environment": "test",
  "dt.entity.service": "SERVICE-INSTRUMENTED-1",
  "service.name": "checkout",
  "network.source.label": "client-01",
  "network.source": "192.0.2.10/32",
  "network.destination.label": "checkout-api",
  "network.destination": "198.51.100.20/32",
  "network.protocol": "tcp",
  "network.port": "443",
  "dependency.confidence": "100",
  "dependency.mapping_state": "ready",
  "evidence.synthetic": false,
}];

test("normalizes DQL-shaped rows into dependency candidates", () => {
  const dependencies = normalizeDynatraceRows(liveRows);

  assert.equal(dependencies.length, 1);
  assert.equal(dependencies[0].appName, "Instrumented Application");
  assert.equal(dependencies[0].serviceEntityId, "SERVICE-INSTRUMENTED-1");
  assert.equal(dependencies[0].protocol, "tcp");
  assert.equal(dependencies[0].source, "192.0.2.10/32");
  assert.equal(dependencies[0].destination, "198.51.100.20/32");
  assert.equal(dependencies[0].mappingState, "ready");
  assert.equal(dependencies[0].synthetic, undefined);
});

test("honors explicit dependency mapping state from DQL rows", () => {
  const [dependency] = normalizeDynatraceRows([
    {
      "app.name": "Instrumented Application",
      "app.environment": "test",
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
      "evidence.synthetic": false,
    },
  ]);

  assert.equal(dependency.mappingState, "ready");
  assert.equal(dependency.synthetic, undefined);
  assert.equal(dependency.sourceLabel, "branch-01");
  assert.equal(dependency.destinationLabel, "checkout-api");
});

test("rejects replay, seeded, fixture, and synthetic provenance", () => {
  const baseRow = {
    "dt.entity.service": "SERVICE-SEEDED",
    "network.source": "10.0.0.10/32",
    "network.destination": "10.0.0.20/32",
    "network.port": "443",
    "forward.dynatrace.seeded": "true",
  };
  assert.throws(() => normalizeDynatraceRows([baseRow]), /live-only normalization rejected/);
  assert.throws(
    () => normalizeDynatraceRows([{ ...baseRow, "forward.dynatrace.seeded": "unknown" }]),
    /must be a boolean when supplied/,
  );
  assert.throws(
    () => normalizeDynatraceRows([{
      ...baseRow,
      "evidence.synthetic": false,
    }]),
    /live-only normalization rejected/,
  );

  assert.throws(() => normalizeDynatraceRows([{
    ...baseRow,
    "forward.dynatrace.seeded": undefined,
    "event.provider": "forward-dynatrace-replay",
  }]), /live-only normalization rejected/);

  assert.throws(() => normalizeDynatraceRows([{
    ...baseRow,
    "forward.dynatrace.seeded": undefined,
    "evidence.replay": "true",
  }]), /live-only normalization rejected/);
});

test("rejects non-array input", () => {
  assert.throws(() => normalizeDynatraceRows({}), /JSON array/);
});
