import assert from "node:assert/strict";
import test from "node:test";

import {
  normalizeDiscoveryRows,
  selectDiscoveryProfile,
  validateDependencyQuery,
} from "./dependency-discovery.mjs";

const now = new Date("2026-07-19T12:00:00.000Z");

const profile = (overrides = {}) => ({
  objectId: overrides.objectId || "profile-1",
  schemaId: "dependency-discovery-profile",
  value: {
    name: overrides.name || "Application non-production",
    status: overrides.status || "enabled",
    selection: overrides.selection || "default",
    query: overrides.query || "fetch spans, from: now()-15m | limit 100",
    maxResultRecords: "500",
    maxEvidenceAgeMinutes: "30",
  },
});

const row = (overrides = {}) => ({
  "dependency.id": "checkout-orders-443",
  "app.name": "Checkout",
  "app.environment": "non-production",
  "dt.entity.service": "SERVICE-CHECKOUT",
  "service.name": "checkout-api",
  "network.source": "192.0.2.10",
  "network.destination": "198.51.100.20",
  "network.protocol": "tcp",
  "network.port": 443,
  "owner.team": "commerce-platform",
  criticality: "critical",
  "dependency.confidence": 100,
  "dependency.mapping_state": "ready",
  "dependency.observed_at": "2026-07-19T11:55:00.000Z",
  "dependency.evidence_source": "dynatrace-live-spans",
  ...overrides,
});

test("accepts only spans-first tenant discovery queries", () => {
  assert.equal(
    validateDependencyQuery("// reviewed\nfetch spans, from: now()-15m | limit 100"),
    "// reviewed\nfetch spans, from: now()-15m | limit 100",
  );
  assert.throws(() => validateDependencyQuery("fetch events | limit 1"), /begin with fetch spans/u);
  assert.throws(
    () => validateDependencyQuery("fetch spans | append [ fetch logs ]"),
    /read only spans/u,
  );
  assert.throws(
    () => validateDependencyQuery("fetch spans | join [ fetch dt.entity.service ]"),
    /read only spans/u,
  );
  assert.throws(
    () => validateDependencyQuery('fetch spans | data record(a="substitute")'),
    /substitute records/u,
  );
});

test("selects one enabled default and never returns its DQL", () => {
  const selected = selectDiscoveryProfile([
    profile(),
    profile({ objectId: "profile-2", name: "Disabled", status: "disabled", selection: "available" }),
  ]);
  assert.equal(selected.profile.id, "profile-1");
  assert.equal(selected.profiles.length, 1);
  assert.equal(Object.hasOwn(selected.profiles[0], "query"), false);
});

test("requires an explicit selection when multiple enabled profiles have no default", () => {
  const selected = selectDiscoveryProfile([
    profile({ selection: "available" }),
    profile({ objectId: "profile-2", name: "Payments", selection: "available" }),
  ]);
  assert.equal(selected.profile, null);
  assert.equal(selected.reason, "profile-selection-required");
});

test("normalizes current real span rows and rejects stale or substitute evidence", () => {
  const normalized = normalizeDiscoveryRows([
    row(),
    row({ "dependency.id": "stale", "dependency.observed_at": "2026-07-19T10:00:00.000Z" }),
    row({ "dependency.id": "replay", "dependency.evidence_source": "captured-replay" }),
  ], { maxEvidenceAgeMinutes: 30, now });

  assert.equal(normalized.dependencies.length, 1);
  assert.equal(normalized.dependencies[0].mappingState, "ready");
  assert.equal(normalized.evidence.queriedRows, 3);
  assert.equal(normalized.evidence.rejectedRows, 2);
  assert.match(normalized.rejected[0].reason, /stale/u);
  assert.match(normalized.rejected[1].reason, /substitute/u);
});

test("fails closed to needs-map when live spans lack endpoint identity", () => {
  const normalized = normalizeDiscoveryRows([
    row({
      "dependency.id": "missing-endpoint",
      "dt.entity.service": "",
      "network.destination": "",
      "dependency.mapping_state": "ready",
    }),
  ], { maxEvidenceAgeMinutes: 30, now });

  assert.equal(normalized.dependencies.length, 1);
  assert.equal(normalized.dependencies[0].mappingState, "needs-map");
});

test("preserves low criticality and rejects malformed numeric values", () => {
  const normalized = normalizeDiscoveryRows([
    row({ criticality: "low" }),
    row({ "dependency.id": "bad-port", "network.port": "443x" }),
    row({ "dependency.id": "synthetic-number", "dependency.synthetic": 1 }),
  ], { maxEvidenceAgeMinutes: 30, now });

  assert.equal(normalized.dependencies[0].criticality, "low");
  assert.equal(normalized.rejected.length, 2);
  assert.match(normalized.rejected[0].reason, /integer/u);
  assert.match(normalized.rejected[1].reason, /synthetic/u);
});
