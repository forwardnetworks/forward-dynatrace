import { createHash } from "node:crypto";

import {
  createForwardClient,
} from "./forward-client.ts";
import type {
  ForwardClientOptions,
} from "./forward-client.ts";
import {
  loadDynatraceConnection,
  validateConnection,
} from "./forward-connection.ts";
import type {
  ForwardConnection,
} from "./forward-connection.ts";
import {
  buildForwardNqePreview,
  summarizeForwardNqeResponse,
} from "./forward-nqe-preview.ts";
import { isForwardAccessProfile } from "./forward-access-profile.ts";
import type {
  ForwardApiClient,
  ForwardAccessProfile,
  ForwardNqeExecutionError,
  NqeTemplateId,
  NqeExecutionCompleted,
  NqeExecutionState,
} from "./types/index.ts";

const MAX_REQUEST_BYTES = 128 * 1024;
const ALLOWED_REQUEST_KEYS = new Set([
  "forwardAccessProfile",
  "templateId",
  "queryId",
  "query",
  "commitId",
  "executionKey",
  "parameters",
  "columnFilters",
  "sortKeys",
  "snapshotId",
  "maxRows",
  "approvedQueryDigest",
  "executeSync",
]);
const SENSITIVE_KEY = /(?:authorization|credential|password|secret|token)/iu;
const TEMPLATE_IDS = new Set<unknown>([
  "endpoint-inventory-smoke",
  "approved-library-query",
]);
const QUERY_DIGEST = /^[a-f0-9]{64}$/u;
const MAX_QUERY_TEXT_BYTES = 128 * 1024;
const MAX_SNAPSHOT_AGE_MS = 7 * 24 * 60 * 60 * 1000;
// Forward enforces only the `X_` prefix ("Expected execution key to begin with
// X_"). Live keys look like `X_<hex>`, but the charset is not part of the
// documented contract, so this deliberately constrains no further than Forward
// does — over-constraining would reject keys Forward would have accepted.
const FORWARD_EXECUTION_KEY = /^X_[A-Za-z0-9_-]{1,250}$/u;
const DEFAULT_MAX_ROWS = 25;
const POLL_MIN_INTERVAL_MS = 1_000;
const POLL_MAX_INTERVAL_MS = 10_000;
const SENSITIVE_MASK = "[redacted]";

interface NqeRequestCommon {
  forwardAccessProfile: ForwardAccessProfile;
  templateId?: NqeTemplateId;
  parameters?: Record<string, unknown>;
  columnFilters?: Array<Record<string, unknown>>;
  sortKeys?: Array<Record<string, unknown>>;
  snapshotId?: string;
  maxRows?: number;
  approvedQueryDigest?: string;
}

interface NqeSubmitRequest extends NqeRequestCommon {
  executionKey?: undefined;
  queryId?: string;
  query?: string;
  commitId?: string;
  executeSync?: boolean;
}

interface NqeResumeRequest extends NqeRequestCommon {
  executionKey: string;
  queryId?: never;
  query?: never;
  commitId?: never;
  executeSync?: never;
}

type NqeActionRequest = NqeSubmitRequest | NqeResumeRequest;

interface SnapshotRecord {
  id: string;
  state: string;
  createdAtMs: number;
}

interface NqeResultSummary {
  snapshotId?: string;
  totalRows: number;
  returnedRows: number;
  columns: string[];
  sampleRows?: Array<Record<string, unknown>>;
}

const isRecord = (value: unknown): value is Record<string, unknown> =>
  Boolean(value) && typeof value === "object" && !Array.isArray(value);

const wait = (milliseconds: number): Promise<void> =>
  new Promise((resolve) => setTimeout(resolve, milliseconds));

const normalizeQueryText = (query: string): string =>
  query.trim().replace(/\s+/gu, " ");
const sha256 = (value: string): string =>
  createHash("sha256").update(value).digest("hex");
const parseHttpStatus = (error: unknown): number | null => {
  if (!(error instanceof Error)) return null;
  const match = /HTTP (\d{3})/u.exec(error.message);
  return match === null ? null : Number(match[1]);
};
const sanitizeSensitiveText = (value: unknown): string =>
  String(value).replace(
    new RegExp(SENSITIVE_KEY.source, "giu"),
    SENSITIVE_MASK,
  );

