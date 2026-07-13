type NqePreviewStatus = "planned" | "ready" | "blocked" | "failed";
type NqeTemplateId =
  | "endpoint-inventory-smoke"
  | "approved-endpoint-resolution"
  | "approved-blast-radius";
type EndpointResolutionStatus =
  | "resolved"
  | "unresolved"
  | "ambiguous"
  | "unknown";
type EndpointResolutionMappingState = "ready" | "review" | "needs-map";

interface DependencyContext {
  appName?: string;
  environment?: string;
  serviceEntityId?: string;
  serviceName?: string;
  source?: string;
  destination?: string;
  protocol?: "tcp" | "udp";
  port?: string;
  owner?: string;
}

interface ForwardNqePreviewRequest {
  forwardBaseUrl?: string;
  forwardNetworkId?: string;
  snapshotId?: string;
  templateId?: NqeTemplateId;
  queryId?: string;
  commitId?: string;
  parameters?: Record<string, unknown>;
  maxRows?: number;
  execute?: boolean;
  includeResultSample?: boolean;
  dependency?: DependencyContext;
}

interface ForwardNqePreviewResponse {
  status: NqePreviewStatus;
  summary: string;
  generatedAt: string;
  templateId: NqeTemplateId;
  requestPreview: {
    method: "POST";
    path: string;
    body: Record<string, unknown>;
  };
  evidence: Array<{ label: string; value: string }>;
  result?: {
    snapshotId?: string;
    totalRows: number;
    returnedRows: number;
    columns: string[];
    sampleRows?: Array<Record<string, unknown>>;
  };
  endpointResolution?: EndpointResolutionSummary;
  nextSteps: string[];
}

interface EndpointResolutionEndpoint {
  role: "source" | "destination";
  value: string;
  status: EndpointResolutionStatus;
  matchCount: number | null;
  detail: string;
}

interface EndpointResolutionSummary {
  mappingState: EndpointResolutionMappingState;
  source: EndpointResolutionEndpoint;
  destination: EndpointResolutionEndpoint;
  summary: string;
}

const DEFAULT_TEMPLATE_ID: NqeTemplateId = "endpoint-inventory-smoke";
const DEFAULT_MAX_ROWS = 25;
const MAX_RESULT_SAMPLE_ROWS = 5;

const missing = (value: string | undefined): boolean => !value?.trim();

const normalizeBaseUrl = (value: string): string => value.replace(/\/+$/, "");

const runtimeEnvironment = (): Record<string, string | undefined> =>
  (
    globalThis as unknown as {
      process?: { env?: Record<string, string | undefined> };
    }
  ).process?.env || {};

const runtimeAuthorization = (): string | undefined =>
  runtimeEnvironment().FORWARD_NQE_READONLY_AUTHORIZATION?.trim() ||
  runtimeEnvironment().FORWARD_READONLY_AUTHORIZATION?.trim();

const allowedQueryIds = (): Set<string> =>
  new Set(
    (runtimeEnvironment().FORWARD_NQE_ALLOWED_QUERY_IDS || "")
      .split(",")
      .map((value) => value.trim())
      .filter(Boolean),
  );

const isForwardQueryId = (value: string): boolean => /^FQ_[A-Fa-f0-9]{40}$/.test(value);

const clampMaxRows = (value: number | undefined): number => {
  if (!Number.isInteger(value) || value === undefined || value <= 0) {
    return DEFAULT_MAX_ROWS;
  }
  return Math.min(value, 100);
};

const templateQuery = (templateId: NqeTemplateId): string | undefined => {
  if (templateId !== "endpoint-inventory-smoke") {
    return undefined;
  }

  return [
    "foreach device in network.devices",
    "select {",
    "  Device: device.name,",
    "}",
  ].join("\n");
};

const dependencyParameters = (
  dependency: DependencyContext | undefined,
): Record<string, unknown> => ({
  ...(dependency?.appName ? { application: dependency.appName } : {}),
  ...(dependency?.environment ? { environment: dependency.environment } : {}),
  ...(dependency?.serviceEntityId ? { serviceEntityId: dependency.serviceEntityId } : {}),
  ...(dependency?.source ? { source: dependency.source } : {}),
  ...(dependency?.destination ? { destination: dependency.destination } : {}),
  ...(dependency?.protocol ? { protocol: dependency.protocol } : {}),
  ...(dependency?.port ? { port: dependency.port } : {}),
  ...(dependency?.owner ? { owner: dependency.owner } : {}),
});

