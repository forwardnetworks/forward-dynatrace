import { createHash } from "node:crypto";

import * as appSettingsV2 from "@dynatrace-sdk/client-app-settings-v2";

import forwardSync from "../api/forward-sync.function.ts";
import {
  inspectManagedIdentity,
  managedSourceKey,
  sourceInstanceTag,
} from "../lib/managed-check-identity.ts";
import {
  canWriteIntentChecks,
  isForwardAccessProfile,
} from "../lib/forward-access-profile.ts";
import {
  evaluatePathEvidence,
  resolveDependencyEvidence,
} from "../lib/forward-evidence.ts";
import type {
  DependencyCandidate,
  ForwardAccessProfile,
  ForwardApiClient,
  ForwardIntentCheck,
  ForwardReconciliation,
  ForwardSyncRequest,
} from "../lib/types/index.ts";

const CONNECTION_SCHEMA = "forward-api-connection";
const MAX_RESPONSE_BYTES = 5 * 1024 * 1024;
const DEFAULT_TIMEOUT_MS = 30_000;
const DEFAULT_INVOCATION_TIMEOUT_MS = 120_000;
const DEFAULT_BATCH_SIZE = 100;
const MAX_CREATE_BUDGET = 2_500;
const MAX_UPDATE_BUDGET = 1_000;
const MAX_DEPENDENCIES = 2_500;
const MAX_RETRY_DELAY_MS = 1_000;
const DEFAULT_RETRY_JITTER_PERCENT = 0.25;
const TRANSIENT_STATUS_CODES = new Set([408, 429, 500, 502, 503, 504]);
const CSRF_ERROR_TOKEN_PATTERN = /csrf|xsrf/i;

export interface ForwardConnection {
  baseUrl: string;
  networkId: string;
  authorization: string;
  forwardAccessProfile: ForwardAccessProfile;
  approvedLibraryQueryIds: string[];
  approvedQueryDigests: string[];
}

interface AppSettingsConnectionClient {
  getAppSettingsObjectByObjectId: (input: {
    objectId: string;
  }) => Promise<unknown>;
}

export interface ForwardClientOptions {
  timeoutMs?: number;
  invocationTimeoutMs?: number;
  maxRetries?: number;
}

const isRecord = (value: unknown): value is Record<string, unknown> =>
  Boolean(value) && typeof value === "object" && !Array.isArray(value);

const isAppSettingsConnectionClient = (
  value: unknown,
): value is AppSettingsConnectionClient =>
  isRecord(value) &&
  typeof value.getAppSettingsObjectByObjectId === "function";

const defaultAppSettingsExport: unknown = Reflect.get(appSettingsV2, "default");
const defaultAppSettingsClient = isRecord(defaultAppSettingsExport)
  ? defaultAppSettingsExport.appSettingsObjectsClient
  : undefined;
const namedAppSettingsClient: unknown = appSettingsV2.appSettingsObjectsClient;
const appSettingsObjectsClient = isAppSettingsConnectionClient(
  namedAppSettingsClient,
)
  ? namedAppSettingsClient
  : isAppSettingsConnectionClient(defaultAppSettingsClient)
    ? defaultAppSettingsClient
    : undefined;

const sha256 = (value: string): string =>
  createHash("sha256").update(value).digest("hex");

const sortObject = (value: unknown): unknown => {
  if (Array.isArray(value)) return value.map(sortObject);
  if (isRecord(value)) {
    return Object.fromEntries(
      Object.entries(value)
        .sort(([left], [right]) => left.localeCompare(right))
        .map(([key, child]) => [key, sortObject(child)]),
    );
  }
  return value;
};

const stableJson = (value: unknown): string =>
  JSON.stringify(sortObject(value));

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

