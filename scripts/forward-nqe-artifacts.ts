import {
  inspectManagedIdentity,
  requiredOwnershipTags,
  sourceKeyTag,
} from "../lib/managed-check-identity.ts";
import type {
  DependencyCandidate,
  DependencyCriticality,
} from "../lib/types/forward.ts";

export const DEFAULT_NQE_CHECKS_PATH = "forward-nqe-checks.json";
export const DEFAULT_NQE_DIFF_REQUESTS_PATH = "forward-nqe-diff-requests.json";
export const FORWARD_QUERY_ID_PATTERN = /^FQ_[a-f0-9]{40}$/i;

interface DependencyGroup {
  appName: string;
  environment: string;
  owner: string;
  serviceEntityIds: Set<string>;
  priorityRank: number;
}

interface NqeCheckBuildOptions {
  queryId?: string;
  sourceInstanceId?: string;
  templateId?: string;
}

interface NqeDiffBuildOptions extends NqeCheckBuildOptions {
  beforeSnapshotId?: string;
  afterSnapshotId?: string;
}

interface ValidationOptions {
  allowedQueryIds?: Set<string>;
}

const isRecord = (value: unknown): value is Record<string, unknown> =>
  Boolean(value) && typeof value === "object" && !Array.isArray(value);

const requireString = (value: unknown): value is string =>
  typeof value === "string" && value.trim().length > 0;
const hasWhitespace = (value: string): boolean => /\s/.test(value);

export const isForwardQueryId = (value: unknown): value is string =>
  typeof value === "string" && FORWARD_QUERY_ID_PATTERN.test(value);

export const parseQueryIdAllowlist = (value: unknown = ""): Set<string> =>
  new Set(
    String(value)
      .split(",")
      .map((item) => item.trim())
      .filter(Boolean),
  );

export const toSlug = (value: unknown): string =>
  (typeof value === "string" || typeof value === "number" || typeof value === "boolean"
    ? String(value)
    : "")
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 80);

const toTagValue = (value: unknown): string => toSlug(value) || "unknown";

const toPriorityRank = (criticality: DependencyCriticality): number => {
  if (criticality === "critical") {
    return 3;
  }
  if (criticality === "high") {
    return 2;
  }
  return 1;
};

const fromPriorityRank = (rank: number): "HIGH" | "MEDIUM" | "LOW" => {
  if (rank >= 3) {
    return "HIGH";
  }
  if (rank === 2) {
    return "MEDIUM";
  }
  return "LOW";
};

const exportableDependencies = (dependencies: DependencyCandidate[]): DependencyCandidate[] =>
  dependencies.filter(
    (dependency) =>
      dependency &&
      dependency.mappingState !== "needs-map" &&
      requireString(dependency.appName) &&
      requireString(dependency.environment),
  );

const groupByAppEnvironment = (dependencies: DependencyCandidate[]): DependencyGroup[] => {
  const groups = new Map<string, DependencyGroup>();
  for (const dependency of exportableDependencies(dependencies)) {
    const key = `${toSlug(dependency.appName)}:${toSlug(dependency.environment)}`;
    const existing = groups.get(key);
    if (existing) {
      if (dependency.serviceEntityId) existing.serviceEntityIds.add(dependency.serviceEntityId);
      existing.priorityRank = Math.max(existing.priorityRank, toPriorityRank(dependency.criticality));
      continue;
    }
    groups.set(key, {
      appName: dependency.appName,
      environment: dependency.environment,
      owner: dependency.owner || "unknown",
      serviceEntityIds: new Set(dependency.serviceEntityId ? [dependency.serviceEntityId] : []),
      priorityRank: toPriorityRank(dependency.criticality),
    });
  }
  return [...groups.values()];
};

