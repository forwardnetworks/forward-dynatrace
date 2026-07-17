export type NqePreviewStatus = "planned" | "ready" | "blocked" | "failed";
export type EndpointResolutionStatus =
  | "resolved"
  | "unresolved"
  | "ambiguous"
  | "unknown";
export type EndpointResolutionMappingState = "ready" | "review" | "needs-map";

export type NqeTemplateId =
  | "endpoint-inventory-smoke"
  | "approved-endpoint-resolution"
  | "approved-blast-radius";

export interface NqeDependencyContext {
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

export interface ForwardNqePreviewRequest {
  forwardBaseUrl?: string;
  forwardNetworkId?: string;
  snapshotId?: string;
  templateId?: NqeTemplateId;
  queryId?: string;
  commitId?: string;
  parameters?: Record<string, unknown>;
  maxRows?: number;
  dependency?: NqeDependencyContext;
}

export interface ForwardNqePreviewResponse {
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
  endpointResolution?: EndpointResolutionSummary;
  nextSteps: string[];
}

export interface EndpointResolutionEndpoint {
  role: "source" | "destination";
  value: string;
  status: EndpointResolutionStatus;
  matchCount: number | null;
  detail: string;
}

export interface EndpointResolutionSummary {
  mappingState: EndpointResolutionMappingState;
  source: EndpointResolutionEndpoint;
  destination: EndpointResolutionEndpoint;
  summary: string;
}