const buildNqeBody = (payload: ForwardNqePreviewRequest): Record<string, unknown> => {
  const maxRows = clampMaxRows(payload.maxRows);
  const queryOptions = {
    limit: maxRows,
    offset: 0,
  };
  const parameters = {
    ...dependencyParameters(payload.dependency),
    ...(payload.parameters || {}),
  };

  if (payload.queryId) {
    return {
      queryId: payload.queryId.trim(),
      ...(payload.commitId ? { commitId: payload.commitId.trim() } : {}),
      ...(Object.keys(parameters).length > 0 ? { parameters } : {}),
      queryOptions,
    };
  }

  return {
    query: templateQuery(payload.templateId || DEFAULT_TEMPLATE_ID),
    queryOptions,
  };
};

const nqePath = (payload: ForwardNqePreviewRequest): string => {
  const params = new URLSearchParams();
  if (payload.forwardNetworkId) {
    params.set("networkId", payload.forwardNetworkId.trim());
  }
  if (payload.snapshotId) {
    params.set("snapshotId", payload.snapshotId.trim());
  }
  const query = params.toString();
  return `/api/nqe${query ? `?${query}` : ""}`;
};

const baseEvidence = (
  payload: ForwardNqePreviewRequest,
  templateId: NqeTemplateId,
): Array<{ label: string; value: string }> => [
  { label: "Template", value: templateId },
  { label: "Mode", value: payload.execute ? "execute" : "plan" },
  { label: "Forward network", value: payload.forwardNetworkId || "not supplied" },
  { label: "Snapshot", value: payload.snapshotId || "latest via network ID" },
  { label: "Query ID", value: payload.queryId || "raw allowlisted template" },
  {
    label: "Dependency",
    value: payload.dependency?.serviceName || payload.dependency?.serviceEntityId || "not supplied",
  },
];

const sanitizeRows = (
  rows: unknown,
  includeResultSample: boolean | undefined,
): ForwardNqePreviewResponse["result"] => {
  const items = Array.isArray(rows) ? rows : [];
  const recordRows = items.filter(
    (item): item is Record<string, unknown> =>
      Boolean(item) && typeof item === "object" && !Array.isArray(item),
  );
  const columns = [...new Set(recordRows.flatMap((row) => Object.keys(row)))];
  return {
    totalRows: recordRows.length,
    returnedRows: recordRows.length,
    columns,
    ...(includeResultSample
      ? { sampleRows: recordRows.slice(0, MAX_RESULT_SAMPLE_ROWS) }
      : {}),
  };
};

const getValue = (
  row: Record<string, unknown>,
  candidateKeys: string[],
): unknown => {
  const normalizedKeys = new Map(
    Object.keys(row).map((key) => [key.toLowerCase().replace(/[^a-z0-9]/g, ""), key]),
  );
  for (const candidateKey of candidateKeys) {
    const key = normalizedKeys.get(candidateKey.toLowerCase().replace(/[^a-z0-9]/g, ""));
    if (key) {
      return row[key];
    }
  }
  return undefined;
};

const toStringValue = (value: unknown): string | undefined => {
  if (typeof value === "string" && value.trim()) {
    return value.trim();
  }
  if (typeof value === "number" || typeof value === "boolean") {
    return String(value);
  }
  return undefined;
};

const toNumberValue = (value: unknown): number | undefined => {
  if (typeof value === "number" && Number.isFinite(value)) {
    return value;
  }
  if (typeof value === "string" && value.trim()) {
    const parsed = Number.parseInt(value, 10);
    if (Number.isFinite(parsed)) {
      return parsed;
    }
  }
  return undefined;
};

const toBooleanValue = (value: unknown): boolean | undefined => {
  if (typeof value === "boolean") {
    return value;
  }
  if (typeof value === "string") {
    const normalized = value.trim().toLowerCase();
    if (["true", "yes", "resolved", "mapped", "match", "matched"].includes(normalized)) {
      return true;
    }
    if (["false", "no", "unresolved", "missing", "not-found", "not found"].includes(normalized)) {
      return false;
    }
  }
  return undefined;
};

