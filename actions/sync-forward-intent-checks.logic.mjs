import { createHash } from "node:crypto";

import * as appSettingsV2 from "@dynatrace-sdk/client-app-settings-v2";

import forwardSync from "../api/forward-sync.function.ts";
import {
  inspectManagedIdentity,
  managedSourceKey,
  sourceInstanceTag,
} from "../lib/managed-check-identity.mjs";
import {
  canWriteIntentChecks,
  isForwardAccessProfile,
} from "../lib/forward-access-profile.mjs";
import {
  evaluatePathEvidence,
  resolveDependencyEvidence,
} from "../lib/forward-evidence.mjs";

const CONNECTION_SCHEMA = "forward-api-connection";
const MAX_RESPONSE_BYTES = 5 * 1024 * 1024;
const DEFAULT_TIMEOUT_MS = 30_000;
const DEFAULT_BATCH_SIZE = 100;
const MAX_CREATE_BUDGET = 2_500;
const MAX_UPDATE_BUDGET = 1_000;
const MAX_DEPENDENCIES = 2_500;
const TRANSIENT_STATUS_CODES = new Set([408, 429, 500, 502, 503, 504]);

const appSettingsObjectsClient = appSettingsV2.appSettingsObjectsClient ||
  appSettingsV2.default?.appSettingsObjectsClient;

const sha256 = (value) => createHash("sha256").update(value).digest("hex");

const sortObject = (value) => {
  if (Array.isArray(value)) return value.map(sortObject);
  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value)
        .sort(([left], [right]) => left.localeCompare(right))
        .map(([key, child]) => [key, sortObject(child)]),
    );
  }
  return value;
};

const stableJson = (value) => JSON.stringify(sortObject(value));

const requiredString = (value, label, maxLength = 4096) => {
  const normalized = typeof value === "string" ? value.trim() : "";
  if (!normalized) throw new Error(`${label} must be a non-empty string.`);
  if (normalized.length > maxLength) throw new Error(`${label} exceeds ${maxLength} characters.`);
  return normalized;
};

const nonNegativeInteger = (value, fallback, maximum, label) => {
  const candidate = value === undefined ? fallback : value;
  if (!Number.isInteger(candidate) || candidate < 0 || candidate > maximum) {
    throw new Error(`${label} must be an integer from 0 through ${maximum}.`);
  }
  return candidate;
};

const assertKnownKeys = (value, allowed, label) => {
  const unknown = Object.keys(value).filter((key) => !allowed.has(key));
  if (unknown.length > 0) {
    throw new Error(`${label} contains unsupported fields: ${unknown.join(", ")}.`);
  }
};

const parseRequest = (value) => {
  let request = value;
  if (typeof request === "string") {
    try {
      request = JSON.parse(request);
    } catch (error) {
      throw new Error(`Forward synchronization request is not valid JSON: ${error.message}`);
    }
  }
  if (!request || typeof request !== "object" || Array.isArray(request)) {
    throw new Error("Forward synchronization request must be a JSON object.");
  }
  return request;
};

const forwardBaseUrl = (value) => {
  const url = new URL(requiredString(value, "Forward API URL", 2048));
  if (url.protocol !== "https:") throw new Error("Forward API URL must use HTTPS.");
  if (url.username || url.password || url.search || url.hash) {
    throw new Error("Forward API URL must not contain credentials, query parameters, or fragments.");
  }
  url.pathname = url.pathname.replace(/\/+$/u, "");
  if (url.pathname !== "/api") {
    throw new Error("Forward API URL must end with /api.");
  }
  return url.toString().replace(/\/+$/u, "");
};

export const loadDynatraceConnection = async (connectionId) =>
  appSettingsObjectsClient?.getAppSettingsObjectByObjectId({ objectId: connectionId });

const FORWARD_QUERY_ID = /^FQ_[A-Fa-f0-9]{40}$/u;

