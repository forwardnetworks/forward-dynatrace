export type ForwardImportState =
  | "valid"
  | "staged"
  | "applied"
  | "reconciled"
  | "needs-review"
  | "failed";

export interface ForwardIngestStatusArtifact {
  schemaVersion: "forward-dynatrace-status/v1";
  runId?: string;
  generatedAt?: string;
  finishedAt?: string;
  durationMs?: number;
  packageId?: string;
  mode?: string;
  forwardAccessProfile?: "read-only" | "network-operator" | "network-admin";
  importState?: ForwardImportState;
  packageSignature?: {
    status?: string;
  };
  target?: {
    networkId?: string;
    snapshotId?: string;
  };
  plannedChecks?: number;
  plannedNqeChecks?: number;
  plannedNqeDiffRequests?: number;
  mutationCounts?: {
    created?: number;
    updated?: number;
    deactivated?: number;
  };
  mutationFailure?: {
    phase?: string;
    statusCode?: number | null;
    affectedCount?: number;
    recoveryRequired?: boolean;
  } | null;
  postApplyVerification?: {
    state?: "not-run" | "pending" | "verified" | "failed" | "unavailable";
    planned?: number;
  };
  counts?: {
    create?: number;
    unchanged?: number;
    changed?: number;
    stale?: number;
  };
}

export interface ForwardStatusRequest {
  statusArtifact?: ForwardIngestStatusArtifact;
  statusArtifactUrl?: string;
}

export interface ForwardStatusResponse {
  status: "ready" | "blocked";
  summary: string;
  rows: Array<{ label: string; value: string }>;
  nextSteps: string[];
}
