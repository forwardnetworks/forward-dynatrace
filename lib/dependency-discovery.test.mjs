import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import {
  normalizeDiscoveryRows,
  selectDiscoveryProfile,
  validateDependencyQuery,
} from "./dependency-discovery.ts";

const now = new Date("2026-07-19T12:00:00.000Z");

const profile = (overrides = {}) => ({
  objectId: overrides.objectId || "profile-1",
  schemaId: "dependency-discovery-profile",
  value: {
    name: overrides.name || "Application non-production",
    status: overrides.status || "enabled",
    selection: overrides.selection || "default",
    sourceType: overrides.sourceType || "distributed-traces",
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

test("restricts distributed trace profiles to spans", () => {
  assert.equal(
    validateDependencyQuery(
      "// reviewed\nfetch spans, from: now()-15m | limit 100",
      "distributed-traces",
    ),
    "// reviewed\nfetch spans, from: now()-15m | limit 100",
  );
  assert.throws(
    () => validateDependencyQuery("fetch events | limit 1", "distributed-traces"),
    /begin with fetch spans/u,
  );
  assert.throws(
    () => validateDependencyQuery(
      "fetch spans | append [ fetch logs ]",
      "distributed-traces",
    ),
    /read only spans/u,
  );
  assert.throws(
    () => validateDependencyQuery(
      "fetch spans | join [ fetch dt.entity.service ]",
      "distributed-traces",
    ),
    /read only spans/u,
  );
  assert.throws(
    () => validateDependencyQuery(
      'fetch spans | data record(a="substitute")',
      "distributed-traces",
    ),
    /substitute records/u,
  );
});

test("restricts network flow profiles to the OneAgent network-flow bucket", () => {
  const query = '// reviewed\nfetch events, bucket:{"default_network_flows"} | limit 100';
  assert.equal(validateDependencyQuery(query, "network-flows"), query);
  assert.throws(
    () => validateDependencyQuery("fetch events | limit 1", "network-flows"),
    /default_network_flows/u,
  );
  assert.throws(
    () => validateDependencyQuery(
      'fetch events, bucket:{"default_network_flows"} | append [ fetch events, bucket:{"default_logs"} ]',
      "network-flows",
    ),
    /default_network_flows bucket/u,
  );
  assert.throws(
    () => validateDependencyQuery(
      'fetch events, bucket:{"default_network_flows"} | join [ fetch spans ]',
      "network-flows",
    ),
    /only network-flow events/u,
  );
});

test("selects one enabled default and never returns its DQL", () => {
  const selected = selectDiscoveryProfile([
    profile(),
    profile({ objectId: "profile-2", name: "Disabled", status: "disabled", selection: "available" }),
  ]);
  assert.equal(selected.profile.id, "profile-1");
  assert.equal(selected.profiles.length, 1);
  assert.equal(selected.profiles[0].sourceType, "distributed-traces");
  assert.equal(Object.hasOwn(selected.profiles[0], "query"), false);
});

test("rejects profiles without an explicit discovery source", () => {
  const missingSource = profile();
  delete missingSource.value.sourceType;
  assert.throws(() => selectDiscoveryProfile([missingSource]), /source type is invalid/u);
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

test("ships a stable, endpoint-complete 1,000-row span discovery query", async () => {
  const query = await readFile(
    new URL("../deploy/dynatrace-dql/otel-span-dependencies.dql", import.meta.url),
    "utf8",
  );

  assert.equal(validateDependencyQuery(query, "distributed-traces"), query.trim());
  assert.match(query, /toString\(`forward\.dependency\.id`\)/u);
  assert.match(query, /`forward\.network\.source\.address`/u);
  assert.match(query, /`forward\.network\.destination\.address`/u);
  assert.match(query, /\| dedup `dependency\.id`/u);
  assert.match(query, /\| limit 1000\s*$/u);
});
