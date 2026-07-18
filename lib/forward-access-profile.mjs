export const FORWARD_ACCESS_PROFILES = Object.freeze([
  "read-only",
  "network-operator",
  "network-admin",
]);

const accessProfileSet = new Set(FORWARD_ACCESS_PROFILES);

export const isForwardAccessProfile = (value) => accessProfileSet.has(value);

export const assertForwardAccessProfile = (value, label = "Forward access profile") => {
  if (!isForwardAccessProfile(value)) {
    throw new Error(
      `${label} must be read-only, network-operator, or network-admin.`,
    );
  }
  return value;
};

export const canExecuteArbitraryNqe = (value) =>
  value === "network-operator" || value === "network-admin";

export const canWriteIntentChecks = (value) => value === "network-admin";

export const forwardAccessProfileSummary = (value) => {
  assertForwardAccessProfile(value);
  if (value === "read-only") {
    return "Read inventory and paths and execute approved Forward Library NQE query IDs; do not write intent checks.";
  }
  if (value === "network-operator") {
    return "Read Only capabilities plus arbitrary NQE execution; do not write intent checks.";
  }
  return "Read and execute NQE, create missing managed intent checks, and replace changed managed checks only under the configured approval policy.";
};