const diagnosticText = (value: unknown): string => {
  if (
    typeof value === "string" ||
    typeof value === "number" ||
    typeof value === "boolean"
  ) {
    return String(value);
  }
  return "unknown";
};

const parseExecutionKeyFromSubmitResult = (value: unknown): string | null => {
  const executionKey = isRecord(value) ? value.executionKey : undefined;
  if (typeof executionKey !== "string" || !executionKey.trim()) {
    return null;
  }
  return executionKey.trim();
};

// The executionKey is carried as a structured property in addition to the
// message. A caller that needs to resume must not have to parse an error
// string to recover it; the message text is for operators, `executionKey` is
// for callers. `resumable` distinguishes "still running, retrievable" from a
// key that is already dead.
const withExecutionKey = (
  error: Error,
  executionKey: string,
  { resumable }: { resumable: boolean },
): ForwardNqeExecutionError =>
  Object.assign(error, {
    executionKey,
    resumable,
  });

const makeStatusLookupError = (
  error: unknown,
  phase: "status" | "result",
  executionKey: string,
): ForwardNqeExecutionError => {
  const status = parseHttpStatus(error);
  if (
    error instanceof Error &&
    error.message.includes("invocation deadline was exhausted")
  ) {
    return withExecutionKey(
      new Error(
        `Forward NQE ${phase} polling exhausted the action invocation deadline while the execution continues server-side. `
        + `Retrieve later with executionKey ${executionKey}.`,
      ),
      executionKey,
      { resumable: true },
    );
  }
  if (status === 404) {
    return withExecutionKey(
      new Error(
        `Forward NQE ${phase} returned 404; executionKey ${executionKey} is unknown, expired, or from an unknown network.`,
      ),
      executionKey,
      { resumable: false },
    );
  }
  // Verified against the live Forward API: a key that does not begin with `X_`
  // is rejected with 400 ("Expected execution key to begin with X_"), while a
  // well-formed but unknown or expired key gives 404. A malformed key can never
  // become valid, so it must not be reported as resumable.
  if (status === 400) {
    return withExecutionKey(
      new Error(
        `Forward NQE ${phase} rejected executionKey ${executionKey} as malformed; it cannot be resumed.`,
      ),
      executionKey,
      { resumable: false },
    );
  }
  if (status === null) {
    return withExecutionKey(
      error instanceof Error
        ? error
        : new Error(
            `Forward NQE ${phase} lookup failed without an HTTP status.`,
          ),
      executionKey,
      { resumable: true },
    );
  }
  return withExecutionKey(
    new Error(`Forward NQE ${phase} lookup failed with HTTP ${status}.`),
    executionKey,
    { resumable: true },
  );
};

const makeNqeOutcomeError = (
  executionKey: string,
  status: NqeExecutionCompleted,
): Error | null => {
  switch (status.outcome) {
    case "OK":
      return null;
    case "USER_ERROR": {
      const message = sanitizeSensitiveText(
        typeof status.error?.message === "string" ? status.error.message : "No USER_ERROR diagnostics were returned.",
      );
      const location = status.error?.location === undefined
        ? ""
        : ` Location: ${JSON.stringify(status.error.location)}.`;
      return new Error(
        `Forward NQE execution ended with USER_ERROR for executionKey ${executionKey}.${location} `
        + `Diagnostic: ${message}`,
      );
    }
    case "TIMED_OUT":
      return new Error(
        `Forward NQE execution ended with TIMED_OUT for executionKey ${executionKey}. `
        + `timeoutMinutes=${diagnosticText(status.timeoutMinutes)}.`,
      );
    case "SYSTEM_ERROR":
      return new Error(`Forward NQE execution failed with SYSTEM_ERROR for executionKey ${executionKey}.`);
  }
};

const buildAsyncExecutionBody = (
  request: NqeSubmitRequest,
  plannedRequestBody: Record<string, unknown>,
): Record<string, unknown> => {
  const body = {
    ...(request.queryId === undefined
      ? {
        query: (typeof request.query === "string" ? request.query : plannedRequestBody.query),
      }
      : {
        queryId: request.queryId,
        ...(request.commitId === undefined ? {} : { commitId: request.commitId }),
      }),
    ...(request.parameters === undefined ? {} : { parameters: request.parameters }),
    ...(request.columnFilters === undefined ? {} : { columnFilters: request.columnFilters }),
    ...(request.sortKeys === undefined ? {} : { sortKeys: request.sortKeys }),
  };
  return body;
};

