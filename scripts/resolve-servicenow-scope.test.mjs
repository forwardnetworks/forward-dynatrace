import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { test } from "node:test";

import {
  resolveScopeMapping,
  validateScopeMapping,
} from "./resolve-servicenow-scope.mjs";

const sourceA = { table: "cmdb_ci_service", sysId: "11111111111111111111111111111111" };
const sourceB = { table: "cmdb_ci", sysId: "22222222222222222222222222222222" };

const mappingEntry = ({
  id,
  sourceRecord,
  serviceEntityId,
  confidence = 0.99,
  status = "reviewed",
  observedAt = "2026-01-01T00:00:00.000Z",
  expiresAt = "2027-01-01T00:00:00.000Z",
} = {}) => ({
  mappingEntryId: id,
  sourceRecord,
  serviceEntityIds: [serviceEntityId],
  forwardEndpoints: [{
    serviceEntityId,
    locationType: "HostFilter",
    value: `${serviceEntityId.toLowerCase()}.nonprod.example.com`,
  }],
  confidence,
  status,
  observedAt,
  expiresAt,
});

const baseMapping = () => ({
  schemaVersion: "forward-dynatrace-servicenow-scope-mapping/v1",
  mappingId: "customer-nonprod-scope-v1",
  environment: {
    environmentId: "customer-nonproduction",
    serviceNowInstanceAlias: "customer-itsm",
    dynatraceEnvironmentAlias: "customer-observability",
    forwardNetworkId: "network-nonproduction",
  },
  owner: { team: "integration-operations", contact: "integration@example.com" },
  observedAt: "2026-01-01T00:00:00.000Z",
  expiresAt: "2027-01-01T00:00:00.000Z",
  minimumConfidence: 0.95,
  mappings: [
    mappingEntry({ id: "service-a-v1", sourceRecord: sourceA, serviceEntityId: "SERVICE-A" }),
    mappingEntry({ id: "service-b-v1", sourceRecord: sourceB, serviceEntityId: "SERVICE-B" }),
  ],
});

const resolve = (overrides = {}) => resolveScopeMapping({
  mapping: baseMapping(),
  environmentId: "customer-nonproduction",
  sourceRecords: [sourceB, sourceA],
  asOf: "2026-07-15T18:30:00.000Z",
  ...overrides,
});

test("resolves a deterministic environment-bound scope without external I/O", () => {
  const first = resolve();
  const second = resolve({ sourceRecords: [sourceA, sourceB] });
  assert.deepEqual(first, second);
  assert.equal(first.schemaVersion, "forward-dynatrace-servicenow-scope-resolution/v1");
  assert.equal(first.mappingId, "customer-nonprod-scope-v1");
  assert.equal(first.mappingSha256.length, 64);
  assert.equal(first.forwardNetworkId, "network-nonproduction");
  assert.deepEqual(first.serviceEntityIds, ["SERVICE-A", "SERVICE-B"]);
  assert.deepEqual(first.sourceRecords, [sourceB, sourceA]);
  assert.equal(first.forwardEndpoints.length, 2);
  assert.equal(first.validity.lowestConfidence, 0.99);
  assert.deepEqual(Object.keys(first).includes("credentials"), false);
});

test("fails closed for a missing affected-record mapping", () => {
  assert.throws(
    () => resolve({
      sourceRecords: [{ table: "cmdb_ci", sysId: "33333333333333333333333333333333" }],
    }),
    /No reviewed scope mapping exists/,
  );
});

test("rejects duplicate requested records", () => {
  assert.throws(
    () => resolve({ sourceRecords: [sourceA, sourceA] }),
    /must contain unique table and sys_id pairs/,
  );
});

test("rejects ambiguous duplicate source mappings", () => {
  const mapping = baseMapping();
  mapping.mappings.push(mappingEntry({
    id: "service-a-duplicate",
    sourceRecord: sourceA,
    serviceEntityId: "SERVICE-A-OTHER",
  }));
  assert.throws(
    () => validateScopeMapping(mapping),
    /Ambiguous scope mapping.*appears more than once/,
  );
});

test("rejects stale mapping and stale entry validity", () => {
  const mapping = baseMapping();
  mapping.expiresAt = "2026-07-01T00:00:00.000Z";
  mapping.mappings = mapping.mappings.map((entry) => ({
    ...entry,
    expiresAt: "2026-07-01T00:00:00.000Z",
  }));
  assert.throws(
    () => resolve({ mapping }),
    /Scope mapping is stale or not yet valid/,
  );

  const entryStale = baseMapping();
  entryStale.mappings[0].expiresAt = "2026-07-01T00:00:00.000Z";
  assert.throws(
    () => resolve({ mapping: entryStale, sourceRecords: [sourceA] }),
    /service-a-v1 is stale or not yet valid/,
  );
});

test("rejects low-confidence and disabled mappings", () => {
  const lowConfidence = baseMapping();
  lowConfidence.mappings[0].confidence = 0.94;
  assert.throws(
    () => resolve({ mapping: lowConfidence, sourceRecords: [sourceA] }),
    /confidence 0.94 is below minimum 0.95/,
  );

  const disabled = baseMapping();
  disabled.mappings[0].status = "disabled";
  assert.throws(
    () => resolve({ mapping: disabled, sourceRecords: [sourceA] }),
    /service-a-v1 is disabled/,
  );
});

test("rejects a cross-environment request", () => {
  assert.throws(
    () => resolve({ environmentId: "production" }),
    /environment mismatch.*production.*customer-nonproduction/,
  );
});

test("rejects incomplete or unrelated Forward endpoint mappings", () => {
  const missing = baseMapping();
  missing.mappings[0].forwardEndpoints = [{
    serviceEntityId: "SERVICE-OTHER",
    locationType: "HostFilter",
    value: "other.example.com",
  }];
  assert.throws(
    () => resolve({ mapping: missing, sourceRecords: [sourceA] }),
    /must map every and only declared serviceEntityIds/,
  );
});

test("CLI writes a schema-valid resolution artifact", async () => {
  const temp = await mkdtemp(path.join(tmpdir(), "servicenow-scope-resolution-"));
  const mappingPath = path.join(temp, "mapping.json");
  const outputPath = path.join(temp, "resolution.json");
  await writeFile(mappingPath, `${JSON.stringify(baseMapping(), null, 2)}\n`);
  const result = spawnSync(process.execPath, [
    "scripts/resolve-servicenow-scope.mjs",
    "--mapping", mappingPath,
    "--environment-id", "customer-nonproduction",
    "--source-record", `cmdb_ci_service:${sourceA.sysId}`,
    "--as-of", "2026-07-15T18:30:00.000Z",
    "--output", outputPath,
  ], { cwd: process.cwd(), encoding: "utf8" });
  assert.equal(result.status, 0, result.stderr);
  assert.deepEqual(JSON.parse(result.stdout), JSON.parse(await readFile(outputPath, "utf8")));

  const validation = spawnSync(process.execPath, [
    "scripts/schema-validate.mjs",
    "--servicenow-scope-resolution", outputPath,
  ], { cwd: process.cwd(), encoding: "utf8" });
  assert.equal(validation.status, 0, validation.stderr || validation.stdout);
});