const approvedLibraryQueryIds = (value) => {
  if (value === undefined || value === null || value === "") return [];
  if (typeof value !== "string" || value.length > 5000) {
    throw new Error("Approved Forward Library NQE query IDs must be a bounded string.");
  }
  const ids = [...new Set(value.split(/[\s,]+/u).map((item) => item.trim()).filter(Boolean))];
  if (ids.some((id) => !FORWARD_QUERY_ID.test(id))) {
    throw new Error("Approved Forward Library NQE query IDs must use the FQ_<40 hex chars> form.");
  }
  return ids;
};

export const validateConnection = (connection) => {
  if (!connection || typeof connection !== "object" || Array.isArray(connection)) {
    throw new Error("Forward connection could not be loaded.");
  }
  if (connection.schemaId && connection.schemaId !== CONNECTION_SCHEMA) {
    throw new Error(`Forward connection must use settings schema ${CONNECTION_SCHEMA}.`);
  }
  const value = connection.value;
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error("Forward connection value is invalid.");
  }
  assertKnownKeys(
    value,
    new Set([
      "name",
      "baseUrl",
      "networkId",
      "username",
      "password",
      "forwardAccessProfile",
      "approvedLibraryQueryIds",
    ]),
    "Forward connection",
  );
  requiredString(value.name, "Forward connection name", 100);
  const forwardAccessProfile = requiredString(
    value.forwardAccessProfile,
    "Forward access profile",
    32,
  );
  if (!isForwardAccessProfile(forwardAccessProfile)) {
    throw new Error("Forward access profile must be read-only, network-operator, or network-admin.");
  }
  const username = requiredString(value.username, "Forward username", 255);
  const password = requiredString(value.password, "Forward password", 4096);
  if (username.includes(":")) throw new Error("Forward username must not contain a colon.");
  return {
    baseUrl: forwardBaseUrl(value.baseUrl),
    networkId: requiredString(value.networkId, "Forward network ID", 128),
    authorization: `Basic ${Buffer.from(`${username}:${password}`, "utf8").toString("base64")}`,
    forwardAccessProfile,
    approvedLibraryQueryIds: approvedLibraryQueryIds(value.approvedLibraryQueryIds),
  };
};

const readBoundedResponseText = async (response) => {
  const text = await response.text();
  if (Buffer.byteLength(text, "utf8") > MAX_RESPONSE_BYTES) {
    throw new Error("Forward API response exceeded the 5 MiB app-function bound.");
  }
  return text;
};

const wait = (milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds));

export const createForwardClient = ({
  connection,
  fetchImpl = globalThis.fetch,
  timeoutMs = DEFAULT_TIMEOUT_MS,
  maxRetries = 2,
}) => {
  let csrfHeaderPromise;
  const loadCsrfHeader = () => {
    csrfHeaderPromise ||= (async () => {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), timeoutMs);
      let response;
      try {
        response = await fetchImpl(`${connection.baseUrl}/public/csrf`, {
          method: "GET",
          headers: { Accept: "application/json" },
          signal: controller.signal,
        });
      } catch {
        throw new Error("Forward CSRF bootstrap failed before an HTTP response was received.");
      } finally {
        clearTimeout(timeout);
      }
      const text = await readBoundedResponseText(response);
      if (!response.ok) throw new Error(`Forward CSRF bootstrap failed with HTTP ${response.status}.`);
      let payload;
      try {
        payload = JSON.parse(text);
      } catch {
        throw new Error("Forward CSRF bootstrap returned invalid JSON.");
      }
      const headerName = payload?.headerName;
      const token = payload?.token;
      if (
        typeof headerName !== "string" ||
        !/^X-(?:CSRF|XSRF)-TOKEN$/iu.test(headerName) ||
        typeof token !== "string" ||
        !token
      ) {
        throw new Error("Forward CSRF bootstrap did not return a supported header and token.");
      }
      return { [headerName]: token };
    })();
    return csrfHeaderPromise;
  };

  return async (method, path, body) => {
    const csrfHeader = method === "GET" ? {} : await loadCsrfHeader();
    for (let attempt = 0; attempt <= maxRetries; attempt += 1) {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), timeoutMs);
      let response;
      try {
        response = await fetchImpl(`${connection.baseUrl}${path}`, {
          method,
          headers: {
            Accept: "application/json",
            Authorization: connection.authorization,
            ...csrfHeader,
            ...(body === undefined ? {} : { "Content-Type": "application/json" }),
          },
          body: body === undefined ? undefined : JSON.stringify(body),
          signal: controller.signal,
        });
      } catch {
        throw new Error("Forward API request failed before an HTTP response was received.");
      } finally {
        clearTimeout(timeout);
      }

      const text = await readBoundedResponseText(response);
      if (response.ok) {
        if (!text || response.status === 204) return null;
        try {
          return JSON.parse(text);
        } catch {
          throw new Error("Forward API returned invalid JSON.");
        }
      }
      if (TRANSIENT_STATUS_CODES.has(response.status) && attempt < maxRetries) {
        await wait(Math.min(250 * (2 ** attempt), 1_000));
        continue;
      }
      throw new Error(`Forward API ${method} failed with HTTP ${response.status}.`);
    }
    throw new Error("Forward API retry budget was exhausted.");
  };
};

