const PROFILE_SCHEMA_ID = "dependency-discovery-profile";
const MAX_QUERY_LENGTH = 5_000;
const MAX_PROFILE_COUNT = 100;
const MAX_RESULT_RECORDS = 1_000;
const MAX_EVIDENCE_AGE_MINUTES = 1_440;
const FUTURE_CLOCK_SKEW_MS = 5 * 60 * 1_000;
const FORBIDDEN_EVIDENCE_PATTERN = /(?:synthetic|fixture|seed(?:ed)?|replay(?:ed)?|capture(?:d)?)/iu;

const isRecord = (value) =>
  Boolean(value) && typeof value === "object" && !Array.isArray(value);

const requiredString = (value, label, maximumLength = 2_048) => {
  if (typeof value !== "string" || !value.trim()) {
    throw new Error(`${label} is required.`);
  }
  const normalized = value.trim();
  if (normalized.length > maximumLength) {
    throw new Error(`${label} exceeds ${maximumLength} characters.`);
  }
  return normalized;
};

const boundedInteger = (value, label, minimum, maximum) => {
  const normalized = String(value).trim();
  if (!/^-?\d+$/u.test(normalized)) {
    throw new Error(`${label} must be an integer from ${minimum} through ${maximum}.`);
  }
  const parsed = Number(normalized);
  if (!Number.isInteger(parsed) || parsed < minimum || parsed > maximum) {
    throw new Error(`${label} must be an integer from ${minimum} through ${maximum}.`);
  }
  return parsed;
};

const boundedOptionalString = (value, label, maximumLength) => {
  if (!value) return "";
  if (value.length > maximumLength) {
    throw new Error(`${label} exceeds ${maximumLength} characters.`);
  }
  return value;
};

const field = (row, names, fallback = "") => {
  for (const name of names) {
    const value = row[name];
    if (
      (typeof value === "string" || typeof value === "number" || typeof value === "boolean") &&
      String(value).trim()
    ) {
      return String(value).trim();
    }
  }
  return fallback;
};

const dependencySlug = (value) =>
  value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/gu, "-")
    .replace(/^-|-$/gu, "")
    .slice(0, 80);

export const validateDependencyQuery = (value) => {
  const query = requiredString(value, "Dependency discovery query", MAX_QUERY_LENGTH);
  const withoutLeadingComments = query.replace(/^(?:\s*\/\/[^\n]*\n)*/gu, "").trimStart();
  if (!/^fetch\s+spans\b/iu.test(withoutLeadingComments)) {
    throw new Error("Dependency discovery query must begin with fetch spans.");
  }
  const fetchSources = [...query.matchAll(/\bfetch\s+([A-Za-z0-9_.]+)/giu)]
    .map((match) => match[1].toLowerCase());
  if (fetchSources.some((source) => source !== "spans")) {
    throw new Error("Dependency discovery query may read only spans.");
  }
  if (/\b(?:data|record)\s+/iu.test(query)) {
    throw new Error("Dependency discovery query may not construct substitute records.");
  }
  return query;
};

export const validateDiscoveryProfile = (object) => {
  if (!isRecord(object)) throw new Error("Dependency discovery profile is invalid.");
  if (object.schemaId !== PROFILE_SCHEMA_ID) {
    throw new Error(`Dependency discovery profile must use schema ${PROFILE_SCHEMA_ID}.`);
  }
  const value = object.value;
  if (!isRecord(value)) throw new Error("Dependency discovery profile value is invalid.");

  const status = value.status || "enabled";
  if (status !== "enabled" && status !== "disabled") {
    throw new Error("Dependency discovery profile status is invalid.");
  }
  const selection = value.selection || "available";
  if (selection !== "default" && selection !== "available") {
    throw new Error("Dependency discovery profile selection is invalid.");
  }

  return {
    id: requiredString(object.objectId, "Dependency discovery profile ID", 255),
    name: requiredString(value.name, "Dependency discovery profile name", 100),
    description: typeof value.description === "string" ? value.description.trim().slice(0, 500) : "",
    enabled: status === "enabled",
    isDefault: selection === "default",
    query: validateDependencyQuery(value.query),
    maxResultRecords: boundedInteger(
      value.maxResultRecords || "500",
      "Maximum result records",
      1,
      MAX_RESULT_RECORDS,
    ),
    maxEvidenceAgeMinutes: boundedInteger(
      value.maxEvidenceAgeMinutes || "30",
      "Maximum evidence age minutes",
      1,
      MAX_EVIDENCE_AGE_MINUTES,
    ),
  };
};

