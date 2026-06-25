type ForwardSyncMode = "data-file" | "data-connector" | "intent-checks";
type ForwardSyncStatus = "ready" | "dry-run" | "blocked";

interface DependencyCandidate {
  id: string;
  appName: string;
  environment: string;
  serviceEntityId: string;
  serviceName: string;
  source: string;
  destination: string;
  protocol: "tcp" | "udp";
  port: string;
  owner: string;
  criticality: "critical" | "high" | "medium";
  confidence: number;
  mappingState: "ready" | "needs-map" | "review";
}

interface ForwardSyncRequest {
  forwardBaseUrl?: string;
  forwardNetworkId?: string;
  dataFileName: string;
  syncMode: ForwardSyncMode;
  includeInNetwork: boolean;
  triggerCollection: boolean;
  createVerifications: boolean;
  dependencies: DependencyCandidate[];
}

interface ForwardSyncResponse {
  status: ForwardSyncStatus;
  summary: string;
  generatedAt: string;
  disclaimer: string;
  dataFileName: string;
  csvPreview: string;
  dataFileRequestPreview: string;
  intentChecksPreview: string;
  intentCheckCount: number;
  rejectedDependencyCount: number;
  actions: ForwardAction[];
  readinessChecks: ReadinessCheck[];
  workflowTrigger: string;
  nextSteps: string[];
}

interface ForwardAction {
  method: "GET" | "POST" | "PATCH" | "DELETE";
  path: string;
  purpose: string;
  bodyPreview?: string;
  idempotencyKey?: string;
}

interface ReadinessCheck {
  label: string;
  status: "ready" | "needs-work" | "blocked";
  detail: string;
}

interface ForwardIntentCheck {
  definition: {
    checkType: "Existential" | "Reachability";
    filters: {
      from: ForwardEndpoint;
      to: ForwardEndpoint;
      flowTypes?: string[];
    };
    headerFieldsWithDefaults: string[];
    noiseTypes: string[];
    returnPath?: "ANY" | "SYMMETRIC";
  };
  enabled: boolean;
  name: string;
  note: string;
  priority: "LOW" | "MEDIUM" | "HIGH";
  tags: string[];
}

interface ForwardEndpoint {
  location: {
    type: "HostFilter";
    value: string;
  };
  headers?: Array<{
    type: "PacketFilter";
    values: Record<string, string[]>;
  }>;
}

const missing = (value: string | undefined): boolean => !value?.trim();

const DEMO_DISCLAIMER =
  "Art-of-the-possible demonstration: this function produces Forward-ready payloads and a production API plan, but it does not mutate Forward until server-side credentials and execution wiring are added.";

const DATA_FILE_HEADERS = [
  "integration_key",
  "app",
  "environment",
  "service_entity_id",
  "service_name",
  "source",
  "destination",
  "protocol",
  "port",
  "owner",
  "criticality",
  "confidence",
  "mapping_state",
  "intent_check_name",
  "intent_check_type",
];

const DATA_FILE_NQE_NAME = "dynatrace_service_dependencies";

const csvCell = (value: string | number): string => {
  const text = String(value);
  return /[",\n]/.test(text) ? `"${text.replaceAll('"', '""')}"` : text;
};

const toCsv = (dependencies: DependencyCandidate[]): string => {
  const rows = dependencies.map((dependency) =>
    [
      toIntegrationKey(dependency),
      dependency.appName,
      dependency.environment,
      dependency.serviceEntityId,
      dependency.serviceName,
      dependency.source,
      dependency.destination,
      dependency.protocol,
      dependency.port,
      dependency.owner,
      dependency.criticality,
      dependency.confidence,
      dependency.mappingState,
      toCheckName(dependency),
      "Existential",
    ]
      .map(csvCell)
      .join(","),
  );
  return [DATA_FILE_HEADERS.join(","), ...rows].join("\n");
};

const toCheckName = (dependency: DependencyCandidate): string =>
  `[Dynatrace] ${dependency.appName} ${dependency.environment}: ${dependency.source} -> ${dependency.destination} ${dependency.protocol}/${dependency.port}`;

const toSlug = (value: string): string =>
  value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 80);

const toIntegrationKey = (dependency: DependencyCandidate): string =>
  [
    "dt",
    toSlug(dependency.appName),
    toSlug(dependency.environment),
    toSlug(dependency.serviceEntityId),
    toSlug(dependency.source),
    toSlug(dependency.destination),
    dependency.protocol,
    dependency.port,
  ]
    .filter(Boolean)
    .join(":");

const toPriority = (
  criticality: DependencyCandidate["criticality"],
): ForwardIntentCheck["priority"] => {
  if (criticality === "critical") {
    return "HIGH";
  }
  if (criticality === "high") {
    return "MEDIUM";
  }
  return "LOW";
};

