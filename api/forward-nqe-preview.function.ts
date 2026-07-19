type NqePreviewStatus = "planned" | "ready" | "blocked" | "failed";
type ForwardAccessProfile = "read-only" | "network-operator" | "network-admin";
type NqeTemplateId = "endpoint-inventory-smoke" | "approved-library-query";

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
  forwardAccessProfile?: ForwardAccessProfile;
  forwardBaseUrl?: string;
  forwardNetworkId?: string;
  snapshotId?: string;
  templateId?: NqeTemplateId;
  queryId?: string;
  query?: string;
  commitId?: string;
  parameters?: Record<string, unknown>;
  maxRows?: number;
  dependency?: DependencyContext;
  execute?: boolean;
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
  nextSteps: string[];
}

const DEFAULT_TEMPLATE_ID: NqeTemplateId = "endpoint-inventory-smoke";
const DEFAULT_MAX_ROWS = 25;
const MAX_RESULT_SAMPLE_ROWS = 5;
const MAX_QUERY_LENGTH = 65_536;

const missing = (value: string | undefined): boolean => !value?.trim();

const isRecord = (value: unknown): value is Record<string, unknown> =>
  Boolean(value) && typeof value === "object" && !Array.isArray(value);

const isForwardAccessProfile = (value: unknown): value is ForwardAccessProfile =>
  value === "read-only" || value === "network-operator" || value === "network-admin";

const canExecuteArbitraryNqe = (value: ForwardAccessProfile): boolean =>
  value === "network-operator" || value === "network-admin";

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
  const queryOptions = { limit: clampMaxRows(payload.maxRows), offset: 0 };
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
    query: payload.query?.trim() || templateQuery(payload.templateId || DEFAULT_TEMPLATE_ID),
    queryOptions,
  };
};

const nqePath = (payload: ForwardNqePreviewRequest): string => {
  const params = new URLSearchParams();
  if (payload.forwardNetworkId) params.set("networkId", payload.forwardNetworkId.trim());
  if (payload.snapshotId) params.set("snapshotId", payload.snapshotId.trim());
  const query = params.toString();
  return `/api/nqe${query ? `?${query}` : ""}`;
};

const baseEvidence = (
  payload: ForwardNqePreviewRequest,
  templateId: NqeTemplateId,
): Array<{ label: string; value: string }> => [
  { label: "Template", value: templateId },
  { label: "Mode", value: "plan" },
  { label: "Forward profile", value: payload.forwardAccessProfile || "not supplied" },
  { label: "Forward network", value: payload.forwardNetworkId || "not supplied" },
  { label: "Snapshot", value: payload.snapshotId || "latest via network ID" },
  { label: "Query ID", value: payload.queryId || "raw capability smoke" },
  {
    label: "Dependency",
    value: payload.dependency?.serviceName || payload.dependency?.serviceEntityId || "not supplied",
  },
];

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
  requestPreview: { method: "POST", path: nqePath(payload), body },
  evidence: baseEvidence(payload, payload.templateId || DEFAULT_TEMPLATE_ID),
  nextSteps,
});