const requiredString = (
  value: unknown,
  label: string,
  maximum = 4096,
): string => {
  const normalized = typeof value === "string" ? value.trim() : "";
  if (!normalized) throw new Error(`${label} must be a non-empty string.`);
  if (normalized.length > maximum) throw new Error(`${label} exceeds ${maximum} characters.`);
  return normalized;
};

const assertSafeParameterKeys = (value: unknown, depth = 0): void => {
  if (depth > 10) throw new Error("Forward NQE parameters exceed the maximum nesting depth.");
  if (!isRecord(value)) return;
  for (const [key, child] of Object.entries(value)) {
    if (SENSITIVE_KEY.test(key)) {
      throw new Error("Forward NQE parameters must not contain credential-like keys.");
    }
    assertSafeParameterKeys(child, depth + 1);
  }
};

const assertObjectArray: (
  value: unknown,
  label: string,
) => asserts value is Array<Record<string, unknown>> = (value, label) => {
  if (!Array.isArray(value)) {
    throw new Error(`Forward NQE ${label} must be an array.`);
  }
  for (const item of value) {
    if (!isRecord(item)) {
      throw new Error(`Forward NQE ${label} entries must be object values.`);
    }
  }
};

const parseRequest = (input: unknown): NqeActionRequest => {
  let requestValue: unknown = input;
  if (typeof requestValue === "string") {
    if (Buffer.byteLength(requestValue, "utf8") > MAX_REQUEST_BYTES) {
      throw new Error("Forward NQE request exceeds the 128 KiB bound.");
    }
    try {
      requestValue = JSON.parse(requestValue) as unknown;
    } catch (error) {
      const detail = error instanceof Error ? error.message : "unknown parse error";
      throw new Error(`Forward NQE request is not valid JSON: ${detail}`);
    }
  }
  if (!isRecord(requestValue)) {
    throw new Error("Forward NQE request must be a JSON object.");
  }
  let request = requestValue;
  const unknown = Object.keys(request).filter((key) => !ALLOWED_REQUEST_KEYS.has(key));
  if (unknown.length > 0) {
    throw new Error(`Forward NQE request contains unsupported fields: ${unknown.join(", ")}.`);
  }
  let serialized: string | undefined;
  try {
    serialized = JSON.stringify(request);
  } catch {
    throw new Error("Forward NQE request must contain only serializable JSON values.");
  }
  if (serialized === undefined) {
    throw new Error("Forward NQE request must contain only serializable JSON values.");
  }
  if (Buffer.byteLength(serialized, "utf8") > MAX_REQUEST_BYTES) {
    throw new Error("Forward NQE request exceeds the 128 KiB bound.");
  }
  if (request.parameters !== undefined) {
    if (!request.parameters || typeof request.parameters !== "object" || Array.isArray(request.parameters)) {
      throw new Error("Forward NQE parameters must be a JSON object.");
    }
    assertSafeParameterKeys(request.parameters);
  }
  if (request.query !== undefined && request.queryId !== undefined) {
    throw new Error("Supply either arbitrary NQE text or a Forward Library query ID, not both.");
  }
  const isResume = request.executionKey !== undefined;
  if (isResume) {
    const resumeKey = requiredString(request.executionKey, "Forward NQE execution key", 256);
    // Forward rejects any key not beginning with `X_` at the API boundary
    // (verified live). Rejecting here avoids spending an API round trip, and a
    // deadline, on a key that can never resolve.
    if (!FORWARD_EXECUTION_KEY.test(resumeKey)) {
      throw new Error("Forward NQE execution key must begin with X_ followed by hex characters.");
    }
    request = { ...request, executionKey: resumeKey };
    if (
      request.query !== undefined
      || request.queryId !== undefined
      || request.commitId !== undefined
      || request.executeSync !== undefined
    ) {
      throw new Error("executionKey is mutually exclusive with query, queryId, commitId, and executeSync.");
    }
  }
  if (request.query !== undefined) {
    const normalized = normalizeQueryText(requiredString(request.query, "Forward NQE query", MAX_QUERY_TEXT_BYTES));
    const queryDigest = sha256(normalized);
    if (
      typeof request.approvedQueryDigest !== "string" ||
      !QUERY_DIGEST.test(request.approvedQueryDigest)
    ) {
      throw new Error("approvedQueryDigest is required for arbitrary NQE and must be a 64-hex sha256.");
    }
    if (request.approvedQueryDigest.toLowerCase() !== queryDigest) {
      throw new Error("approvedQueryDigest does not match the normalized query text.");
    }
    request = { ...request, query: normalized, approvedQueryDigest: request.approvedQueryDigest.toLowerCase() };
  }
  if (request.approvedQueryDigest !== undefined && typeof request.approvedQueryDigest !== "string") {
    throw new Error("approvedQueryDigest must be a non-empty string.");
  }
  if (request.executeSync !== undefined && typeof request.executeSync !== "boolean") {
    throw new Error("executeSync must be a boolean.");
  }
  if (!isForwardAccessProfile(request.forwardAccessProfile)) {
    throw new Error("Forward access profile must be read-only, network-operator, or network-admin.");
  }
  if (request.templateId !== undefined && !TEMPLATE_IDS.has(request.templateId)) {
    throw new Error("Forward NQE template ID is unsupported.");
  }
  if (
    request.maxRows !== undefined &&
    (typeof request.maxRows !== "number" ||
      !Number.isInteger(request.maxRows) ||
      request.maxRows < 1 ||
      request.maxRows > 100)
  ) {
    throw new Error("Forward NQE maxRows must be an integer from 1 through 100.");
  }
  if (request.columnFilters !== undefined) {
    assertObjectArray(request.columnFilters, "columnFilters");
  }
  if (request.sortKeys !== undefined) {
    assertObjectArray(request.sortKeys, "sortKeys");
  }
  if (request.queryId !== undefined) {
    request = {
      ...request,
      queryId: requiredString(
        request.queryId,
        "Forward NQE query ID",
        256,
      ),
    };
  }
  if (request.commitId !== undefined) {
    request = {
      ...request,
      commitId: requiredString(
        request.commitId,
        "Forward NQE commit ID",
        256,
      ),
    };
  }
  if (request.snapshotId !== undefined) {
    request = {
      ...request,
      snapshotId: requiredString(
        request.snapshotId,
        "Forward snapshot ID",
        128,
      ),
    };
  }
  return request as unknown as NqeActionRequest;
};