const toProtocolValue = (protocol: DependencyCandidate["protocol"]): string =>
  protocol.toUpperCase();

const toIntentCheck = (dependency: DependencyCandidate): ForwardIntentCheck => ({
  definition: {
    checkType: "Existential",
    filters: {
      from: {
        location: {
          type: "HostFilter",
          value: dependency.source,
        },
        headers: [
          {
            type: "PacketFilter",
            values: {
              ip_proto: [toProtocolValue(dependency.protocol)],
              tp_dst: [dependency.port],
            },
          },
        ],
      },
      to: {
        location: {
          type: "HostFilter",
          value: dependency.destination,
        },
      },
      flowTypes: ["VALID"],
    },
    headerFieldsWithDefaults: ["url"],
    noiseTypes: [],
    returnPath: "ANY",
  },
  enabled: true,
  name: toCheckName(dependency),
  note: [
    `Generated from Dynatrace service ${dependency.serviceName}`,
    `serviceEntityId=${dependency.serviceEntityId}`,
    `integrationKey=${toIntegrationKey(dependency)}`,
    `owner=${dependency.owner}`,
    `confidence=${dependency.confidence}`,
  ].join("; "),
  priority: toPriority(dependency.criticality),
  tags: [
    "dynatrace",
    `app:${dependency.appName}`,
    `environment:${dependency.environment}`,
    `owner:${dependency.owner}`,
    `dynatrace-key:${toIntegrationKey(dependency)}`,
  ],
});

const toDataFileRequest = (
  payload: ForwardSyncRequest,
): Record<string, string | string[] | null> => ({
  name: payload.dataFileName,
  nqeName: DATA_FILE_NQE_NAME,
  description:
    "Generated by the Forward Dynatrace art-of-the-possible app. Contains normalized Dynatrace service dependencies for NQE and Verify correlation.",
  fileType: "CSV",
  headers: DATA_FILE_HEADERS,
});

const toReadinessChecks = (
  payload: ForwardSyncRequest,
  exportableDependencies: DependencyCandidate[],
): ReadinessCheck[] => [
  {
    label: "Forward target",
    status:
      missing(payload.forwardBaseUrl) || missing(payload.forwardNetworkId)
        ? "needs-work"
        : "ready",
    detail:
      missing(payload.forwardBaseUrl) || missing(payload.forwardNetworkId)
        ? "Base URL and network ID are needed before execution."
        : "Forward base URL and network ID are configured.",
  },
  {
    label: "Credential storage",
    status: "blocked",
    detail:
      "Production execution needs server-side Forward credentials. No browser-supplied secret is accepted.",
  },
  {
    label: "External requests",
    status: "needs-work",
    detail:
      "Dynatrace must allow the Forward host, or route to private Forward with EdgeConnect.",
  },
  {
    label: "Dependency quality",
    status: exportableDependencies.length > 0 ? "ready" : "blocked",
    detail: `${exportableDependencies.length} dependency rows are eligible for Forward artifact generation.`,
  },
  {
    label: "Idempotency",
    status: "ready",
    detail:
      "Rows include deterministic integration keys and intent-check tags for dedupe/update logic.",
  },
];

const isExportableDependency = (dependency: DependencyCandidate): boolean =>
  dependency.mappingState !== "needs-map" &&
  Boolean(
    dependency.source &&
      dependency.destination &&
      dependency.protocol &&
      dependency.port &&
      dependency.serviceEntityId,
  );