const forwardBaseUrl = (value: unknown): string => {
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

export const loadDynatraceConnection = async (
  connectionId: string,
): Promise<unknown> =>
  appSettingsObjectsClient?.getAppSettingsObjectByObjectId({ objectId: connectionId });

const FORWARD_QUERY_ID = /^FQ_[A-Fa-f0-9]{40}$/u;
const FORWARD_QUERY_DIGEST = /^[a-fA-F0-9]{64}$/u;

const approvedLibraryQueryIds = (value: unknown): string[] => {
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

const approvedQueryDigests = (value: unknown): string[] => {
  if (value === undefined || value === null || value === "") return [];
  if (typeof value !== "string" || value.length > 5000) {
    throw new Error("Approved Forward arbitrary NQE query digests must be a bounded string.");
  }
  const digests = [...new Set(value.split(/[\s,]+/u).map((item) => item.trim()).filter(Boolean))];
  if (digests.some((digest) => !FORWARD_QUERY_DIGEST.test(digest))) {
    throw new Error("Approved Forward arbitrary NQE query digests must be 64 hex characters.");
  }
  return digests.map((digest) => digest.toLowerCase());
};

export const validateConnection = (connection: unknown): ForwardConnection => {
  if (!isRecord(connection)) {
    throw new Error("Forward connection could not be loaded.");
  }
  if (connection.schemaId && connection.schemaId !== CONNECTION_SCHEMA) {
    throw new Error(`Forward connection must use settings schema ${CONNECTION_SCHEMA}.`);
  }
  const value = connection.value;
  if (!isRecord(value)) {
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
      "approvedQueryDigests",
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
    approvedQueryDigests: approvedQueryDigests(value.approvedQueryDigests),
  };
};

const readBoundedResponseText = async (response: Response): Promise<string> => {
  const contentLength = response.headers.get("content-length");
  if (contentLength !== null) {
    const declaredLength = Number(contentLength);
    if (Number.isInteger(declaredLength) && declaredLength > MAX_RESPONSE_BYTES) {
      throw new Error("Forward API response exceeded the 5 MiB app-function bound.");
    }
  }
  if (!response.body) {
    return "";
  }
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let byteLength = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      byteLength += value.byteLength;
      if (byteLength > MAX_RESPONSE_BYTES) {
        throw new Error("Forward API response exceeded the 5 MiB app-function bound.");
      }
      chunks.push(value);
    }
  } finally {
    if (reader.cancel && typeof reader.cancel === "function") {
      try {
        await reader.cancel();
      } catch {
        // Intentionally ignore cleanup failures while preserving the original error.
      }
    }
    if (reader.releaseLock && typeof reader.releaseLock === "function") {
      reader.releaseLock();
    }
  }
  return Buffer.concat(chunks).toString("utf8");
};

const parseRetryAfter = (value: string | null): number | null => {
  if (!value) return null;
  const trimmed = value.trim();
  if (!trimmed) return null;
  const delaySeconds = Number(trimmed);
  if (Number.isFinite(delaySeconds) && Number.isInteger(delaySeconds) && delaySeconds >= 0) {
    return delaySeconds * 1000;
  }
  const absoluteTime = Date.parse(trimmed);
  if (Number.isNaN(absoluteTime)) return null;
  return Math.max(0, absoluteTime - Date.now());
};

const isTransientStatus = (status: number): boolean =>
  TRANSIENT_STATUS_CODES.has(status);

const isRedirectStatus = (status: number): boolean =>
  status >= 300 && status < 400;

const isStaleCsrfResponse = (status: number, text: string): boolean =>
  status === 403 && CSRF_ERROR_TOKEN_PATTERN.test(text);

const computeRetryDelayMs = (
  attempt: number,
  responseRetryAfterMs: number | null,
  remainingMs: number,
): number => {
  const baseDelay = Math.min(250 * (2 ** attempt), MAX_RETRY_DELAY_MS);
  const jitter = Math.floor(baseDelay * DEFAULT_RETRY_JITTER_PERCENT * Math.random());
  const jittered = baseDelay - jitter;
  if (responseRetryAfterMs === null) {
    return Math.max(0, jittered);
  }
  const boundedRetryAfter = Math.min(MAX_RETRY_DELAY_MS, Math.max(0, responseRetryAfterMs));
  return Math.min(Math.max(jittered, boundedRetryAfter), Math.max(0, remainingMs));
};

