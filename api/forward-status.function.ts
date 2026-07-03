type ForwardImportState = "valid" | "dry-run" | "applied" | "needs-review" | "failed";

interface ForwardIngestStatusArtifact {
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

interface ForwardStatusRequest {
  statusArtifact?: ForwardIngestStatusArtifact;
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

const countValue = (
  artifact: ForwardIngestStatusArtifact,
  key: keyof NonNullable<ForwardIngestStatusArtifact["counts"]>,
) => String(artifact.counts?.[key] ?? 0);

export default function (payload?: ForwardStatusRequest): ForwardStatusResponse {
  const artifact = payload?.statusArtifact;
  if (!artifact) {
    return invalid("No Forward ingest status artifact supplied.");
  }
  if (artifact.schemaVersion !== "forward-dynatrace-status/v1") {
    return invalid("Forward ingest status artifact schema is not supported.");
  }

  const state = artifact.importState || "failed";
  const needsReview = state === "needs-review" || Boolean(
    (artifact.counts?.changed ?? 0) > 0 || (artifact.counts?.stale ?? 0) > 0,
  );

  return {
    status: "ready",
    summary: needsReview
      ? "Forward-side ingest completed with reviewable drift."
      : "Forward-side ingest status is ready for Dynatrace display.",
    rows: [
      { label: "Import state", value: state },
      { label: "Mode", value: artifact.mode || "unknown" },
      { label: "Package", value: artifact.packageId || "unknown" },
      { label: "Run", value: artifact.runId || "unknown" },
      { label: "Finished", value: artifact.finishedAt || "unknown" },
      { label: "Planned checks", value: String(artifact.plannedChecks ?? 0) },
      { label: "Create", value: countValue(artifact, "create") },
      { label: "Unchanged", value: countValue(artifact, "unchanged") },
      { label: "Changed", value: countValue(artifact, "changed") },
      { label: "Stale", value: countValue(artifact, "stale") },
      { label: "Signature", value: artifact.packageSignature?.status || "not-provided" },
      { label: "Network", value: artifact.target?.networkId || "unknown" },
    ],
    nextSteps: needsReview
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
