import { sha256Hex, stableJson } from "../lib/managed-check-identity.mjs";

export const IMPORT_PLAN_SCHEMA_VERSION = "forward-dynatrace-import-plan/v1";

const SHA256_PATTERN = /^[a-f0-9]{64}$/u;
const SOURCE_KEY_PATTERN = /^source-key:sha256:[a-f0-9]{64}$/u;

const isNonEmptyString = (value) => typeof value === "string" && value.trim().length > 0;
const isNonNegativeInteger = (value) => Number.isInteger(value) && value >= 0;

const requireExactKeys = (value, expectedKeys, label, errors) => {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    errors.push(`${label} must be an object`);
    return false;
  }
  const expected = new Set(expectedKeys);
  for (const key of Object.keys(value)) {
    if (!expected.has(key)) errors.push(`${label}.${key} is not supported`);
  }
  for (const key of expected) {
    if (!Object.hasOwn(value, key)) errors.push(`${label}.${key} is required`);
  }
  return true;
};

const validateActionArray = (items, action, expectedFields, errors, allSourceKeys) => {
  if (!Array.isArray(items)) {
    errors.push(`actions.${action} must be an array`);
    return;
  }

  const localSourceKeys = new Set();
  items.forEach((item, index) => {
    const label = `actions.${action}[${index}]`;
    if (!requireExactKeys(item, expectedFields, label, errors)) return;
    if (!SOURCE_KEY_PATTERN.test(item.sourceKey || "")) {
      errors.push(`${label}.sourceKey must be a source-key:sha256:<64 hex> value`);
    } else if (localSourceKeys.has(item.sourceKey)) {
      errors.push(`${label}.sourceKey duplicates another ${action} action`);
    } else if (allSourceKeys.has(item.sourceKey)) {
      errors.push(`${label}.sourceKey appears in more than one action category`);
    } else {
      localSourceKeys.add(item.sourceKey);
      allSourceKeys.add(item.sourceKey);
    }

    for (const field of expectedFields.filter((field) => field.endsWith("Fingerprint"))) {
      if (!SHA256_PATTERN.test(item[field] || "")) {
        errors.push(`${label}.${field} must be a SHA-256 digest`);
      }
    }
    if (expectedFields.includes("existingCheckId") && !isNonEmptyString(item.existingCheckId)) {
      errors.push(`${label}.existingCheckId is required`);
    }
    if (expectedFields.includes("reason") && !isNonEmptyString(item.reason)) {
      errors.push(`${label}.reason is required`);
    }
    if (expectedFields.includes("existingCheckIds")) {
      if (!Array.isArray(item.existingCheckIds)) {
        errors.push(`${label}.existingCheckIds must be an array`);
      } else if (item.existingCheckIds.some((id) => !isNonEmptyString(id))) {
        errors.push(`${label}.existingCheckIds must contain only non-empty strings`);
      } else if (new Set(item.existingCheckIds).size !== item.existingCheckIds.length) {
        errors.push(`${label}.existingCheckIds must not contain duplicates`);
      }
    }
  });
};

const sorted = (items) =>
  [...items].sort((left, right) =>
    String(left.sourceKey || left.key || left.name || "").localeCompare(
      String(right.sourceKey || right.key || right.name || ""),
    ),
  );

const sourceKey = (item) => item.key || item.sourceKey || null;

const planBody = ({
  createdAt,
  manifest,
  manifestText,
  packageSignatureStatus,
  networkId,
  snapshotId,
  reconciliation,
  policy,
}) => ({
  schemaVersion: IMPORT_PLAN_SCHEMA_VERSION,
  createdAt,
  package: {
    packageId: manifest.packageId,
    manifestSha256: sha256Hex(manifestText),
    intentChecksSha256: manifest.integrity.intentChecksSha256,
    signatureStatus: packageSignatureStatus,
    sourceInstanceTag: manifest.source.instanceTag,
  },
  target: {
    networkId: String(networkId),
    snapshotId: String(snapshotId),
  },
  policy: {
    createMissing: true,
    updateChanged: Boolean(policy.applyUpdates),
    retireStale: Boolean(policy.deactivateStale),
    maxUpdates: policy.maxUpdates,
    maxRetirements: policy.maxDeactivations,
  },
  counts: {
    create: reconciliation.create.length,
    unchanged: reconciliation.unchanged.length,
    changed: reconciliation.changed.length,
    stale: reconciliation.stale.length,
    collision: reconciliation.collision.length,
  },
  actions: {
    create: sorted(
      reconciliation.create.map((item) => ({
        sourceKey: sourceKey(item),
        checkFingerprint: item.fingerprint,
      })),
    ),
    update: sorted(
      policy.applyUpdates
        ? reconciliation.changed.map((item) => ({
            sourceKey: sourceKey(item),
            existingCheckId: String(item.existingId),
            existingFingerprint: item.existing.fingerprint,
            plannedFingerprint: item.planned.fingerprint,
          }))
        : [],
    ),
    retire: sorted(
      policy.deactivateStale
        ? reconciliation.stale.map((item) => ({
            sourceKey: sourceKey(item),
            existingCheckId: String(item.id),
            existingFingerprint: item.fingerprint,
          }))
        : [],
    ),
    collision: sorted(
      reconciliation.collision.map((item) => ({
        sourceKey: sourceKey(item),
        reason: item.reason,
        existingCheckIds: [...(item.existingIds || [])].map(String).sort(),
      })),
    ),
  },
});

