export type ForwardImportState = "valid" | "dry-run" | "applied" | "needs-review" | "failed";

export interface ForwardIngestStatusArtifact {
  schemaVersion: "forward-dynatrace-status/v1";
  runId?: string;
  finishedAt?: string;
  durationMs?: number;
  packageId?: string;
  mode?: string;
  importState?: ForwardImportState;
  packageSignature?: {
    status?: string;
  };
  target?: {
    networkId?: string;
    snapshotId?: string;
  };
  plannedChecks?: number;
  counts?: {
    create?: number;
    unchanged?: number;
    changed?: number;
    stale?: number;
  };
}

export interface ForwardStatusRequest {
  statusArtifact?: ForwardIngestStatusArtifact;
}

export interface ForwardStatusResponse {
  status: "ready" | "blocked";
  summary: string;
  rows: Array<{ label: string; value: string }>;
  nextSteps: string[];
}
