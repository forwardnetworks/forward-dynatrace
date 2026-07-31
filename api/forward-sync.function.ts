import {
  buildForwardIntentPackage,
} from "../lib/intent-builder.ts";
import type {
  ForwardSyncRequest,
  ForwardSyncResponse,
} from "../lib/types/index.ts";

export type { ForwardSyncRequest } from "../lib/types/index.ts";

export default function (
  payload?: ForwardSyncRequest,
): ForwardSyncResponse {
  const result = buildForwardIntentPackage(payload);
  const hasGeneratedArtifacts = result.exportManifest !== null;

  return {
    status: result.status,
    summary: result.summary,
    generatedAt: result.generatedAt,
    disclaimer: result.disclaimer,
    exportManifestPreview: hasGeneratedArtifacts
      ? `${JSON.stringify(result.exportManifest, null, 2)}\n`
      : "",
    intentChecksPreview: hasGeneratedArtifacts
      ? `${JSON.stringify(result.intentChecks, null, 2)}\n`
      : "",
    intentCheckCount: result.intentCheckCount,
    rejectedDependencyCount: result.rejectedDependencyCount,
    actions: result.actions,
    readinessChecks: result.readinessChecks,
    workflowTrigger: result.workflowTrigger,
    nextSteps: result.nextSteps,
  };
}
