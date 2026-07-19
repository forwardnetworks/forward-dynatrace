import { createHash } from "node:crypto";

import {
  createForwardClient,
  loadDynatraceConnection,
  validateConnection,
} from "./sync-forward-intent-checks.logic.mjs";
import {
  buildForwardNqePreview,
  summarizeForwardNqeResponse,
} from "../api/forward-nqe-preview.function.ts";
import { isForwardAccessProfile } from "../lib/forward-access-profile.mjs";

const MAX_REQUEST_BYTES = 128 * 1024;
const ALLOWED_REQUEST_KEYS = new Set([
  "forwardAccessProfile",
  "templateId",
  "queryId",
  "query",
  "commitId",
  "parameters",
  "snapshotId",
  "maxRows",
]);
const SENSITIVE_KEY = /(?:authorization|credential|password|secret|token)/iu;
const TEMPLATE_IDS = new Set(["endpoint-inventory-smoke", "approved-library-query"]);

const requiredString = (value, label, maximum = 4096) => {
  const normalized = typeof value === "string" ? value.trim() : "";
  if (!normalized) throw new Error(`${label} must be a non-empty string.`);
  if (normalized.length > maximum) throw new Error(`${label} exceeds ${maximum} characters.`);
  return normalized;
};

const assertSafeParameterKeys = (value, depth = 0) => {
  if (depth > 10) throw new Error("Forward NQE parameters exceed the maximum nesting depth.");
  if (!value || typeof value !== "object") return;
  for (const [key, child] of Object.entries(value)) {
    if (SENSITIVE_KEY.test(key)) {
      throw new Error("Forward NQE parameters must not contain credential-like keys.");
    }
    assertSafeParameterKeys(child, depth + 1);
  }
};

const parseRequest = (input) => {
  let request = input;
  if (typeof request === "string") {
    if (Buffer.byteLength(request, "utf8") > MAX_REQUEST_BYTES) {
      throw new Error("Forward NQE request exceeds the 128 KiB bound.");
    }
    try {
      request = JSON.parse(request);
    } catch (error) {
      throw new Error(`Forward NQE request is not valid JSON: ${error.message}`);
    }
  }
  if (!request || typeof request !== "object" || Array.isArray(request)) {
    throw new Error("Forward NQE request must be a JSON object.");
  }
  const unknown = Object.keys(request).filter((key) => !ALLOWED_REQUEST_KEYS.has(key));
  if (unknown.length > 0) {
    throw new Error(`Forward NQE request contains unsupported fields: ${unknown.join(", ")}.`);
  }
  let serialized;
  try {
    serialized = JSON.stringify(request);
  } catch {
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
  if (!isForwardAccessProfile(request.forwardAccessProfile)) {
    throw new Error("Forward access profile must be read-only, network-operator, or network-admin.");
  }
  if (request.templateId !== undefined && !TEMPLATE_IDS.has(request.templateId)) {
    throw new Error("Forward NQE template ID is unsupported.");
  }
  if (request.maxRows !== undefined && (!Number.isInteger(request.maxRows) || request.maxRows < 1 || request.maxRows > 100)) {
    throw new Error("Forward NQE maxRows must be an integer from 1 through 100.");
  }
  if (request.commitId !== undefined) requiredString(request.commitId, "Forward NQE commit ID", 256);
  if (request.snapshotId !== undefined) requiredString(request.snapshotId, "Forward snapshot ID", 128);
  return request;
};

const latestSnapshotId = (value) => {
  const id = value?.id;
  if (id === undefined || id === null || id === "") {
    throw new Error("Forward connection has no processed collection snapshot.");
  }
  return String(id);
};

const sha256 = (value) => createHash("sha256").update(value).digest("hex");

export const createRunForwardNqeAction = ({
  loadConnection = loadDynatraceConnection,
  fetchImpl = globalThis.fetch,
} = {}) => async ({ connectionId, request: input }) => {
  const selectedConnectionId = requiredString(connectionId, "Forward connection ID", 256);
  const request = parseRequest(input);
  const connection = validateConnection(await loadConnection(selectedConnectionId));
  if (request.forwardAccessProfile !== connection.forwardAccessProfile) {
    throw new Error("Request and Forward connection access profiles must match exactly.");
  }
  if (
    connection.forwardAccessProfile === "read-only" &&
    (!request.queryId || !connection.approvedLibraryQueryIds.includes(request.queryId.trim()))
  ) {
    throw new Error("Read Only NQE execution requires a query ID from the connection allowlist.");
  }

  const client = createForwardClient({ connection, fetchImpl });
  const selectedSnapshotId = request.snapshotId
    ? requiredString(request.snapshotId, "Forward snapshot ID", 128)
    : latestSnapshotId(await client(
      "GET",
      `/networks/${encodeURIComponent(connection.networkId)}/snapshots/latestProcessed`,
    ));
  const planned = buildForwardNqePreview({
    ...request,
    templateId: request.queryId
      ? "approved-library-query"
      : request.templateId || "endpoint-inventory-smoke",
    forwardBaseUrl: connection.baseUrl,
    forwardNetworkId: connection.networkId,
    snapshotId: selectedSnapshotId,
  });
  if (planned.status !== "planned") throw new Error(planned.summary);

  const resultPayload = await client(
    "POST",
    planned.requestPreview.path.replace(/^\/api/u, ""),
    planned.requestPreview.body,
  );
  const { result } = summarizeForwardNqeResponse(request, resultPayload, false);
  const maximumRows = request.maxRows || 25;
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
};

export default createRunForwardNqeAction();
