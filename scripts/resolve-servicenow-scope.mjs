#!/usr/bin/env node

import { createHash } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { pathToFileURL } from "node:url";

const MAPPING_SCHEMA = "forward-dynatrace-servicenow-scope-mapping/v1";
const RESOLUTION_SCHEMA = "forward-dynatrace-servicenow-scope-resolution/v1";
const IDENTIFIER_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/u;
const TABLE_PATTERN = /^[a-z][a-z0-9_]{0,79}$/u;
const SYS_ID_PATTERN = /^[0-9a-f]{32}$/u;
const LOCATION_TYPES = new Set(["HostFilter", "SubnetLocationFilter", "DeviceFilter"]);
const MAX_SOURCE_RECORDS = 100;

const usage = `
Resolve ServiceNow affected records into Dynatrace and Forward scope

Usage:
  npm run servicenow:scope:resolve -- \\
    --mapping /secure/config/servicenow-scope-mapping.json \\
    --environment-id customer-nonproduction \\
    --source-record cmdb_ci_service:0123456789abcdef0123456789abcdef \\
    --as-of 2026-07-15T18:30:00.000Z \\
    --output /secure/evidence/servicenow-scope-resolution.json

Options:
  --mapping path          Versioned mapping file outside the ServiceNow request.
  --environment-id value Exact environment boundary expected by the worker.
  --source-record value  ServiceNow table:sys_id reference; repeat for each affected record.
  --as-of value           Resolution time; defaults to the current time.
  --output path           Optional resolved-scope artifact path.
  --help                  Show help.

The resolver is read-only. It returns no credentials and performs no ServiceNow,
Dynatrace, or Forward API calls.
`;

const canonicalJson = (value) => `${JSON.stringify(value, null, 2)}\n`;
const sha256 = (value) => createHash("sha256").update(value).digest("hex");
const compareStrings = (left, right) => left < right ? -1 : left > right ? 1 : 0;

const assertKnownKeys = (value, allowed, label) => {
  const unknown = Object.keys(value).filter((key) => !allowed.has(key));
  if (unknown.length > 0) throw new Error(`${label} contains unsupported fields: ${unknown.join(", ")}.`);
};

const requiredString = (value, label, maxLength = 255) => {
  const normalized = typeof value === "string" ? value.trim() : "";
  if (!normalized) throw new Error(`${label} must be a non-empty string.`);
  if (normalized.length > maxLength) throw new Error(`${label} exceeds ${maxLength} characters.`);
  return normalized;
};

const identifier = (value, label) => {
  const normalized = requiredString(value, label, 128);
  if (!IDENTIFIER_PATTERN.test(normalized)) {
    throw new Error(`${label} must be a publish-safe identifier.`);
  }
  return normalized;
};

const instant = (value, label) => {
  const normalized = requiredString(value, label, 64);
  const epoch = Date.parse(normalized);
  if (!Number.isFinite(epoch)) throw new Error(`${label} must be an ISO date-time.`);
  return { value: normalized, epoch };
};

const confidence = (value, label) => {
  if (typeof value !== "number" || !Number.isFinite(value) || value < 0 || value > 1) {
    throw new Error(`${label} must be a number between 0 and 1.`);
  }
  return value;
};

const sourceRecordKey = (record) => `${record.table}:${record.sysId}`;

export const normalizeSourceRecord = (value, label = "source record") => {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error(`${label} must be an object.`);
  }
  const unknown = Object.keys(value).filter((key) => !new Set(["table", "sysId"]).has(key));
  if (unknown.length > 0) throw new Error(`${label} contains unsupported fields: ${unknown.join(", ")}.`);
  const table = requiredString(value.table, `${label}.table`, 80);
  const sysId = requiredString(value.sysId, `${label}.sysId`, 32).toLowerCase();
  if (!TABLE_PATTERN.test(table)) throw new Error(`${label}.table is invalid.`);
  if (!SYS_ID_PATTERN.test(sysId)) throw new Error(`${label}.sysId must be a 32-character ServiceNow sys_id.`);
  return { table, sysId };
};