const buildActions = (
  payload: ForwardSyncRequest,
  intentChecks: ForwardIntentCheck[],
): ForwardAction[] => {
  const encodedFile = encodeURIComponent(payload.dataFileName);
  const actions: ForwardAction[] = [
    {
      method: "POST",
      path: "/api/data-files",
      purpose: "Create the Dynatrace dependency data file if it does not exist.",
      bodyPreview:
        "multipart/form-data: file=<generated CSV>, request=<DataFileCreateRequest JSON>",
    },
    {
      method: "POST",
      path: `/api/data-files/${encodedFile}`,
      purpose: "Replace the file contents with current Dynatrace dependencies.",
      bodyPreview: "multipart/form-data: file=<generated CSV>",
    },
  ];

  if (payload.includeInNetwork) {
    actions.push({
      method: "POST",
      path: `/api/networks/${payload.forwardNetworkId || "{networkId}"}/data-files/${encodedFile}`,
      purpose: "Enable the data file for the Forward network.",
    });
  }

  if (payload.triggerCollection) {
    actions.push({
      method: "POST",
      path: `/api/networks/${payload.forwardNetworkId || "{networkId}"}/snapshots?async=1`,
      purpose: "Start a snapshot so NQE and Verify consume the updated data.",
    });
  }

  if (payload.createVerifications) {
    actions.push({
      method: "GET",
      path: `/api/networks/${payload.forwardNetworkId || "{networkId}"}/snapshots/latestProcessed`,
      purpose: "Resolve the latest processed snapshot that can accept persistent checks.",
    });
    actions.push({
      method: "GET",
      path: "/api/snapshots/{latestProcessedSnapshotId}/checks?type=Existential",
      purpose:
        "Find existing Dynatrace-managed checks by deterministic name or dynatrace-key tag before creating new ones.",
    });
    actions.push({
      method: "POST",
      path: "/api/snapshots/{latestProcessedSnapshotId}/checks?persistent=true",
      purpose: "Create persistent Forward intent checks from Dynatrace dependencies.",
      bodyPreview: `${intentChecks.length} NewNetworkCheck JSON payload(s)`,
      idempotencyKey: "Forward check name plus dynatrace-key tag",
    });
    actions.push({
      method: "GET",
      path: "/api/snapshots/{latestProcessedSnapshotId}/checks?type=Existential",
      purpose: "Read back check status so Dynatrace can annotate the problem or app screen.",
    });
  }

  return actions;
};

export default function (
  payload?: ForwardSyncRequest,
): ForwardSyncResponse {
  const generatedAt = new Date().toISOString();

  if (!payload || payload.dependencies.length === 0) {
    return {
      status: "blocked",
      summary: "No dependency rows selected for Forward sync.",
      generatedAt,
      disclaimer: DEMO_DISCLAIMER,
      dataFileName: payload?.dataFileName || "dynatrace_service_dependencies.csv",
      csvPreview: "",
      dataFileRequestPreview: "",
      intentChecksPreview: "",
      intentCheckCount: 0,
      rejectedDependencyCount: 0,
      actions: [],
      readinessChecks: [],
      workflowTrigger: "Not staged",
      nextSteps: ["Select at least one dependency row."],
    };
  }

  const exportableDependencies = payload.dependencies.filter(isExportableDependency);
  const rejectedDependencyCount =
    payload.dependencies.length - exportableDependencies.length;
  const intentChecks = exportableDependencies.map(toIntentCheck);
  const csvPreview = toCsv(exportableDependencies);
  const dataFileRequestPreview = JSON.stringify(toDataFileRequest(payload), null, 2);
  const intentChecksPreview = JSON.stringify(
    intentChecks,
    null,
    2,
  );
  const hasForwardTarget =
    !missing(payload.forwardBaseUrl) && !missing(payload.forwardNetworkId);

  if (exportableDependencies.length === 0) {
    return {
      status: "blocked",
      summary:
        "No rows are production-ready for Forward. Map each dependency to a source, destination, protocol, port, and Dynatrace service entity.",
      generatedAt,
      disclaimer: DEMO_DISCLAIMER,
      dataFileName: payload.dataFileName,
      csvPreview,
      dataFileRequestPreview,
      intentChecksPreview,
      intentCheckCount: 0,
      rejectedDependencyCount,
      actions: [],
      readinessChecks: toReadinessChecks(payload, exportableDependencies),
      workflowTrigger: "Not staged",
      nextSteps: [
        "Complete endpoint mapping for at least one dependency.",
        "Keep needs-map rows out of automated Forward check creation.",
      ],
    };
  }

  return {
    status: hasForwardTarget ? "ready" : "dry-run",
    summary: hasForwardTarget
      ? "Forward payloads are ready. Execution remains disabled until server-side credentials are configured."
      : "Dry run generated. Add Forward base URL and network ID to complete the execution target.",
    generatedAt,
    disclaimer: DEMO_DISCLAIMER,
    dataFileName: payload.dataFileName,
    csvPreview,
    dataFileRequestPreview,
    intentChecksPreview,
    intentCheckCount: intentChecks.length,
    rejectedDependencyCount,
    actions: buildActions(payload, intentChecks),
    readinessChecks: toReadinessChecks(payload, exportableDependencies),
    workflowTrigger:
      "Dynatrace Workflow on problem trigger or schedule calls this app function, then posts the generated Data File and persistent check payloads to Forward.",
    nextSteps: [
      "Store Forward API credentials in Dynatrace server-side settings or credential vault.",
      "Allow the Forward host in Dynatrace External requests, or use EdgeConnect for private Forward.",
      "Implement execution behind the current dry-run plan: create/update Data File, resolve latest processed snapshot, dedupe checks, then POST persistent checks.",
      "Run this function from a Dynatrace Workflow for automatic problem or scheduled sync.",
    ],
  };
}