const listFrom = (value, keys) => {
  if (Array.isArray(value)) return value;
  if (!value || typeof value !== "object") return [];
  for (const key of keys) {
    if (Array.isArray(value[key])) return value[key];
  }
  return [];
};

const latestProcessedSnapshot = (value) => {
  if (value?.id !== undefined && value?.id !== null && value.id !== "") {
    return String(value.id);
  }
  const snapshots = listFrom(value, ["snapshots", "items"])
    .filter((snapshot) => snapshot && typeof snapshot === "object")
    .filter((snapshot) => String(snapshot.state || "PROCESSED") === "PROCESSED")
    .filter((snapshot) => !snapshot.predictInfo && !snapshot.parentSnapshotId)
    .sort((left, right) => String(right.createdAt || "").localeCompare(String(left.createdAt || "")));
  const snapshotId = snapshots[0]?.id;
  if (snapshotId === undefined || snapshotId === null || snapshotId === "") {
    throw new Error("Forward connection has no processed collection snapshot.");
  }
  return String(snapshotId);
};

const canonicalizeLocation = (value) => {
  if (typeof value !== "string") return value;
  if (/^(?:\d{1,3}\.){3}\d{1,3}\/32$/u.test(value)) return value.slice(0, -3);
  if (/^[A-Fa-f0-9:]+\/128$/u.test(value)) return value.slice(0, -4);
  return value;
};

const canonicalizeCheck = (check) => {
  const definition = structuredClone(check.definition || {});
  for (const endpoint of [definition.filters?.from, definition.filters?.to]) {
    if (endpoint?.location?.type === "SubnetLocationFilter") {
      endpoint.location.value = canonicalizeLocation(endpoint.location.value);
    }
  }
  return {
    definition,
    enabled: check.enabled !== false,
    perfMonitoringEnabled: check.perfMonitoringEnabled === true,
    name: check.name || "",
    note: check.note || "",
    priority: check.priority || "NOT_SET",
    tags: [...(Array.isArray(check.tags) ? check.tags : [])].sort(),
  };
};

const fingerprint = (check) => sha256(stableJson(canonicalizeCheck(check)));