const statusFromEvidence = (
  matchCount: number | undefined,
  resolved: boolean | undefined,
  status: string | undefined,
): EndpointResolutionStatus => {
  if (typeof matchCount === "number") {
    if (matchCount === 0) {
      return "unresolved";
    }
    if (matchCount === 1) {
      return "resolved";
    }
    return "ambiguous";
  }
  if (typeof resolved === "boolean") {
    return resolved ? "resolved" : "unresolved";
  }
  const normalized = status?.toLowerCase() || "";
  if (/unresolved|not[- ]?found|missing|no[- ]?match/.test(normalized)) {
    return "unresolved";
  }
  if (/ambiguous|multiple|many/.test(normalized)) {
    return "ambiguous";
  }
  if (/resolved|mapped|matched|found/.test(normalized)) {
    return "resolved";
  }
  return "unknown";
};

const endpointDetail = (
  status: EndpointResolutionStatus,
  matchCount: number | null,
): string => {
  if (status === "resolved") {
    return matchCount === null ? "Resolved in Forward." : `Resolved with ${matchCount} match.`;
  }
  if (status === "ambiguous") {
    return matchCount === null
      ? "Resolved ambiguously in Forward."
      : `Resolved ambiguously with ${matchCount} matches.`;
  }
  if (status === "unresolved") {
    return "No matching Forward location found.";
  }
  return "Endpoint-resolution query did not return a recognized status.";
};

const mappingStateFromEndpoints = (
  source: EndpointResolutionEndpoint,
  destination: EndpointResolutionEndpoint,
): EndpointResolutionMappingState => {
  if (source.status === "unresolved" || destination.status === "unresolved") {
    return "needs-map";
  }
  if (source.status === "resolved" && destination.status === "resolved") {
    return "ready";
  }
  return "review";
};

const endpointFromState = (
  role: "source" | "destination",
  value: string | undefined,
  status: EndpointResolutionStatus = "unknown",
  matchCount: number | null = null,
): EndpointResolutionEndpoint => ({
  role,
  value: value || "not supplied",
  status,
  matchCount,
  detail: endpointDetail(status, matchCount),
});

const updateEndpoint = (
  endpoint: EndpointResolutionEndpoint,
  matchCount: number | undefined,
  resolved: boolean | undefined,
  statusText: string | undefined,
): EndpointResolutionEndpoint => {
  const status = statusFromEvidence(matchCount, resolved, statusText);
  const nextMatchCount = typeof matchCount === "number" ? matchCount : endpoint.matchCount;
  return {
    ...endpoint,
    status,
    matchCount: nextMatchCount,
    detail: endpointDetail(status, nextMatchCount),
  };
};

const sameEndpoint = (left: string | undefined, right: string | undefined): boolean =>
  Boolean(left && right && left.trim().toLowerCase() === right.trim().toLowerCase());

const rowRole = (
  row: Record<string, unknown>,
  dependency: DependencyContext,
): "source" | "destination" | undefined => {
  const role = toStringValue(getValue(row, [
    "role",
    "endpointRole",
    "endpoint_role",
    "direction",
    "side",
  ]))?.toLowerCase();
  if (role) {
    if (/source|from|client/.test(role)) {
      return "source";
    }
    if (/destination|dest|to|server/.test(role)) {
      return "destination";
    }
  }

  const endpoint = toStringValue(getValue(row, [
    "endpoint",
    "endpointName",
    "location",
    "locationValue",
    "host",
    "name",
    "value",
  ]));
  if (sameEndpoint(endpoint, dependency.source)) {
    return "source";
  }
  if (sameEndpoint(endpoint, dependency.destination)) {
    return "destination";
  }
  return undefined;
};

