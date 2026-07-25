import type { ForwardAccessProfile } from "./forward.ts";

export type NqeExecutionStatus =
  | "SUBMITTED"
  | "EXECUTING"
  | "COMPLETED";

export type NqeExecutionOutcome =
  | "OK"
  | "USER_ERROR"
  | "TIMED_OUT"
  | "SYSTEM_ERROR";

export interface NqeExecutionPending {
  status: "SUBMITTED" | "EXECUTING";
  outcome?: never;
}

export interface NqeExecutionCompletedOk {
  status: "COMPLETED";
  outcome: "OK";
}

export interface NqeExecutionCompletedUserError {
  status: "COMPLETED";
  outcome: "USER_ERROR";
  error?: {
    message?: string;
    location?: unknown;
  };
}

export interface NqeExecutionCompletedTimedOut {
  status: "COMPLETED";
  outcome: "TIMED_OUT";
  timeoutMinutes?: unknown;
}

export interface NqeExecutionCompletedSystemError {
  status: "COMPLETED";
  outcome: "SYSTEM_ERROR";
}

export type NqeExecutionCompleted =
  | NqeExecutionCompletedOk
  | NqeExecutionCompletedUserError
  | NqeExecutionCompletedTimedOut
  | NqeExecutionCompletedSystemError;

export type NqeExecutionState =
  | NqeExecutionPending
  | NqeExecutionCompleted;

export interface ForwardNqeExecutionError extends Error {
  executionKey: string;
  resumable: boolean;
}

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
  forwardAccessProfile?: ForwardAccessProfile;
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
  execute?: boolean;
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
