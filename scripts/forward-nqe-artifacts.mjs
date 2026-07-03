export const DEFAULT_NQE_CHECKS_PATH = "forward-nqe-checks.json";
export const DEFAULT_NQE_DIFF_REQUESTS_PATH = "forward-nqe-diff-requests.json";
export const FORWARD_QUERY_ID_PATTERN = /^FQ_[a-f0-9]{40}$/i;

const requireString = (value) => typeof value === "string" && value.trim().length > 0;
const hasWhitespace = (value) => /\s/.test(value);

export const isForwardQueryId = (value) => FORWARD_QUERY_ID_PATTERN.test(value || "");

export const parseQueryIdAllowlist = (value = "") =>
  new Set(
    String(value)
      .split(",")
      .map((item) => item.trim())
      .filter(Boolean),
  );

export const toSlug = (value) =>
  String(value || "")
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 80);

const toTagValue = (value) => toSlug(value) || "unknown";

const toQueryToken = (queryId) => queryId.toLowerCase().replace(/^fq_/, "");

const toNqeKey = ({ appName, environment, queryId }) =>
  ["dt", "nqe", toSlug(appName), toSlug(environment), toQueryToken(queryId)]
    .filter(Boolean)
    .join(":");

const toPriorityRank = (criticality) => {
  if (criticality === "critical") {
    return 3;
  }
  if (criticality === "high") {
    return 2;
  }
  return 1;
};

const fromPriorityRank = (rank) => {
  if (rank >= 3) {
    return "HIGH";
  }
  if (rank === 2) {
    return "MEDIUM";
  }
  return "LOW";
};

const exportableDependencies = (dependencies) =>
  dependencies.filter(
    (dependency) =>
      dependency &&
      dependency.mappingState !== "needs-map" &&
      requireString(dependency.appName) &&
      requireString(dependency.environment),
  );

const groupByAppEnvironment = (dependencies) => {
  const groups = new Map();
  for (const dependency of exportableDependencies(dependencies)) {
    const key = `${toSlug(dependency.appName)}:${toSlug(dependency.environment)}`;
    const existing = groups.get(key);
    if (existing) {
      existing.serviceEntityIds.add(dependency.serviceEntityId);
      existing.priorityRank = Math.max(existing.priorityRank, toPriorityRank(dependency.criticality));
      continue;
    }
    groups.set(key, {
      appName: dependency.appName,
      environment: dependency.environment,
      owner: dependency.owner || "unknown",
      serviceEntityIds: new Set([dependency.serviceEntityId].filter(Boolean)),
      priorityRank: toPriorityRank(dependency.criticality),
    });
  }
  return [...groups.values()];
};

export const buildNqeChecksFromDependencies = (
  dependencies,
  {
    queryId,
    templateId = "app-environment-policy",
  } = {},
) => {
  if (!isForwardQueryId(queryId)) {
    throw new Error("NQE query ID must use the FQ_<40 hex chars> form.");
  }

  return groupByAppEnvironment(dependencies).map((group) => ({
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
      `app:${toTagValue(group.appName)}`,
      `environment:${toTagValue(group.environment)}`,
      `owner:${toTagValue(group.owner)}`,
      `dynatrace-key:${toNqeKey({ ...group, queryId })}`,
    ],
  }));
};

export const buildNqeDiffRequestsFromDependencies = (
  dependencies,
  {
    queryId,
    beforeSnapshotId,
    afterSnapshotId,
    templateId = "app-environment-policy",
  } = {},
) => {
  if (!isForwardQueryId(queryId)) {
    throw new Error("NQE diff query ID must use the FQ_<40 hex chars> form.");
  }
  if (!requireString(beforeSnapshotId) || !requireString(afterSnapshotId)) {
    throw new Error("NQE diff requests require before and after snapshot IDs.");
  }

  return groupByAppEnvironment(dependencies).map((group) => {
    const dynatraceKey = `dynatrace-key:${toNqeKey({ ...group, queryId })}:diff`;
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
      dynatraceKey,
      tags: [
        "dynatrace",
        "nqe-diff",
        `app:${toTagValue(group.appName)}`,
        `environment:${toTagValue(group.environment)}`,
        dynatraceKey,
      ],
    };
  });
};

const validateAllowlist = (queryIds, allowedQueryIds, errors, label) => {
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

const validateTags = (tags, label, errors) => {
  if (!Array.isArray(tags)) {
    errors.push(`${label}.tags must be an array.`);
    return [];
  }
  const dynatraceKeys = [];
  tags.forEach((tag, index) => {
    if (!requireString(tag)) {
      errors.push(`${label}.tags[${index}] must be a non-empty string.`);
    } else if (hasWhitespace(tag)) {
      errors.push(`${label}.tags[${index}] must not contain whitespace.`);
    } else if (tag.startsWith("dynatrace-key:")) {
      dynatraceKeys.push(tag);
    }
  });
  return dynatraceKeys;
};

export const validateNqeChecks = (
  checks,
  {
    allowedQueryIds,
  } = {},
) => {
  if (!Array.isArray(checks)) {
    throw new Error("forward-nqe-checks.json must contain a NewNetworkCheck[] JSON array.");
  }

  const errors = [];
  const names = new Map();
  const keys = new Map();
  const queryIds = new Set();

  checks.forEach((check, index) => {
    const label = `nqeCheck[${index}]`;
    if (!check || typeof check !== "object" || Array.isArray(check)) {
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
    if (!check.definition || typeof check.definition !== "object" || Array.isArray(check.definition)) {
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

    const dynatraceKeys = validateTags(check.tags, label, errors);
    if (dynatraceKeys.length !== 1) {
      errors.push(`${label}.tags must contain exactly one dynatrace-key:* tag.`);
    } else if (keys.has(dynatraceKeys[0])) {
      errors.push(`${label} dynatrace-key duplicates nqeCheck[${keys.get(dynatraceKeys[0])}].`);
    } else {
      keys.set(dynatraceKeys[0], index);
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
  requests,
  {
    allowedQueryIds,
  } = {},
) => {
  if (!Array.isArray(requests)) {
    throw new Error("forward-nqe-diff-requests.json must contain a JSON array.");
  }

  const errors = [];
  const names = new Map();
  const keys = new Map();
  const queryIds = new Set();

  requests.forEach((request, index) => {
    const label = `nqeDiffRequest[${index}]`;
    if (!request || typeof request !== "object" || Array.isArray(request)) {
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
      (!request.parameters || typeof request.parameters !== "object" || Array.isArray(request.parameters))
    ) {
      errors.push(`${label}.parameters must be an object when supplied.`);
    }
    if (
      request.options !== undefined &&
      (!request.options || typeof request.options !== "object" || Array.isArray(request.options))
    ) {
      errors.push(`${label}.options must be an object when supplied.`);
    }
    if (!requireString(request.dynatraceKey) || !request.dynatraceKey.startsWith("dynatrace-key:")) {
      errors.push(`${label}.dynatraceKey must be a dynatrace-key:* string.`);
    } else if (keys.has(request.dynatraceKey)) {
      errors.push(`${label}.dynatraceKey duplicates nqeDiffRequest[${keys.get(request.dynatraceKey)}].`);
    } else {
      keys.set(request.dynatraceKey, index);
    }
    validateTags(request.tags || [request.dynatraceKey], label, errors);
  });

  validateAllowlist(queryIds, allowedQueryIds, errors, "NQE diff requests");

  if (errors.length > 0) {
    throw new Error(
      `Invalid Forward NQE diff package:\n${errors.map((error) => `- ${error}`).join("\n")}`,
    );
  }
};