const analyzeEndpointResolution = (
  templateId: NqeTemplateId,
  dependency: DependencyContext | undefined,
  rows: Record<string, unknown>[],
): EndpointResolutionSummary | undefined => {
  if (templateId !== "approved-endpoint-resolution" || !dependency) {
    return undefined;
  }

  let source = endpointFromState("source", dependency.source);
  let destination = endpointFromState("destination", dependency.destination);

  for (const row of rows) {
    const sourceMatchCount = toNumberValue(getValue(row, [
      "sourceMatchCount",
      "sourceMatches",
      "source_match_count",
      "fromMatchCount",
      "fromMatches",
    ]));
    const destinationMatchCount = toNumberValue(getValue(row, [
      "destinationMatchCount",
      "destinationMatches",
      "destination_match_count",
      "destMatchCount",
      "toMatchCount",
      "toMatches",
    ]));
    if (sourceMatchCount !== undefined) {
      source = updateEndpoint(
        source,
        sourceMatchCount,
        toBooleanValue(getValue(row, ["sourceResolved", "fromResolved"])),
        toStringValue(getValue(row, ["sourceStatus", "fromStatus"])),
      );
    }
    if (destinationMatchCount !== undefined) {
      destination = updateEndpoint(
        destination,
        destinationMatchCount,
        toBooleanValue(getValue(row, ["destinationResolved", "destResolved", "toResolved"])),
        toStringValue(getValue(row, ["destinationStatus", "destStatus", "toStatus"])),
      );
    }

    const role = rowRole(row, dependency);
    if (!role) {
      continue;
    }
    const matchCount = toNumberValue(getValue(row, [
      "matchCount",
      "matches",
      "matchedLocations",
      "locationCount",
      "count",
    ]));
    const resolved = toBooleanValue(getValue(row, [
      "resolved",
      "isResolved",
      "mapped",
      "matched",
    ]));
    const statusText = toStringValue(getValue(row, [
      "status",
      "mappingStatus",
      "resolutionStatus",
    ]));
    if (role === "source") {
      source = updateEndpoint(source, matchCount, resolved, statusText);
    } else {
      destination = updateEndpoint(destination, matchCount, resolved, statusText);
    }
  }

  if (rows.length === 0) {
    source = endpointFromState("source", dependency.source, "unresolved", 0);
    destination = endpointFromState("destination", dependency.destination, "unresolved", 0);
  }

  const mappingState = mappingStateFromEndpoints(source, destination);
  const summary =
    mappingState === "ready"
      ? "Forward resolved both dependency endpoints."
      : mappingState === "needs-map"
        ? "Forward could not resolve one or both dependency endpoints; keep this row out of apply until mapped."
        : "Forward endpoint resolution needs review before apply.";

  return {
    mappingState,
    source,
    destination,
    summary,
  };
};

const isRecord = (value: unknown): value is Record<string, unknown> =>
  Boolean(value) && typeof value === "object" && !Array.isArray(value);

const blocked = (
  summary: string,
  payload: ForwardNqePreviewRequest,
  body: Record<string, unknown>,
  nextSteps: string[],
): ForwardNqePreviewResponse => ({
  status: "blocked",
  summary,
  generatedAt: new Date().toISOString(),
  templateId: payload.templateId || DEFAULT_TEMPLATE_ID,
  requestPreview: {
    method: "POST",
    path: nqePath(payload),
    body,
  },
  evidence: baseEvidence(payload, payload.templateId || DEFAULT_TEMPLATE_ID),
  nextSteps,
});

