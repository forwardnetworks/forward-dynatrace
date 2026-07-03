import { createHash } from "node:crypto";

type ForwardSyncMode = "manual-import" | "data-connector" | "intent-package";
type ForwardSyncStatus = "ready" | "blocked";
type ForwardLocationFilterType =
  | "HostFilter"
  | "DeviceFilter"
  | "SubnetLocationFilter";

interface DependencyCandidate {
  id: string;
  appName: string;
  environment: string;
  serviceEntityId: string;
  serviceName: string;
  source: string;
  sourceFilterType?: ForwardLocationFilterType;
  destination: string;
  destinationFilterType?: ForwardLocationFilterType;
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
  includeReviewRows?: boolean;
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
    type: ForwardLocationFilterType;
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
  integrity: {
    algorithm: "sha256";
    intentChecksSha256: string;
  };
  dependencyRows: {
    rowCount: number;
    rejectedRowCount: number;
    readyRowCount: number;
    reviewRowCount: number;
    needsMapRowCount: number;
    includedReviewRowCount: number;
    reviewOverrideEnabled: boolean;
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
    owner: "forward-operator" | "forward-side-connector";
    writesForward: true;
    summary: string;
  }>;
}

const missing = (value: string | undefined): boolean => !value?.trim();

const INTEGRATION_BOUNDARY_DISCLAIMER =
  "Forward Field Integration reference: this Dynatrace app only exports Forward-ready artifacts and is not an officially supported Forward product integration. Forward ingestion runs in a Forward-controlled environment: either a manual importer or a Forward-side connector that pulls the package.";

const MANIFEST_FILE_NAME = "forward-dynatrace-manifest.json";
const INTENT_CHECKS_FILE_NAME = "forward-intent-checks.json";

const toBaseCheckName = (dependency: DependencyCandidate): string =>
  `[Dynatrace] ${dependency.appName} ${dependency.environment}: ${dependency.source} -> ${dependency.destination} ${dependency.protocol}/${dependency.port}`;

const toCheckName = (
  dependency: DependencyCandidate,
  duplicateBaseNames: Set<string>,
): string => {
  const baseName = toBaseCheckName(dependency);
  if (!duplicateBaseNames.has(baseName)) {
    return baseName;
  }
  const suffix = toSlug(dependency.serviceEntityId).slice(-16) || "duplicate";
  return `${baseName} [${suffix}]`;
};

const toSlug = (value: string): string =>
  value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 80);

const toTagValue = (value: string): string => toSlug(value) || "unknown";

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

const toLocation = (
  value: string,
  type: ForwardLocationFilterType = "HostFilter",
): ForwardEndpoint["location"] => ({ type, value });

const toIntentCheck = (
  dependency: DependencyCandidate,
  duplicateBaseNames: Set<string>,
): ForwardIntentCheck => ({
  definition: {
    checkType: "Existential",
    filters: {
      from: {
        location: toLocation(dependency.source, dependency.sourceFilterType),
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
        location: toLocation(
          dependency.destination,
          dependency.destinationFilterType,
        ),
      },
      flowTypes: ["VALID"],
    },
    headerFieldsWithDefaults: ["url"],
    noiseTypes: [],
    returnPath: "ANY",
  },
  enabled: true,
  name: toCheckName(dependency, duplicateBaseNames),
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
    `app:${toTagValue(dependency.appName)}`,
    `environment:${toTagValue(dependency.environment)}`,
    `owner:${toTagValue(dependency.owner)}`,
    `dynatrace-key:${toIntegrationKey(dependency)}`,
  ],
});

const toIntentChecks = (
  dependencies: DependencyCandidate[],
): ForwardIntentCheck[] => {
  const baseNameCounts = new Map<string, number>();
  for (const dependency of dependencies) {
    const baseName = toBaseCheckName(dependency);
    baseNameCounts.set(baseName, (baseNameCounts.get(baseName) || 0) + 1);
  }
  const duplicateBaseNames = new Set(
    [...baseNameCounts.entries()]
      .filter(([, count]) => count > 1)
      .map(([baseName]) => baseName),
  );
  return dependencies.map((dependency) =>
    toIntentCheck(dependency, duplicateBaseNames),
  );
};

const toPackageId = (generatedAt: string): string =>
  `dynatrace-forward-${generatedAt.replace(/[^0-9]/g, "").slice(0, 14)}`;

const sha256Hex = (text: string): string =>
  createHash("sha256").update(text, "utf8").digest("hex");

const toExportManifest = ({
  payload,
  generatedAt,
  exportableDependencies,
  rejectedDependencyCount,
  intentChecks,
  intentChecksSha256,
}: {
  payload: ForwardSyncRequest;
  generatedAt: string;
  exportableDependencies: DependencyCandidate[];
  rejectedDependencyCount: number;
  intentChecks: ForwardIntentCheck[];
  intentChecksSha256: string;
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
  integrity: {
    algorithm: "sha256",
    intentChecksSha256,
  },
  dependencyRows: {
    rowCount: payload.dependencies.length,
    rejectedRowCount: rejectedDependencyCount,
    readyRowCount: payload.dependencies.filter((dependency) => dependency.mappingState === "ready").length,
    reviewRowCount: payload.dependencies.filter((dependency) => dependency.mappingState === "review").length,
    needsMapRowCount: payload.dependencies.filter((dependency) => dependency.mappingState === "needs-map").length,
    includedReviewRowCount: exportableDependencies.filter((dependency) => dependency.mappingState === "review").length,
    reviewOverrideEnabled: Boolean(payload.includeReviewRows),
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
      owner: "forward-side-connector",
      writesForward: true,
      summary:
        "Forward-side connector pulls the latest package from Dynatrace with read-only Dynatrace access, validates schema, dedupes checks, then performs Forward writes.",
    },
  ],
});

