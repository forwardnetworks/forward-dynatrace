import assert from "node:assert/strict";
import test from "node:test";

import exportForwardPackage from "../actions/export-forward-package.logic.mjs";

const dependency = {
  id: "checkout-orders",
  appName: "Checkout",
  environment: "prod",
  serviceEntityId: "SERVICE-CHECKOUT",
  serviceName: "checkout-api",
  source: "10.0.0.1",
  destination: "10.0.0.2",
  protocol: "tcp",
  port: "443",
  owner: "commerce-platform",
  criticality: "critical",
  confidence: 100,
  mappingState: "ready",
};

test("workflow action returns exact package artifacts from object input", async () => {
  const result = await exportForwardPackage({
    request: { syncMode: "data-connector", dependencies: [dependency] },
  });
  assert.equal(result.status, "ready");
  assert.equal(result.intentCheckCount, 1);
  assert.equal(result.boundary, "dynatrace-never-writes-forward");
  assert.equal(JSON.parse(result.artifacts.manifest).packageId, result.packageId);
  assert.equal(JSON.parse(result.artifacts.intentChecks).length, 1);
});

test("workflow action accepts expression-resolved JSON text", async () => {
  const result = await exportForwardPackage({
    request: JSON.stringify({ syncMode: "manual-import", dependencies: [dependency] }),
  });
  assert.equal(result.intentCheckCount, 1);
});

test("workflow action rejects empty export scope", async () => {
  await assert.rejects(
    exportForwardPackage({ request: { syncMode: "data-connector", dependencies: [] } }),
    /No dependency rows selected/,
  );
});
