#!/usr/bin/env node

import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { pathToFileURL } from "node:url";

import { loadForwardAuthorization } from "../lib/forward-authorization.mjs";

import {
  isIpOrSubnet,
  latestProcessedSnapshotId,
  makeForwardReadOnlyClient,
  normalizeBaseUrl,
  resolveDependencyCandidates,
} from "./forward-resolve-hosts.mjs";

const DEFAULT_MAX_RETRIES = 2;
const DEFAULT_INTENT = "PREFER_DELIVERED";
const DEFAULT_MAX_CANDIDATES = 5000;
const DEFAULT_MAX_RESULTS = 1;
const DEFAULT_MAX_RETURN_PATH_RESULTS = 0;
const DEFAULT_MAX_SECONDS = 30;
const PATH_SEARCH_ENDPOINT = "POST /api/networks/{networkId}/paths-bulk";

const usage = `
Forward read-only path evidence

Usage:
  npm run forward:path-evidence -- \\
    --dependencies resolved-dependencies.json \\
    --forward-base-url https://forward.example.com \\
    --forward-network-id <network-id> \\
    --snapshot-id <snapshot-id> \\
    --authorization-file /secure/path/read-only-forward-auth-header \\
    --execute \\
    --output forward-path-evidence.json

Options:
  --dependencies path          Normalized or host-resolved Dynatrace dependency candidates JSON.
  --forward-base-url url       Forward base URL.
  --forward-network-id id      Forward network ID.
  --snapshot-id id             Optional snapshot ID.
  --authorization-file path    File containing the full read-only Authorization header value.
  --resolve-hosts              Run Forward host resolution first when --execute is supplied.
  --execute                    Contact Forward. Omit for plan-only evidence.
  --intent value               Path search intent. Defaults to PREFER_DELIVERED.
  --max-candidates n           Defaults to 5000.
  --max-results n              Defaults to 1.
  --max-return-path-results n  Defaults to 0.
  --max-seconds n              Defaults to 30.
  --output path                Write aggregate path evidence JSON.

Authorization is accepted only from --authorization-file. This command is read-only.
`;