const toReadinessChecks = (
  payload: ForwardSyncRequest,
  exportableDependencies: DependencyCandidate[],
): ReadinessCheck[] => {
  const readyCount = payload.dependencies.filter(
    (dependency) => dependency.mappingState === "ready",
  ).length;
  const reviewCount = payload.dependencies.filter(
    (dependency) => dependency.mappingState === "review",
  ).length;
  const includedReviewCount = exportableDependencies.filter(
    (dependency) => dependency.mappingState === "review",
  ).length;

  return [
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
      label: "Forward-side ingest",
      status: "ready",
      detail:
        "A manual importer or Forward-side connector is responsible for all Forward writes.",
    },
    {
      label: "Dependency quality",
      status: exportableDependencies.length > 0 ? "ready" : "blocked",
      detail: `${readyCount} ready row(s), ${reviewCount} review row(s), ${exportableDependencies.length} eligible for Forward artifact generation.`,
    },
    {
      label: "Idempotency",
      status: "ready",
      detail:
        "Rows include deterministic integration keys and intent-check tags; Forward-side import must dedupe before bulk create.",
    },
    {
      label: "Forward endpoint mapping",
      status: reviewCount > includedReviewCount ? "needs-work" : "ready",
      detail: reviewCount > includedReviewCount
        ? `${reviewCount - includedReviewCount} review row(s) are held until read-only endpoint-resolution marks them ready. Unresolved endpoints must become needs-map.`
        : includedReviewCount > 0
          ? `${includedReviewCount} review row(s) included by explicit override. Forward apply may still reject unresolved locations.`
        : "Source and destination values are marked ready for Forward location resolution.",
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
};

const isExportableDependency = (
  dependency: DependencyCandidate,
  includeReviewRows: boolean | undefined,
): boolean =>
  (dependency.mappingState === "ready" ||
    (Boolean(includeReviewRows) && dependency.mappingState === "review")) &&
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
      disclaimer: INTEGRATION_BOUNDARY_DISCLAIMER,
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

  const exportableDependencies = payload.dependencies.filter((dependency) =>
    isExportableDependency(dependency, payload.includeReviewRows),
  );
  const rejectedDependencyCount =
    payload.dependencies.length - exportableDependencies.length;
  const intentChecks = toIntentChecks(exportableDependencies);
  const intentChecksPreview = JSON.stringify(
    intentChecks,
    null,
    2,
  ) + "\n";
  const exportManifestPreview = JSON.stringify(
    toExportManifest({
      payload,
      generatedAt,
      exportableDependencies,
      rejectedDependencyCount,
      intentChecks,
      intentChecksSha256: sha256Hex(intentChecksPreview),
    }),
    null,
    2,
  ) + "\n";
  const hasForwardTarget =
    !missing(payload.forwardBaseUrl) && !missing(payload.forwardNetworkId);

  if (exportableDependencies.length === 0) {
    return {
      status: "blocked",
      summary:
        "No rows are production-ready for Forward. Map each dependency to a Forward-resolved source, destination, protocol, port, and Dynatrace service entity.",
      generatedAt,
      disclaimer: INTEGRATION_BOUNDARY_DISCLAIMER,
      exportManifestPreview,
      intentChecksPreview,
      intentCheckCount: 0,
      rejectedDependencyCount,
      actions: [],
      readinessChecks: toReadinessChecks(payload, exportableDependencies),
      workflowTrigger: "Not staged",
      nextSteps: [
        "Complete endpoint mapping for at least one dependency.",
        "Run the read-only Forward endpoint-resolution preflight; only resolved rows should become ready.",
        "Keep needs-map rows out of automated Forward check creation.",
        "Use includeReviewRows only as an explicit operator override.",
      ],
    };
  }

  const hasHeldReviewRows = payload.dependencies.some(
    (dependency) => dependency.mappingState === "review" &&
      !isExportableDependency(dependency, payload.includeReviewRows),
  );

  return {
    status: "ready",
    summary: hasForwardTarget
      ? "Forward bulk intent package is ready. A Forward-side importer or connector owns ingestion."
      : "Forward import package is ready. Add optional Forward URL and network ID metadata if desired.",
    generatedAt,
    disclaimer: INTEGRATION_BOUNDARY_DISCLAIMER,
    exportManifestPreview,
    intentChecksPreview,
    intentCheckCount: intentChecks.length,
    rejectedDependencyCount,
    actions: buildActions(payload, intentChecks),
    readinessChecks: toReadinessChecks(payload, exportableDependencies),
    workflowTrigger:
      "Dynatrace Workflow on problem trigger or schedule can generate this package. Forward then imports it manually, or a Forward-side connector pulls it.",
    nextSteps: [
      "Export the manifest and NewNetworkCheck[] JSON package.",
      ...(hasHeldReviewRows
        ? [
            "Run endpoint-resolution preflight for review rows before apply, or enable the review-row override deliberately.",
          ]
        : [
            "Run Forward-side validate-only and dry-run import before apply.",
          ]),
      "Import with the Forward-side script, or let a Forward-side connector pull the package.",
      "Forward-side import resolves latest processed snapshot, reads existing checks, dedupes by name/tag, then calls /checks?bulk.",
      "Review changed or stale Dynatrace-managed checks before any update or retirement workflow.",
      "Keep Dynatrace as the mapping source and Forward as the system of record for intent.",
    ],
  };
}