const normalizeEndpoint = (value, label) => {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error(`${label} must be an object.`);
  }
  const unknown = Object.keys(value).filter(
    (key) => !new Set(["serviceEntityId", "locationType", "value"]).has(key),
  );
  if (unknown.length > 0) throw new Error(`${label} contains unsupported fields: ${unknown.join(", ")}.`);
  const serviceEntityId = requiredString(value.serviceEntityId, `${label}.serviceEntityId`);
  const locationType = requiredString(value.locationType, `${label}.locationType`, 32);
  if (!LOCATION_TYPES.has(locationType)) throw new Error(`${label}.locationType is unsupported.`);
  return {
    serviceEntityId,
    locationType,
    value: requiredString(value.value, `${label}.value`),
  };
};

const uniqueStrings = (values, label, maxItems = 100) => {
  if (!Array.isArray(values) || values.length === 0 || values.length > maxItems) {
    throw new Error(`${label} must contain between 1 and ${maxItems} values.`);
  }
  const normalized = values.map((value, index) => requiredString(value, `${label}[${index}]`));
  if (new Set(normalized).size !== normalized.length) throw new Error(`${label} must contain unique values.`);
  return normalized.sort();
};

export const validateScopeMapping = (mapping) => {
  if (!mapping || typeof mapping !== "object" || Array.isArray(mapping)) {
    throw new Error("Scope mapping must be a JSON object.");
  }
  if (mapping.schemaVersion !== MAPPING_SCHEMA) {
    throw new Error(`Scope mapping schemaVersion must be ${MAPPING_SCHEMA}.`);
  }
  assertKnownKeys(mapping, new Set([
    "schemaVersion", "mappingId", "environment", "owner", "observedAt", "expiresAt",
    "minimumConfidence", "mappings",
  ]), "scope mapping");
  const mappingId = identifier(mapping.mappingId, "mappingId");
  const environment = mapping.environment;
  if (!environment || typeof environment !== "object" || Array.isArray(environment)) {
    throw new Error("mapping.environment must be an object.");
  }
  assertKnownKeys(environment, new Set([
    "environmentId", "serviceNowInstanceAlias", "dynatraceEnvironmentAlias", "forwardNetworkId",
  ]), "mapping.environment");
  const normalizedEnvironment = {
    environmentId: identifier(environment.environmentId, "environment.environmentId"),
    serviceNowInstanceAlias: identifier(
      environment.serviceNowInstanceAlias,
      "environment.serviceNowInstanceAlias",
    ),
    dynatraceEnvironmentAlias: identifier(
      environment.dynatraceEnvironmentAlias,
      "environment.dynatraceEnvironmentAlias",
    ),
    forwardNetworkId: requiredString(environment.forwardNetworkId, "environment.forwardNetworkId"),
  };
  const owner = mapping.owner;
  if (!owner || typeof owner !== "object" || Array.isArray(owner)) {
    throw new Error("mapping.owner must be an object.");
  }
  assertKnownKeys(owner, new Set(["team", "contact"]), "mapping.owner");
  const normalizedOwner = {
    team: requiredString(owner.team, "owner.team", 128),
    contact: requiredString(owner.contact, "owner.contact"),
  };
  const mappingObservedAt = instant(mapping.observedAt, "observedAt");
  const mappingExpiresAt = instant(mapping.expiresAt, "expiresAt");
  if (mappingExpiresAt.epoch <= mappingObservedAt.epoch) {
    throw new Error("Scope mapping expiresAt must be after observedAt.");
  }
  const minimumConfidence = confidence(mapping.minimumConfidence, "minimumConfidence");
  if (!Array.isArray(mapping.mappings) || mapping.mappings.length === 0 || mapping.mappings.length > 1000) {
    throw new Error("mappings must contain between 1 and 1000 entries.");
  }
  const seenEntryIds = new Set();
  const seenSources = new Set();
  const normalizedMappings = mapping.mappings.map((entry, index) => {
    const label = `mappings[${index}]`;
    if (!entry || typeof entry !== "object" || Array.isArray(entry)) {
      throw new Error(`${label} must be an object.`);
    }
    assertKnownKeys(entry, new Set([
      "mappingEntryId", "sourceRecord", "serviceEntityIds", "forwardEndpoints", "confidence",
      "status", "observedAt", "expiresAt",
    ]), label);
    const mappingEntryId = identifier(entry.mappingEntryId, `${label}.mappingEntryId`);
    if (seenEntryIds.has(mappingEntryId)) throw new Error(`Duplicate mappingEntryId: ${mappingEntryId}.`);
    seenEntryIds.add(mappingEntryId);
    const sourceRecord = normalizeSourceRecord(entry.sourceRecord, `${label}.sourceRecord`);
    const sourceKey = sourceRecordKey(sourceRecord);
    if (seenSources.has(sourceKey)) {
      throw new Error(`Ambiguous scope mapping: ${sourceKey} appears more than once.`);
    }
    seenSources.add(sourceKey);
    const serviceEntityIds = uniqueStrings(entry.serviceEntityIds, `${label}.serviceEntityIds`);
    if (!Array.isArray(entry.forwardEndpoints) || entry.forwardEndpoints.length === 0 || entry.forwardEndpoints.length > 500) {
      throw new Error(`${label}.forwardEndpoints must contain between 1 and 500 entries.`);
    }
    const forwardEndpoints = entry.forwardEndpoints.map((endpoint, endpointIndex) =>
      normalizeEndpoint(endpoint, `${label}.forwardEndpoints[${endpointIndex}]`));
    const endpointKeys = forwardEndpoints.map(
      (endpoint) => `${endpoint.serviceEntityId}:${endpoint.locationType}:${endpoint.value}`,
    );
    if (new Set(endpointKeys).size !== endpointKeys.length) {
      throw new Error(`${label}.forwardEndpoints contains duplicate endpoints.`);
    }
    const endpointServices = new Set(forwardEndpoints.map((endpoint) => endpoint.serviceEntityId));
    const missingEndpoints = serviceEntityIds.filter((serviceId) => !endpointServices.has(serviceId));
    const unrelatedEndpoints = [...endpointServices].filter((serviceId) => !serviceEntityIds.includes(serviceId));
    if (missingEndpoints.length > 0 || unrelatedEndpoints.length > 0) {
      throw new Error(
        `${label}.forwardEndpoints must map every and only declared serviceEntityIds.`,
      );
    }
    const observedAt = instant(entry.observedAt, `${label}.observedAt`);
    const expiresAt = instant(entry.expiresAt, `${label}.expiresAt`);
    if (expiresAt.epoch <= observedAt.epoch) {
      throw new Error(`${label}.expiresAt must be after observedAt.`);
    }
    if (observedAt.epoch < mappingObservedAt.epoch || expiresAt.epoch > mappingExpiresAt.epoch) {
      throw new Error(`${label} validity must stay within the mapping validity window.`);
    }
    if (!new Set(["reviewed", "disabled"]).has(entry.status)) {
      throw new Error(`${label}.status must be reviewed or disabled.`);
    }
    return {
      mappingEntryId,
      sourceRecord,
      serviceEntityIds,
      forwardEndpoints: forwardEndpoints.sort((left, right) =>
        compareStrings(JSON.stringify(left), JSON.stringify(right))),
      confidence: confidence(entry.confidence, `${label}.confidence`),
      status: entry.status,
      observedAt: observedAt.value,
      expiresAt: expiresAt.value,
      observedAtEpoch: observedAt.epoch,
      expiresAtEpoch: expiresAt.epoch,
    };
  });
  return {
    mappingId,
    environment: normalizedEnvironment,
    owner: normalizedOwner,
    observedAt: mappingObservedAt.value,
    expiresAt: mappingExpiresAt.value,
    observedAtEpoch: mappingObservedAt.epoch,
    expiresAtEpoch: mappingExpiresAt.epoch,
    minimumConfidence,
    mappings: normalizedMappings,
  };
};