export const buildForwardNqePreview = async (
  payload: ForwardNqePreviewRequest | undefined,
  fetchImpl: typeof fetch = fetch,
): Promise<ForwardNqePreviewResponse> => {
  const generatedAt = new Date().toISOString();
  const request = payload || {};
  const templateId = request.templateId || DEFAULT_TEMPLATE_ID;
  const body = buildNqeBody({ ...request, templateId });
  const requestPreview = {
    method: "POST" as const,
    path: nqePath(request),
    body,
  };

  if (templateId !== "endpoint-inventory-smoke" && !request.queryId) {
    return blocked(
      "This preview template requires an approved Forward NQE Library query ID.",
      { ...request, templateId },
      body,
      [
        "Create and commit the query in Forward NQE Library.",
        "Add the query ID to the allowlist used by the runtime.",
        "Rerun the preview with queryId and dependency parameters.",
      ],
    );
  }

  if (request.queryId) {
    const queryId = request.queryId.trim();
    if (!isForwardQueryId(queryId)) {
      return blocked(
        "Forward NQE query IDs must use the FQ_<40 hex chars> form.",
        { ...request, templateId },
        body,
        ["Use a committed Forward NQE Library query ID."],
      );
    }
    if (!allowedQueryIds().has(queryId)) {
      return blocked(
        "The supplied Forward NQE query ID is not in the runtime allowlist.",
        { ...request, templateId },
        body,
        [
          "Add the query ID to FORWARD_NQE_ALLOWED_QUERY_IDS in the runtime secret/config layer.",
          "Keep query authoring and commit ownership inside Forward.",
        ],
      );
    }
  }

  if (!request.execute) {
    const targetSupplied = !missing(request.forwardBaseUrl) && !missing(request.forwardNetworkId);
    return {
      status: "planned",
      summary: targetSupplied
        ? "Read-only Forward NQE preview request is planned but not executed."
        : "Read-only Forward NQE preview is planned. Add Forward URL metadata and a network ID before execution.",
      generatedAt,
      templateId,
      requestPreview,
      evidence: baseEvidence(request, templateId),
      nextSteps: [
        ...(targetSupplied ? [] : ["Add Forward URL and network ID metadata before execution."]),
        "Review the NQE request body and dependency parameters.",
        "Execute only from a runtime with read-only Forward NQE permission.",
        "Use preview results to mark Dynatrace rows ready, review, or needs-map.",
      ],
    };
  }

  if (missing(request.forwardBaseUrl) || missing(request.forwardNetworkId)) {
    return blocked(
      "Forward NQE execution requires Forward URL metadata and a network ID.",
      { ...request, templateId },
      body,
      [
        "Add Forward URL and network ID metadata.",
        "Keep Forward write credentials out of Dynatrace.",
        "Use read-only NQE execution permission only for this preview path.",
      ],
    );
  }

  const authorization = runtimeAuthorization();
  if (!authorization) {
    return blocked(
      "Execution requires a runtime-supplied read-only Forward authorization header.",
      { ...request, templateId },
      body,
      [
        "Inject FORWARD_NQE_READONLY_AUTHORIZATION from a secret store.",
        "Do not put Forward credentials in browser state, app settings, or package artifacts.",
        "Use a Forward-side proxy if the customer does not permit Dynatrace-hosted NQE execution.",
      ],
    );
  }

  try {
    const response = await fetchImpl(
      `${normalizeBaseUrl(request.forwardBaseUrl || "")}${requestPreview.path}`,
      {
        method: "POST",
        headers: {
          Accept: "application/json",
          Authorization: authorization,
          "Content-Type": "application/json",
        },
        body: JSON.stringify(body),
      },
    );
    const text = await response.text();
    const parsed: unknown = text ? JSON.parse(text) : {};
    const parsedRecord = isRecord(parsed) ? parsed : {};
    const resultRows = Array.isArray(parsedRecord.items)
      ? parsedRecord.items.filter(
          (item): item is Record<string, unknown> =>
            Boolean(item) && typeof item === "object" && !Array.isArray(item),
        )
      : [];
    const sanitized = sanitizeRows(
      parsedRecord.items,
      request.includeResultSample,
    );
    const totalNumItems = parsedRecord.totalNumItems;

    if (!response.ok) {
      return {
        status: "failed",
        summary: `Forward NQE preview failed with HTTP ${response.status}.`,
        generatedAt,
        templateId,
        requestPreview,
        evidence: [
          ...baseEvidence(request, templateId),
          { label: "HTTP status", value: String(response.status) },
        ],
        nextSteps: [
          "Confirm the read-only credential can execute NQE.",
          "Validate the query ID/template against the target Forward instance.",
          "Do not block package export; lower mapping confidence or mark the dependency for review.",
        ],
      };
    }

    const result = {
      snapshotId:
        typeof parsedRecord.snapshotId === "string"
          ? parsedRecord.snapshotId
          : undefined,
      ...sanitized,
      totalRows: typeof totalNumItems === "number" && Number.isInteger(totalNumItems)
        ? totalNumItems
        : sanitized?.totalRows || 0,
    };
    const endpointResolution = analyzeEndpointResolution(
      templateId,
      request.dependency,
      resultRows,
    );

    return {
      status: "ready",
      summary: endpointResolution?.summary ||
        "Forward NQE preview completed with sanitized aggregate evidence.",
      generatedAt,
      templateId,
      requestPreview,
      evidence: [
        ...baseEvidence(request, templateId),
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
          ? "Mark unresolved dependencies as needs-map before exporting an apply package."
          : "Use aggregate evidence to improve Dynatrace-to-Forward mapping confidence.",
        "Keep persistent Forward writes in the importer or Forward-side connector.",
      ],
    };
  } catch (error) {
    return {
      status: "failed",
      summary: `Forward NQE preview failed: ${error instanceof Error ? error.message : "unknown error"}`,
      generatedAt,
      templateId,
      requestPreview,
      evidence: baseEvidence(request, templateId),
      nextSteps: [
        "Confirm Forward URL, network ID, and runtime authorization.",
        "Treat preview failure as non-blocking for package export.",
      ],
    };
  }
};

export default async function (
  payload?: ForwardNqePreviewRequest,
): Promise<ForwardNqePreviewResponse> {
  return buildForwardNqePreview(payload);
}
