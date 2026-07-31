import { createHash } from "node:crypto";

export const MANAGED_BY_TAG = "managed-by:com.forward.dynatrace";
export const CONTRACT_VERSION_TAG = "contract-version:1";
export const SOURCE_INSTANCE_TAG_PREFIX = "source-instance:";
export const SOURCE_KEY_TAG_PREFIX = "source-key:sha256:";

const SOURCE_INSTANCE_PATTERN = /^[a-z0-9][a-z0-9._:-]{2,127}$/u;
const SOURCE_KEY_PATTERN = /^source-key:sha256:[a-f0-9]{64}$/u;

interface DependencyIdentityInput {
  destinationEntityId?: unknown;
  destinationServiceEntityId?: unknown;
  destination?: unknown;
  port?: unknown;
  protocol?: unknown;
  serviceEntityId?: unknown;
  sourceEntityId?: unknown;
  source?: unknown;
}

export interface ManagedCheckIdentity {
  managed: boolean;
  errors: string[];
  sourceInstance: string | null;
  sourceKey: string | null;
}

const isRecord = (value: unknown): value is Record<string, unknown> =>
  Boolean(value) && typeof value === "object" && !Array.isArray(value);

const stableObject = (value: unknown): unknown => {
  if (Array.isArray(value)) return value.map(stableObject);
  if (isRecord(value)) {
    return Object.fromEntries(
      Object.entries(value)
        .sort(([left], [right]) => left.localeCompare(right))
        .map(([key, child]) => [key, stableObject(child)]),
    );
  }
  return value;
};

export const stableJson = (value: unknown): string =>
  JSON.stringify(stableObject(value));

export const sha256Hex = (value: string): string =>
  createHash("sha256").update(value, "utf8").digest("hex");

export const normalizeSourceInstanceId = (value: unknown): string => {
  const normalized = typeof value === "string" ? value.trim().toLowerCase() : "";
  if (!SOURCE_INSTANCE_PATTERN.test(normalized)) {
    throw new Error(
      "sourceInstanceId must be 3 to 128 lowercase letters, digits, dots, underscores, colons, or hyphens.",
    );
  }
  return normalized;
};

export const sourceInstanceTag = (sourceInstanceId: unknown): string =>
  `${SOURCE_INSTANCE_TAG_PREFIX}${normalizeSourceInstanceId(sourceInstanceId)}`;

const identityValue = (value: unknown): string =>
  typeof value === "string" ||
  typeof value === "number" ||
  typeof value === "boolean"
    ? String(value).trim()
    : "";

export const dependencyIdentity = (
  dependency: DependencyIdentityInput,
  { kind = "intent" }: { kind?: string } = {},
) => ({
  destination: identityValue(
    dependency.destinationEntityId ||
      dependency.destinationServiceEntityId ||
      dependency.destination,
  ),
  kind,
  port: identityValue(dependency.port),
  protocol: identityValue(dependency.protocol).toLowerCase(),
  serviceEntityId: identityValue(dependency.serviceEntityId),
  source: identityValue(dependency.sourceEntityId || dependency.source),
});

export const sourceKeyTag = ({
  sourceInstanceId,
  identity,
}: {
  sourceInstanceId: unknown;
  identity: unknown;
}): string => {
  const scopedIdentity = {
    identity,
    sourceInstanceId: normalizeSourceInstanceId(sourceInstanceId),
  };
  return `${SOURCE_KEY_TAG_PREFIX}${sha256Hex(stableJson(scopedIdentity))}`;
};

export const dependencySourceKeyTag = (
  dependency: DependencyIdentityInput,
  options: { sourceInstanceId: unknown; kind?: string },
): string =>
  sourceKeyTag({
    sourceInstanceId: options.sourceInstanceId,
    identity: dependencyIdentity(dependency, options),
  });

export const requiredOwnershipTags = ({
  sourceInstanceId,
  sourceKey,
}: {
  sourceInstanceId: unknown;
  sourceKey: string;
}): string[] => [
  MANAGED_BY_TAG,
  CONTRACT_VERSION_TAG,
  sourceInstanceTag(sourceInstanceId),
  sourceKey,
];

const tagsWithPrefix = (tags: unknown, prefix: string): string[] =>
  (Array.isArray(tags) ? tags : []).filter((tag) =>
    typeof tag === "string" && tag.startsWith(prefix),
  ) as string[];

export const inspectManagedIdentity = (check: unknown): ManagedCheckIdentity => {
  const tags = isRecord(check) && Array.isArray(check.tags) ? check.tags : [];
  const managedByCount = tags.filter((tag) => tag === MANAGED_BY_TAG).length;
  const contractVersionCount = tags.filter(
    (tag) => tag === CONTRACT_VERSION_TAG,
  ).length;
  const sourceInstances = tagsWithPrefix(tags, SOURCE_INSTANCE_TAG_PREFIX);
  const sourceKeys = tagsWithPrefix(tags, SOURCE_KEY_TAG_PREFIX);
  const errors = [];

  if (managedByCount !== 1) errors.push(`requires exactly one ${MANAGED_BY_TAG} tag`);
  if (contractVersionCount !== 1) {
    errors.push(`requires exactly one ${CONTRACT_VERSION_TAG} tag`);
  }
  if (sourceInstances.length !== 1) {
    errors.push(`requires exactly one ${SOURCE_INSTANCE_TAG_PREFIX}* tag`);
  } else {
    const value = sourceInstances[0].slice(SOURCE_INSTANCE_TAG_PREFIX.length);
    if (!SOURCE_INSTANCE_PATTERN.test(value)) {
      errors.push("contains an invalid source-instance tag");
    }
  }
  if (sourceKeys.length !== 1) {
    errors.push(`requires exactly one ${SOURCE_KEY_TAG_PREFIX}* tag`);
  } else if (!SOURCE_KEY_PATTERN.test(sourceKeys[0])) {
    errors.push("contains an invalid source-key digest tag");
  }

  return {
    managed: errors.length === 0,
    errors,
    sourceInstance: sourceInstances.length === 1 ? sourceInstances[0] : null,
    sourceKey: sourceKeys.length === 1 ? sourceKeys[0] : null,
  };
};

export const managedSourceKey = (check: unknown): string | null => {
  const identity = inspectManagedIdentity(check);
  return identity.managed ? identity.sourceKey : null;
};

export const isManagedCheck = (check: unknown): boolean =>
  inspectManagedIdentity(check).managed;