export const selectDiscoveryProfile = (objects, requestedProfileId) => {
  if (!Array.isArray(objects)) throw new Error("Dependency discovery profile list is invalid.");
  if (objects.length > MAX_PROFILE_COUNT) {
    throw new Error(`Dependency discovery profile list exceeds ${MAX_PROFILE_COUNT} objects.`);
  }

  const profiles = objects.map(validateDiscoveryProfile).filter((profile) => profile.enabled);
  const publicProfiles = profiles.map(({ id, name, description, isDefault }) => ({
    id,
    name,
    description,
    isDefault,
  }));

  if (profiles.length === 0) {
    return { profile: null, profiles: publicProfiles, reason: "no-enabled-profile" };
  }

  if (requestedProfileId) {
    const requested = profiles.find((profile) => profile.id === requestedProfileId);
    if (!requested) {
      return { profile: null, profiles: publicProfiles, reason: "profile-not-accessible" };
    }
    return { profile: requested, profiles: publicProfiles, reason: null };
  }

  const defaults = profiles.filter((profile) => profile.isDefault);
  if (defaults.length === 1) {
    return { profile: defaults[0], profiles: publicProfiles, reason: null };
  }
  if (defaults.length > 1) {
    return { profile: null, profiles: publicProfiles, reason: "multiple-default-profiles" };
  }
  if (profiles.length === 1) {
    return { profile: profiles[0], profiles: publicProfiles, reason: null };
  }
  return { profile: null, profiles: publicProfiles, reason: "profile-selection-required" };
};

const normalizeDependency = (row, index) => {
  if (!isRecord(row)) throw new Error("row is not an object");

  const appName = requiredString(field(row, ["app.name", "appName"]), "app.name", 255);
  const environment = requiredString(
    field(row, ["app.environment", "environment"]),
    "app.environment",
    255,
  );
  const serviceEntityId = boundedOptionalString(
    field(row, ["dt.entity.service", "serviceEntityId"]),
    "dt.entity.service",
    255,
  );
  const serviceName = requiredString(
    field(row, ["service.name", "serviceName"], serviceEntityId),
    "service.name",
    255,
  );
  const sourceLabel = boundedOptionalString(
    field(row, ["network.source.label", "sourceLabel"]),
    "network.source.label",
    255,
  );
  const source = boundedOptionalString(field(row, ["network.source", "source"]), "network.source", 512);
  const destinationLabel = boundedOptionalString(
    field(row, ["network.destination.label", "destinationLabel"]),
    "network.destination.label",
    255,
  );
  const destination = boundedOptionalString(
    field(row, ["network.destination", "destination"]),
    "network.destination",
    512,
  );
  const protocolValue = field(row, ["network.protocol", "protocol"]).toLowerCase();
  const portValue = field(row, ["network.port", "port"]);
  const owner = requiredString(field(row, ["owner.team", "owner"]), "owner.team", 255);
  const criticalityValue = field(row, ["criticality"]).toLowerCase();
  const confidenceValue = Number.parseInt(field(row, ["dependency.confidence", "confidence"]), 10);
  const observedAt = requiredString(
    field(row, ["dependency.observed_at", "observedAt", "timestamp"]),
    "dependency.observed_at",
    100,
  );
  const evidenceSource = requiredString(
    field(row, ["dependency.evidence_source", "forward.dynatrace.evidence_source", "evidenceSource"]),
    "dependency.evidence_source",
    200,
  );
  if (FORBIDDEN_EVIDENCE_PATTERN.test(evidenceSource)) {
    throw new Error("dependency.evidence_source identifies substitute evidence");
  }
  if (["true", "1", "yes"].includes(
    field(row, ["dependency.synthetic", "forward.dynatrace.synthetic"]).toLowerCase(),
  )) {
    throw new Error("dependency row is marked synthetic");
  }

  if (protocolValue !== "tcp" && protocolValue !== "udp") {
    throw new Error("network.protocol must be tcp or udp");
  }
  const port = boundedInteger(portValue, "network.port", 1, 65_535);
  if (!Number.isInteger(confidenceValue) || confidenceValue < 0 || confidenceValue > 100) {
    throw new Error("dependency.confidence must be an integer from 0 through 100");
  }
  if (!["critical", "high", "medium", "low"].includes(criticalityValue)) {
    throw new Error("criticality must be critical, high, medium, or low");
  }

  const rawMappingState = field(row, ["dependency.mapping_state", "mappingState"]).toLowerCase();
  const mappingState = !source || !destination || !serviceEntityId
    ? "needs-map"
    : rawMappingState === "ready" || rawMappingState === "review" || rawMappingState === "needs-map"
      ? rawMappingState
      : confidenceValue < 90
        ? "review"
        : "ready";
  const id = requiredString(field(row, ["dependency.id", "id"], [
    dependencySlug(appName),
    dependencySlug(environment),
    dependencySlug(serviceEntityId || serviceName),
    dependencySlug(source || `source-${index + 1}`),
    dependencySlug(destination || `destination-${index + 1}`),
    protocolValue,
    String(port),
  ].filter(Boolean).join("-")), "dependency.id", 255);

  return {
    dependency: {
      id,
      appName,
      environment,
      serviceEntityId,
      serviceName,
      ...(sourceLabel ? { sourceLabel } : {}),
      source,
      ...(destinationLabel ? { destinationLabel } : {}),
      destination,
      protocol: protocolValue,
      port: String(port),
      owner,
      criticality: criticalityValue,
      confidence: confidenceValue,
      mappingState,
    },
    evidence: {
      observedAt,
      evidenceSource,
      runId: field(row, ["dependency.run_id", "forward.dynatrace.run_id", "runId"], "tenant-query"),
    },
  };
};

