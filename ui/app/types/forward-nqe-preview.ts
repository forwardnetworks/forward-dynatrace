export type NqePreviewStatus = "planned" | "ready" | "blocked" | "failed";
export type NqeTemplateId =
  | "endpoint-inventory-smoke"
  | "approved-library-query";

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
  forwardAccessProfile: "read-only" | "network-operator" | "network-admin";
  forwardBaseUrl?: string;
  forwardNetworkId?: string;
  snapshotId?: string;
  templateId?: NqeTemplateId;
  queryId?: string;
  query?: string;
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
  nextSteps: string[];
}
