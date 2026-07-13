import forwardSync from "../api/forward-sync.function.ts";

const parseRequest = (value) => {
  if (typeof value === "string") {
    try {
      return JSON.parse(value);
    } catch (error) {
      throw new Error(`Forward package request is not valid JSON: ${error.message}`);
    }
  }
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error("Forward package request must be a JSON object or an expression resolving to one.");
  }
  return value;
};

export default async (payload) => {
  if (!payload || payload.request === undefined || payload.request === null) {
    throw new Error("Input field 'request' is missing.");
  }
  const result = forwardSync(parseRequest(payload.request));
  if (result.status !== "ready") {
    throw new Error(result.summary);
  }
  const manifest = JSON.parse(result.exportManifestPreview);
  return {
    schemaVersion: "forward-dynatrace-workflow-action/v1",
    status: result.status,
    packageId: manifest.packageId,
    generatedAt: result.generatedAt,
    intentCheckCount: result.intentCheckCount,
    rejectedDependencyCount: result.rejectedDependencyCount,
    artifacts: {
      manifestFileName: "forward-dynatrace-manifest.json",
      manifest: result.exportManifestPreview,
      intentChecksFileName: "forward-intent-checks.json",
      intentChecks: result.intentChecksPreview,
    },
    boundary: "dynatrace-never-writes-forward",
  };
};