export const buildNqeChecksFromDependencies = (
  dependencies: DependencyCandidate[],
  {
    queryId,
    sourceInstanceId,
    templateId = "app-environment-policy",
  }: NqeCheckBuildOptions = {},
) => {
  if (!isForwardQueryId(queryId)) {
    throw new Error("NQE query ID must use the FQ_<40 hex chars> form.");
  }

  if (!sourceInstanceId) {
    throw new Error("NQE check generation requires sourceInstanceId.");
  }

  return groupByAppEnvironment(dependencies).map((group) => {
    const sourceKey = sourceKeyTag({
      sourceInstanceId,
      identity: {
        kind: "nqe",
        queryId,
        serviceEntityIds: [...group.serviceEntityIds].filter(Boolean).sort(),
        templateId,
      },
    });
    return ({
    definition: {
      checkType: "NQE",
      queryId,
      params: {
        application: group.appName,
        environment: group.environment,
      },
    },
    enabled: true,
    name: `[Dynatrace] ${group.appName} ${group.environment}: NQE policy`,
    note: [
      "Generated from Dynatrace app metadata",
      `queryId=${queryId}`,
      `template=${templateId}`,
      `serviceEntityCount=${group.serviceEntityIds.size}`,
      `owner=${group.owner}`,
    ].join("; "),
    priority: fromPriorityRank(group.priorityRank),
    tags: [
      "dynatrace",
      "nqe",
      ...requiredOwnershipTags({ sourceInstanceId, sourceKey }),
      `app:${toTagValue(group.appName)}`,
      `environment:${toTagValue(group.environment)}`,
      `owner:${toTagValue(group.owner)}`,
    ],
    });
  });
};

export const buildNqeDiffRequestsFromDependencies = (
  dependencies: DependencyCandidate[],
  {
    queryId,
    sourceInstanceId,
    beforeSnapshotId,
    afterSnapshotId,
    templateId = "app-environment-policy",
  }: NqeDiffBuildOptions = {},
) => {
  if (!isForwardQueryId(queryId)) {
    throw new Error("NQE diff query ID must use the FQ_<40 hex chars> form.");
  }
  if (!requireString(beforeSnapshotId) || !requireString(afterSnapshotId)) {
    throw new Error("NQE diff requests require before and after snapshot IDs.");
  }
  if (!sourceInstanceId) {
    throw new Error("NQE diff generation requires sourceInstanceId.");
  }

  return groupByAppEnvironment(dependencies).map((group) => {
    const sourceKey = sourceKeyTag({
      sourceInstanceId,
      identity: {
        beforeSnapshotId,
        afterSnapshotId,
        kind: "nqe-diff",
        queryId,
        serviceEntityIds: [...group.serviceEntityIds].filter(Boolean).sort(),
        templateId,
      },
    });
    return {
      name: `[Dynatrace] ${group.appName} ${group.environment}: NQE diff`,
      queryId,
      beforeSnapshotId,
      afterSnapshotId,
      parameters: {
        application: group.appName,
        environment: group.environment,
      },
      options: {
        itemFormat: "JSON",
        limit: 1000,
      },
      templateId,
      sourceKey,
      tags: [
        "dynatrace",
        "nqe-diff",
        ...requiredOwnershipTags({ sourceInstanceId, sourceKey }),
        `app:${toTagValue(group.appName)}`,
        `environment:${toTagValue(group.environment)}`,
      ],
    };
  });
};

const validateAllowlist = (
  queryIds: Set<string>,
  allowedQueryIds: Set<string> | undefined,
  errors: string[],
  label: string,
): void => {
  if (!(allowedQueryIds instanceof Set) || allowedQueryIds.size === 0) {
    errors.push(`${label} requires a non-empty Forward-owned query ID allowlist.`);
    return;
  }
  for (const queryId of queryIds) {
    if (!allowedQueryIds.has(queryId)) {
      errors.push(`${label} queryId ${queryId} is not in the approved allowlist.`);
    }
  }
};

const validateTags = (
  tags: unknown,
  label: string,
  errors: string[],
): ReturnType<typeof inspectManagedIdentity> => {
  if (!Array.isArray(tags)) {
    errors.push(`${label}.tags must be an array.`);
    return inspectManagedIdentity({ tags: [] });
  }
  tags.forEach((tag, index) => {
    if (!requireString(tag)) {
      errors.push(`${label}.tags[${index}] must be a non-empty string.`);
    } else if (hasWhitespace(tag)) {
      errors.push(`${label}.tags[${index}] must not contain whitespace.`);
    }
  });
  return inspectManagedIdentity({ tags });
};

