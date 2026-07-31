import {
  getApprovalNonce,
  getTrustedActionContext,
} from "@dynatrace-sdk/automation-action-utils/actions";
import type {
  TrustedActionContext,
} from "@dynatrace-sdk/automation-action-utils/actions";

import {
  sourceInstanceTag,
} from "./managed-check-identity.ts";
import {
  canWriteIntentChecks,
  isForwardAccessProfile,
} from "./forward-access-profile.ts";
import {
  evaluatePathEvidence,
  resolveDependencyEvidence,
} from "./forward-evidence.ts";
import {
  createForwardClient,
  latestProcessedSnapshot,
  parseCheckList,
} from "./forward-client.ts";
import {
  loadDynatraceCredential,
  loadDynatraceConnection,
  resolveForwardConnection,
} from "./forward-connection.ts";
import type {
  CredentialLoader,
} from "./forward-connection.ts";
import { buildForwardIntentPackage } from "./intent-builder.ts";
import {
  collisionReasonCounts,
  planDigest,
  reconciliationCounts,
  reconcileChecks,
  sha256,
  stableJson,
} from "./reconciliation.ts";
import type {
  DependencyCandidate,
  ForwardIntentCheck,
  ForwardSyncRequest,
} from "./types/index.ts";

const DEFAULT_BATCH_SIZE = 100;
const MAX_CREATE_BUDGET = 2_500;
const MAX_UPDATE_BUDGET = 1_000;
const MAX_DEPENDENCIES = 2_500;
// A live single-item PATCH/restore probe on Forward network 252606 observed a
// raw 735-update arithmetic ceiling under the 120-second action deadline.
// Five hundred reserves roughly 32% of that deadline for evidence collection,
// reconciliation, full-inventory reads, readback, and latency variance.
const SAFE_SEQUENTIAL_UPDATE_LIMIT = 500;
const ENGINE_APPROVAL_TTL_MS = 15 * 60 * 1_000;

const isRecord = (value: unknown): value is Record<string, unknown> =>
  Boolean(value) && typeof value === "object" && !Array.isArray(value);

const requiredString = (
  value: unknown,
  label: string,
  maxLength = 4096,
): string => {
  const normalized = typeof value === "string" ? value.trim() : "";
  if (!normalized) throw new Error(`${label} must be a non-empty string.`);
  if (normalized.length > maxLength) throw new Error(`${label} exceeds ${maxLength} characters.`);
  return normalized;
};

const nonNegativeInteger = (
  value: unknown,
  fallback: number,
  maximum: number,
  label: string,
): number => {
  const candidate = value === undefined ? fallback : value;
  if (
    typeof candidate !== "number" ||
    !Number.isInteger(candidate) ||
    candidate < 0 ||
    candidate > maximum
  ) {
    throw new Error(`${label} must be an integer from 0 through ${maximum}.`);
  }
  return candidate;
};

const assertKnownKeys = (
  value: Record<string, unknown>,
  allowed: ReadonlySet<string>,
  label: string,
): void => {
  const unknown = Object.keys(value).filter((key) => !allowed.has(key));
  if (unknown.length > 0) {
    throw new Error(`${label} contains unsupported fields: ${unknown.join(", ")}.`);
  }
};

const parseRequest = (value: unknown): Record<string, unknown> => {
  let request: unknown = value;
  if (typeof request === "string") {
    try {
      const parsed: unknown = JSON.parse(request);
      request = parsed;
    } catch (error) {
      const detail = error instanceof Error ? error.message : "unknown parse error";
      throw new Error(`Forward synchronization request is not valid JSON: ${detail}`);
    }
  }
  if (!isRecord(request)) {
    throw new Error("Forward synchronization request must be a JSON object.");
  }
  return request;
};

const chunk = <Value>(values: Value[], size: number): Value[][] => {
  const batches: Value[][] = [];
  for (let index = 0; index < values.length; index += size) {
    batches.push(values.slice(index, index + size));
  }
  return batches;
};