export const validateScopeResolution = (resolution, {
  asOf = null,
  forwardNetworkId = null,
  serviceEntityIds = null,
  serviceNowInstanceAlias = null,
} = {}) => {
  if (!resolution || typeof resolution !== "object" || Array.isArray(resolution)) {
    throw new Error("Scope resolution must be a JSON object.");
  }
  if (resolution.schemaVersion !== RESOLUTION_SCHEMA) {
    throw new Error(`Scope resolution schemaVersion must be ${RESOLUTION_SCHEMA}.`);
  }
  assertKnownKeys(resolution, new Set([
    "schemaVersion", "mappingId", "mappingSha256", "environmentId", "serviceNowInstanceAlias",
    "dynatraceEnvironmentAlias", "resolvedAt", "sourceRecords", "serviceEntityIds",
    "forwardNetworkId", "forwardEndpoints", "owner", "validity",
  ]), "scope resolution");
  identifier(resolution.mappingId, "resolution.mappingId");
  if (!/^[a-f0-9]{64}$/u.test(String(resolution.mappingSha256 || ""))) {
    throw new Error("resolution.mappingSha256 must be a SHA-256 digest.");
  }
  identifier(resolution.environmentId, "resolution.environmentId");
  const resolvedInstanceAlias = identifier(
    resolution.serviceNowInstanceAlias,
    "resolution.serviceNowInstanceAlias",
  );
  identifier(resolution.dynatraceEnvironmentAlias, "resolution.dynatraceEnvironmentAlias");
  const resolvedAt = instant(resolution.resolvedAt, "resolution.resolvedAt");
  if (!Array.isArray(resolution.sourceRecords) || resolution.sourceRecords.length === 0 ||
      resolution.sourceRecords.length > MAX_SOURCE_RECORDS) {
    throw new Error(`resolution.sourceRecords must contain between 1 and ${MAX_SOURCE_RECORDS} records.`);
  }
  const normalizedSources = resolution.sourceRecords.map((record, index) =>
    normalizeSourceRecord(record, `resolution.sourceRecords[${index}]`));
  const sourceKeys = normalizedSources.map(sourceRecordKey);
  if (new Set(sourceKeys).size !== sourceKeys.length) {
    throw new Error("resolution.sourceRecords must contain unique values.");
  }
  const resolvedServices = uniqueStrings(
    resolution.serviceEntityIds,
    "resolution.serviceEntityIds",
  );
  const resolvedNetworkId = requiredString(
    resolution.forwardNetworkId,
    "resolution.forwardNetworkId",
  );
  if (!Array.isArray(resolution.forwardEndpoints) || resolution.forwardEndpoints.length === 0 ||
      resolution.forwardEndpoints.length > 500) {
    throw new Error("resolution.forwardEndpoints must contain between 1 and 500 entries.");
  }
  const endpoints = resolution.forwardEndpoints.map((endpoint, index) =>
    normalizeEndpoint(endpoint, `resolution.forwardEndpoints[${index}]`));
  const endpointServices = new Set(endpoints.map((endpoint) => endpoint.serviceEntityId));
  if (
    resolvedServices.some((serviceId) => !endpointServices.has(serviceId)) ||
    [...endpointServices].some((serviceId) => !resolvedServices.includes(serviceId))
  ) {
    throw new Error("resolution.forwardEndpoints must map every and only resolved serviceEntityIds.");
  }
  if (!resolution.owner || typeof resolution.owner !== "object" || Array.isArray(resolution.owner)) {
    throw new Error("resolution.owner must be an object.");
  }
  assertKnownKeys(resolution.owner, new Set(["team", "contact"]), "resolution.owner");
  requiredString(resolution.owner.team, "resolution.owner.team", 128);
  requiredString(resolution.owner.contact, "resolution.owner.contact");
  if (!resolution.validity || typeof resolution.validity !== "object" || Array.isArray(resolution.validity)) {
    throw new Error("resolution.validity must be an object.");
  }
  assertKnownKeys(resolution.validity, new Set([
    "mappingObservedAt", "mappingExpiresAt", "minimumConfidence", "lowestConfidence",
  ]), "resolution.validity");
  const mappingObservedAt = instant(
    resolution.validity.mappingObservedAt,
    "resolution.validity.mappingObservedAt",
  );
  const mappingExpiresAt = instant(
    resolution.validity.mappingExpiresAt,
    "resolution.validity.mappingExpiresAt",
  );
  const minimum = confidence(
    resolution.validity.minimumConfidence,
    "resolution.validity.minimumConfidence",
  );
  const lowest = confidence(
    resolution.validity.lowestConfidence,
    "resolution.validity.lowestConfidence",
  );
  if (lowest < minimum) throw new Error("Scope resolution confidence is below its minimum.");
  if (resolvedAt.epoch < mappingObservedAt.epoch || resolvedAt.epoch >= mappingExpiresAt.epoch) {
    throw new Error("Scope resolution was produced outside its mapping validity window.");
  }
  if (asOf) {
    const verificationTime = instant(asOf, "scope resolution verification time");
    if (verificationTime.epoch < mappingObservedAt.epoch || verificationTime.epoch >= mappingExpiresAt.epoch) {
      throw new Error("Scope resolution mapping is stale or not yet valid.");
    }
  }
  if (forwardNetworkId !== null && resolvedNetworkId !== forwardNetworkId) {
    throw new Error("Scope resolution Forward network does not match the workflow request.");
  }
  if (
    serviceEntityIds !== null &&
    JSON.stringify(resolvedServices) !== JSON.stringify([...new Set(serviceEntityIds)].sort())
  ) {
    throw new Error("Scope resolution service entities do not match the workflow request.");
  }
  if (serviceNowInstanceAlias !== null && resolvedInstanceAlias !== serviceNowInstanceAlias) {
    throw new Error("Scope resolution ServiceNow instance does not match the workflow request.");
  }
  return resolution;
};