export const validateNqeChecks = (
  checks: unknown,
  {
    allowedQueryIds,
  }: ValidationOptions = {},
): void => {
  if (!Array.isArray(checks)) {
    throw new Error("forward-nqe-checks.json must contain a NewNetworkCheck[] JSON array.");
  }

  const errors: string[] = [];
  const names = new Map<string, number>();
  const keys = new Map<string, number>();
  const queryIds = new Set<string>();

  checks.forEach((check, index) => {
    const label = `nqeCheck[${index}]`;
    if (!isRecord(check)) {
      errors.push(`${label} must be an object.`);
      return;
    }
    if (!requireString(check.name)) {
      errors.push(`${label}.name is required.`);
    } else if (names.has(check.name)) {
      errors.push(`${label}.name duplicates nqeCheck[${names.get(check.name)}].name.`);
    } else {
      names.set(check.name, index);
    }
    if (!isRecord(check.definition)) {
      errors.push(`${label}.definition must be an object.`);
    } else {
      if (check.definition.checkType !== "NQE") {
        errors.push(`${label}.definition.checkType must be NQE.`);
      }
      if (!isForwardQueryId(check.definition.queryId)) {
        errors.push(`${label}.definition.queryId must use FQ_<40 hex chars> form.`);
      } else {
        queryIds.add(check.definition.queryId);
      }
      if (
        check.definition.params !== undefined &&
        (!check.definition.params ||
          typeof check.definition.params !== "object" ||
          Array.isArray(check.definition.params))
      ) {
        errors.push(`${label}.definition.params must be an object when supplied.`);
      }
    }

    const identity = validateTags(check.tags, label, errors);
    for (const identityError of identity.errors) {
      errors.push(`${label}.tags ${identityError}.`);
    }
    if (identity.sourceKey && keys.has(identity.sourceKey)) {
      errors.push(`${label} source-key duplicates nqeCheck[${keys.get(identity.sourceKey)}].`);
    } else if (identity.managed && identity.sourceKey) {
      keys.set(identity.sourceKey, index);
    }
  });

  validateAllowlist(queryIds, allowedQueryIds, errors, "NQE checks");

  if (errors.length > 0) {
    throw new Error(
      `Invalid Forward NQE check package:\n${errors.map((error) => `- ${error}`).join("\n")}`,
    );
  }
};

export const validateNqeDiffRequests = (
  requests: unknown,
  {
    allowedQueryIds,
  }: ValidationOptions = {},
): void => {
  if (!Array.isArray(requests)) {
    throw new Error("forward-nqe-diff-requests.json must contain a JSON array.");
  }

  const errors: string[] = [];
  const names = new Map<string, number>();
  const keys = new Map<string, number>();
  const queryIds = new Set<string>();

  requests.forEach((request, index) => {
    const label = `nqeDiffRequest[${index}]`;
    if (!isRecord(request)) {
      errors.push(`${label} must be an object.`);
      return;
    }
    if (!requireString(request.name)) {
      errors.push(`${label}.name is required.`);
    } else if (names.has(request.name)) {
      errors.push(`${label}.name duplicates nqeDiffRequest[${names.get(request.name)}].name.`);
    } else {
      names.set(request.name, index);
    }
    if (!isForwardQueryId(request.queryId)) {
      errors.push(`${label}.queryId must use FQ_<40 hex chars> form.`);
    } else {
      queryIds.add(request.queryId);
    }
    if (!requireString(request.beforeSnapshotId)) {
      errors.push(`${label}.beforeSnapshotId is required.`);
    }
    if (!requireString(request.afterSnapshotId)) {
      errors.push(`${label}.afterSnapshotId is required.`);
    }
    if (
      request.parameters !== undefined &&
      !isRecord(request.parameters)
    ) {
      errors.push(`${label}.parameters must be an object when supplied.`);
    }
    if (
      request.options !== undefined &&
      !isRecord(request.options)
    ) {
      errors.push(`${label}.options must be an object when supplied.`);
    }
    if (!requireString(request.sourceKey) || !request.sourceKey.startsWith("source-key:sha256:")) {
      errors.push(`${label}.sourceKey must be a source-key:sha256:* string.`);
    } else if (keys.has(request.sourceKey)) {
      errors.push(`${label}.sourceKey duplicates nqeDiffRequest[${keys.get(request.sourceKey)}].`);
    } else {
      keys.set(request.sourceKey, index);
    }
    const identity = validateTags(request.tags || [], label, errors);
    for (const identityError of identity.errors) {
      errors.push(`${label}.tags ${identityError}.`);
    }
    if (identity.sourceKey && identity.sourceKey !== request.sourceKey) {
      errors.push(`${label}.sourceKey must match the managed source-key tag.`);
    }
  });

  validateAllowlist(queryIds, allowedQueryIds, errors, "NQE diff requests");

  if (errors.length > 0) {
    throw new Error(
      `Invalid Forward NQE diff package:\n${errors.map((error) => `- ${error}`).join("\n")}`,
    );
  }
};