const DEPENDENCY_FIELDS = new Set([
  "id", "appName", "environment", "serviceEntityId", "serviceName",
  "sourceLabel", "source", "sourceFilterType", "sourceResolvedValue",
  "sourceResolvedFilterType", "sourceResolutionStatus",
  "destinationLabel", "destination", "destinationFilterType",
  "destinationResolvedValue", "destinationResolvedFilterType",
  "destinationResolutionStatus",
  "protocol", "port", "owner", "criticality", "confidence", "mappingState",
]);
const DEPENDENCY_PROTOCOLS = new Set<unknown>(["tcp", "udp"]);
const DEPENDENCY_CRITICALITIES = new Set<unknown>([
  "critical",
  "high",
  "medium",
  "low",
]);
const DEPENDENCY_MAPPING_STATES = new Set<unknown>([
  "ready",
  "needs-map",
  "review",
]);
const DEPENDENCY_FILTER_TYPES = new Set<unknown>([
  "HostFilter", "DeviceFilter", "SubnetLocationFilter",
]);

const optionalString = (
  value: unknown,
  label: string,
  maxLength: number,
): string | undefined => {
  if (value === undefined) return undefined;
  return requiredString(value, label, maxLength);
};

// Permits the empty string, unlike requiredString, but still enforces the type
// and the length bound.
const boundedOptionalString = (
  value: unknown,
  label: string,
  maxLength: number,
): string => {
  if (typeof value !== "string") throw new Error(`${label} must be a string.`);
  if (value.length > maxLength) throw new Error(`${label} exceeds ${maxLength} characters.`);
  return value.trim();
};

const optionalEnum = (
  value: unknown,
  allowed: ReadonlySet<unknown>,
  label: string,
): string | undefined => {
  if (value === undefined) return undefined;
  if (typeof value !== "string" || !allowed.has(value)) {
    throw new Error(`${label} must be one of ${[...allowed].sort().join(", ")}.`);
  }
  return value;
};

// TypeScript interfaces give the Workflow action no runtime protection: the
// caller supplies `dependencies` directly. Every field that reaches a Forward
// payload or a path query is validated here so that an unmodelled value cannot
// be interpreted differently by path preflight and by check generation.
const validateDependency = (
  dependency: unknown,
  index: number,
): DependencyCandidate => {
  const label = `dependencies[${index}]`;
  if (!isRecord(dependency)) {
    throw new Error(`${label} must be a JSON object.`);
  }
  assertKnownKeys(dependency, DEPENDENCY_FIELDS, label);

  // Validated first because the identity-field rules below branch on it.
  if (!DEPENDENCY_MAPPING_STATES.has(dependency.mappingState)) {
    throw new Error(`${label}.mappingState must be ready, needs-map, or review.`);
  }

  requiredString(dependency.id, `${label}.id`, 255);
  requiredString(dependency.appName, `${label}.appName`, 255);
  requiredString(dependency.environment, `${label}.environment`, 255);
  requiredString(dependency.serviceName, `${label}.serviceName`, 255);
  requiredString(dependency.owner, `${label}.owner`, 255);

  // serviceEntityId, source, and destination are legitimately empty on
  // needs-map rows: discovery marks a row needs-map precisely because one of
  // them is missing, and such rows are filtered out before export rather than
  // rejected. They must be present and bounded on any row that can reach a
  // Forward payload.
  const identityFields = ["serviceEntityId", "source", "destination"];
  if (dependency.mappingState === "needs-map") {
    for (const key of identityFields) {
      if (dependency[key] !== undefined) {
        boundedOptionalString(dependency[key], `${label}.${key}`, 512);
      }
    }
  } else {
    requiredString(dependency.serviceEntityId, `${label}.serviceEntityId`, 255);
    requiredString(dependency.source, `${label}.source`, 512);
    requiredString(dependency.destination, `${label}.destination`, 512);
  }

  optionalString(dependency.sourceLabel, `${label}.sourceLabel`, 255);
  optionalString(dependency.destinationLabel, `${label}.destinationLabel`, 255);
  optionalString(dependency.sourceResolvedValue, `${label}.sourceResolvedValue`, 512);
  optionalString(dependency.destinationResolvedValue, `${label}.destinationResolvedValue`, 512);
  optionalString(dependency.sourceResolutionStatus, `${label}.sourceResolutionStatus`, 64);
  optionalString(dependency.destinationResolutionStatus, `${label}.destinationResolutionStatus`, 64);

  optionalEnum(dependency.sourceFilterType, DEPENDENCY_FILTER_TYPES, `${label}.sourceFilterType`);
  optionalEnum(dependency.destinationFilterType, DEPENDENCY_FILTER_TYPES, `${label}.destinationFilterType`);
  optionalEnum(dependency.sourceResolvedFilterType, DEPENDENCY_FILTER_TYPES, `${label}.sourceResolvedFilterType`);
  optionalEnum(dependency.destinationResolvedFilterType, DEPENDENCY_FILTER_TYPES, `${label}.destinationResolvedFilterType`);

  // Anything outside this set would be scored as TCP by path preflight and
  // emitted as UDP by check generation.
  if (typeof dependency.protocol !== "string" || !DEPENDENCY_PROTOCOLS.has(dependency.protocol)) {
    throw new Error(`${label}.protocol must be tcp or udp.`);
  }
  const port = Number(dependency.port);
  if (
    typeof dependency.port !== "string" ||
    !/^\d{1,5}$/u.test(dependency.port) ||
    port < 1 ||
    port > 65_535
  ) {
    throw new Error(`${label}.port must be a decimal string from 1 through 65535.`);
  }
  if (
    typeof dependency.confidence !== "number" ||
    !Number.isInteger(dependency.confidence) ||
    dependency.confidence < 0 ||
    dependency.confidence > 100
  ) {
    throw new Error(`${label}.confidence must be an integer from 0 through 100.`);
  }
  if (!DEPENDENCY_CRITICALITIES.has(dependency.criticality)) {
    throw new Error(`${label}.criticality must be critical, high, medium, or low.`);
  }
  return dependency as unknown as DependencyCandidate;
};

