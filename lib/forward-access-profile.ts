import type { ForwardAccessProfile } from "./types/index.ts";

export const FORWARD_ACCESS_PROFILES = Object.freeze([
  "read-only",
  "network-operator",
  "network-admin",
] as const);

const accessProfileSet = new Set<unknown>(FORWARD_ACCESS_PROFILES);

export const isForwardAccessProfile = (
  value: unknown,
): value is ForwardAccessProfile => accessProfileSet.has(value);

export const assertForwardAccessProfile = (
  value: unknown,
  label = "Forward access profile",
): ForwardAccessProfile => {
  if (!isForwardAccessProfile(value)) {
    throw new Error(
      `${label} must be read-only, network-operator, or network-admin.`,
    );
  }
  return value;
};

export const canExecuteArbitraryNqe = (value: unknown): boolean =>
  value === "network-operator" || value === "network-admin";

export const canWriteIntentChecks = (value: unknown): boolean =>
  value === "network-admin";

export const forwardAccessProfileSummary = (value: unknown): string => {
  const profile = assertForwardAccessProfile(value);
  if (profile === "read-only") {
    return "Read inventory and paths and execute approved Forward Library NQE query IDs; do not write intent checks.";
  }
  if (profile === "network-operator") {
    return "Read Only capabilities plus arbitrary NQE execution; do not write intent checks.";
  }
  return "Read and execute NQE, create missing managed intent checks, and replace changed managed checks only under the configured approval policy.";
};