export const reconcileChecks = (plannedChecks, existingChecks, expectedSourceInstanceTag) => {
  const byKey = new Map();
  const byName = new Map();
  for (const check of existingChecks) {
    const key = managedSourceKey(check);
    if (key) byKey.set(key, [...(byKey.get(key) || []), check]);
    if (check?.name) byName.set(check.name, [...(byName.get(check.name) || []), check]);
  }

  const create = [];
  const unchanged = [];
  const changed = [];
  const collision = [];
  const plannedKeys = new Set();

  for (const planned of plannedChecks) {
    const identity = inspectManagedIdentity(planned);
    const key = managedSourceKey(planned);
    if (!identity.managed || identity.sourceInstance !== expectedSourceInstanceTag || !key) {
      collision.push({ key: key || "invalid", reason: "invalid-managed-identity" });
      continue;
    }
    if (plannedKeys.has(key)) {
      collision.push({ key, reason: "duplicate-planned-source-key" });
      continue;
    }
    plannedKeys.add(key);
    const keyMatches = byKey.get(key) || [];
    const nameMatches = byName.get(planned.name) || [];
    if (keyMatches.length > 1) {
      collision.push({ key, reason: "duplicate-existing-source-key" });
      continue;
    }
    if (keyMatches.length === 0) {
      if (nameMatches.length > 0) {
        collision.push({ key, reason: "name-owned-by-another-check" });
      } else {
        create.push({ key, check: planned });
      }
      continue;
    }
    const existing = keyMatches[0];
    if (nameMatches.some((candidate) => String(candidate.id) !== String(existing.id))) {
      collision.push({ key, reason: "name-collision" });
      continue;
    }
    if (fingerprint(planned) === fingerprint(existing)) {
      unchanged.push({ key, existingId: String(existing.id) });
    } else {
      changed.push({ key, existingId: String(existing.id), check: planned });
    }
  }

  const stale = existingChecks
    .map((check) => ({ check, identity: inspectManagedIdentity(check) }))
    .filter(({ identity }) => identity.managed && identity.sourceInstance === expectedSourceInstanceTag)
    .filter(({ identity }) => !plannedKeys.has(identity.sourceKey))
    .map(({ identity }) => ({ key: identity.sourceKey }));

  return { create, unchanged, changed, stale, collision };
};

const counts = (reconciliation) => ({
  create: reconciliation.create.length,
  unchanged: reconciliation.unchanged.length,
  changed: reconciliation.changed.length,
  stale: reconciliation.stale.length,
  collision: reconciliation.collision.length,
});

const collisionReasonCounts = (collisions) => Object.fromEntries(
  [...collisions.reduce((reasons, { reason }) => {
    reasons.set(reason, (reasons.get(reason) || 0) + 1);
    return reasons;
  }, new Map()).entries()].sort(([left], [right]) => left.localeCompare(right)),
);

const planDigest = ({ networkId, snapshotId, profile, pathEvidenceDigest, reconciliation }) => sha256(stableJson({
  networkId,
  snapshotId,
  profile,
  pathEvidenceDigest,
  create: reconciliation.create
    .map(({ key, check }) => ({ key, fingerprint: fingerprint(check) }))
    .sort((left, right) => left.key.localeCompare(right.key)),
  changed: reconciliation.changed
    .map(({ key, check }) => ({ key, fingerprint: fingerprint(check) }))
    .sort((left, right) => left.key.localeCompare(right.key)),
  stale: reconciliation.stale.map(({ key }) => key).sort(),
  collision: reconciliation.collision.map(({ key, reason }) => ({ key, reason })),
}));

const chunk = (values, size) => {
  const batches = [];
  for (let index = 0; index < values.length; index += size) {
    batches.push(values.slice(index, index + size));
  }
  return batches;
};

