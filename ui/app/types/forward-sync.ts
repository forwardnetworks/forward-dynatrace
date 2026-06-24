export type ForwardSyncMode = "data-file" | "data-connector" | "intent-checks";
export type ForwardSyncStatus = "ready" | "dry-run" | "blocked";

export interface DependencyCandidate {
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

export interface ForwardSyncRequest {
  forwardBaseUrl?: string;
  forwardNetworkId?: string;
  dataFileName: string;
  syncMode: ForwardSyncMode;
  includeInNetwork: boolean;
  triggerCollection: boolean;
  createVerifications: boolean;
  dependencies: DependencyCandidate[];
}

export interface ForwardSyncResponse {
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

export interface ForwardAction {
  method: "GET" | "POST" | "PATCH" | "DELETE";
  path: string;
  purpose: string;
}