export const buildForwardNqePreview = (
  payload: ForwardNqePreviewRequest | undefined,
): ForwardNqePreviewResponse => {
  const request = payload || {};
  const templateId = request.templateId || DEFAULT_TEMPLATE_ID;
  const body = buildNqeBody({ ...request, templateId });

  if (!isForwardAccessProfile(request.forwardAccessProfile)) {
    return blocked(
      "Select a supported Forward access profile before planning NQE execution.",
      { ...request, templateId },
      body,
      ["Select Read Only, Network Operator, or Network Admin."],
    );
  }

  if (!canExecuteArbitraryNqe(request.forwardAccessProfile) && !request.queryId) {
    return blocked(
      "Read Only can execute only a customer-approved committed Forward Library NQE query ID.",
      { ...request, templateId },
      body,
      [
        "Supply a customer-owned committed query ID and add it to the app connection allowlist.",
        "Do not create an NQE solely for endpoint resolution; use the Forward host API and /paths-bulk.",
      ],
    );
  }

  if (request.query !== undefined) {
    if (!canExecuteArbitraryNqe(request.forwardAccessProfile)) {
      return blocked(
        "Read Only cannot execute arbitrary NQE text.",
        { ...request, templateId },
        body,
        ["Use a customer-approved committed Forward Library query ID."],
      );
    }
    if (!request.query.trim() || request.query.length > MAX_QUERY_LENGTH) {
      return blocked(
        `Arbitrary NQE text must be between 1 and ${MAX_QUERY_LENGTH} characters.`,
        { ...request, templateId },
        body,
        ["Provide one bounded, reviewed NQE query."],
      );
    }
  }

  if (templateId === "approved-library-query" && !request.queryId) {
    return blocked(
      "The approved Library query extension requires a customer-owned Forward query ID.",
      { ...request, templateId },
      body,
      [
        "Record the policy purpose, parameter contract, owner, and allowed query ID.",
        "Add the query ID to the app connection's approved Library-query allowlist.",
      ],
    );
  }

  if (request.queryId && !isForwardQueryId(request.queryId.trim())) {
    return blocked(
      "Forward NQE query IDs must use the FQ_<40 hex chars> form.",
      { ...request, templateId },
      body,
      ["Use a committed Forward Library query ID."],
    );
  }

  const targetSupplied = !missing(request.forwardBaseUrl) && !missing(request.forwardNetworkId);
  const accessProfileLabel = request.forwardAccessProfile === "read-only"
    ? "Read Only"
    : request.forwardAccessProfile === "network-operator"
      ? "Network Operator"
      : "Network Admin";
  return {
    status: "planned",
    summary: targetSupplied
      ? `${accessProfileLabel} optional NQE request is planned for app-backend execution.`
      : `${accessProfileLabel} optional NQE request is planned. Add Forward URL metadata and a network ID before execution.`,
    generatedAt: new Date().toISOString(),
    templateId,
    requestPreview: { method: "POST", path: nqePath(request), body },
    evidence: baseEvidence(request, templateId),
    nextSteps: [
      ...(targetSupplied ? [] : ["Add Forward URL and network ID metadata before execution."]),
      "Confirm this optional NQE has a separately reviewed network-policy purpose.",
      `Execute with the bundled Dynatrace NQE action using a ${accessProfileLabel} secret connection.`,
      "Return only sanitized aggregate evidence to Dynatrace.",
    ],
  };
};

export const summarizeForwardNqeResponse = (
  _payload: ForwardNqePreviewRequest | undefined,
  parsed: unknown,
  includeResultSample = false,
): Pick<ForwardNqePreviewResponse, "result"> => {
  const parsedRecord = isRecord(parsed) ? parsed : {};
  const items = Array.isArray(parsedRecord.items) ? parsedRecord.items : [];
  const recordRows = items.filter(
    (item): item is Record<string, unknown> => isRecord(item),
  );
  const columns = [...new Set(recordRows.flatMap((row) => Object.keys(row)))];
  const totalNumItems = parsedRecord.totalNumItems;
  return {
    result: {
      snapshotId: typeof parsedRecord.snapshotId === "string" ? parsedRecord.snapshotId : undefined,
      totalRows: typeof totalNumItems === "number" && Number.isInteger(totalNumItems)
        ? totalNumItems
        : recordRows.length,
      returnedRows: recordRows.length,
      columns,
      ...(includeResultSample ? { sampleRows: recordRows.slice(0, MAX_RESULT_SAMPLE_ROWS) } : {}),
    },
  };
};

export default function (
  payload?: ForwardNqePreviewRequest,
): ForwardNqePreviewResponse {
  if (isRecord(payload) && payload.execute === true) {
    const planned = buildForwardNqePreview(payload);
    return {
      ...planned,
      status: "blocked",
      summary: "Use the bundled Dynatrace NQE Workflow action to execute approved optional NQE evidence.",
      nextSteps: [
        "Select the owner-controlled Forward API connection in the bundled NQE action.",
        "Require the request profile to match the selected connection exactly.",
        "Return only sanitized aggregate evidence from the app backend.",
      ],
    };
  }
  return buildForwardNqePreview(payload);
}