export const resolveScopeMapping = ({
  mapping,
  environmentId,
  sourceRecords,
  asOf = new Date().toISOString(),
}) => {
  const validated = validateScopeMapping(mapping);
  const expectedEnvironmentId = identifier(environmentId, "environmentId");
  if (validated.environment.environmentId !== expectedEnvironmentId) {
    throw new Error(
      `Scope mapping environment mismatch: requested ${expectedEnvironmentId}, ` +
      `mapping is ${validated.environment.environmentId}.`,
    );
  }
  const resolvedAt = instant(asOf, "asOf");
  if (resolvedAt.epoch < validated.observedAtEpoch || resolvedAt.epoch >= validated.expiresAtEpoch) {
    throw new Error("Scope mapping is stale or not yet valid at the requested resolution time.");
  }
  if (!Array.isArray(sourceRecords) || sourceRecords.length === 0 || sourceRecords.length > MAX_SOURCE_RECORDS) {
    throw new Error(`sourceRecords must contain between 1 and ${MAX_SOURCE_RECORDS} records.`);
  }
  const normalizedSources = sourceRecords.map((record, index) =>
    normalizeSourceRecord(record, `sourceRecords[${index}]`));
  const sourceKeys = normalizedSources.map(sourceRecordKey);
  if (new Set(sourceKeys).size !== sourceKeys.length) {
    throw new Error("sourceRecords must contain unique table and sys_id pairs.");
  }
  const mappingBySource = new Map(
    validated.mappings.map((entry) => [sourceRecordKey(entry.sourceRecord), entry]),
  );
  const selected = normalizedSources.map((sourceRecord) => {
    const key = sourceRecordKey(sourceRecord);
    const entry = mappingBySource.get(key);
    if (!entry) throw new Error(`No reviewed scope mapping exists for affected record ${key}.`);
    if (entry.status !== "reviewed") throw new Error(`Scope mapping ${entry.mappingEntryId} is disabled.`);
    if (entry.confidence < validated.minimumConfidence) {
      throw new Error(
        `Scope mapping ${entry.mappingEntryId} confidence ${entry.confidence} is below ` +
        `minimum ${validated.minimumConfidence}.`,
      );
    }
    if (resolvedAt.epoch < entry.observedAtEpoch || resolvedAt.epoch >= entry.expiresAtEpoch) {
      throw new Error(`Scope mapping ${entry.mappingEntryId} is stale or not yet valid.`);
    }
    return entry;
  });
  const serviceEntityIds = [...new Set(selected.flatMap((entry) => entry.serviceEntityIds))].sort();
  const endpointMap = new Map();
  for (const endpoint of selected.flatMap((entry) => entry.forwardEndpoints)) {
    const key = `${endpoint.serviceEntityId}:${endpoint.locationType}:${endpoint.value}`;
    endpointMap.set(key, endpoint);
  }
  const forwardEndpoints = [...endpointMap.values()].sort((left, right) =>
    compareStrings(JSON.stringify(left), JSON.stringify(right)));
  const selectedSourceRecords = selected.map((entry) => entry.sourceRecord)
    .sort((left, right) => compareStrings(sourceRecordKey(left), sourceRecordKey(right)));
  return {
    schemaVersion: RESOLUTION_SCHEMA,
    mappingId: validated.mappingId,
    mappingSha256: sha256(canonicalJson(mapping)),
    environmentId: validated.environment.environmentId,
    serviceNowInstanceAlias: validated.environment.serviceNowInstanceAlias,
    dynatraceEnvironmentAlias: validated.environment.dynatraceEnvironmentAlias,
    resolvedAt: resolvedAt.value,
    sourceRecords: selectedSourceRecords,
    serviceEntityIds,
    forwardNetworkId: validated.environment.forwardNetworkId,
    forwardEndpoints,
    owner: validated.owner,
    validity: {
      mappingObservedAt: validated.observedAt,
      mappingExpiresAt: validated.expiresAt,
      minimumConfidence: validated.minimumConfidence,
      lowestConfidence: Math.min(...selected.map((entry) => entry.confidence)),
    },
  };
};

