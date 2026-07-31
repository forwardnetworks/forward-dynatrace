export type ForwardAccessProfile =
  | "read-only"
  | "network-operator"
  | "network-admin";

export type ForwardLocationFilterType =
  | "HostFilter"
  | "DeviceFilter"
  | "SubnetLocationFilter";

export type DependencyCriticality =
  | "critical"
  | "high"
  | "medium"
  | "low";

interface DependencyCandidateBase {
  id: string;
  appName: string;
  environment: string;
  serviceName: string;
  sourceLabel?: string;
  sourceFilterType?: ForwardLocationFilterType;
  sourceResolvedValue?: string;
  sourceResolvedFilterType?: ForwardLocationFilterType;
  sourceResolutionStatus?: string;
  destinationLabel?: string;
  destinationFilterType?: ForwardLocationFilterType;
  destinationResolvedValue?: string;
  destinationResolvedFilterType?: ForwardLocationFilterType;
  destinationResolutionStatus?: string;
  protocol: "tcp" | "udp";
  port: string;
  owner: string;
  criticality: DependencyCriticality;
  confidence: number;
}

export interface MappedDependencyCandidate extends DependencyCandidateBase {
  serviceEntityId: string;
  source: string;
  destination: string;
  mappingState: "ready" | "review";
}

export interface UnmappedDependencyCandidate extends DependencyCandidateBase {
  serviceEntityId?: string;
  source?: string;
  destination?: string;
  mappingState: "needs-map";
}

export type DependencyCandidate =
  | MappedDependencyCandidate
  | UnmappedDependencyCandidate;

export interface ForwardEndpoint {
  location: {
    type: ForwardLocationFilterType;
    value: string;
  };
  headers?: Array<{
    type: "PacketFilter";
    values: Record<string, string[]>;
  }>;
}

export interface ForwardIntentCheck {
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
  perfMonitoringEnabled: boolean;
  name: string;
  note: string;
  priority: "LOW" | "MEDIUM" | "HIGH";
  tags: string[];
}

export interface ExistingForwardIntentCheck extends ForwardIntentCheck {
  id: string | number;
}

export interface ForwardReconciliationCreate {
  key: string;
  check: ForwardIntentCheck;
}

export interface ForwardReconciliationUnchanged {
  key: string;
  existingId: string;
}

export interface ForwardReconciliationChanged {
  key: string;
  existingId: string;
  existingFingerprint: string;
  check: ForwardIntentCheck;
}

export interface ForwardReconciliationStale {
  key: string;
}

export type ForwardReconciliationCollisionReason =
  | "invalid-managed-identity"
  | "duplicate-planned-source-key"
  | "duplicate-existing-source-key"
  | "name-owned-by-another-check"
  | "foreign-source-instance"
  | "name-collision";

export interface ForwardReconciliationCollision {
  key: string;
  reason: ForwardReconciliationCollisionReason;
}

export interface ForwardReconciliation {
  create: ForwardReconciliationCreate[];
  unchanged: ForwardReconciliationUnchanged[];
  changed: ForwardReconciliationChanged[];
  stale: ForwardReconciliationStale[];
  collision: ForwardReconciliationCollision[];
}

export type ForwardSyncMode = "direct-api";
export type ForwardSyncStatus = "ready" | "blocked";

export type ForwardApiMethod = "GET" | "POST" | "PATCH";

export interface ForwardApiRequestOptions {
  retryable?: boolean;
}

export type ForwardApiClient = (
  method: ForwardApiMethod,
  path: string,
  body?: unknown,
  options?: ForwardApiRequestOptions,
) => Promise<unknown>;

export interface ForwardSyncRequest {
  sourceInstanceId: string;
  forwardBaseUrl?: string;
  forwardNetworkId?: string;
  syncMode: ForwardSyncMode;
  forwardAccessProfile: ForwardAccessProfile;
  includeReviewRows?: boolean;
  enablePerformanceMonitoring?: boolean;
  dependencies: DependencyCandidate[];
}

export interface ForwardAction {
  method: "GET" | "POST" | "PATCH";
  path: string;
  purpose: string;
  bodyPreview?: string;
  idempotencyKey?: string;
}

export interface ReadinessCheck {
  label: string;
  status: "ready" | "needs-work" | "blocked";
  detail: string;
}

export interface ForwardSyncResponse {
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

export interface DependencyDiscoveryProfileSummary {
  id: string;
  name: string;
  description: string;
  isDefault: boolean;
  sourceType: DependencyDiscoverySourceType;
}

export type DependencyDiscoverySourceType =
  | "distributed-traces"
  | "network-flows";

export interface DependencyDiscoveryProfile
  extends DependencyDiscoveryProfileSummary {
  enabled: boolean;
  query: string;
  maxResultRecords: number;
  maxEvidenceAgeMinutes: number;
}

export type DependencyDiscoverySelectionReason =
  | "no-enabled-profile"
  | "profile-not-accessible"
  | "multiple-default-profiles"
  | "profile-selection-required";

export interface DependencyDiscoverySelection {
  profile: DependencyDiscoveryProfile | null;
  profiles: DependencyDiscoveryProfileSummary[];
  reason: DependencyDiscoverySelectionReason | null;
}

export interface DependencyDiscoveryEvidence {
  queriedRows: number;
  acceptedRows: number;
  rejectedRows: number;
  newestObservedAt: string | null;
  sources: string[];
  runIds: string[];
}

export interface RejectedDependencyRow {
  row: number;
  reason: string;
}

export interface NormalizedDiscoveryRows {
  dependencies: DependencyCandidate[];
  rejected: RejectedDependencyRow[];
  evidence: DependencyDiscoveryEvidence;
}

export interface DependencyDiscoveryResponse {
  status: "ready" | "configuration-required" | "blocked";
  summary: string;
  selectedProfile: {
    id: string;
    name: string;
    sourceType: DependencyDiscoverySourceType;
  } | null;
  profiles: DependencyDiscoveryProfileSummary[];
  dependencies: DependencyCandidate[];
  evidence: DependencyDiscoveryEvidence | null;
  rejectedRows: RejectedDependencyRow[];
  nextSteps: string[];
}
