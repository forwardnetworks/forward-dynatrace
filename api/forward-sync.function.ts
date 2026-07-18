import { createHash } from "node:crypto";

import {
  CONTRACT_VERSION_TAG,
  MANAGED_BY_TAG,
  SOURCE_INSTANCE_TAG_PREFIX,
  SOURCE_KEY_TAG_PREFIX,
  dependencySourceKeyTag,
  normalizeSourceInstanceId,
  requiredOwnershipTags,
  sourceInstanceTag,
} from "../lib/managed-check-identity.mjs";
import {
  canWriteIntentChecks,
  isForwardAccessProfile,
} from "../lib/forward-access-profile.mjs";

type ForwardSyncMode = "manual-import" | "data-connector" | "intent-package";
type ForwardAccessProfile = "read-only" | "network-operator" | "network-admin";
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
  sourceLabel?: string;
  source: string;
  sourceFilterType?: ForwardLocationFilterType;
  sourceResolvedValue?: string;
  sourceResolvedFilterType?: ForwardLocationFilterType;
  sourceResolutionStatus?: string;
  destinationLabel?: string;
  destination: string;
  destinationFilterType?: ForwardLocationFilterType;
  destinationResolvedValue?: string;
  destinationResolvedFilterType?: ForwardLocationFilterType;
  destinationResolutionStatus?: string;
  protocol: "tcp" | "udp";
  port: string;
  owner: string;
  criticality: "critical" | "high" | "medium";
  confidence: number;
  mappingState: "ready" | "needs-map" | "review";
}

export interface ForwardSyncRequest {
  sourceInstanceId: string;
  forwardBaseUrl?: string;
  forwardNetworkId?: string;
  syncMode: ForwardSyncMode;
  forwardAccessProfile: ForwardAccessProfile;
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
  requestedForwardAccessProfile: ForwardAccessProfile;
  source: {
    platform: "dynatrace";
    app: "com.forward.dynatrace";
    instanceId: string;
    instanceTag: string;
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
    dedupe: "managed-source-key";
    fingerprintAlgorithm: "canonical-json-sha256";
  };
  validation: {
    managedByTag: string;
    contractVersionTag: string;
    sourceInstanceTagPrefix: string;
    sourceKeyTagPrefix: string;
    ownershipTagsPerCheck: 4;
    identityPolicy: "strict-ownership-tuple";
    duplicatePolicy: "reject-package";
    allowedCheckTypes: Array<"Existential">;
    credentialPolicy: "no-forward-credentials-in-dynatrace";
  };
  reconciliation: {
    strategy: "source-scoped-desired-state";
    defaultApplyPolicy: "create-missing-only";
    changedChecks: "report-only";
    staleChecks: "report-only";
    collisionPolicy: "reject";
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
    writesForward: boolean;
    summary: string;
  }>;
}

const missing = (value: string | undefined): boolean => !value?.trim();

const INTEGRATION_BOUNDARY_DISCLAIMER =
  "Forward for Dynatrace exports checksummed, source-scoped intent artifacts. Package signing, Forward ingestion, and every Forward mutation run in a Forward-controlled integration service or connector.";

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

const resolvedLocationValue = (
  dependency: DependencyCandidate,
  role: "source" | "destination",
): string =>
  role === "source"
    ? dependency.sourceResolvedValue?.trim() || dependency.source
    : dependency.destinationResolvedValue?.trim() || dependency.destination;

const isIpOrSubnet = (value: string): boolean =>
  /^(?:\d{1,3}\.){3}\d{1,3}(?:\/(?:3[0-2]|[12]?\d))?$/u.test(value.trim()) ||
  /^[A-Fa-f0-9:]+(?::[A-Fa-f0-9:]*)?(?:\/(?:12[0-8]|1[01]\d|\d?\d))?$/u.test(
    value.trim(),
  );