export const readScopeMapping = async (filePath) =>
  JSON.parse(await readFile(path.resolve(filePath), "utf8"));

const parseSourceRecordArg = (value) => {
  const normalized = requiredString(value, "--source-record");
  const separator = normalized.indexOf(":");
  if (separator <= 0 || separator === normalized.length - 1) {
    throw new Error("--source-record must use table:sys_id format.");
  }
  return normalizeSourceRecord({
    table: normalized.slice(0, separator),
    sysId: normalized.slice(separator + 1),
  }, "--source-record");
};

const parseArgs = (argv) => {
  const args = { sourceRecords: [] };
  for (let index = 0; index < argv.length; index += 1) {
    const value = argv[index];
    if (value === "--help") {
      args.help = true;
      continue;
    }
    if (!value.startsWith("--")) throw new Error(`Unexpected argument: ${value}`);
    const next = argv[index + 1];
    if (!next || next.startsWith("--")) throw new Error(`Missing value for ${value}.`);
    if (value === "--source-record") args.sourceRecords.push(parseSourceRecordArg(next));
    else if (value === "--mapping") args.mapping = next;
    else if (value === "--environment-id") args.environmentId = next;
    else if (value === "--as-of") args.asOf = next;
    else if (value === "--output") args.output = next;
    else throw new Error(`Unsupported option: ${value}`);
    index += 1;
  }
  return args;
};

export const run = async (argv = process.argv.slice(2)) => {
  const args = parseArgs(argv);
  if (args.help) {
    process.stdout.write(usage);
    return 0;
  }
  const mappingPath = requiredString(args.mapping, "--mapping");
  const resolution = resolveScopeMapping({
    mapping: await readScopeMapping(mappingPath),
    environmentId: requiredString(args.environmentId, "--environment-id", 128),
    sourceRecords: args.sourceRecords,
    asOf: args.asOf || new Date().toISOString(),
  });
  const text = canonicalJson(resolution);
  if (args.output) {
    const output = path.resolve(args.output);
    await mkdir(path.dirname(output), { recursive: true, mode: 0o700 });
    await writeFile(output, text, { mode: 0o600 });
  }
  process.stdout.write(text);
  return 0;
};

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  run().then((code) => {
    process.exitCode = code;
  }).catch((error) => {
    process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
    process.exitCode = 1;
  });
}