export const buildImportPlan = (input) => {
  const body = planBody(input);
  const planSha256 = sha256Hex(stableJson(body));
  return {
    ...body,
    planId: `forward-dynatrace-plan-${planSha256.slice(0, 24)}`,
    planSha256,
  };
};

export const validateImportPlan = (plan) => {
  const errors = [];
  if (!plan || typeof plan !== "object" || Array.isArray(plan)) {
    throw new Error("Import plan must be a JSON object.");
  }
  if (plan.schemaVersion !== IMPORT_PLAN_SCHEMA_VERSION) {
    errors.push(`schemaVersion must be ${IMPORT_PLAN_SCHEMA_VERSION}`);
  }
  requireExactKeys(
    plan,
    [
      "schemaVersion",
      "createdAt",
      "package",
      "target",
      "policy",
      "counts",
      "actions",
      "planId",
      "planSha256",
    ],
    "plan",
    errors,
  );
  for (const [label, value] of Object.entries({
    createdAt: plan.createdAt,
    planId: plan.planId,
    planSha256: plan.planSha256,
    packageId: plan.package?.packageId,
    manifestSha256: plan.package?.manifestSha256,
    intentChecksSha256: plan.package?.intentChecksSha256,
    sourceInstanceTag: plan.package?.sourceInstanceTag,
    networkId: plan.target?.networkId,
    snapshotId: plan.target?.snapshotId,
  })) {
    if (typeof value !== "string" || !value.trim()) errors.push(`${label} is required`);
  }
  if (!Number.isFinite(Date.parse(plan.createdAt || ""))) {
    errors.push("createdAt must be an ISO timestamp");
  }
  if (!/^forward-dynatrace-plan-[a-f0-9]{24}$/u.test(plan.planId || "")) {
    errors.push("planId must be a Forward import plan ID");
  }
  if (!SHA256_PATTERN.test(plan.planSha256 || "")) {
    errors.push("planSha256 must be a SHA-256 digest");
  }

  if (
    requireExactKeys(
      plan.package,
      [
        "packageId",
        "manifestSha256",
        "intentChecksSha256",
        "signatureStatus",
        "sourceInstanceTag",
      ],
      "package",
      errors,
    )
  ) {
    if (!isNonEmptyString(plan.package.packageId)) errors.push("package.packageId is required");
    if (!SHA256_PATTERN.test(plan.package.manifestSha256 || "")) {
      errors.push("package.manifestSha256 must be a SHA-256 digest");
    }
    if (!SHA256_PATTERN.test(plan.package.intentChecksSha256 || "")) {
      errors.push("package.intentChecksSha256 must be a SHA-256 digest");
    }
    if (plan.package.signatureStatus !== "verified") {
      errors.push("package.signatureStatus must be verified");
    }
    if (!/^source-instance:[a-z0-9][a-z0-9._:-]{2,127}$/u.test(plan.package.sourceInstanceTag || "")) {
      errors.push("package.sourceInstanceTag must be a normalized source-instance tag");
    }
  }

  if (requireExactKeys(plan.target, ["networkId", "snapshotId"], "target", errors)) {
    if (!isNonEmptyString(plan.target.networkId)) errors.push("target.networkId is required");
    if (!isNonEmptyString(plan.target.snapshotId)) errors.push("target.snapshotId is required");
  }

  if (
    requireExactKeys(
      plan.policy,
      ["createMissing", "updateChanged", "retireStale", "maxUpdates", "maxRetirements"],
      "policy",
      errors,
    )
  ) {
    if (plan.policy.createMissing !== true) errors.push("policy.createMissing must be true");
    if (typeof plan.policy.updateChanged !== "boolean") {
      errors.push("policy.updateChanged must be a boolean");
    }
    if (typeof plan.policy.retireStale !== "boolean") {
      errors.push("policy.retireStale must be a boolean");
    }
    if (!isNonNegativeInteger(plan.policy.maxUpdates)) {
      errors.push("policy.maxUpdates must be a non-negative integer");
    }
    if (!isNonNegativeInteger(plan.policy.maxRetirements)) {
      errors.push("policy.maxRetirements must be a non-negative integer");
    }
  }

  const countKeys = ["create", "unchanged", "changed", "stale", "collision"];
  if (requireExactKeys(plan.counts, countKeys, "counts", errors)) {
    for (const key of countKeys) {
      if (!isNonNegativeInteger(plan.counts[key])) {
        errors.push(`counts.${key} must be a non-negative integer`);
      }
    }
  }

  if (
    requireExactKeys(
      plan.actions,
      ["create", "update", "retire", "collision"],
      "actions",
      errors,
    )
  ) {
    const allSourceKeys = new Set();
    validateActionArray(
      plan.actions.create,
      "create",
      ["sourceKey", "checkFingerprint"],
      errors,
      allSourceKeys,
    );
    validateActionArray(
      plan.actions.update,
      "update",
      ["sourceKey", "existingCheckId", "existingFingerprint", "plannedFingerprint"],
      errors,
      allSourceKeys,
    );
    validateActionArray(
      plan.actions.retire,
      "retire",
      ["sourceKey", "existingCheckId", "existingFingerprint"],
      errors,
      allSourceKeys,
    );
    validateActionArray(
      plan.actions.collision,
      "collision",
      ["sourceKey", "reason", "existingCheckIds"],
      errors,
      allSourceKeys,
    );

    if (Array.isArray(plan.actions.create) && plan.actions.create.length !== plan.counts?.create) {
      errors.push("actions.create count must equal counts.create");
    }
    const expectedUpdates = plan.policy?.updateChanged ? plan.counts?.changed : 0;
    if (Array.isArray(plan.actions.update) && plan.actions.update.length !== expectedUpdates) {
      errors.push("actions.update count must match the approved update policy and counts.changed");
    }
    const expectedRetirements = plan.policy?.retireStale ? plan.counts?.stale : 0;
    if (Array.isArray(plan.actions.retire) && plan.actions.retire.length !== expectedRetirements) {
      errors.push("actions.retire count must match the approved retirement policy and counts.stale");
    }
    if (
      Array.isArray(plan.actions.collision) &&
      plan.actions.collision.length !== plan.counts?.collision
    ) {
      errors.push("actions.collision count must equal counts.collision");
    }
    if (
      Array.isArray(plan.actions.update) &&
      isNonNegativeInteger(plan.policy?.maxUpdates) &&
      plan.actions.update.length > plan.policy.maxUpdates
    ) {
      errors.push("actions.update exceeds policy.maxUpdates");
    }
    if (
      Array.isArray(plan.actions.retire) &&
      isNonNegativeInteger(plan.policy?.maxRetirements) &&
      plan.actions.retire.length > plan.policy.maxRetirements
    ) {
      errors.push("actions.retire exceeds policy.maxRetirements");
    }
  }
  if (errors.length > 0) {
    throw new Error(`Invalid Forward import plan:\n${errors.map((error) => `- ${error}`).join("\n")}`);
  }

  const { planId: _planId, planSha256: _planSha256, ...body } = plan;
  const expectedSha256 = sha256Hex(stableJson(body));
  const expectedPlanId = `forward-dynatrace-plan-${expectedSha256.slice(0, 24)}`;
  if (plan.planSha256 !== expectedSha256 || plan.planId !== expectedPlanId) {
    throw new Error("Import plan digest does not match its immutable contents.");
  }
  return plan;
};

export const assertImportPlanMatches = (approvedPlan, currentPlan) => {
  validateImportPlan(approvedPlan);
  validateImportPlan(currentPlan);
  if (
    approvedPlan.planId !== currentPlan.planId ||
    approvedPlan.planSha256 !== currentPlan.planSha256
  ) {
    throw new Error(
      "Current Forward reconciliation no longer matches the approved import plan; stage and approve a new plan.",
    );
  }
};