interface SynchronizationInput {
  operation: "plan" | "apply";
  approvalMode: "digest" | "engine-approval";
  approvalNonce: unknown;
  approvedPlanDigest: unknown;
  approvedSourceKeys: string[];
  applySourceKeys: string[] | null;
  maxCreates: number;
  maxUpdates: number;
  runPathPreflight: boolean;
  syncRequest: ForwardSyncRequest;
}

const synchronizationInput = (
  request: Record<string, unknown>,
): SynchronizationInput => {
  assertKnownKeys(
    request,
    new Set([
      "sourceInstanceId", "syncMode", "forwardAccessProfile", "includeReviewRows",
      "enablePerformanceMonitoring", "dependencies", "operation", "approvedPlanDigest",
      "approvedSourceKeys", "maxCreates", "maxUpdates", "forwardBaseUrl", "forwardNetworkId",
      "runPathPreflight", "approvalMode", "approvalNonce", "applySourceKeys",
    ]),
    "Forward synchronization request",
  );
  const operation = request.operation || "plan";
  if (operation !== "plan" && operation !== "apply") {
    throw new Error("operation must be plan or apply.");
  }
  const approvalMode = request.approvalMode === undefined
    ? "digest"
    : request.approvalMode;
  if (approvalMode !== "digest" && approvalMode !== "engine-approval") {
    throw new Error("approvalMode must be digest or engine-approval.");
  }
  const approvedSourceKeys = request.approvedSourceKeys || [];
  if (
    !Array.isArray(approvedSourceKeys) ||
    !approvedSourceKeys.every(
      (value): value is string => typeof value === "string",
    )
  ) {
    throw new Error("approvedSourceKeys must be an array of managed source-key tags.");
  }
  const applySourceKeysValue = request.applySourceKeys;
  if (
    applySourceKeysValue !== undefined &&
    (!Array.isArray(applySourceKeysValue) ||
      !applySourceKeysValue.every(
        (value): value is string => typeof value === "string",
      ))
  ) {
    throw new Error("applySourceKeys must be an array of managed source-key tags.");
  }
  const applySourceKeys = applySourceKeysValue === undefined
    ? null
    : applySourceKeysValue;
  if (applySourceKeys && new Set(applySourceKeys).size !== applySourceKeys.length) {
    throw new Error("applySourceKeys must not contain duplicate managed source-key tags.");
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
  // Apply must never run against a plan that skipped modeled path evidence.
  // Without this the evidence gate below is simply absent, because a null
  // pathEvidence short-circuits it.
  if (operation === "apply" && request.runPathPreflight === false) {
    throw new Error(
      "runPathPreflight must not be disabled for apply; modeled path evidence is required before any mutation.",
    );
  }
  const dependencies = request.dependencies.map(validateDependency);
  const duplicateIds = dependencies
    .map((dependency) => dependency.id)
    .filter((id, index, ids) => ids.indexOf(id) !== index);
  if (duplicateIds.length > 0) {
    throw new Error(`dependencies contains duplicate dependency identifiers: ${[...new Set(duplicateIds)].sort().join(", ")}.`);
  }
  const syncMode = request.syncMode || "direct-api";
  if (syncMode !== "direct-api") {
    throw new Error("syncMode must be direct-api.");
  }
  if (!isForwardAccessProfile(request.forwardAccessProfile)) {
    throw new Error(
      "Forward access profile must be read-only, network-operator, or network-admin.",
    );
  }
  if (
    request.includeReviewRows !== undefined &&
    typeof request.includeReviewRows !== "boolean"
  ) {
    throw new Error("includeReviewRows must be a boolean.");
  }
  if (
    request.enablePerformanceMonitoring !== undefined &&
    typeof request.enablePerformanceMonitoring !== "boolean"
  ) {
    throw new Error("enablePerformanceMonitoring must be a boolean.");
  }
  const sourceInstanceId = requiredString(
    request.sourceInstanceId,
    "sourceInstanceId",
    128,
  );
  return {
    operation,
    approvalMode,
    approvalNonce: request.approvalNonce,
    approvedPlanDigest: request.approvedPlanDigest,
    approvedSourceKeys,
    applySourceKeys,
    maxCreates: nonNegativeInteger(request.maxCreates, 1_000, MAX_CREATE_BUDGET, "maxCreates"),
    maxUpdates: nonNegativeInteger(request.maxUpdates, 100, MAX_UPDATE_BUDGET, "maxUpdates"),
    runPathPreflight: request.runPathPreflight !== false,
    syncRequest: {
      sourceInstanceId,
      syncMode,
      forwardAccessProfile: request.forwardAccessProfile,
      includeReviewRows: request.includeReviewRows,
      enablePerformanceMonitoring: request.enablePerformanceMonitoring,
      dependencies,
    },
  };
};

type ConnectionLoader = (connectionId: string) => Promise<unknown>;
type TrustedActionContextLoader = () => TrustedActionContext | null;
type ApprovalNonceLoader = () => string;
type Clock = () => number;

interface AuthorizationEvidence {
  mode: "digest" | "engine-approval";
  approvalOutcome?: "APPROVED";
  approvalNonceSha256?: string;
  planGeneratedAt?: string;
  expiresAt?: string;
  ttlSeconds?: number;
}

const engineApprovalEvidence = ({
  approvalNonce,
  approvedPlanDigest,
  loadApprovalNonce,
  now,
  trustedActionContext,
}: {
  approvalNonce: unknown;
  approvedPlanDigest: string;
  loadApprovalNonce: ApprovalNonceLoader;
  now: Clock;
  trustedActionContext: TrustedActionContext | null;
}): AuthorizationEvidence => {
  const approval = trustedActionContext?.approval;
  if (!approval) {
    throw new Error(
      "engine-approval mode requires trusted Dynatrace Workflow approval context.",
    );
  }
  if (approval.outcome !== "APPROVED") {
    throw new Error(
      `engine-approval mode requires an APPROVED engine outcome; received ${approval.outcome}.`,
    );
  }
  if (!isRecord(approval.originalResult)) {
    throw new Error(
      "engine-approval mode requires the engine-carried original plan result.",
    );
  }
  const originalResult = approval.originalResult;
  if (
    originalResult.schemaVersion !== "forward-dynatrace-direct-sync/v1" ||
    originalResult.operation !== "plan" ||
    originalResult.planDigest !== approvedPlanDigest
  ) {
    throw new Error(
      "engine-approval original plan does not match the current immutable plan.",
    );
  }
  const planGeneratedAt = requiredString(
    originalResult.generatedAt,
    "engine-approval original plan generatedAt",
    64,
  );
  const generatedAtMs = Date.parse(planGeneratedAt);
  const ageMs = now() - generatedAtMs;
  if (!Number.isFinite(generatedAtMs) || ageMs < 0 || ageMs > ENGINE_APPROVAL_TTL_MS) {
    throw new Error(
      "engine-approval original plan is stale or has an invalid generation time.",
    );
  }
  const suppliedNonce = requiredString(
    approvalNonce,
    "approvalNonce",
    512,
  );
  let trustedNonce: string;
  try {
    trustedNonce = requiredString(
      loadApprovalNonce(),
      "engine-provided approval nonce",
      512,
    );
  } catch {
    throw new Error(
      "engine-approval mode requires an engine-provided approval nonce.",
    );
  }
  if (suppliedNonce !== trustedNonce) {
    throw new Error("approvalNonce does not match the engine-provided approval nonce.");
  }
  return {
    mode: "engine-approval",
    approvalOutcome: "APPROVED",
    approvalNonceSha256: sha256(trustedNonce),
    planGeneratedAt,
    expiresAt: new Date(generatedAtMs + ENGINE_APPROVAL_TTL_MS).toISOString(),
    ttlSeconds: ENGINE_APPROVAL_TTL_MS / 1_000,
  };
};

const isStringArray = (value: unknown): value is string[] =>
  Array.isArray(value) &&
  value.every((item): item is string => typeof item === "string");

const isForwardEndpoint = (value: unknown): boolean => {
  if (!isRecord(value) || !isRecord(value.location)) return false;
  if (
    !DEPENDENCY_FILTER_TYPES.has(value.location.type) ||
    typeof value.location.value !== "string"
  ) {
    return false;
  }
  if (value.headers === undefined) return true;
  return (
    Array.isArray(value.headers) &&
    value.headers.every((header) => {
      if (
        !isRecord(header) ||
        header.type !== "PacketFilter" ||
        !isRecord(header.values)
      ) {
        return false;
      }
      return Object.values(header.values).every(isStringArray);
    })
  );
};

const isForwardIntentCheck = (
  value: unknown,
): value is ForwardIntentCheck => {
  if (
    !isRecord(value) ||
    typeof value.enabled !== "boolean" ||
    typeof value.perfMonitoringEnabled !== "boolean" ||
    typeof value.name !== "string" ||
    typeof value.note !== "string" ||
    (value.priority !== "LOW" &&
      value.priority !== "MEDIUM" &&
      value.priority !== "HIGH") ||
    !isStringArray(value.tags) ||
    !isRecord(value.definition)
  ) {
    return false;
  }
  const definition = value.definition;
  if (
    (definition.checkType !== "Existential" &&
      definition.checkType !== "Reachability") ||
    !isRecord(definition.filters) ||
    !isForwardEndpoint(definition.filters.from) ||
    !isForwardEndpoint(definition.filters.to) ||
    !isStringArray(definition.headerFieldsWithDefaults) ||
    !isStringArray(definition.noiseTypes)
  ) {
    return false;
  }
  return (
    (definition.filters.flowTypes === undefined ||
      isStringArray(definition.filters.flowTypes)) &&
    (definition.returnPath === undefined ||
      definition.returnPath === "ANY" ||
      definition.returnPath === "SYMMETRIC")
  );
};

export const createSyncForwardIntentAction = ({
  loadConnection = loadDynatraceConnection,
  loadCredential = loadDynatraceCredential,
  fetchImpl = globalThis.fetch,
  loadTrustedActionContext = getTrustedActionContext,
  loadApprovalNonce = getApprovalNonce,
  now = Date.now,
}: {
  loadConnection?: ConnectionLoader;
  loadCredential?: CredentialLoader;
  fetchImpl?: typeof globalThis.fetch;
  loadTrustedActionContext?: TrustedActionContextLoader;
  loadApprovalNonce?: ApprovalNonceLoader;
  now?: Clock;
} = {}) => async (payload: unknown): Promise<unknown> => {
  if (
    !isRecord(payload) ||
    payload.request === undefined ||
    payload.request === null
  ) {
    throw new Error("Input field 'request' is missing.");
  }
  const connectionId = requiredString(payload.connectionId, "Input field 'connectionId'", 255);
  const connection = await resolveForwardConnection(
    await loadConnection(connectionId),
    loadCredential,
  );
  const input = synchronizationInput(parseRequest(payload.request));
  const trustedActionContext = loadTrustedActionContext();
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
  const packageResult = buildForwardIntentPackage({
    ...input.syncRequest,
    dependencies: hostResolution.dependencies,
  });
  if (packageResult.status !== "ready") throw new Error(packageResult.summary);
  const manifest = packageResult.exportManifest;
  if (!manifest || typeof manifest.packageId !== "string") {
    throw new Error("Generated Forward manifest is invalid.");
  }
  const plannedChecks = packageResult.intentChecks;
  if (!plannedChecks.every(isForwardIntentCheck)) {
    throw new Error("Generated Forward intent-check list is invalid.");
  }
  const existingResponse = await api(
    "GET",
    `/snapshots/${encodeURIComponent(snapshotId)}/checks?type=Existential`,
  );
  const existingChecks = parseCheckList(existingResponse);
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
    budgets: { maxCreates: input.maxCreates, maxUpdates: input.maxUpdates },
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
    counts: reconciliationCounts(reconciliation),
    changedSourceKeys: reconciliation.changed.map(({ key }) => key).sort(),
    staleSourceKeys: reconciliation.stale.map(({ key }) => key).sort(),
    collisionSourceKeys: reconciliation.collision.map(({ key }) => key).sort(),
    collisionReasonCounts: collisionReasonCounts(reconciliation.collision),
    mutationCounts: { created: 0, updated: 0 },
    postApplyVerification: "not-run",
    boundary: "tenant-managed-secret-backend-only",
    ...(trustedActionContext
      ? {
          executionContext: {
            trustedWorkflowInvocation: true,
            approverIdentityAvailable: false,
            usedForAuthorization: false,
            ...(trustedActionContext.approval
              ? { approvalOutcome: trustedActionContext.approval.outcome }
              : {}),
          },
        }
      : {}),
  };

  if (input.operation === "plan") return baseResponse;
  if (!canWriteIntentChecks(connection.forwardAccessProfile)) {
    throw new Error("Only a Network Admin connection may apply intent-check creates or updates.");
  }
  if (!pathEvidence) {
    throw new Error("Forward apply is blocked because modeled path evidence was not collected.");
  }
  if (
    pathEvidence.counts.failed > 0 ||
    pathEvidence.counts.ambiguous > 0 ||
    pathEvidence.counts.unmapped > 0
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

  const recheckPlanAgainstCurrentState = async () => {
    const verificationResponse = await api(
      "GET",
      `/snapshots/${encodeURIComponent(snapshotId)}/checks?type=Existential`,
    );
    const recheckedReconciliation = reconcileChecks(
      plannedChecks,
      parseCheckList(verificationResponse),
      sourceInstanceTag(input.syncRequest.sourceInstanceId),
    );
    const recheckedDigest = planDigest({
      networkId: connection.networkId,
      snapshotId,
      profile: connection.forwardAccessProfile,
      pathEvidenceDigest: pathEvidence ? sha256(stableJson(pathEvidence.rows)) : null,
      reconciliation: recheckedReconciliation,
      budgets: { maxCreates: input.maxCreates, maxUpdates: input.maxUpdates },
    });
    if (recheckedDigest !== approvedDigest) {
      throw new Error("approvedPlanDigest does not match the current immutable plan.");
    }
    return recheckedReconciliation;
  };

  reconciliation = await recheckPlanAgainstCurrentState();
  if (reconciliation.create.length > input.maxCreates) {
    throw new Error("Create count exceeds the approved mutation budget.");
  }
  if (reconciliation.changed.length > input.maxUpdates) {
    throw new Error("Update count exceeds the approved mutation budget.");
  }
  const changedKeys = reconciliation.changed.map(({ key }) => key).sort();
  const applyKeys = input.applySourceKeys === null
    ? changedKeys
    : [...input.applySourceKeys].sort();
  const changedKeySet = new Set(changedKeys);
  if (applyKeys.some((key) => !changedKeySet.has(key))) {
    throw new Error("applySourceKeys must be a subset of the current plan's changed managed checks.");
  }
  if (input.applySourceKeys !== null && applyKeys.length === 0) {
    throw new Error("applySourceKeys must select at least one current changed managed check.");
  }
  if (applyKeys.length > SAFE_SEQUENTIAL_UPDATE_LIMIT) {
    throw new Error(
      input.applySourceKeys === null
        ? `Update count ${applyKeys.length} exceeds the safe per-invocation limit of ${SAFE_SEQUENTIAL_UPDATE_LIMIT} sequential Forward PATCH requests under the 120-second AppEngine deadline. Split dependencies into smaller independently planned and approved applies; no Forward mutations were attempted.`
        : `Update count ${applyKeys.length} exceeds the safe per-invocation limit of ${SAFE_SEQUENTIAL_UPDATE_LIMIT} sequential Forward PATCH requests under the 120-second AppEngine deadline. Select a smaller applySourceKeys partition and obtain an exact approval; no Forward mutations were attempted.`,
    );
  }
  const approvedKeys = [...new Set(input.approvedSourceKeys)].sort();
  if (stableJson(applyKeys) !== stableJson(approvedKeys)) {
    throw new Error("approvedSourceKeys must exactly match the changed managed checks selected for this apply.");
  }
  const authorization: AuthorizationEvidence = input.approvalMode === "engine-approval"
    ? engineApprovalEvidence({
        approvalNonce: input.approvalNonce,
        approvedPlanDigest: approvedDigest,
        loadApprovalNonce,
        now,
        trustedActionContext,
      })
    : { mode: "digest" };
  const applyKeySet = new Set(applyKeys);
  const selectedChanges = reconciliation.changed.filter(({ key }) => applyKeySet.has(key));

  let created = 0;
  let updated = 0;
  const plannedCreates = reconciliation.create.length;
  const plannedUpdates = selectedChanges.length;
  try {
    for (const batch of chunk(reconciliation.create, DEFAULT_BATCH_SIZE)) {
      await api(
        "POST",
        `/snapshots/${encodeURIComponent(snapshotId)}/checks?bulk`,
        batch.map(({ check }) => check),
      );
      created += batch.length;
    }
    for (const item of selectedChanges) {
      await api(
        "PATCH",
        `/snapshots/${encodeURIComponent(snapshotId)}/checks/${encodeURIComponent(item.existingId)}`,
        item.check,
      );
      updated += 1;
    }
  } catch (error) {
    const status = String(error instanceof Error ? error.message : "")
      .match(/HTTP (\d{3})/u)?.[1] || "unknown";
    throw new Error(
      `Forward apply stopped with HTTP ${status}; reconcile current state and stage a new plan. Confirmed progress before the failed request: created ${created}/${plannedCreates}, updated ${updated}/${plannedUpdates}.`,
    );
  }

  let verificationResponse: unknown;
  try {
    verificationResponse = await api(
      "GET",
      `/snapshots/${encodeURIComponent(snapshotId)}/checks?type=Existential`,
    );
  } catch (error) {
    const status = String(error instanceof Error ? error.message : "")
      .match(/HTTP (\d{3})/u)?.[1] || "unknown";
    throw new Error(
      `Forward post-apply verification stopped with HTTP ${status}; reconcile current state and stage a new plan. Mutation progress before readback: created ${created}/${plannedCreates}, updated ${updated}/${plannedUpdates}.`,
    );
  }
  reconciliation = reconcileChecks(
    plannedChecks,
    parseCheckList(verificationResponse),
    sourceInstanceTag(input.syncRequest.sourceInstanceId),
  );
  const verificationCounts = reconciliationCounts(reconciliation);
  const outstandingSourceKeys = reconciliation.changed.map(({ key }) => key).sort();
  const unconvergedAppliedSourceKeys = outstandingSourceKeys.filter((key) =>
    applyKeySet.has(key));
  if (
    verificationCounts.create !== 0 ||
    verificationCounts.collision !== 0 ||
    unconvergedAppliedSourceKeys.length !== 0 ||
    (input.applySourceKeys === null && verificationCounts.changed !== 0)
  ) {
    throw new Error(
      `Forward post-apply verification failed; stage a new plan before another mutation. Mutation progress: created ${created}/${plannedCreates}, updated ${updated}/${plannedUpdates}.`,
    );
  }

  return {
    ...baseResponse,
    counts: verificationCounts,
    mutationCounts: { created, updated },
    postApplyVerification: "verified",
    authorization,
    applyScope: {
      mode: input.applySourceKeys === null ? "full-plan" : "partition",
      appliedSourceKeys: applyKeys,
      outstandingSourceKeys,
      outstandingCount: outstandingSourceKeys.length,
    },
    ...(input.approvalMode === "engine-approval" && baseResponse.executionContext
      ? {
          executionContext: {
            ...baseResponse.executionContext,
            usedForAuthorization: true,
          },
        }
      : {}),
  };
};

export default createSyncForwardIntentAction();
