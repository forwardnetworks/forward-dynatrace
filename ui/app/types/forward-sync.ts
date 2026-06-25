export type ForwardSyncMode =
  | "manual-import"
  | "data-connector"
  | "intent-package";
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

export interface ForwardSyncRequest {
  forwardBaseUrl?: string;
  forwardNetworkId?: string;
  syncMode: ForwardSyncMode;
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
  method: "GET" | "POST" | "PATCH" | "DELETE";
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
