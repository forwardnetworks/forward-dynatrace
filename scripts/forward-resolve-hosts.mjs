#!/usr/bin/env node

import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { pathToFileURL } from "node:url";

const DEFAULT_MAX_RETRIES = 2;
const TRANSIENT_STATUS_CODES = new Set([408, 409, 425, 429, 500, 502, 503, 504]);
const FORWARD_HOSTS_ENDPOINT = "GET /api/networks/{networkId}/hosts/{hostSpecifier}";
const FORWARD_SNAPSHOT_ENDPOINT = "GET /api/networks/{networkId}/snapshots/latestProcessed";

const usage = `
Forward host resolver for Dynatrace dependency candidates

Usage:
  npm run forward:resolve-hosts -- \\
    --dependencies dependencies.json \\
    --forward-base-url https://forward.example.com \\
    --forward-network-id <network-id> \\
    --snapshot-id <snapshot-id> \\
    --authorization-file /secure/path/read-only-forward-auth-header \\
    --execute \\
    --output resolved-dependencies.json \\
    --report forward-host-resolution-report.json

Options:
  --dependencies path          Normalized Dynatrace dependency candidates JSON.
  --forward-base-url url       Forward base URL.
  --forward-network-id id      Forward network ID.
  --snapshot-id id             Optional Forward snapshot ID. If omitted with --execute,
                               latestProcessed is read first.
  --authorization-file path    File containing the full read-only Authorization header value.
  --execute                    Contact Forward. Omit for plan-only classification.
  --max-retries 2              Retry count for transient Forward API responses.
  --output path                Write resolved dependency candidates JSON.
  --report path                Write host-resolution report JSON.

Authorization can also be supplied by FORWARD_HOST_RESOLUTION_AUTHORIZATION,
FORWARD_READONLY_AUTHORIZATION, or FORWARD_AUTHORIZATION. This command is read-only:
it calls latestProcessed when needed and GET /api/networks/{networkId}/hosts/{hostSpecifier}.
`;

const parseArgs = (argv) => {
  const args = {};
  for (let index = 0; index < argv.length; index += 1) {
    const value = argv[index];
    if (value === "--help") {
      args.help = true;
      continue;
    }
    if (value === "--execute") {
      args.execute = true;
      continue;
    }
    if (value.startsWith("--")) {
      const key = value.slice(2);
      const next = argv[index + 1];
      if (!next || next.startsWith("--")) {
        throw new Error(`Missing value for ${value}.`);
      }
      args[key] = next;
      index += 1;
      continue;
    }
    throw new Error(`Unsupported positional argument: ${value}`);
  }
  return args;
};

const required = (args, key) => {
  if (!args[key]) {
    throw new Error(`Missing required option: --${key}`);
  }
  return args[key];
};

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

const retryDelayMs = (attempt, retryAfter) => {
  const retryAfterSeconds = Number.parseInt(retryAfter || "", 10);
  if (Number.isInteger(retryAfterSeconds) && retryAfterSeconds > 0) {
    return retryAfterSeconds * 1000;
  }
  return Math.min(500 * 2 ** attempt, 5000);
};

export const normalizeBaseUrl = (value) => value.replace(/\/+$/, "");

const isRecord = (value) => Boolean(value) && typeof value === "object" && !Array.isArray(value);

const ipv4Octet = "(?:25[0-5]|2[0-4]\\d|1\\d\\d|[1-9]?\\d)";
const ipv4Pattern = new RegExp(`^${ipv4Octet}(?:\\.${ipv4Octet}){3}(?:/(?:3[0-2]|[12]?\\d))?$`);
const ipv6Pattern = /^(?:[A-Fa-f0-9:]+:+[A-Fa-f0-9:]*)(?:\/(?:12[0-8]|1[01]\d|\d?\d))?$/;
export const isIpOrSubnet = (value) => {
  const normalized = String(value || "").trim();
  return ipv4Pattern.test(normalized) || ipv6Pattern.test(normalized);
};

const isExplicitResolvedFilter = (filterType, value) =>
  filterType === "DeviceFilter" ||
  (filterType === "SubnetLocationFilter" && isIpOrSubnet(value));

const parsePositiveInteger = (value, fallback, label) => {
  if (value === undefined) {
    return fallback;
  }
  const parsed = Number.parseInt(value, 10);
  if (!Number.isInteger(parsed) || parsed < 0) {
    throw new Error(`${label} must be a non-negative integer.`);
  }
  return parsed;
};

