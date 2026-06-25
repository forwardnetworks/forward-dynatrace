type ForwardSyncMode = "manual-import" | "data-connector" | "intent-package";
type ForwardSyncStatus = "ready" | "blocked";

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
  syncMode: ForwardSyncMode;
  dependencies: DependencyCandidate[];
}

interface ForwardSyncResponse {
  status: ForwardSyncStatus;
  summary: string;
  generatedAt: string;
  disclaimer: string;
  exportManifestPreview: string;
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

interface ForwardExportManifest {
  schemaVersion: "forward-dynatrace/v1";
  packageType: "forward-intent-import";
  packageId: string;
  generatedAt: string;
  requestedIngestPath: ForwardSyncMode;
  source: {
    platform: "dynatrace";
    app: "forward-dynatrace";
    writePolicy: "dynatrace-never-writes-forward";
  };
  forwardTargetMetadata: {
    baseUrl: string | null;
    networkId: string | null;
    requiredAtImport: boolean;
  };
  artifacts: {
    manifest: string;
    intentChecks: string;
  };
  dependencyRows: {
    rowCount: number;
    rejectedRowCount: number;
  };
  intentChecks: {
    count: number;
    checkType: "Existential";
    payloadShape: "NewNetworkCheck[]";
    bulkEndpoint: "/api/snapshots/{snapshotId}/checks?bulk";
    dedupeRequiredBeforePost: true;
    dedupe: "name-or-dynatrace-key-tag";
    fingerprintAlgorithm: "canonical-json-sha256";
  };
  validation: {
    requiredTagPrefix: "dynatrace-key:";
    requiredTagsPerCheck: 1;
    duplicatePolicy: "reject-package";
    allowedCheckTypes: Array<"Existential">;
    credentialPolicy: "no-forward-credentials-in-dynatrace";
  };
  reconciliation: {
    strategy: "desired-state";
    defaultApplyPolicy: "create-missing-only";
    changedChecks: "report-only";
    staleChecks: "report-only";
  };
  bulkPolicy: {
    supported: true;
    batchingOwner: "forward-side-ingest";
    recommendedBatchSize: number;
    partialFailurePolicy: "report-per-row-and-continue-safe-creates";
  };
  workflowOptions: Array<{
    id: "manual-import" | "data-connector";
    owner: "forward-operator" | "forward-owned-connector";
    writesForward: true;
    summary: string;
  }>;
}

const missing = (value: string | undefined): boolean => !value?.trim();

const DEMO_DISCLAIMER =
  "Art-of-the-possible demonstration: this Dynatrace app only exports Forward-ready artifacts. Forward ingestion is performed manually by a Forward operator or automatically by a Forward-owned data connector.";

const MANIFEST_FILE_NAME = "forward-dynatrace-manifest.json";
const INTENT_CHECKS_FILE_NAME = "forward-intent-checks.json";

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
  protocol === "tcp" ? "6" : "17";

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
            },
          },
          {
            type: "PacketFilter",
            values: {
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

const toPackageId = (generatedAt: string): string =>
  `dynatrace-forward-${generatedAt.replace(/[^0-9]/g, "").slice(0, 14)}`;

const toExportManifest = ({
  payload,
  generatedAt,
  exportableDependencies,
  rejectedDependencyCount,
  intentChecks,
}: {
  payload: ForwardSyncRequest;
  generatedAt: string;
  exportableDependencies: DependencyCandidate[];
  rejectedDependencyCount: number;
  intentChecks: ForwardIntentCheck[];
}): ForwardExportManifest => ({
  schemaVersion: "forward-dynatrace/v1",
  packageType: "forward-intent-import",
  packageId: toPackageId(generatedAt),
  generatedAt,
  requestedIngestPath: payload.syncMode,
  source: {
    platform: "dynatrace",
    app: "forward-dynatrace",
    writePolicy: "dynatrace-never-writes-forward",
  },
  forwardTargetMetadata: {
    baseUrl: missing(payload.forwardBaseUrl) ? null : payload.forwardBaseUrl.trim(),
    networkId: missing(payload.forwardNetworkId)
      ? null
      : payload.forwardNetworkId.trim(),
    requiredAtImport:
      missing(payload.forwardBaseUrl) || missing(payload.forwardNetworkId),
  },
  artifacts: {
    manifest: MANIFEST_FILE_NAME,
    intentChecks: INTENT_CHECKS_FILE_NAME,
  },
  dependencyRows: {
    rowCount: exportableDependencies.length,
    rejectedRowCount: rejectedDependencyCount,
  },
  intentChecks: {
    count: intentChecks.length,
    checkType: "Existential",
    payloadShape: "NewNetworkCheck[]",
    bulkEndpoint: "/api/snapshots/{snapshotId}/checks?bulk",
    dedupeRequiredBeforePost: true,
    dedupe: "name-or-dynatrace-key-tag",
    fingerprintAlgorithm: "canonical-json-sha256",
  },
  validation: {
    requiredTagPrefix: "dynatrace-key:",
    requiredTagsPerCheck: 1,
    duplicatePolicy: "reject-package",
    allowedCheckTypes: ["Existential"],
    credentialPolicy: "no-forward-credentials-in-dynatrace",
  },
  reconciliation: {
    strategy: "desired-state",
    defaultApplyPolicy: "create-missing-only",
    changedChecks: "report-only",
    staleChecks: "report-only",
  },
  bulkPolicy: {
    supported: true,
    batchingOwner: "forward-side-ingest",
    recommendedBatchSize: 500,
    partialFailurePolicy: "report-per-row-and-continue-safe-creates",
  },
  workflowOptions: [
    {
      id: "manual-import",
      owner: "forward-operator",
      writesForward: true,
      summary:
        "Download artifacts from Dynatrace, review them, then run Forward-side dry-run/import tooling from a Forward-controlled environment.",
    },
    {
      id: "data-connector",
      owner: "forward-owned-connector",
      writesForward: true,
      summary:
        "Forward connector pulls the latest package from Dynatrace with read-only Dynatrace access, validates schema, dedupes checks, then performs Forward writes.",
    },
  ],
});

const toReadinessChecks = (
  payload: ForwardSyncRequest,
  exportableDependencies: DependencyCandidate[],
): ReadinessCheck[] => [
  {
    label: "Forward target metadata",
    status: "ready",
    detail:
      missing(payload.forwardBaseUrl) || missing(payload.forwardNetworkId)
        ? "Optional. Forward URL and network ID can be added during Forward-side import."
        : "Forward URL and network ID are included as package metadata.",
  },
  {
    label: "No Dynatrace write credential",
    status: "ready",
    detail:
      "The Dynatrace app does not collect or store Forward write credentials.",
  },
  {
    label: "Forward-owned ingest",
    status: "ready",
    detail:
      "Forward operator import or Forward data connector owns all Forward-side writes.",
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
      "Rows include deterministic integration keys and intent-check tags; Forward-side import must dedupe before bulk create.",
  },
  {
    label: "Package validation",
    status: "ready",
    detail:
      "Forward-side import rejects malformed packages, missing dynatrace-key tags, duplicate keys, duplicate names, and unsupported check types before writes.",
  },
  {
    label: "Bulk import",
    status: "ready",
    detail:
      "Intent checks are exported as NewNetworkCheck[] for Forward's standard /checks?bulk endpoint.",
  },
  {
    label: "Reconciliation",
    status: "ready",
    detail:
      "Forward-side import creates missing checks and reports changed or stale Dynatrace-managed checks.",
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
  const actions: ForwardAction[] = [];

  actions.push({
    method: "GET",
    path: `/api/networks/${payload.forwardNetworkId || "{networkId}"}/snapshots/latestProcessed`,
    purpose:
      "Forward-side import resolves the latest processed snapshot that can accept persistent checks.",
  });
  actions.push({
    method: "GET",
    path: "/api/snapshots/{latestProcessedSnapshotId}/checks?type=Existential",
    purpose:
      "Forward-side import reads existing intent checks, dedupes by check name or dynatrace-key tag, and detects changed or stale checks.",
  });
  actions.push({
    method: "POST",
    path: "/api/snapshots/{latestProcessedSnapshotId}/checks?bulk",
    purpose:
      "Forward-side import creates the missing persistent intent checks in bulk with NewNetworkCheck[] JSON.",
    bodyPreview: `${intentChecks.length} NewNetworkCheck JSON payload(s); persistent defaults to true`,
    idempotencyKey: "Forward check name plus dynatrace-key tag",
  });
  actions.push({
    method: "GET",
    path: "/api/snapshots/{latestProcessedSnapshotId}/checks?type=Existential",
    purpose: "Forward-side import reads back check status for reporting.",
  });

  return actions;
};

export default function (
  payload?: ForwardSyncRequest,
): ForwardSyncResponse {
  const generatedAt = new Date().toISOString();

  if (!payload || payload.dependencies.length === 0) {
    return {
      status: "blocked",
      summary: "No dependency rows selected for Forward export.",
      generatedAt,
      disclaimer: DEMO_DISCLAIMER,
      exportManifestPreview: "",
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
  const intentChecksPreview = JSON.stringify(
    intentChecks,
    null,
    2,
  );
  const exportManifestPreview = JSON.stringify(
    toExportManifest({
      payload,
      generatedAt,
      exportableDependencies,
      rejectedDependencyCount,
      intentChecks,
    }),
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
      exportManifestPreview,
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
    status: "ready",
    summary: hasForwardTarget
      ? "Forward bulk intent package is ready. Forward owns manual import or connector-based ingestion."
      : "Forward import package is ready. Add optional Forward URL and network ID metadata if desired.",
    generatedAt,
    disclaimer: DEMO_DISCLAIMER,
    exportManifestPreview,
    intentChecksPreview,
    intentCheckCount: intentChecks.length,
    rejectedDependencyCount,
    actions: buildActions(payload, intentChecks),
    readinessChecks: toReadinessChecks(payload, exportableDependencies),
    workflowTrigger:
      "Dynatrace Workflow on problem trigger or schedule can generate this package. Forward then imports it manually or pulls it with a Forward-owned connector.",
    nextSteps: [
      "Export the manifest and NewNetworkCheck[] JSON package.",
      "Import manually with a Forward-side script or let a Forward-owned connector pull the package.",
      "Forward-side import resolves latest processed snapshot, reads existing checks, dedupes by name/tag, then calls /checks?bulk.",
      "Review changed or stale Dynatrace-managed checks before any update or retirement workflow.",
      "Keep Dynatrace as the mapping source and Forward as the system of record for intent.",
    ],
  };
}