const wait = (milliseconds: number): Promise<void> =>
  new Promise((resolve) => setTimeout(resolve, milliseconds));

export const createForwardClient = ({
  connection,
  fetchImpl = globalThis.fetch,
  timeoutMs = DEFAULT_TIMEOUT_MS,
  invocationTimeoutMs = DEFAULT_INVOCATION_TIMEOUT_MS,
  maxRetries = 2,
}: {
  connection: ForwardConnection;
  fetchImpl?: typeof globalThis.fetch;
} & ForwardClientOptions): ForwardApiClient => {
  const invocationStartedAtMs = Date.now();
  let csrfHeaderPromise: Promise<Record<string, string>> | undefined;
  const loadCsrfHeader = async (
    { refresh = false }: { refresh?: boolean } = {},
  ): Promise<Record<string, string>> => {
    if (refresh) {
      csrfHeaderPromise = undefined;
    }
    if (!csrfHeaderPromise) {
      csrfHeaderPromise = (async () => {
        const controller = new AbortController();
        const timeout = setTimeout(() => controller.abort(), timeoutMs);
        let response: Response;
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
        let payload: unknown;
        try {
          payload = JSON.parse(text) as unknown;
        } catch {
          throw new Error("Forward CSRF bootstrap returned invalid JSON.");
        }
        const headerName = isRecord(payload) ? payload.headerName : undefined;
        const token = isRecord(payload) ? payload.token : undefined;
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
    }
    return csrfHeaderPromise;
  };

  return async (method, path, body, { retryable = method === "GET" } = {}) => {
    const isRetryableMethod = retryable === true;
    let csrfRefreshes = 0;

    for (let attempt = 0; attempt <= maxRetries; attempt += 1) {
      const remainingBudgetMs = invocationTimeoutMs - (Date.now() - invocationStartedAtMs);
      if (remainingBudgetMs <= 0) {
        throw new Error("Forward API invocation deadline was exhausted.");
      }

      const requestTimeoutMs = Math.min(timeoutMs, remainingBudgetMs);
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), requestTimeoutMs);
      const csrfHeader = method === "GET" ? {} : await loadCsrfHeader();
      let response;
      try {
        response = await fetchImpl(`${connection.baseUrl}${path}`, {
          method,
          redirect: "manual",
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
        if (isRetryableMethod && attempt < maxRetries) {
          const delay = computeRetryDelayMs(attempt, null, remainingBudgetMs);
          if (delay > 0) {
            await wait(delay);
          }
          continue;
        }
        throw new Error(
          isRetryableMethod
            ? "Forward API request failed before an HTTP response was received."
            : `Forward API ${method} failed before an HTTP response was received and its mutation outcome is indeterminate; reconcile current state and stage a new plan.`,
        );
      } finally {
        clearTimeout(timeout);
      }

      if (isRedirectStatus(response.status)) {
        throw new Error(`Forward API ${method} was redirected with HTTP ${response.status}.`);
      }

      const text = await readBoundedResponseText(response);
      if (
        isStaleCsrfResponse(response.status, text) &&
        method !== "GET" &&
        csrfRefreshes < 1
      ) {
        csrfRefreshes += 1;
        await loadCsrfHeader({ refresh: true });
        continue;
      }
      if (response.ok) {
        if (!text || response.status === 204) return null;
        try {
          return JSON.parse(text) as unknown;
        } catch {
          throw new Error("Forward API returned invalid JSON.");
        }
      }
      if (
        isRetryableMethod &&
        isTransientStatus(response.status) &&
        attempt < maxRetries
      ) {
        const delay = computeRetryDelayMs(
          attempt,
          parseRetryAfter(response.headers.get("retry-after")),
          remainingBudgetMs,
        );
        if (delay > 0) {
          await wait(Math.min(delay, Math.max(0, remainingBudgetMs)));
        }
        continue;
      }
      if (!isRetryableMethod && isTransientStatus(response.status)) {
        throw new Error(
          `Forward API ${method} returned HTTP ${response.status} with an indeterminate mutation outcome; reconcile current state and stage a new plan.`,
        );
      }
      throw new Error(`Forward API ${method} failed with HTTP ${response.status}.`);
    }
    throw new Error("Forward API retry budget was exhausted.");
  };
};

const listFrom = (value: unknown, keys: string[]): unknown[] => {
  if (Array.isArray(value)) return value;
  if (!isRecord(value)) return [];
  for (const key of keys) {
    if (Array.isArray(value[key])) return value[key];
  }
  return [];
};

// Existing-check enumeration decides whether a planned check is created or
// updated, so an unrecognized, paginated, or truncated response must fail
// before planning rather than degrade to "no existing checks", which would
// produce duplicate creates that readback can only detect after the fact.
// Deliberately narrow. Generic names like `next`, `total`, and `count` are too
// easy for an unrelated Forward field to collide with, and a false positive
// here hard-blocks every plan and apply. Only unambiguous pagination markers
// are treated as evidence of a partial inventory.
const PAGINATION_TOKEN_KEYS = ["nextPageToken", "nextPage", "nextCursor"];
const TOTAL_COUNT_KEYS = ["totalCount", "totalElements"];

export const parseCheckList = (value: unknown): unknown[] => {
  if (Array.isArray(value)) return value;
  if (!isRecord(value)) {
    throw new Error("Forward check listing returned an unsupported response shape.");
  }
  const containerKey = ["checks", "items"].find((key) => Array.isArray(value[key]));
  if (!containerKey) {
    throw new Error("Forward check listing returned an unsupported response shape.");
  }
  const checks = value[containerKey];
  if (!Array.isArray(checks)) {
    throw new Error("Forward check listing returned an unsupported response shape.");
  }
  const pageToken = PAGINATION_TOKEN_KEYS.map((key) => value[key]).find(
    (token) => typeof token === "string" && token !== "",
  );
  if (pageToken !== undefined) {
    throw new Error(
      "Forward check listing is paginated; refusing to plan against a partial check inventory.",
    );
  }
  if (value.hasMore === true || value.isLast === false) {
    throw new Error(
      "Forward check listing reported additional pages; refusing to plan against a partial check inventory.",
    );
  }
  const totalCount = TOTAL_COUNT_KEYS.map((key) => value[key]).find(
    (total): total is number =>
      typeof total === "number" && Number.isInteger(total),
  );
  if (totalCount !== undefined && totalCount !== checks.length) {
    throw new Error(
      `Forward check listing returned ${checks.length} of ${totalCount} checks; refusing to plan against a truncated check inventory.`,
    );
  }
  return checks;
};

const latestProcessedSnapshot = (value: unknown): string => {
  if (
    isRecord(value) &&
    (typeof value.id === "string" || typeof value.id === "number") &&
    String(value.id) !== ""
  ) {
    return String(value.id);
  }
  const snapshots = listFrom(value, ["snapshots", "items"])
    .filter(isRecord)
    .filter(
      (snapshot) =>
        (typeof snapshot.state === "string"
          ? snapshot.state
          : "PROCESSED") === "PROCESSED",
    )
    .filter((snapshot) => !snapshot.predictInfo && !snapshot.parentSnapshotId)
    .sort((left, right) => {
      const rightCreatedAt =
        typeof right.createdAt === "string" ? right.createdAt : "";
      const leftCreatedAt =
        typeof left.createdAt === "string" ? left.createdAt : "";
      return rightCreatedAt.localeCompare(leftCreatedAt);
    });
  const snapshotId = snapshots[0]?.id;
  if (
    (typeof snapshotId !== "string" && typeof snapshotId !== "number") ||
    String(snapshotId) === ""
  ) {
    throw new Error("Forward connection has no processed collection snapshot.");
  }
  return String(snapshotId);
};

const canonicalizeLocation = (value: unknown): unknown => {
  if (typeof value !== "string") return value;
  if (/^(?:\d{1,3}\.){3}\d{1,3}\/32$/u.test(value)) return value.slice(0, -3);
  if (/^[A-Fa-f0-9:]+\/128$/u.test(value)) return value.slice(0, -4);
  return value;
};

const canonicalizeCheck = (check: unknown): Record<string, unknown> => {
  const checkRecord = isRecord(check) ? check : {};
  const definition = structuredClone(
    isRecord(checkRecord.definition) ? checkRecord.definition : {},
  );
  const filters = isRecord(definition.filters) ? definition.filters : {};
  const tags: unknown[] = Array.isArray(checkRecord.tags)
    ? checkRecord.tags as unknown[]
    : [];
  for (const endpointValue of [filters.from, filters.to]) {
    if (!isRecord(endpointValue) || !isRecord(endpointValue.location)) {
      continue;
    }
    if (endpointValue.location.type === "SubnetLocationFilter") {
      endpointValue.location.value = canonicalizeLocation(
        endpointValue.location.value,
      );
    }
  }
  return {
    definition,
    enabled: checkRecord.enabled !== false,
    perfMonitoringEnabled: checkRecord.perfMonitoringEnabled === true,
    name: checkRecord.name || "",
    note: checkRecord.note || "",
    priority: checkRecord.priority || "NOT_SET",
    tags: tags.slice().sort(),
  };
};

const fingerprint = (check: unknown): string =>
  sha256(stableJson(canonicalizeCheck(check)));

export const reconcileChecks = (
  plannedChecks: ForwardIntentCheck[],
  existingChecks: unknown[],
  expectedSourceInstanceTag: string,
): ForwardReconciliation => {
  const byKey = new Map<
    string,
    Array<{
      check: Record<string, unknown>;
      identity: ReturnType<typeof inspectManagedIdentity>;
    }>
  >();
  const byName = new Map<string, Array<Record<string, unknown>>>();
  // Existing checks are indexed by source key regardless of which source
  // instance owns them. Matching the key alone is not proof of ownership, so
  // the owning instance is carried through and verified at match time; a key
  // hit belonging to another instance must fail closed rather than be adopted
  // or silently re-created.
  for (const check of existingChecks) {
    if (!isRecord(check)) continue;
    const identity = inspectManagedIdentity(check);
    const key = identity.managed ? identity.sourceKey : null;
    if (key) {
      byKey.set(key, [...(byKey.get(key) || []), { check, identity }]);
    }
    if (typeof check.name === "string" && check.name) {
      byName.set(check.name, [...(byName.get(check.name) || []), check]);
    }
  }

  const create: ForwardReconciliation["create"] = [];
  const unchanged: ForwardReconciliation["unchanged"] = [];
  const changed: ForwardReconciliation["changed"] = [];
  const collision: ForwardReconciliation["collision"] = [];
  const plannedKeys = new Set<string>();

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
    if (keyMatches[0].identity.sourceInstance !== expectedSourceInstanceTag) {
      collision.push({ key, reason: "foreign-source-instance" });
      continue;
    }
    const existing = keyMatches[0].check;
    if (nameMatches.some((candidate) => String(candidate.id) !== String(existing.id))) {
      collision.push({ key, reason: "name-collision" });
      continue;
    }
    const existingFingerprint = fingerprint(existing);
    if (fingerprint(planned) === existingFingerprint) {
      unchanged.push({ key, existingId: String(existing.id) });
    } else {
      changed.push({
        key,
        existingId: String(existing.id),
        existingFingerprint,
        check: planned,
      });
    }
  }

  const stale = existingChecks
    .map((check) => inspectManagedIdentity(check))
    .filter(
      (identity) =>
        identity.managed &&
        identity.sourceInstance === expectedSourceInstanceTag &&
        identity.sourceKey !== null,
    )
    .filter((identity) => !plannedKeys.has(identity.sourceKey as string))
    .map((identity) => ({ key: identity.sourceKey as string }));

  return { create, unchanged, changed, stale, collision };
};

interface ReconciliationCounts {
  create: number;
  unchanged: number;
  changed: number;
  stale: number;
  collision: number;
}

const counts = (
  reconciliation: ForwardReconciliation,
): ReconciliationCounts => ({
  create: reconciliation.create.length,
  unchanged: reconciliation.unchanged.length,
  changed: reconciliation.changed.length,
  stale: reconciliation.stale.length,
  collision: reconciliation.collision.length,
});

const collisionReasonCounts = (
  collisions: ForwardReconciliation["collision"],
): Record<string, number> => Object.fromEntries(
  [...collisions.reduce((reasons, { reason }) => {
    reasons.set(reason, (reasons.get(reason) || 0) + 1);
    return reasons;
  }, new Map<string, number>()).entries()].sort(([left], [right]) =>
    left.localeCompare(right)),
);

// The digest is the approval token, so it must bind every input that changes
// what apply would do. Binding only the desired payload would let a check be
// deleted and re-created under a different ID, or drift arbitrarily while
// staying in the `changed` bucket, without invalidating an earlier approval.
const planDigest = ({
  networkId,
  snapshotId,
  profile,
  pathEvidenceDigest,
  reconciliation,
  budgets,
}: {
  networkId: string;
  snapshotId: string;
  profile: ForwardAccessProfile;
  pathEvidenceDigest: string | null;
  reconciliation: ForwardReconciliation;
  budgets: { maxCreates: number; maxUpdates: number };
}): string => sha256(stableJson({
  networkId,
  snapshotId,
  profile,
  pathEvidenceDigest,
  budgets,
  create: reconciliation.create
    .map(({ key, check }) => ({ key, fingerprint: fingerprint(check) }))
    .sort((left, right) => left.key.localeCompare(right.key)),
  changed: reconciliation.changed
    .map(({ key, check, existingId, existingFingerprint }) => ({
      key,
      existingId,
      existingFingerprint,
      fingerprint: fingerprint(check),
    }))
    .sort((left, right) => left.key.localeCompare(right.key)),
  stale: reconciliation.stale.map(({ key }) => key).sort(),
  collision: reconciliation.collision
    .map(({ key, reason }) => ({ key, reason }))
    .sort((left, right) => left.key.localeCompare(right.key) || left.reason.localeCompare(right.reason)),
}));

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
  approvedPlanDigest: unknown;
  approvedSourceKeys: string[];
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
      "runPathPreflight",
    ]),
    "Forward synchronization request",
  );
  const operation = request.operation || "plan";
  if (operation !== "plan" && operation !== "apply") {
    throw new Error("operation must be plan or apply.");
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
    approvedPlanDigest: request.approvedPlanDigest,
    approvedSourceKeys,
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
  fetchImpl = globalThis.fetch,
}: {
  loadConnection?: ConnectionLoader;
  fetchImpl?: typeof globalThis.fetch;
} = {}) => async (payload: unknown): Promise<unknown> => {
  if (
    !isRecord(payload) ||
    payload.request === undefined ||
    payload.request === null
  ) {
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
  const manifest: unknown = JSON.parse(packageResult.exportManifestPreview);
  if (!isRecord(manifest) || typeof manifest.packageId !== "string") {
    throw new Error("Generated Forward manifest is invalid.");
  }
  const plannedChecksValue: unknown = JSON.parse(
    packageResult.intentChecksPreview,
  );
  if (
    !Array.isArray(plannedChecksValue) ||
    !plannedChecksValue.every(isForwardIntentCheck)
  ) {
    throw new Error("Generated Forward intent-check list is invalid.");
  }
  const plannedChecks: ForwardIntentCheck[] = plannedChecksValue;
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
    const status = String(error instanceof Error ? error.message : "")
      .match(/HTTP (\d{3})/u)?.[1] || "unknown";
    throw new Error(`Forward apply stopped with HTTP ${status}; reconcile current state and stage a new plan.`);
  }

  const verificationResponse = await api(
    "GET",
    `/snapshots/${encodeURIComponent(snapshotId)}/checks?type=Existential`,
  );
  reconciliation = reconcileChecks(
    plannedChecks,
    parseCheckList(verificationResponse),
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