const readJson = async (filePath) =>
  JSON.parse(await readFile(path.resolve(filePath), "utf8"));

const readAuthorizationFile = async (filePath) => {
  const value = (await readFile(path.resolve(filePath), "utf8")).trim();
  if (!value) {
    throw new Error("Authorization file is empty.");
  }
  return value;
};

const runtimeAuthorization = async (args) => {
  if (args["authorization-file"]) {
    return readAuthorizationFile(args["authorization-file"]);
  }
  const value =
    process.env.FORWARD_HOST_RESOLUTION_AUTHORIZATION ||
    process.env.FORWARD_READONLY_AUTHORIZATION ||
    process.env.FORWARD_AUTHORIZATION;
  return value?.trim() || "";
};

const writeJson = async (filePath, value) => {
  const outputPath = path.resolve(filePath);
  await mkdir(path.dirname(outputPath), { recursive: true });
  await writeFile(outputPath, `${JSON.stringify(value, null, 2)}\n`);
};

const parseResponseBody = (text) => {
  if (!text.trim()) {
    return null;
  }
  return JSON.parse(text);
};

export const makeForwardReadOnlyClient = ({
  forwardBaseUrl,
  authorization,
  maxRetries = DEFAULT_MAX_RETRIES,
  fetchImpl = fetch,
}) => {
  const root = normalizeBaseUrl(forwardBaseUrl);
  return async (method, requestPath, options = {}) => {
    const hasBody = Object.prototype.hasOwnProperty.call(options, "body");
    for (let attempt = 0; attempt <= maxRetries; attempt += 1) {
      const response = await fetchImpl(`${root}${requestPath}`, {
        method,
        headers: {
          Accept: "application/json",
          ...(hasBody ? { "Content-Type": "application/json" } : {}),
          ...(authorization ? { Authorization: authorization } : {}),
          ...(options.headers || {}),
        },
        body: hasBody ? JSON.stringify(options.body) : undefined,
      });
      const text = await response.text();
      if (response.ok) {
        return parseResponseBody(text);
      }
      if (TRANSIENT_STATUS_CODES.has(response.status) && attempt < maxRetries) {
        await sleep(retryDelayMs(attempt, response.headers?.get?.("retry-after")));
        continue;
      }
      throw new Error(
        `${method} ${requestPath} failed with ${response.status}: ${text.slice(0, 500)}`,
      );
    }
    throw new Error(`${method} ${requestPath} failed after retry budget was exhausted.`);
  };
};

export const latestProcessedSnapshotId = async ({ api, networkId }) => {
  const latest = await api(
    "GET",
    `/api/networks/${encodeURIComponent(networkId)}/snapshots/latestProcessed`,
  );
  const snapshotId = latest?.id || latest?.snapshotId;
  if (!snapshotId || typeof snapshotId !== "string") {
    throw new Error("latestProcessed response did not include id or snapshotId.");
  }
  return snapshotId;
};

const hostLookupPath = ({ networkId, snapshotId, hostSpecifier }) => {
  const params = new URLSearchParams({ snapshotId });
  return `/api/networks/${encodeURIComponent(networkId)}/hosts/${encodeURIComponent(hostSpecifier)}?${params}`;
};

const uniqueStrings = (values) => [...new Set(values.map((value) => String(value).trim()).filter(Boolean))];

export const selectResolvedHostCandidate = (payload) => {
  const hosts = Array.isArray(payload?.hosts) ? payload.hosts.filter(isRecord) : [];
  const candidates = hosts.flatMap((host) =>
    uniqueStrings(Array.isArray(host.subnets) ? host.subnets : []).map((subnet) => ({
      value: subnet,
      filterType: "HostFilter",
      hostName: typeof host.name === "string" ? host.name : null,
      hostType: typeof host.type === "string" ? host.type : null,
      deviceName: typeof host.deviceName === "string" ? host.deviceName : null,
    })),
  );

  if (hosts.length === 0 || candidates.length === 0) {
    return {
      status: "unresolved",
      matchCount: hosts.length,
      candidateCount: candidates.length,
      reason: "Forward host inventory returned no usable host subnet.",
    };
  }

  if (candidates.length > 1) {
    return {
      status: "ambiguous",
      matchCount: hosts.length,
      candidateCount: candidates.length,
      reason:
        "Forward host inventory returned multiple host/subnet candidates; operator review is required.",
    };
  }

  return {
    status: "resolved",
    matchCount: hosts.length,
    candidateCount: candidates.length,
    reason: "Forward resolved the identifier to one host subnet.",
    ...candidates[0],
  };
};