const resolvedLocationType = (
  dependency: DependencyCandidate,
  role: "source" | "destination",
): ForwardLocationFilterType => {
  const explicitType =
    role === "source"
      ? dependency.sourceResolvedFilterType || dependency.sourceFilterType
      : dependency.destinationResolvedFilterType || dependency.destinationFilterType;
  if (explicitType) {
    return explicitType;
  }
  return isIpOrSubnet(resolvedLocationValue(dependency, role))
    ? "SubnetLocationFilter"
    : "HostFilter";
};

const resolutionNoteFields = (dependency: DependencyCandidate): string[] => [
  ...(dependency.sourceResolvedValue
    ? [`sourceResolvedValue=${dependency.sourceResolvedValue}`]
    : []),
  ...(dependency.destinationResolvedValue
    ? [`destinationResolvedValue=${dependency.destinationResolvedValue}`]
    : []),
];

const toIntentCheck = (
  dependency: DependencyCandidate,
  duplicateBaseNames: Set<string>,
  sourceInstanceId: string,
): ForwardIntentCheck => {
  const sourceKey = dependencySourceKeyTag(dependency, { sourceInstanceId });
  const ownershipTags = requiredOwnershipTags({ sourceInstanceId, sourceKey }) as string[];
  return ({
  definition: {
    checkType: "Existential",
    filters: {
      from: {
        location: toLocation(
          resolvedLocationValue(dependency, "source"),
          resolvedLocationType(dependency, "source"),
        ),
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
          resolvedLocationValue(dependency, "destination"),
          resolvedLocationType(dependency, "destination"),
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
    `sourceKey=${sourceKey}`,
    `owner=${dependency.owner}`,
    `confidence=${dependency.confidence}`,
    ...resolutionNoteFields(dependency),
  ].join("; "),
  priority: toPriority(dependency.criticality),
  tags: [
    "dynatrace",
    ...ownershipTags,
    `app:${toTagValue(dependency.appName)}`,
    `environment:${toTagValue(dependency.environment)}`,
    `owner:${toTagValue(dependency.owner)}`,
    `criticality:${toTagValue(dependency.criticality)}`,
  ],
  });
};

const toIntentChecks = (
  dependencies: DependencyCandidate[],
  sourceInstanceId: string,
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
    toIntentCheck(dependency, duplicateBaseNames, sourceInstanceId),
  );
};

const toPackageId = (generatedAt: string, manifestIdentitySha256: string): string =>
  `dynatrace-forward-${generatedAt.replace(/[^0-9]/g, "").slice(0, 17)}-${manifestIdentitySha256.slice(0, 12)}`;

const sha256Hex = (text: string): string =>
  createHash("sha256").update(text, "utf8").digest("hex");

const toManifestIdentitySha256 = ({
  payload,
  generatedAt,
  exportableDependencies,
  rejectedDependencyCount,
  intentCheckCount,
  intentChecksSha256,
}: {
  payload: ForwardSyncRequest;
  generatedAt: string;
  exportableDependencies: DependencyCandidate[];
  rejectedDependencyCount: number;
  intentCheckCount: number;
  intentChecksSha256: string;
}): string => sha256Hex(JSON.stringify({
  generatedAt,
  requestedIngestPath: payload.syncMode,
  requestedForwardAccessProfile: payload.forwardAccessProfile,
  sourceInstanceId: normalizeSourceInstanceId(payload.sourceInstanceId),
  forwardBaseUrl: missing(payload.forwardBaseUrl) ? null : payload.forwardBaseUrl.trim(),
  forwardNetworkId: missing(payload.forwardNetworkId) ? null : payload.forwardNetworkId.trim(),
  rowCount: payload.dependencies.length,
  rejectedDependencyCount,
  readyRowCount: payload.dependencies.filter((dependency) => dependency.mappingState === "ready").length,
  reviewRowCount: payload.dependencies.filter((dependency) => dependency.mappingState === "review").length,
  needsMapRowCount: payload.dependencies.filter((dependency) => dependency.mappingState === "needs-map").length,
  includedReviewRowCount: exportableDependencies.filter(
    (dependency) => dependency.mappingState === "review",
  ).length,
  reviewOverrideEnabled: Boolean(payload.includeReviewRows),
  intentCheckCount,
  intentChecksSha256,
}));

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
  packageId: toPackageId(
    generatedAt,
    toManifestIdentitySha256({
      payload,
      generatedAt,
      exportableDependencies,
      rejectedDependencyCount,
      intentCheckCount: intentChecks.length,
      intentChecksSha256,
    }),
  ),
  generatedAt,
  requestedIngestPath: payload.syncMode,
  requestedForwardAccessProfile: payload.forwardAccessProfile,
  source: {
    platform: "dynatrace",
    app: "com.forward.dynatrace",
    instanceId: normalizeSourceInstanceId(payload.sourceInstanceId),
    instanceTag: sourceInstanceTag(payload.sourceInstanceId),
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
    dedupe: "managed-source-key",
    fingerprintAlgorithm: "canonical-json-sha256",
  },
  validation: {
    managedByTag: MANAGED_BY_TAG,
    contractVersionTag: CONTRACT_VERSION_TAG,
    sourceInstanceTagPrefix: SOURCE_INSTANCE_TAG_PREFIX,
    sourceKeyTagPrefix: SOURCE_KEY_TAG_PREFIX,
    ownershipTagsPerCheck: 4,
    identityPolicy: "strict-ownership-tuple",
    duplicatePolicy: "reject-package",
    allowedCheckTypes: ["Existential"],
    credentialPolicy: "no-forward-credentials-in-dynatrace",
  },
  reconciliation: {
    strategy: "source-scoped-desired-state",
    defaultApplyPolicy: "create-missing-only",
    changedChecks: "report-only",
    staleChecks: "report-only",
    collisionPolicy: "reject",
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
      writesForward: canWriteIntentChecks(payload.forwardAccessProfile),
      summary:
        "Download artifacts from Dynatrace, review them, then run the profile-gated Forward-side tooling from a Forward-controlled environment.",
    },
    {
      id: "data-connector",
      owner: "forward-side-connector",
      writesForward: canWriteIntentChecks(payload.forwardAccessProfile),
      summary:
        "Forward-side connector pulls the latest package with read-only Dynatrace access, validates and reconciles it, then enforces the requested Forward access profile.",
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
      label: "Dynatrace source identity",
      status: "ready",
      detail: `Packages and managed checks are scoped to ${sourceInstanceTag(payload.sourceInstanceId)}.`,
    },
    {
      label: "Forward target metadata",
      status: "ready",
      detail:
        missing(payload.forwardBaseUrl) || missing(payload.forwardNetworkId)
          ? "Optional. Forward URL and network ID can be added during Forward-side import."
          : "Forward URL and network ID are included as package metadata.",
    },
    {
      label: "Forward access profile",
      status: "ready",
      detail:
        payload.forwardAccessProfile === "read-only"
          ? "Read inventory and paths and execute approved Library NQE query IDs; no intent-check writes."
          : payload.forwardAccessProfile === "network-operator"
            ? "Read Only capabilities plus arbitrary NQE execution; no intent-check writes."
            : "Network Admin may create missing checks and replace changed managed checks only after exact approval.",
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
        "Rows include opaque, source-scoped SHA-256 identities; Forward-side import reconciles only the complete managed ownership tuple.",
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
        "Forward-side import rejects malformed packages, incomplete ownership tags, duplicate source keys, name collisions, and unsupported check types before writes.",
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
    path: `/api/networks/${payload.forwardNetworkId || "{networkId}"}/hosts/{hostSpecifier}?snapshotId={snapshotId}`,
    purpose:
      "Forward-side preflight resolves Dynatrace endpoint names through Forward host inventory before package generation.",
  });
  actions.push({
    method: "POST",
    path: `/api/networks/${payload.forwardNetworkId || "{networkId}"}/paths-bulk?snapshotId={snapshotId}`,
    purpose:
      "Optional read-only path evidence evaluates the same resolved dependencies before import approval.",
    bodyPreview: "PathSearchBulkRequest built from sourceResolvedValue and destinationResolvedValue",
  });
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
      "Forward-side import reads existing intent checks, reconciles only by managed source key, and detects changed, stale, or colliding checks.",
  });
  actions.push({
    method: "POST",
    path: "/api/nqe",
    purpose:
      payload.forwardAccessProfile === "read-only"
        ? "Read Only may execute approved Forward Library NQE query IDs only."
        : "Network Operator and Network Admin may execute an approved arbitrary NQE preflight.",
    bodyPreview:
      payload.forwardAccessProfile === "read-only"
        ? "Forward-owned query ID plus bounded parameters"
        : "Approved bounded NQE query or Forward-owned query ID",
  });
  if (canWriteIntentChecks(payload.forwardAccessProfile)) {
    actions.push({
      method: "POST",
      path: "/api/snapshots/{latestProcessedSnapshotId}/checks?bulk",
      purpose:
        "Network Admin creates missing persistent intent checks in bulk after reconciliation.",
      bodyPreview: `${intentChecks.length} NewNetworkCheck JSON payload(s); persistent defaults to true`,
      idempotencyKey: "Managed source-instance plus source-key ownership tuple",
    });
    actions.push({
      method: "DELETE",
      path: "/api/snapshots/{latestProcessedSnapshotId}/checks/{approvedManagedCheckId}",
      purpose:
        "Network Admin replaces a changed managed check only when a signed package, exact approval, change window, and update budget authorize it; the replacement is recreated through /checks?bulk.",
    });
  }
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

  if (payload) {
    if (!isForwardAccessProfile(payload.forwardAccessProfile)) {
      return {
        status: "blocked",
        summary: "Select a supported Forward access profile.",
        generatedAt,
        disclaimer: INTEGRATION_BOUNDARY_DISCLAIMER,
        exportManifestPreview: "",
        intentChecksPreview: "",
        intentCheckCount: 0,
        rejectedDependencyCount: payload.dependencies?.length || 0,
        actions: [],
        readinessChecks: [],
        workflowTrigger: "Not staged",
        nextSteps: ["Select Read Only, Network Operator, or Network Admin."],
      };
    }
    try {
      normalizeSourceInstanceId(payload.sourceInstanceId);
    } catch (error) {
      return {
        status: "blocked",
        summary: error instanceof Error ? error.message : "Invalid sourceInstanceId.",
        generatedAt,
        disclaimer: INTEGRATION_BOUNDARY_DISCLAIMER,
        exportManifestPreview: "",
        intentChecksPreview: "",
        intentCheckCount: 0,
        rejectedDependencyCount: payload.dependencies?.length || 0,
        actions: [],
        readinessChecks: [],
        workflowTrigger: "Not staged",
        nextSteps: ["Configure a stable opaque Dynatrace sourceInstanceId."],
      };
    }
  }

  if (!payload || !Array.isArray(payload.dependencies) || payload.dependencies.length === 0) {
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
  const intentChecks = toIntentChecks(
    exportableDependencies,
    normalizeSourceInstanceId(payload.sourceInstanceId),
  );
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
  const profileSummary = payload.forwardAccessProfile === "network-admin"
    ? "Forward intent package is ready for Network Admin reconciliation and managed create/update policy."
    : `Forward intent package is ready for ${payload.forwardAccessProfile === "read-only" ? "Read Only" : "Network Operator"} reconciliation; no Forward writes are requested.`;

  return {
    status: "ready",
    summary: hasForwardTarget
      ? profileSummary
      : `${profileSummary} Add optional Forward URL and network ID metadata if desired.`,
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
      "Process with the Forward-side script, or let a Forward-side connector pull the package.",
      ...(payload.forwardAccessProfile === "network-admin"
        ? [
            "Network Admin resolves the latest processed snapshot, reconciles the source-scoped ownership tuple, creates missing checks, and updates changed managed checks only with exact approval.",
            "Review stale Dynatrace-managed checks separately before any retirement workflow.",
          ]
        : [
            "Read Only and Network Operator profiles reconcile and report without calling Forward intent-check write APIs.",
          ]),
      "Keep Dynatrace as the mapping source and Forward as the system of record for intent.",
    ],
  };
}
