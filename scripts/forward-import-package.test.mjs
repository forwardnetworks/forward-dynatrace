import assert from "node:assert/strict";
import { test } from "node:test";

import {
  fingerprintCheck,
  reconcileChecks,
  reconciliationKey,
  validatePlannedChecks,
} from "./forward-import-package.mjs";

const baseCheck = {
  definition: {
    checkType: "Existential",
    filters: {
      from: {
        location: { type: "HostFilter", value: "checkout-vip" },
        headers: [
          { type: "PacketFilter", values: { ip_proto: ["6"] } },
          { type: "PacketFilter", values: { tp_dst: ["443"] } },
        ],
      },
      to: { location: { type: "HostFilter", value: "orders-db" } },
      flowTypes: ["VALID"],
    },
    headerFieldsWithDefaults: ["url"],
    noiseTypes: [],
    returnPath: "ANY",
  },
  enabled: true,
  name: "[Dynatrace] Checkout prod: checkout-vip -> orders-db tcp/443",
  note: "Generated from Dynatrace service checkout-api",
  priority: "HIGH",
  tags: [
    "dynatrace",
    "app:Checkout",
    "environment:prod",
    "owner:commerce-platform",
    "dynatrace-key:dt:checkout:prod:service-123:checkout-vip:orders-db:tcp:443",
  ],
};

const withResultFields = (check) => ({
  ...check,
  id: "check-1",
  createdAt: "2026-01-01T00:00:00Z",
  definedAt: "2026-01-01T00:00:00Z",
  executedAt: "2026-01-01T00:01:00Z",
  status: "PASS",
});

test("uses the dynatrace-key tag as the reconciliation key", () => {
  assert.equal(
    reconciliationKey(baseCheck),
    "dynatrace-key:dt:checkout:prod:service-123:checkout-vip:orders-db:tcp:443",
  );
});

test("ignores Forward result-only fields when comparing fingerprints", () => {
  assert.equal(fingerprintCheck(baseCheck), fingerprintCheck(withResultFields(baseCheck)));
});

test("classifies matching generated checks as unchanged", () => {
  const result = reconcileChecks([baseCheck], [withResultFields(baseCheck)]);

  assert.equal(result.create.length, 0);
  assert.equal(result.unchanged.length, 1);
  assert.equal(result.changed.length, 0);
  assert.equal(result.stale.length, 0);
});

test("classifies missing planned checks as create", () => {
  const result = reconcileChecks([baseCheck], []);

  assert.equal(result.create.length, 1);
  assert.equal(result.unchanged.length, 0);
  assert.equal(result.changed.length, 0);
  assert.equal(result.stale.length, 0);
});

test("classifies same-key definition drift as changed", () => {
  const existing = structuredClone(baseCheck);
  existing.definition.filters.from.headers[1].values.tp_dst = ["8443"];
  existing.id = "check-1";

  const result = reconcileChecks([baseCheck], [existing]);

  assert.equal(result.create.length, 0);
  assert.equal(result.changed.length, 1);
  assert.deepEqual(result.changed[0].fields, ["definition"]);
});

test("classifies managed checks missing from the package as stale", () => {
  const result = reconcileChecks([], [withResultFields(baseCheck), { name: "user-owned" }]);

  assert.equal(result.stale.length, 1);
  assert.equal(result.stale[0].id, "check-1");
});

test("accepts a valid generated intent package", () => {
  assert.doesNotThrow(() => validatePlannedChecks([baseCheck]));
});

test("rejects package entries without exactly one dynatrace reconciliation key", () => {
  const missingKey = { ...baseCheck, tags: ["dynatrace"] };
  const duplicateKey = {
    ...baseCheck,
    tags: [...baseCheck.tags, "dynatrace-key:duplicate"],
  };

  assert.throws(
    () => validatePlannedChecks([missingKey, duplicateKey]),
    /tags must contain exactly one dynatrace-key:\* tag/,
  );
});

test("rejects duplicate generated check names and dynatrace keys", () => {
  const duplicate = structuredClone(baseCheck);

  assert.throws(
    () => validatePlannedChecks([baseCheck, duplicate]),
    /duplicates check\[0\]/,
  );
});

test("rejects unsupported Forward check types", () => {
  const unsupported = structuredClone(baseCheck);
  unsupported.definition.checkType = "Path";

  assert.throws(
    () => validatePlannedChecks([unsupported]),
    /definition\.checkType must be one of Existential/,
  );
});