export const resolveEndpoint = async ({
  role,
  value,
  filterType,
  api,
  networkId,
  snapshotId,
  execute,
}) => {
  const endpointValue = String(value || "").trim();
  const endpointFilterType = filterType || "HostFilter";
  if (!endpointValue) {
    return {
      role,
      input: endpointValue,
      inputFilterType: endpointFilterType,
      status: "unresolved",
      reason: "Dependency endpoint is empty.",
      selectedValue: null,
      selectedFilterType: endpointFilterType,
      matchCount: 0,
      candidateCount: 0,
    };
  }

  if (isExplicitResolvedFilter(endpointFilterType, endpointValue)) {
    return {
      role,
      input: endpointValue,
      inputFilterType: endpointFilterType,
      status: "resolved",
      reason: "Dependency endpoint already has an explicit Forward filter type.",
      selectedValue: endpointValue,
      selectedFilterType: endpointFilterType,
      matchCount: null,
      candidateCount: 1,
    };
  }

  if (isIpOrSubnet(endpointValue)) {
    return {
      role,
      input: endpointValue,
      inputFilterType: endpointFilterType,
      status: "resolved",
      reason: "Dependency endpoint is already an IP address or subnet.",
      selectedValue: endpointValue,
      selectedFilterType: endpointFilterType,
      matchCount: null,
      candidateCount: 1,
    };
  }

  if (endpointFilterType !== "HostFilter") {
    return {
      role,
      input: endpointValue,
      inputFilterType: endpointFilterType,
      status: "review",
      reason: `Unsupported live resolution for ${endpointFilterType}; keep operator review.`,
      selectedValue: endpointValue,
      selectedFilterType: endpointFilterType,
      matchCount: null,
      candidateCount: null,
    };
  }

  if (!execute) {
    return {
      role,
      input: endpointValue,
      inputFilterType: endpointFilterType,
      status: "planned",
      reason: `Would call ${FORWARD_HOSTS_ENDPOINT}.`,
      selectedValue: null,
      selectedFilterType: endpointFilterType,
      matchCount: null,
      candidateCount: null,
    };
  }

  const result = selectResolvedHostCandidate(
    await api("GET", hostLookupPath({ networkId, snapshotId, hostSpecifier: endpointValue })),
  );
  return {
    role,
    input: endpointValue,
    inputFilterType: endpointFilterType,
    selectedFilterType: result.filterType || endpointFilterType,
    selectedValue: result.value || null,
    ...result,
  };
};

const mappingStateFromResolutions = (source, destination) => {
  if (source.status === "unresolved" || destination.status === "unresolved") {
    return "needs-map";
  }
  if (source.status === "resolved" && destination.status === "resolved") {
    return "ready";
  }
  return "review";
};

const applyEndpointResolution = (dependency, role, resolution) => {
  const valueField = role === "source" ? "sourceResolvedValue" : "destinationResolvedValue";
  const typeField = role === "source" ? "sourceResolvedFilterType" : "destinationResolvedFilterType";
  const statusField = role === "source" ? "sourceResolutionStatus" : "destinationResolutionStatus";
  const next = {
    ...dependency,
    [statusField]: resolution.status,
  };
  if (resolution.status === "resolved" && resolution.selectedValue) {
    next[valueField] = resolution.selectedValue;
    next[typeField] = resolution.selectedFilterType || "HostFilter";
  } else {
    delete next[valueField];
    delete next[typeField];
  }
  return next;
};

