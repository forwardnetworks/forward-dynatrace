export type ForwardSyncMode = "direct-api";
export type ForwardAccessProfile =
  | "read-only"
  | "network-operator"
  | "network-admin";
export type ForwardSyncStatus = "ready" | "blocked";
export type ForwardLocationFilterType =
  | "HostFilter"
  | "DeviceFilter"
  | "SubnetLocationFilter";

export interface DependencyCandidate {
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
  criticality: "critical" | "high" | "medium" | "low";
  confidence: number;
  mappingState: "ready" | "needs-map" | "review";
}

export interface DependencyDiscoveryProfileSummary {
  id: string;
  name: string;
  description: string;
  isDefault: boolean;
}

export interface DependencyDiscoveryResponse {
  status: "ready" | "configuration-required" | "blocked";
  summary: string;
  selectedProfile: { id: string; name: string } | null;
  profiles: DependencyDiscoveryProfileSummary[];
  dependencies: DependencyCandidate[];
  evidence: {
    queriedRows: number;
    acceptedRows: number;
    rejectedRows: number;
    newestObservedAt: string | null;
    sources: string[];
    runIds: string[];
  } | null;
  rejectedRows: Array<{ row: number; reason: string }>;
  nextSteps: string[];
}

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