const parseSnapshotRecord = (value: unknown): SnapshotRecord => {
  const record = isRecord(value) ? value : {};
  const id = record.id;
  if (
    (typeof id !== "string" && typeof id !== "number") ||
    String(id) === ""
  ) {
    throw new Error("Forward snapshot lookup did not return a usable snapshot identifier.");
  }
  const state = typeof record.state === "string" ? record.state.toUpperCase() : "";
  const createdAt = typeof record.createdAt === "string" ? record.createdAt : null;
  const createdAtMs = createdAt ? Date.parse(createdAt) : NaN;
  return { id: String(id), state, createdAtMs };
};

const isFreshSnapshot = (
  candidate: SnapshotRecord,
  reference: number,
  maxAgeMs = MAX_SNAPSHOT_AGE_MS,
): boolean => {
  if (!Number.isFinite(candidate.createdAtMs)) return false;
  if (!Number.isFinite(reference)) return false;
  const ageMs = reference - candidate.createdAtMs;
  return ageMs >= 0 && ageMs <= maxAgeMs;
};

const selectNqeSnapshot = async ({
  client,
  networkId,
  requestSnapshotId,
}: {
  client: ForwardApiClient;
  networkId: string;
  requestSnapshotId?: string;
}): Promise<string> => {
  const latest = parseSnapshotRecord(
    await client(
      "GET",
      `/networks/${encodeURIComponent(networkId)}/snapshots/latestProcessed`,
    ),
  );
  if (latest.state && latest.state !== "PROCESSED") {
    throw new Error("Forward latest snapshot is not processed.");
  }

  if (requestSnapshotId === undefined) {
    return latest.id;
  }
  const requested = parseSnapshotRecord(
    await client(
      "GET",
      `/snapshots/${encodeURIComponent(requestSnapshotId)}`,
    ),
  );
  if (requested.id !== String(requestSnapshotId)) {
    throw new Error("Forward snapshot lookup returned a mismatched snapshot ID.");
  }
  if (requested.state && requested.state !== "PROCESSED") {
    throw new Error("Forward snapshot lookup did not return a processed snapshot.");
  }
  if (!isFreshSnapshot(requested, latest.createdAtMs)) {
    throw new Error("Forward snapshot is older than the configured freshness window.");
  }
  return requested.id;
};

