import { createHash } from "node:crypto";

import {
  inspectManagedIdentity,
  managedSourceKey,
} from "./managed-check-identity.ts";
import type {
  ForwardAccessProfile,
  ForwardIntentCheck,
  ForwardReconciliation,
} from "./types/index.ts";

export type {
  ForwardReconciliation,
  ForwardReconciliationChanged,
  ForwardReconciliationCollision,
  ForwardReconciliationCollisionReason,
  ForwardReconciliationCreate,
  ForwardReconciliationStale,
  ForwardReconciliationUnchanged,
} from "./types/index.ts";

const isRecord = (value: unknown): value is Record<string, unknown> =>
  Boolean(value) && typeof value === "object" && !Array.isArray(value);

export const sha256 = (value: string): string =>
  createHash("sha256").update(value).digest("hex");

const sortObject = (value: unknown): unknown => {
  if (Array.isArray(value)) return value.map(sortObject);
  if (isRecord(value)) {
    return Object.fromEntries(
      Object.entries(value)
        .sort(([left], [right]) => left.localeCompare(right))
        .map(([key, child]) => [key, sortObject(child)]),
    );
  }
  return value;
};

export const stableJson = (value: unknown): string =>
  JSON.stringify(sortObject(value));

const canonicalizeLocation = (value: unknown): unknown => {
  if (typeof value !== "string") return value;
  if (/^(?:\d{1,3}\.){3}\d{1,3}\/32$/u.test(value)) return value.slice(0, -3);
  if (/^[A-Fa-f0-9:]+\/128$/u.test(value)) return value.slice(0, -4);
  return value;
};

const canonicalizeCheck = (check: unknown): Record<string, unknown> => {
  const checkRecord = isRecord(check) ? check : {};
  const definition = structuredClone(
    isRecord(checkRecord.definition) ? checkRecord.definition : {},
  );
  const filters = isRecord(definition.filters) ? definition.filters : {};
  const tags: unknown[] = Array.isArray(checkRecord.tags)
    ? checkRecord.tags
    : [];
  for (const endpointValue of [filters.from, filters.to]) {
    if (!isRecord(endpointValue) || !isRecord(endpointValue.location)) {
      continue;
    }
    if (endpointValue.location.type === "SubnetLocationFilter") {
      endpointValue.location.value = canonicalizeLocation(
        endpointValue.location.value,
      );
    }
  }
  return {
    definition,
    enabled: checkRecord.enabled !== false,
    perfMonitoringEnabled: checkRecord.perfMonitoringEnabled === true,
    name: checkRecord.name || "",
    note: checkRecord.note || "",
    priority: checkRecord.priority || "NOT_SET",
    tags: tags.slice().sort(),
  };
};

export const fingerprint = (check: unknown): string =>
  sha256(stableJson(canonicalizeCheck(check)));