const synchronizationInput = (request) => {
  assertKnownKeys(
    request,
    new Set([
      "sourceInstanceId", "syncMode", "forwardAccessProfile", "includeReviewRows",
      "enablePerformanceMonitoring", "dependencies", "operation", "approvedPlanDigest",
      "approvedSourceKeys", "maxCreates", "maxUpdates", "forwardBaseUrl", "forwardNetworkId",
      "runPathPreflight",
    ]),
    "Forward synchronization request",
  );
  const operation = request.operation || "plan";
  if (!new Set(["plan", "apply"]).has(operation)) {
    throw new Error("operation must be plan or apply.");
  }
  const approvedSourceKeys = request.approvedSourceKeys || [];
  if (!Array.isArray(approvedSourceKeys) || approvedSourceKeys.some((value) => typeof value !== "string")) {
    throw new Error("approvedSourceKeys must be an array of managed source-key tags.");
  }
  if (!Array.isArray(request.dependencies) || request.dependencies.length === 0) {
    throw new Error("No dependency rows selected for Forward synchronization.");
  }
  if (request.dependencies.length > MAX_DEPENDENCIES) {
    throw new Error(`dependencies exceeds the ${MAX_DEPENDENCIES}-row action limit.`);
  }
  if (request.runPathPreflight !== undefined && typeof request.runPathPreflight !== "boolean") {
    throw new Error("runPathPreflight must be a boolean.");
  }
  return {
    operation,
    approvedPlanDigest: request.approvedPlanDigest,
    approvedSourceKeys,
    maxCreates: nonNegativeInteger(request.maxCreates, 1_000, MAX_CREATE_BUDGET, "maxCreates"),
    maxUpdates: nonNegativeInteger(request.maxUpdates, 100, MAX_UPDATE_BUDGET, "maxUpdates"),
    runPathPreflight: request.runPathPreflight !== false,
    syncRequest: {
      sourceInstanceId: request.sourceInstanceId,
      syncMode: request.syncMode || "direct-api",
      forwardAccessProfile: request.forwardAccessProfile,
      includeReviewRows: request.includeReviewRows,
      enablePerformanceMonitoring: request.enablePerformanceMonitoring,
      dependencies: request.dependencies,
    },
  };
};