const parseNqeExecutionState = (
  value: unknown,
  executionKey: string,
): NqeExecutionState => {
  if (!isRecord(value)) {
    throw new Error(
      "Forward NQE execution status was unrecognized: undefined.",
    );
  }
  const statusValue = value.status;
  if (statusValue === "SUBMITTED" || statusValue === "EXECUTING") {
    return { status: statusValue };
  }
  if (statusValue !== "COMPLETED") {
    throw new Error(
      `Forward NQE execution status was unrecognized: ${JSON.stringify(statusValue)}.`,
    );
  }
  const outcome = value.outcome;
  switch (outcome) {
    case "OK":
      return { status: "COMPLETED", outcome };
    case "USER_ERROR": {
      const errorValue = isRecord(value.error) ? value.error : undefined;
      return {
        status: "COMPLETED",
        outcome,
        ...(errorValue
          ? {
              error: {
                ...(typeof errorValue.message === "string"
                  ? { message: errorValue.message }
                  : {}),
                ...(errorValue.location === undefined
                  ? {}
                  : { location: errorValue.location }),
              },
            }
          : {}),
      };
    }
    case "TIMED_OUT":
      return {
        status: "COMPLETED",
        outcome,
        ...(value.timeoutMinutes === undefined
          ? {}
          : { timeoutMinutes: value.timeoutMinutes }),
      };
    case "SYSTEM_ERROR":
      return { status: "COMPLETED", outcome };
    default: {
      const rawOutcome =
        typeof outcome === "string" ? outcome : "UNKNOWN";
      throw new Error(
        `Forward NQE execution ended with unsupported outcome ${rawOutcome} for executionKey ${executionKey}.`,
      );
    }
  }
};

const summarizeNqeResult = (
  request: NqeActionRequest,
  payload: unknown,
): NqeResultSummary => {
  const summary = summarizeForwardNqeResponse(request, payload, false);
  if (summary.result === undefined) {
    throw new Error("Forward NQE response did not contain a result summary.");
  }
  return summary.result;
};

const waitForNqeResult = async ({
  client,
  connection,
  executionKey,
  maximumRows,
  request,
  selectedSnapshotId,
  enforceSnapshotMatch,
}: {
  client: ForwardApiClient;
  connection: ForwardConnection;
  executionKey: string;
  maximumRows: number;
  request: NqeActionRequest;
  selectedSnapshotId: string | undefined;
  enforceSnapshotMatch: boolean;
}): Promise<{
  result: NqeResultSummary;
  snapshotId: string | undefined;
}> => {
  const statusPath = `/networks/${encodeURIComponent(connection.networkId)}/nqe-executions/`
    + encodeURIComponent(executionKey);
  let statusBackoffMs = POLL_MIN_INTERVAL_MS;
  let lastStatusPollStartedAtMs = 0;
  while (true) {
    if (lastStatusPollStartedAtMs !== 0) {
      const elapsedSinceLastPollMs = Date.now() - lastStatusPollStartedAtMs;
      const delayForIntervalMs = Math.max(0, statusBackoffMs - elapsedSinceLastPollMs);
      if (delayForIntervalMs > 0) {
        await wait(delayForIntervalMs);
      }
    }
    lastStatusPollStartedAtMs = Date.now();

    let statusValue: unknown;
    try {
      statusValue = await client("GET", statusPath, undefined, {
        retryable: true,
      });
    } catch (error) {
      throw makeStatusLookupError(error, "status", executionKey);
    }
    const status = parseNqeExecutionState(statusValue, executionKey);
    if (status.status !== "COMPLETED") {
      statusBackoffMs = Math.min(POLL_MAX_INTERVAL_MS, statusBackoffMs * 2);
      continue;
    }
    const outcomeError = makeNqeOutcomeError(executionKey, status);
    if (outcomeError !== null) {
      throw outcomeError;
    }

    const statusParams = new URLSearchParams({ offset: "0", limit: String(maximumRows) });
    let resultPayload;
    try {
      resultPayload = await client("GET", `${statusPath}/result?${statusParams.toString()}`, undefined, { retryable: true });
    } catch (error) {
      throw makeStatusLookupError(error, "result", executionKey);
    }
    const result = summarizeNqeResult(request, resultPayload);
    if (
      enforceSnapshotMatch
      && selectedSnapshotId !== undefined
      && result.snapshotId !== undefined
      && result.snapshotId !== selectedSnapshotId
    ) {
      throw new Error("Forward NQE response snapshot does not match the requested snapshot.");
    }
    if (
      !Number.isInteger(result.totalRows) || result.totalRows < 0 ||
      !Number.isInteger(result.returnedRows) || result.returnedRows < 0 ||
      result.returnedRows > maximumRows || result.returnedRows > result.totalRows
    ) {
      throw new Error("Forward NQE response row counts violate the bounded request.");
    }
    return {
      result,
      snapshotId: result.snapshotId || selectedSnapshotId,
    };
  }
};