export const normalizeDiscoveryRows = (
  rows,
  { maxEvidenceAgeMinutes, now = new Date() },
) => {
  if (!Array.isArray(rows)) throw new Error("Dynatrace query records are invalid.");
  if (rows.length > MAX_RESULT_RECORDS) {
    throw new Error(`Dynatrace query returned more than ${MAX_RESULT_RECORDS} records.`);
  }

  const nowMs = now instanceof Date ? now.getTime() : new Date(now).getTime();
  if (!Number.isFinite(nowMs)) throw new Error("Current time is invalid.");
  const maximumAgeMs = maxEvidenceAgeMinutes * 60 * 1_000;
  const dependencies = [];
  const rejected = [];
  const sources = new Set();
  const runIds = new Set();
  let newestObservedAtMs = 0;

  rows.forEach((row, index) => {
    try {
      const normalized = normalizeDependency(row, index);
      const observedAtMs = Date.parse(normalized.evidence.observedAt);
      if (!Number.isFinite(observedAtMs)) throw new Error("dependency.observed_at is invalid");
      if (observedAtMs > nowMs + FUTURE_CLOCK_SKEW_MS) {
        throw new Error("dependency evidence timestamp is in the future");
      }
      if (nowMs - observedAtMs > maximumAgeMs) {
        throw new Error("dependency evidence is stale");
      }
      newestObservedAtMs = Math.max(newestObservedAtMs, observedAtMs);
      sources.add(normalized.evidence.evidenceSource);
      runIds.add(normalized.evidence.runId);
      dependencies.push(normalized.dependency);
    } catch (error) {
      rejected.push({
        row: index + 1,
        reason: error instanceof Error ? error.message : "row validation failed",
      });
    }
  });

  return {
    dependencies,
    rejected,
    evidence: {
      queriedRows: rows.length,
      acceptedRows: dependencies.length,
      rejectedRows: rejected.length,
      newestObservedAt: newestObservedAtMs ? new Date(newestObservedAtMs).toISOString() : null,
      sources: [...sources].sort(),
      runIds: [...runIds].sort(),
    },
  };
};

export const discoveryConfigurationMessage = (reason) => ({
  "no-enabled-profile": "Create and enable a tenant-owned dependency discovery profile.",
  "profile-not-accessible": "The selected dependency discovery profile is unavailable or disabled.",
  "multiple-default-profiles": "Exactly one enabled dependency discovery profile may be marked default.",
  "profile-selection-required": "Select one of the enabled dependency discovery profiles.",
}[reason] || "Dependency discovery configuration requires review.");

export { PROFILE_SCHEMA_ID };
