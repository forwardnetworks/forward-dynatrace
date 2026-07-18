import path from "node:path";
import { pathToFileURL } from "node:url";

const root = path.resolve(new URL("..", import.meta.url).pathname);
const previewModuleUrl = pathToFileURL(
  path.join(root, "api/forward-nqe-preview.function.ts"),
).href;
const { summarizeForwardNqeResponse } = await import(previewModuleUrl);

const AUTHORIZATION_PATTERN = /^(?:Basic|Bearer) [A-Za-z0-9._~+\/-]+=*$/u;

const normalizeForwardBaseUrl = (value) => {
  const url = new URL(value);
  const localHttp =
    url.protocol === "http:" && ["127.0.0.1", "localhost", "::1"].includes(url.hostname);
  if (url.protocol !== "https:" && !localHttp) {
    throw new Error("Forward base URL must use HTTPS except for loopback tests.");
  }
  if (url.username || url.password || url.search || url.hash || url.pathname !== "/") {
    throw new Error("Forward base URL must be an origin without credentials, path, query, or fragment.");
  }
  return url.origin;
};

const executionFailure = (planned, summary, httpStatus) => ({
  ...planned,
  status: "failed",
  summary,
  generatedAt: new Date().toISOString(),
  evidence: [
    ...planned.evidence,
    ...(httpStatus === undefined ? [] : [{ label: "HTTP status", value: String(httpStatus) }]),
  ],
  nextSteps: [
    "Inspect the Forward-side runtime logs and configured Forward access-profile permissions.",
    "Do not publish raw Forward responses or credentials to Dynatrace.",
    "Issue a new preflight after correcting the Forward-side failure.",
  ],
});

export const executeForwardNqePreview = async ({
  request,
  planned,
  authorization,
  allowedQueryIds = [],
  includeResultSample = false,
  fetchImpl = fetch,
}) => {
  if (!planned || planned.status !== "planned") {
    throw new Error("Forward-side execution requires a successfully planned NQE request.");
  }
  if (!request?.forwardBaseUrl || !request?.forwardNetworkId) {
    throw new Error("Forward-side execution requires Forward URL metadata and a network ID.");
  }
  if (!AUTHORIZATION_PATTERN.test(authorization || "")) {
    throw new Error("Forward-side execution requires a valid Forward Authorization value.");
  }
  if (request.queryId && !new Set(allowedQueryIds).has(request.queryId.trim())) {
    throw new Error("Forward NQE query ID is not in the Forward-side runtime allowlist.");
  }
  if (
    planned.requestPreview?.method !== "POST" ||
    !planned.requestPreview.path?.startsWith("/api/nqe")
  ) {
    throw new Error("Planned request is not an approved POST /api/nqe operation.");
  }

  const baseUrl = normalizeForwardBaseUrl(request.forwardBaseUrl);
  try {
    const response = await fetchImpl(`${baseUrl}${planned.requestPreview.path}`, {
      method: "POST",
      headers: {
        Accept: "application/json",
        Authorization: authorization,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(planned.requestPreview.body),
    });
    const responseText = await response.text();
    let parsed = {};
    if (responseText) {
      try {
        parsed = JSON.parse(responseText);
      } catch {
        return executionFailure(
          planned,
          "Forward NQE execution returned a non-JSON response.",
          response.status,
        );
      }
    }
    if (!response.ok) {
      return executionFailure(
        planned,
        `Forward NQE execution failed with HTTP ${response.status}.`,
        response.status,
      );
    }

    const { result, endpointResolution } = summarizeForwardNqeResponse(
      request,
      parsed,
      includeResultSample,
    );
    return {
      ...planned,
      status: "ready",
      summary:
        endpointResolution?.summary ||
        "Forward NQE execution completed with sanitized aggregate evidence.",
      generatedAt: new Date().toISOString(),
      evidence: [
        ...planned.evidence,
        { label: "Rows", value: String(result.totalRows) },
        { label: "Columns", value: result.columns.join(", ") || "none" },
        ...(endpointResolution
          ? [
              { label: "Source mapping", value: endpointResolution.source.status },
              { label: "Destination mapping", value: endpointResolution.destination.status },
              { label: "Export state", value: endpointResolution.mappingState },
            ]
          : []),
      ],
      result,
      ...(endpointResolution ? { endpointResolution } : {}),
      nextSteps: [
        endpointResolution?.mappingState === "needs-map"
          ? "Keep unresolved dependencies out of an apply package until mapped."
          : "Use the sanitized evidence to update dependency mapping readiness.",
        "Keep all persistent Forward writes in the approved importer workflow.",
      ],
    };
  } catch {
    return executionFailure(
      planned,
      "Forward NQE execution failed before a response was received.",
    );
  }
};