type ConnectionLoader = (connectionId: string) => Promise<unknown>;

const isResumeRequest = (
  request: NqeActionRequest,
): request is NqeResumeRequest => request.executionKey !== undefined;

export const createRunForwardNqeAction = ({
  loadConnection = loadDynatraceConnection,
  fetchImpl = globalThis.fetch,
  forwardClientOptions = {},
}: {
  loadConnection?: ConnectionLoader;
  fetchImpl?: typeof globalThis.fetch;
  forwardClientOptions?: ForwardClientOptions;
} = {}) => async (payload: unknown): Promise<unknown> => {
  if (!isRecord(payload)) {
    throw new Error("Forward NQE action input must be a JSON object.");
  }
  const selectedConnectionId = requiredString(
    payload.connectionId,
    "Forward connection ID",
    256,
  );
  const request = parseRequest(payload.request);
  const connection = validateConnection(await loadConnection(selectedConnectionId));
  if (request.forwardAccessProfile !== connection.forwardAccessProfile) {
    throw new Error("Request and Forward connection access profiles must match exactly.");
  }
  const resumeExecution = isResumeRequest(request);
  if (
    !resumeExecution &&
    connection.forwardAccessProfile === "read-only" &&
    (!request.queryId || !connection.approvedLibraryQueryIds.includes(request.queryId.trim()))
  ) {
    throw new Error("Read Only NQE execution requires a query ID from the connection allowlist.");
  }
  if (
    request.query &&
    (typeof request.approvedQueryDigest !== "string" ||
      !connection.approvedQueryDigests.includes(request.approvedQueryDigest))
  ) {
    throw new Error("Arbitrary NQE execution requires a matching approved query digest from the connection allowlist.");
  }

  const client = createForwardClient({ connection, fetchImpl, ...forwardClientOptions });
  // Resume flow is keyed by a server-issued executionKey and does not re-submit a request body.
  // The original submission already performed the approval checks, so we intentionally do not re-validate approvedQueryDigest.
  const selectedSnapshotId = resumeExecution
    ? (request.snapshotId
      ? await selectNqeSnapshot({
        client,
        networkId: connection.networkId,
        requestSnapshotId: requiredString(request.snapshotId, "Forward snapshot ID", 128),
      })
      : undefined)
    : await selectNqeSnapshot({
      client,
      networkId: connection.networkId,
      requestSnapshotId: request.snapshotId ? requiredString(request.snapshotId, "Forward snapshot ID", 128) : undefined,
    });
  const planned = resumeExecution ? undefined : buildForwardNqePreview({
    ...request,
    templateId: request.queryId
      ? "approved-library-query"
      : request.templateId || "endpoint-inventory-smoke",
    forwardBaseUrl: connection.baseUrl,
    forwardNetworkId: connection.networkId,
    snapshotId: selectedSnapshotId,
  });
  if (planned && planned.status !== "planned") throw new Error(planned.summary);

  const maximumRows = request.maxRows || DEFAULT_MAX_ROWS;
  if (request.executeSync) {
    if (planned === undefined) {
      throw new Error("Synchronous execution is not supported for resumed execution.");
    }
    const resultPayload = await client(
      "POST",
      planned.requestPreview.path.replace(/^\/api/u, ""),
      planned.requestPreview.body,
    );
    const result = summarizeNqeResult(request, resultPayload);
    if (result.snapshotId && result.snapshotId !== selectedSnapshotId) {
      throw new Error("Forward NQE response snapshot does not match the requested snapshot.");
    }
    if (
      !Number.isInteger(result.totalRows) || result.totalRows < 0 ||
      !Number.isInteger(result.returnedRows) || result.returnedRows < 0 ||
      result.returnedRows > maximumRows || result.returnedRows > result.totalRows
    ) {
      throw new Error("Forward NQE response row counts violate the bounded request.");
    }
    const requestFingerprint = sha256(JSON.stringify({
      path: planned.requestPreview.path,
      body: planned.requestPreview.body,
      profile: connection.forwardAccessProfile,
    }));
    return {
      schemaVersion: "forward-dynatrace-nqe-action/v1",
      status: "ready",
      summary: "Forward NQE execution completed through the Dynatrace app backend.",
      generatedAt: new Date().toISOString(),
      forwardAccessProfile: connection.forwardAccessProfile,
      target: {
        networkId: connection.networkId,
        snapshotId: result.snapshotId || selectedSnapshotId,
      },
      query: {
        kind: request.queryId ? "library" : "arbitrary",
        ...(request.queryId ? { queryId: request.queryId.trim() } : {}),
        requestFingerprint,
        maximumRows,
      },
      result: {
        totalRows: result.totalRows,
        returnedRows: result.returnedRows,
        columns: result.columns.filter((column) => !SENSITIVE_KEY.test(column)).slice(0, 100),
      },
      disclaimer: "This is sanitized NQE evidence. It contains no Forward credential, query text, row values, endpoint inventory, or raw response body.",
    };
  }

  let executionSubmitPath: string | null = null;
  let executionKey: string;
  if (isResumeRequest(request)) {
    executionKey = request.executionKey;
  } else {
    if (selectedSnapshotId === undefined || planned === undefined) {
      throw new Error("Forward NQE submit plan is incomplete.");
    }
    executionSubmitPath =
      `/networks/${encodeURIComponent(connection.networkId)}/nqe-executions?snapshotId=` +
      encodeURIComponent(selectedSnapshotId);
    const submittedExecutionKey = parseExecutionKeyFromSubmitResult(
      await client(
        "POST",
        executionSubmitPath,
        buildAsyncExecutionBody(request, planned.requestPreview.body),
        { retryable: false },
      ),
    );
    if (submittedExecutionKey === null) {
      throw new Error(
        "Forward NQE async submit response did not include an executionKey.",
      );
    }
    executionKey = submittedExecutionKey;
  }

  const asyncResult = await waitForNqeResult({
    client,
    connection,
    executionKey,
    maximumRows,
    request,
    selectedSnapshotId,
    enforceSnapshotMatch: resumeExecution ? request.snapshotId !== undefined : true,
  });

  let requestFingerprint: string;
  if (isResumeRequest(request)) {
    requestFingerprint = sha256(JSON.stringify({
      executionKey,
      mode: "resumed",
      profile: connection.forwardAccessProfile,
    }));
  } else {
    if (planned === undefined) {
      throw new Error("Forward NQE submit plan is incomplete.");
    }
    requestFingerprint = sha256(JSON.stringify({
      path: executionSubmitPath,
      body: buildAsyncExecutionBody(request, planned.requestPreview.body),
      profile: connection.forwardAccessProfile,
    }));
  }
  return {
    schemaVersion: "forward-dynatrace-nqe-action/v1",
    status: "ready",
    summary: "Forward NQE execution completed through the Dynatrace app backend.",
    generatedAt: new Date().toISOString(),
    forwardAccessProfile: connection.forwardAccessProfile,
    target: {
      networkId: connection.networkId,
      snapshotId: asyncResult.snapshotId,
    },
    query: {
      kind: resumeExecution ? "resumed" : request.queryId ? "library" : "arbitrary",
      ...(request.queryId ? { queryId: request.queryId.trim() } : {}),
      requestFingerprint,
      maximumRows,
      ...(resumeExecution ? { resumed: true } : {}),
    },
    execution: {
      executionKey,
      resumed: resumeExecution,
    },
    result: {
      totalRows: asyncResult.result.totalRows,
      returnedRows: asyncResult.result.returnedRows,
      columns: asyncResult.result.columns.filter((column) => !SENSITIVE_KEY.test(column)).slice(0, 100),
    },
    disclaimer: "This is sanitized NQE evidence. It contains no Forward credential, query text, row values, endpoint inventory, or raw response body.",
  };
};

export default createRunForwardNqeAction();