export const resolveDependencyCandidates = async ({
  dependencies,
  forwardBaseUrl,
  forwardNetworkId,
  snapshotId,
  authorization = "",
  execute = false,
  maxRetries = DEFAULT_MAX_RETRIES,
  fetchImpl = fetch,
}) => {
  if (!Array.isArray(dependencies)) {
    throw new Error("dependencies must be a JSON array.");
  }

  const api =
    execute
      ? makeForwardReadOnlyClient({
          forwardBaseUrl,
          authorization,
          maxRetries,
          fetchImpl,
        })
      : null;
  const effectiveSnapshotId =
    execute && !snapshotId
      ? await latestProcessedSnapshotId({ api, networkId: forwardNetworkId })
      : snapshotId || null;

  const rows = [];
  const resolvedDependencies = [];

  for (const dependency of dependencies) {
    const source = await resolveEndpoint({
      role: "source",
      value: dependency.source,
      filterType: dependency.sourceFilterType,
      api,
      networkId: forwardNetworkId,
      snapshotId: effectiveSnapshotId,
      execute,
    });
    const destination = await resolveEndpoint({
      role: "destination",
      value: dependency.destination,
      filterType: dependency.destinationFilterType,
      api,
      networkId: forwardNetworkId,
      snapshotId: effectiveSnapshotId,
      execute,
    });
    const mappingState = mappingStateFromResolutions(source, destination);
    const resolvedDependency = {
      ...applyEndpointResolution(applyEndpointResolution(dependency, "source", source), "destination", destination),
      mappingState,
    };
    resolvedDependencies.push(resolvedDependency);
    rows.push({
      id: dependency.id || null,
      mappingState,
      source: {
        status: source.status,
        matchCount: source.matchCount,
        candidateCount: source.candidateCount,
        reason: source.reason,
        usedResolvedValue: Boolean(resolvedDependency.sourceResolvedValue),
      },
      destination: {
        status: destination.status,
        matchCount: destination.matchCount,
        candidateCount: destination.candidateCount,
        reason: destination.reason,
        usedResolvedValue: Boolean(resolvedDependency.destinationResolvedValue),
      },
    });
  }

  const count = (predicate) => rows.filter(predicate).length;
  const report = {
    schemaVersion: "forward-dynatrace-host-resolution/v1",
    generatedAt: new Date().toISOString(),
    mode: execute ? "execute" : "plan",
    source: "forward-host-inventory",
    endpoint: FORWARD_HOSTS_ENDPOINT,
    snapshotEndpoint: FORWARD_SNAPSHOT_ENDPOINT,
    target: {
      networkId: forwardNetworkId || null,
      snapshotId: effectiveSnapshotId,
    },
    counts: {
      total: rows.length,
      ready: count((row) => row.mappingState === "ready"),
      review: count((row) => row.mappingState === "review"),
      needsMap: count((row) => row.mappingState === "needs-map"),
      sourceResolved: count((row) => row.source.status === "resolved"),
      destinationResolved: count((row) => row.destination.status === "resolved"),
      ambiguous: count(
        (row) => row.source.status === "ambiguous" || row.destination.status === "ambiguous",
      ),
      unresolved: count(
        (row) => row.source.status === "unresolved" || row.destination.status === "unresolved",
      ),
    },
    rows,
  };

  return { dependencies: resolvedDependencies, report };
};

const main = async () => {
  const args = parseArgs(process.argv.slice(2));
  if (args.help) {
    process.stdout.write(usage);
    return;
  }

  const dependencies = await readJson(required(args, "dependencies"));
  const execute = Boolean(args.execute);
  const forwardBaseUrl = args["forward-base-url"] || process.env.FORWARD_BASE_URL;
  const forwardNetworkId = args["forward-network-id"] || process.env.FORWARD_NETWORK_ID;
  const snapshotId = args["snapshot-id"] || process.env.FORWARD_SNAPSHOT_ID;
  if (execute) {
    if (!forwardBaseUrl) {
      throw new Error("Missing --forward-base-url or FORWARD_BASE_URL for --execute.");
    }
    if (!forwardNetworkId) {
      throw new Error("Missing --forward-network-id or FORWARD_NETWORK_ID for --execute.");
    }
  }

  const result = await resolveDependencyCandidates({
    dependencies,
    forwardBaseUrl,
    forwardNetworkId,
    snapshotId,
    authorization: await runtimeAuthorization(args),
    execute,
    maxRetries: parsePositiveInteger(args["max-retries"], DEFAULT_MAX_RETRIES, "--max-retries"),
  });

  if (args.output) {
    await writeJson(args.output, result.dependencies);
  }
  if (args.report) {
    await writeJson(args.report, result.report);
  }
  process.stdout.write(`${JSON.stringify(result.report, null, 2)}\n`);
};

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((error) => {
    process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
    process.stderr.write(usage);
    process.exitCode = 1;
  });
}