export const reconcileChecks = (
  plannedChecks: ForwardIntentCheck[],
  existingChecks: unknown[],
  expectedSourceInstanceTag: string,
): ForwardReconciliation => {
  const byKey = new Map<
    string,
    Array<{
      check: Record<string, unknown>;
      identity: ReturnType<typeof inspectManagedIdentity>;
    }>
  >();
  const byName = new Map<string, Array<Record<string, unknown>>>();
  // Existing checks are indexed by source key regardless of which source
  // instance owns them. Matching the key alone is not proof of ownership, so
  // the owning instance is carried through and verified at match time; a key
  // hit belonging to another instance must fail closed rather than be adopted
  // or silently re-created.
  for (const check of existingChecks) {
    if (!isRecord(check)) continue;
    const identity = inspectManagedIdentity(check);
    const key = identity.managed ? identity.sourceKey : null;
    if (key) {
      byKey.set(key, [...(byKey.get(key) || []), { check, identity }]);
    }
    if (typeof check.name === "string" && check.name) {
      byName.set(check.name, [...(byName.get(check.name) || []), check]);
    }
  }

  const create: ForwardReconciliation["create"] = [];
  const unchanged: ForwardReconciliation["unchanged"] = [];
  const changed: ForwardReconciliation["changed"] = [];
  const collision: ForwardReconciliation["collision"] = [];
  const plannedKeys = new Set<string>();

  for (const planned of plannedChecks) {
    const identity = inspectManagedIdentity(planned);
    const key = managedSourceKey(planned);
    if (!identity.managed || identity.sourceInstance !== expectedSourceInstanceTag || !key) {
      collision.push({ key: key || "invalid", reason: "invalid-managed-identity" });
      continue;
    }
    if (plannedKeys.has(key)) {
      collision.push({ key, reason: "duplicate-planned-source-key" });
      continue;
    }
    plannedKeys.add(key);
    const keyMatches = byKey.get(key) || [];
    const nameMatches = byName.get(planned.name) || [];
    if (keyMatches.length > 1) {
      collision.push({ key, reason: "duplicate-existing-source-key" });
      continue;
    }
    if (keyMatches.length === 0) {
      if (nameMatches.length > 0) {
        collision.push({ key, reason: "name-owned-by-another-check" });
      } else {
        create.push({ key, check: planned });
      }
      continue;
    }
    if (keyMatches[0].identity.sourceInstance !== expectedSourceInstanceTag) {
      collision.push({ key, reason: "foreign-source-instance" });
      continue;
    }
    const existing = keyMatches[0].check;
    if (nameMatches.some((candidate) => String(candidate.id) !== String(existing.id))) {
      collision.push({ key, reason: "name-collision" });
      continue;
    }
    const existingFingerprint = fingerprint(existing);
    if (fingerprint(planned) === existingFingerprint) {
      unchanged.push({ key, existingId: String(existing.id) });
    } else {
      changed.push({
        key,
        existingId: String(existing.id),
        existingFingerprint,
        check: planned,
      });
    }
  }

  const stale: ForwardReconciliation["stale"] = [];
  for (const check of existingChecks) {
    const identity = inspectManagedIdentity(check);
    if (
      identity.managed &&
      identity.sourceInstance === expectedSourceInstanceTag &&
      identity.sourceKey !== null &&
      !plannedKeys.has(identity.sourceKey)
    ) {
      stale.push({ key: identity.sourceKey });
    }
  }

  return { create, unchanged, changed, stale, collision };
};

export interface ReconciliationCounts {
  create: number;
  unchanged: number;
  changed: number;
  stale: number;
  collision: number;
}

export const reconciliationCounts = (
  reconciliation: ForwardReconciliation,
): ReconciliationCounts => ({
  create: reconciliation.create.length,
  unchanged: reconciliation.unchanged.length,
  changed: reconciliation.changed.length,
  stale: reconciliation.stale.length,
  collision: reconciliation.collision.length,
});

export const collisionReasonCounts = (
  collisions: ForwardReconciliation["collision"],
): Record<string, number> => Object.fromEntries(
  [...collisions.reduce((reasons, { reason }) => {
    reasons.set(reason, (reasons.get(reason) || 0) + 1);
    return reasons;
  }, new Map<string, number>()).entries()].sort(([left], [right]) =>
    left.localeCompare(right)),
);

// The digest is the approval token, so it must bind every input that changes
// what apply would do. Binding only the desired payload would let a check be
// deleted and re-created under a different ID, or drift arbitrarily while
// staying in the `changed` bucket, without invalidating an earlier approval.
export const planDigest = ({
  networkId,
  snapshotId,
  profile,
  pathEvidenceDigest,
  reconciliation,
  budgets,
}: {
  networkId: string;
  snapshotId: string;
  profile: ForwardAccessProfile;
  pathEvidenceDigest: string | null;
  reconciliation: ForwardReconciliation;
  budgets: { maxCreates: number; maxUpdates: number };
}): string => sha256(stableJson({
  networkId,
  snapshotId,
  profile,
  pathEvidenceDigest,
  budgets,
  create: reconciliation.create
    .map(({ key, check }) => ({ key, fingerprint: fingerprint(check) }))
    .sort((left, right) => left.key.localeCompare(right.key)),
  changed: reconciliation.changed
    .map(({ key, check, existingId, existingFingerprint }) => ({
      key,
      existingId,
      existingFingerprint,
      fingerprint: fingerprint(check),
    }))
    .sort((left, right) => left.key.localeCompare(right.key)),
  stale: reconciliation.stale.map(({ key }) => key).sort(),
  collision: reconciliation.collision
    .map(({ key, reason }) => ({ key, reason }))
    .sort((left, right) => left.key.localeCompare(right.key) || left.reason.localeCompare(right.reason)),
}));