export const createSyncForwardIntentAction = ({
  loadConnection = loadDynatraceConnection,
  fetchImpl = globalThis.fetch,
} = {}) => async (payload) => {
  if (!payload || payload.request === undefined || payload.request === null) {
    throw new Error("Input field 'request' is missing.");
  }
  const connectionId = requiredString(payload.connectionId, "Input field 'connectionId'", 255);
  const connection = validateConnection(await loadConnection(connectionId));
  const input = synchronizationInput(parseRequest(payload.request));
  if (input.syncRequest.syncMode !== "direct-api") {
    throw new Error("syncMode must be direct-api.");
  }
  if (input.syncRequest.forwardAccessProfile !== connection.forwardAccessProfile) {
    throw new Error("Request and Forward connection access profiles must match exactly.");
  }

  const api = createForwardClient({ connection, fetchImpl });
  const snapshotResponse = await api(
    "GET",
    `/networks/${encodeURIComponent(connection.networkId)}/snapshots/latestProcessed`,
  );
  const snapshotId = latestProcessedSnapshot(snapshotResponse);
  const hostResolution = await resolveDependencyEvidence({
    dependencies: input.syncRequest.dependencies,
    api,
    networkId: connection.networkId,
    snapshotId,
  });
  const pathEvidence = input.runPathPreflight
    ? await evaluatePathEvidence({
        dependencies: hostResolution.dependencies,
        api,
        networkId: connection.networkId,
        snapshotId,
      })
    : null;
  const packageResult = forwardSync({
    ...input.syncRequest,
    dependencies: hostResolution.dependencies,
  });
  if (packageResult.status !== "ready") throw new Error(packageResult.summary);
  const manifest = JSON.parse(packageResult.exportManifestPreview);
  const plannedChecks = JSON.parse(packageResult.intentChecksPreview);
  const existingResponse = await api(
    "GET",
    `/snapshots/${encodeURIComponent(snapshotId)}/checks?type=Existential`,
  );
  const existingChecks = listFrom(existingResponse, ["checks", "items"]);
  let reconciliation = reconcileChecks(
    plannedChecks,
    existingChecks,
    sourceInstanceTag(input.syncRequest.sourceInstanceId),
  );
  const digest = planDigest({
    networkId: connection.networkId,
    snapshotId,
    profile: connection.forwardAccessProfile,
    pathEvidenceDigest: pathEvidence ? sha256(stableJson(pathEvidence.rows)) : null,
    reconciliation,
  });

  const baseResponse = {
    schemaVersion: "forward-dynatrace-direct-sync/v1",
    operation: input.operation,
    packageId: manifest.packageId,
    generatedAt: packageResult.generatedAt,
    forwardAccessProfile: connection.forwardAccessProfile,
    target: { networkId: connection.networkId, snapshotId },
    hostResolution: { counts: hostResolution.report.counts },
    pathEvidence: pathEvidence
      ? {
          status: "completed",
          modeledReachabilityAssessment: pathEvidence.modeledReachabilityAssessment,
          counts: pathEvidence.counts,
        }
      : { status: "not-run" },
    planDigest: digest,
    counts: counts(reconciliation),
    changedSourceKeys: reconciliation.changed.map(({ key }) => key).sort(),
    staleSourceKeys: reconciliation.stale.map(({ key }) => key).sort(),
    collisionSourceKeys: reconciliation.collision.map(({ key }) => key).sort(),
    collisionReasonCounts: collisionReasonCounts(reconciliation.collision),
    mutationCounts: { created: 0, updated: 0 },
    postApplyVerification: "not-run",
    boundary: "tenant-managed-secret-backend-only",
  };

  if (input.operation === "plan") return baseResponse;
  if (!canWriteIntentChecks(connection.forwardAccessProfile)) {
    throw new Error("Only a Network Admin connection may apply intent-check creates or updates.");
  }
  if (
    pathEvidence &&
    (pathEvidence.counts.failed > 0 ||
      pathEvidence.counts.ambiguous > 0 ||
      pathEvidence.counts.unmapped > 0)
  ) {
    throw new Error("Forward apply is blocked by incomplete modeled path evidence.");
  }
  if (reconciliation.collision.length > 0) {
    throw new Error("Forward apply is blocked by managed identity or name collisions.");
  }
  const approvedDigest = requiredString(input.approvedPlanDigest, "approvedPlanDigest", 128);
  if (!/^[a-f0-9]{64}$/u.test(approvedDigest) || approvedDigest !== digest) {
    throw new Error("approvedPlanDigest does not match the current immutable plan.");
  }
  if (reconciliation.create.length > input.maxCreates) {
    throw new Error("Create count exceeds the approved mutation budget.");
  }
  if (reconciliation.changed.length > input.maxUpdates) {
    throw new Error("Update count exceeds the approved mutation budget.");
  }
  const changedKeys = reconciliation.changed.map(({ key }) => key).sort();
  const approvedKeys = [...new Set(input.approvedSourceKeys)].sort();
  if (stableJson(changedKeys) !== stableJson(approvedKeys)) {
    throw new Error("approvedSourceKeys must exactly match every changed managed check in the plan.");
  }

  let created = 0;
  let updated = 0;
  try {
    for (const batch of chunk(reconciliation.create, DEFAULT_BATCH_SIZE)) {
      await api(
        "POST",
        `/snapshots/${encodeURIComponent(snapshotId)}/checks?bulk`,
        batch.map(({ check }) => check),
      );
      created += batch.length;
    }
    for (const item of reconciliation.changed) {
      await api(
        "PATCH",
        `/snapshots/${encodeURIComponent(snapshotId)}/checks/${encodeURIComponent(item.existingId)}`,
        item.check,
      );
      updated += 1;
    }
  } catch (error) {
    const status = String(error?.message || "").match(/HTTP (\d{3})/u)?.[1] || "unknown";
    throw new Error(`Forward apply stopped with HTTP ${status}; reconcile current state and stage a new plan.`);
  }

  const verificationResponse = await api(
    "GET",
    `/snapshots/${encodeURIComponent(snapshotId)}/checks?type=Existential`,
  );
  reconciliation = reconcileChecks(
    plannedChecks,
    listFrom(verificationResponse, ["checks", "items"]),
    sourceInstanceTag(input.syncRequest.sourceInstanceId),
  );
  const verificationCounts = counts(reconciliation);
  if (
    verificationCounts.create !== 0 ||
    verificationCounts.changed !== 0 ||
    verificationCounts.collision !== 0
  ) {
    throw new Error("Forward post-apply verification failed; stage a new plan before another mutation.");
  }

  return {
    ...baseResponse,
    counts: verificationCounts,
    mutationCounts: { created, updated },
    postApplyVerification: "verified",
  };
};

export default createSyncForwardIntentAction();