const parseArgs = (argv) => {
  const args = {};
  for (let index = 0; index < argv.length; index += 1) {
    const value = argv[index];
    if (value === "--help") {
      args.help = true;
      continue;
    }
    if (value === "--execute" || value === "--resolve-hosts") {
      args[value.slice(2)] = true;
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

const parsePositiveInteger = (value, fallback, label) => {
  if (value === undefined) {
    return fallback;
  }
  const parsed = Number.parseInt(value, 10);
  if (!Number.isInteger(parsed) || parsed <= 0) {
    throw new Error(`${label} must be a positive integer.`);
  }
  return parsed;
};

const parseNonNegativeInteger = (value, fallback, label) => {
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

const writeJson = async (filePath, value) => {
  const outputPath = path.resolve(filePath);
  await mkdir(path.dirname(outputPath), { recursive: true });
  await writeFile(outputPath, `${JSON.stringify(value, null, 2)}\n`);
};

const protocolNumber = (protocol) => {
  const normalized = String(protocol || "").trim().toLowerCase();
  if (normalized === "udp") {
    return 17;
  }
  if (normalized === "icmp") {
    return 1;
  }
  return 6;
};

const pathEndpointValue = (dependency, role) => {
  const resolvedValue =
    role === "source" ? dependency.sourceResolvedValue : dependency.destinationResolvedValue;
  const rawValue = role === "source" ? dependency.source : dependency.destination;
  const value = String(resolvedValue || rawValue || "").trim();
  return isIpOrSubnet(value) ? value : "";
};

export const buildPathQuery = (dependency) => {
  const dstIp = pathEndpointValue(dependency, "destination");
  const srcIp = pathEndpointValue(dependency, "source");
  const query = {};
  if (!dstIp) {
    return { query: null, reason: "Destination is not a Forward-resolved IP or subnet." };
  }
  query.dstIp = dstIp;
  if (srcIp) {
    query.srcIp = srcIp;
  } else if (dependency.sourceFilterType === "DeviceFilter" && dependency.source) {
    query.from = dependency.source;
  } else {
    return { query: null, reason: "Source is not a Forward-resolved IP/subnet or DeviceFilter." };
  }
  query.ipProto = protocolNumber(dependency.protocol);
  if (dependency.port && query.ipProto !== 1) {
    query.dstPort = String(dependency.port);
  }
  return { query, reason: "Queryable." };
};

const pathSearchPath = ({ networkId, snapshotId }) => {
  const params = new URLSearchParams();
  if (snapshotId) {
    params.set("snapshotId", snapshotId);
  }
  const suffix = params.toString() ? `?${params}` : "";
  return `/api/networks/${encodeURIComponent(networkId)}/paths-bulk${suffix}`;
};

export const classifyPathSearchResult = (result) => {
  if (!result || result.error === true || result.errorMessage) {
    return "failed";
  }
  if (result.timedOut || Object.keys(result.unrecognizedValues || {}).length > 0) {
    return "ambiguous";
  }
  const paths = Array.isArray(result.info?.paths)
    ? result.info.paths
    : Array.isArray(result.paths)
      ? result.paths
      : [];
  if (paths.length === 0) {
    return "blocked";
  }
  return paths.some(
    (pathResult) =>
      pathResult.forwardingOutcome === "DELIVERED" &&
      pathResult.securityOutcome !== "DENIED",
  )
    ? "reachable"
    : "blocked";
};

const uniqueStrings = (values) => [
  ...new Set(values.filter((value) => typeof value === "string" && value.trim())),
];

export const summarizePathSearchResult = (result) => {
  const paths = Array.isArray(result?.info?.paths)
    ? result.info.paths
    : Array.isArray(result?.paths)
      ? result.paths
      : [];
  return {
    queryUrl: typeof result?.queryUrl === "string" ? result.queryUrl : null,
    sourceLocationType:
      typeof result?.srcIpLocationType === "string" ? result.srcIpLocationType : null,
    destinationLocationType:
      typeof result?.dstIpLocationType === "string" ? result.dstIpLocationType : null,
    pathCount: paths.length,
    forwardingOutcomes: uniqueStrings(paths.map((pathResult) => pathResult?.forwardingOutcome)),
    securityOutcomes: uniqueStrings(paths.map((pathResult) => pathResult?.securityOutcome)),
    maxHopCount: paths.reduce(
      (maximum, pathResult) =>
        Math.max(maximum, Array.isArray(pathResult?.hops) ? pathResult.hops.length : 0),
      0,
    ),
  };
};

export const modeledReachabilityAssessment = (rows) => {
  if (rows.some((row) => row.status === "blocked")) {
    return "consistent-with-network-policy-block";
  }
  if (rows.length > 0 && rows.every((row) => row.status === "reachable")) {
    return "no-modeled-policy-block";
  }
  return "inconclusive";
};

const countStatuses = (rows) => ({
  total: rows.length,
  queryable: rows.filter((row) => row.status !== "unmapped").length,
  reachable: rows.filter((row) => row.status === "reachable").length,
  blocked: rows.filter((row) => row.status === "blocked").length,
  ambiguous: rows.filter((row) => row.status === "ambiguous").length,
  unmapped: rows.filter((row) => row.status === "unmapped").length,
  failed: rows.filter((row) => row.status === "failed").length,
});

export const buildPathEvidence = async ({
  dependencies,
  forwardBaseUrl,
  forwardNetworkId,
  snapshotId = null,
  authorization = "",
  execute = false,
  resolveHosts = false,
  maxRetries = DEFAULT_MAX_RETRIES,
  intent = DEFAULT_INTENT,
  maxCandidates = DEFAULT_MAX_CANDIDATES,
  maxResults = DEFAULT_MAX_RESULTS,
  maxReturnPathResults = DEFAULT_MAX_RETURN_PATH_RESULTS,
  maxSeconds = DEFAULT_MAX_SECONDS,
  fetchImpl = fetch,
}) => {
  let effectiveDependencies = dependencies;
  let hostResolution = null;
  let effectiveSnapshotId = snapshotId || null;
  const api = execute
    ? makeForwardReadOnlyClient({
        forwardBaseUrl: normalizeBaseUrl(forwardBaseUrl),
        authorization,
        maxRetries,
        fetchImpl,
      })
    : null;

  if (execute && resolveHosts) {
    hostResolution = await resolveDependencyCandidates({
      dependencies,
      forwardBaseUrl,
      forwardNetworkId,
      snapshotId: effectiveSnapshotId,
      authorization,
      execute: true,
      maxRetries,
      fetchImpl,
    });
    effectiveDependencies = hostResolution.dependencies;
    effectiveSnapshotId = hostResolution.report.target.snapshotId;
  }
  if (execute && !effectiveSnapshotId) {
    effectiveSnapshotId = await latestProcessedSnapshotId({
      api,
      networkId: forwardNetworkId,
    });
  }

  const planned = effectiveDependencies.map((dependency) => {
    const { query, reason } = buildPathQuery(dependency);
    return {
      dependency,
      query,
      reason,
    };
  });
  const queryable = planned.filter((item) => item.query);
  const request = {
    queries: queryable.map((item) => item.query),
    intent,
    maxCandidates,
    maxResults,
    maxReturnPathResults,
    maxSeconds,
    maxOverallSeconds: maxSeconds,
    includeTags: false,
    includeNetworkFunctions: false,
  };

  let responses = [];
  if (execute && request.queries.length > 0) {
    responses = await api(
      "POST",
      pathSearchPath({ networkId: forwardNetworkId, snapshotId: effectiveSnapshotId }),
      { body: request },
    );
    if (!Array.isArray(responses)) {
      throw new Error("Forward paths-bulk response must be an array.");
    }
  }

  let responseIndex = 0;
  const rows = planned.map((item) => {
    if (!item.query) {
      return {
        id: item.dependency.id || null,
        status: "unmapped",
        reason: item.reason,
        ...summarizePathSearchResult(null),
      };
    }
    const response = execute ? responses[responseIndex++] : null;
    const status = execute ? classifyPathSearchResult(response) : "planned";
    return {
      id: item.dependency.id || null,
      status,
      reason: execute ? "Forward path search evaluated this dependency." : "Path query planned.",
      ...summarizePathSearchResult(response),
    };
  });

  return {
    schemaVersion: "forward-dynatrace-path-evidence/v1",
    generatedAt: new Date().toISOString(),
    mode: execute ? "execute" : "plan",
    status:
      rows.some((row) => row.status === "failed")
        ? "failed"
        : rows.some((row) => row.status === "unmapped" || row.status === "ambiguous")
          ? "partial"
          : "completed",
    source: "forward-path-search-bulk",
    endpoint: PATH_SEARCH_ENDPOINT,
    modeledReachabilityAssessment: modeledReachabilityAssessment(rows),
    hostResolution: hostResolution
      ? {
          status: "completed",
          counts: hostResolution.report.counts,
        }
      : null,
    target: {
      networkId: forwardNetworkId || null,
      snapshotId: effectiveSnapshotId || null,
    },
    request: {
      intent,
      maxCandidates,
      maxResults,
      maxReturnPathResults,
      maxSeconds,
      queryCount: request.queries.length,
    },
    counts: countStatuses(rows),
    rows,
  };
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
  const snapshotId = args["snapshot-id"] || process.env.FORWARD_SNAPSHOT_ID || null;
  if (execute) {
    if (!forwardBaseUrl) {
      throw new Error("Missing --forward-base-url or FORWARD_BASE_URL for --execute.");
    }
    if (!forwardNetworkId) {
      throw new Error("Missing --forward-network-id or FORWARD_NETWORK_ID for --execute.");
    }
    if (!args["authorization-file"]) {
      throw new Error("--authorization-file is required for --execute.");
    }
  }

  const evidence = await buildPathEvidence({
    dependencies,
    forwardBaseUrl,
    forwardNetworkId,
    snapshotId,
    authorization: execute
      ? await loadForwardAuthorization(args["authorization-file"])
      : "",
    execute,
    resolveHosts: Boolean(args["resolve-hosts"]),
    maxRetries: parsePositiveInteger(args["max-retries"], DEFAULT_MAX_RETRIES, "--max-retries"),
    intent: args.intent || DEFAULT_INTENT,
    maxCandidates: parsePositiveInteger(args["max-candidates"], DEFAULT_MAX_CANDIDATES, "--max-candidates"),
    maxResults: parsePositiveInteger(args["max-results"], DEFAULT_MAX_RESULTS, "--max-results"),
    maxReturnPathResults: parseNonNegativeInteger(
      args["max-return-path-results"],
      DEFAULT_MAX_RETURN_PATH_RESULTS,
      "--max-return-path-results",
    ),
    maxSeconds: parsePositiveInteger(args["max-seconds"], DEFAULT_MAX_SECONDS, "--max-seconds"),
  });

  if (args.output) {
    await writeJson(args.output, evidence);
  }
  process.stdout.write(`${JSON.stringify(evidence, null, 2)}\n`);
};

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((error) => {
    process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
    process.stderr.write(usage);
    process.exitCode = 1;
  });
}
