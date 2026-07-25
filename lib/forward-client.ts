import type { ForwardConnection } from "./forward-connection.ts";
import type { ForwardApiClient } from "./types/index.ts";

const MAX_RESPONSE_BYTES = 5 * 1024 * 1024;
const DEFAULT_TIMEOUT_MS = 30_000;
const DEFAULT_INVOCATION_TIMEOUT_MS = 120_000;
const MAX_RETRY_DELAY_MS = 1_000;
const DEFAULT_RETRY_JITTER_PERCENT = 0.25;
const TRANSIENT_STATUS_CODES = new Set([408, 429, 500, 502, 503, 504]);
const CSRF_ERROR_TOKEN_PATTERN = /csrf|xsrf/i;

export interface ForwardClientOptions {
  timeoutMs?: number;
  invocationTimeoutMs?: number;
  maxRetries?: number;
}

const isRecord = (value: unknown): value is Record<string, unknown> =>
  Boolean(value) && typeof value === "object" && !Array.isArray(value);

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

export const latestProcessedSnapshot = (value: unknown): string => {
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
