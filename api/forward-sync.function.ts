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
  dataFileName: string;
  csvPreview: string;
  intentChecksPreview: string;
  actions: ForwardAction[];
  workflowTrigger: string;
  nextSteps: string[];
}

interface ForwardAction {
  method: "GET" | "POST" | "PATCH" | "DELETE";
  path: string;
  purpose: string;
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

const csvCell = (value: string | number): string => {
  const text = String(value);
  return /[",\n]/.test(text) ? `"${text.replaceAll('"', '""')}"` : text;
};

const toCsv = (dependencies: DependencyCandidate[]): string => {
  const headers = [
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
  const rows = dependencies.map((dependency) =>
    [
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
  return [headers.join(","), ...rows].join("\n");
};

const toCheckName = (dependency: DependencyCandidate): string =>
  `[Dynatrace] ${dependency.appName} ${dependency.environment}: ${dependency.source} -> ${dependency.destination} ${dependency.protocol}/${dependency.port}`;

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
    `owner=${dependency.owner}`,
    `confidence=${dependency.confidence}`,
  ].join("; "),
  priority: toPriority(dependency.criticality),
  tags: [
    "dynatrace",
    `app:${dependency.appName}`,
    `environment:${dependency.environment}`,
    `owner:${dependency.owner}`,
  ],
});

const buildActions = (payload: ForwardSyncRequest): ForwardAction[] => {
  const encodedFile = encodeURIComponent(payload.dataFileName);
  const actions: ForwardAction[] = [
    {
      method: "POST",
      path: "/api/data-files",
      purpose: "Create the Dynatrace dependency data file if it does not exist.",
    },
    {
      method: "POST",
      path: `/api/data-files/${encodedFile}`,
      purpose: "Replace the file contents with current Dynatrace dependencies.",
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
      method: "POST",
      path: "/api/snapshots/{latestProcessedSnapshotId}/checks?persistent=true",
      purpose: "Create persistent Forward intent checks from Dynatrace dependencies.",
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
      dataFileName: payload?.dataFileName || "dynatrace_service_dependencies.csv",
      csvPreview: "",
      intentChecksPreview: "",
      actions: [],
      workflowTrigger: "Not staged",
      nextSteps: ["Select at least one dependency row."],
    };
  }

  const csvPreview = toCsv(payload.dependencies);
  const intentChecksPreview = JSON.stringify(
    payload.dependencies.map(toIntentCheck),
    null,
    2,
  );
  const hasForwardTarget =
    !missing(payload.forwardBaseUrl) && !missing(payload.forwardNetworkId);

  return {
    status: hasForwardTarget ? "ready" : "dry-run",
    summary: hasForwardTarget
      ? "Forward sync plan is ready. Credential storage is the only missing runtime piece."
      : "Dry run generated. Add Forward base URL and network ID to make this executable.",
    generatedAt,
    dataFileName: payload.dataFileName,
    csvPreview,
    intentChecksPreview,
    actions: buildActions(payload),
    workflowTrigger:
      "Dynatrace Workflow on problem trigger or schedule calls this app function, then posts the generated CSV to Forward.",
    nextSteps: [
      "Store Forward API credentials in Dynatrace server-side settings or credential vault.",
      "Allow the Forward host in Dynatrace External requests, or use EdgeConnect for private Forward.",
      "Run this function from a Dynatrace Workflow for automatic problem or scheduled sync.",
    ],
  };
}
