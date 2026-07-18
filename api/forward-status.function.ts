type ForwardImportState =
  | "valid"
  | "staged"
  | "applied"
  | "reconciled"
  | "needs-review"
  | "failed";

interface ForwardIngestStatusArtifact {
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
  plannedChecks?: number;
  plannedNqeChecks?: number;
  plannedNqeDiffRequests?: number;
  counts?: {
    create?: number;
    unchanged?: number;
    changed?: number;
    stale?: number;
  };
}

interface ForwardStatusRequest {
  statusArtifact?: ForwardIngestStatusArtifact;
  statusArtifactUrl?: string;
}

interface ForwardStatusResponse {
  status: "ready" | "blocked";
  summary: string;
  rows: Array<{ label: string; value: string }>;
  nextSteps: string[];
}

const invalid = (summary: string): ForwardStatusResponse => ({
  status: "blocked",
  summary,
  rows: [],
  nextSteps: [
    "Publish only the sanitized Forward ingest status artifact.",
    "Do not publish Forward credentials, check names, hostnames, or API response bodies.",
  ],
});

const LOCAL_HTTP_HOSTS = new Set(["127.0.0.1", "::1", "localhost"]);

const validateStatusArtifactUrl = (value: string): string => {
  const url = new URL(value);
  if (url.protocol === "https:") {
    return url.toString();
  }
  if (url.protocol === "http:" && LOCAL_HTTP_HOSTS.has(url.hostname)) {
    return url.toString();
  }
  throw new Error("Forward status artifact URL must use HTTPS unless it is localhost.");
};

const fetchStatusArtifact = async (statusArtifactUrl: string): Promise<ForwardIngestStatusArtifact> => {
  const url = validateStatusArtifactUrl(statusArtifactUrl);
  const response = await fetch(url, {
    headers: { Accept: "application/json" },
  });
  const text = await response.text();
  if (!response.ok) {
    throw new Error(`Forward status artifact fetch failed with HTTP ${response.status}.`);
  }
  try {
    return JSON.parse(text) as ForwardIngestStatusArtifact;
  } catch {
    throw new Error("Forward status artifact URL did not return valid JSON.");
  }
};

const countValue = (
  artifact: ForwardIngestStatusArtifact,
  key: keyof NonNullable<ForwardIngestStatusArtifact["counts"]>,
) => String(artifact.counts?.[key] ?? 0);

export default async function (payload?: ForwardStatusRequest): Promise<ForwardStatusResponse> {
  let artifact = payload?.statusArtifact;
  if (!artifact && payload?.statusArtifactUrl) {
    try {
      artifact = await fetchStatusArtifact(payload.statusArtifactUrl);
    } catch (error) {
      return invalid(error instanceof Error ? error.message : "Forward status artifact fetch failed.");
    }
  }
  if (!artifact) {
    return invalid("No Forward ingest status artifact supplied.");
  }
  if (artifact.schemaVersion !== "forward-dynatrace-status/v1") {
    return invalid("Forward ingest status artifact schema is not supported.");
  }

  const state = artifact.importState || "failed";
  const failed = state === "failed" || Boolean(artifact.mutationFailure);
  const needsReview = state === "needs-review" || Boolean(
    (artifact.counts?.changed ?? 0) > 0 || (artifact.counts?.stale ?? 0) > 0,
  );

  return {
    status: "ready",
    summary: failed
      ? "Forward-side apply stopped and requires reconciliation before restaging."
      : needsReview
        ? "Forward-side ingest completed with reviewable drift."
        : "Forward-side ingest status is ready for Dynatrace display.",
    rows: [
      { label: "Import state", value: state },
      { label: "Mode", value: artifact.mode || "unknown" },
      { label: "Forward profile", value: artifact.forwardAccessProfile || "unknown" },
      { label: "Package", value: artifact.packageId || "unknown" },
      { label: "Run", value: artifact.runId || "unknown" },
      { label: "Finished", value: artifact.finishedAt || artifact.generatedAt || "unknown" },
      { label: "Planned checks", value: String(artifact.plannedChecks ?? 0) },
      { label: "NQE checks", value: String(artifact.plannedNqeChecks ?? 0) },
      { label: "NQE diffs", value: String(artifact.plannedNqeDiffRequests ?? 0) },
      { label: "Create", value: countValue(artifact, "create") },
      { label: "Unchanged", value: countValue(artifact, "unchanged") },
      { label: "Changed", value: countValue(artifact, "changed") },
      { label: "Stale", value: countValue(artifact, "stale") },
      { label: "Updated", value: String(artifact.mutationCounts?.updated ?? 0) },
      { label: "Deactivated", value: String(artifact.mutationCounts?.deactivated ?? 0) },
      {
        label: "Apply verification",
        value: artifact.postApplyVerification?.state || "not-run",
      },
      { label: "Failure phase", value: artifact.mutationFailure?.phase || "none" },
      {
        label: "Failure status",
        value: artifact.mutationFailure?.statusCode
          ? String(artifact.mutationFailure.statusCode)
          : "none",
      },
      { label: "Signature", value: artifact.packageSignature?.status || "not-provided" },
      { label: "Network", value: artifact.target?.networkId || "unknown" },
    ],
    nextSteps: failed
      ? [
          "Reconcile the target snapshot before attempting another write.",
          "Stage and approve a new immutable import plan after reconciliation.",
          "Retain the private importer report as the mutation audit record.",
        ]
      : needsReview
      ? [
          "Review changed and stale Dynatrace-managed checks in Forward.",
          "Keep update and retirement actions under Forward-side policy.",
          "Regenerate the package after Dynatrace mapping changes.",
        ]
      : [
          "Keep this as read-only Dynatrace evidence.",
          "Run the Forward-side connector on the approved cadence.",
        ],
  };
}
