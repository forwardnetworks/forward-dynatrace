const ipv4Octet = "(?:25[0-5]|2[0-4]\\d|1\\d\\d|[1-9]?\\d)";
const ipv4Pattern = new RegExp(`^${ipv4Octet}(?:\\.${ipv4Octet}){3}(?:/(?:3[0-2]|[12]?\\d))?$`);
const ipv6Pattern = /^(?:[A-Fa-f0-9:]+:+[A-Fa-f0-9:]*)(?:\/(?:12[0-8]|1[01]\d|\d?\d))?$/u;

export const isIpOrSubnet = (value) => {
  const normalized = String(value || "").trim();
  return ipv4Pattern.test(normalized) || ipv6Pattern.test(normalized);
};

const uniqueStrings = (values) => [
  ...new Set(values.map((value) => String(value).trim()).filter(Boolean)),
];

const selectResolvedHostCandidate = (payload) => {
  const hosts = Array.isArray(payload?.hosts)
    ? payload.hosts.filter((host) => host && typeof host === "object" && !Array.isArray(host))
    : [];
  const candidates = hosts.flatMap((host) =>
    uniqueStrings(Array.isArray(host.subnets) ? host.subnets : []).map((subnet) => ({
      value: subnet,
      filterType: "HostFilter",
    })),
  );
  if (candidates.length === 0) {
    return { status: "unresolved", matchCount: hosts.length, candidateCount: 0 };
  }
  if (candidates.length > 1) {
    return { status: "ambiguous", matchCount: hosts.length, candidateCount: candidates.length };
  }
  return {
    status: "resolved",
    matchCount: hosts.length,
    candidateCount: 1,
    selectedValue: candidates[0].value,
    selectedFilterType: candidates[0].filterType,
  };
};

const endpointInput = (dependency, role) => ({
  rawValue: String(role === "source" ? dependency.source || "" : dependency.destination || "").trim(),
  rawFilterType:
    (role === "source" ? dependency.sourceFilterType : dependency.destinationFilterType) ||
    "HostFilter",
  resolvedValue: String(
    role === "source"
      ? dependency.sourceResolvedValue || ""
      : dependency.destinationResolvedValue || "",
  ).trim(),
  resolvedFilterType:
    role === "source"
      ? dependency.sourceResolvedFilterType
      : dependency.destinationResolvedFilterType,
});

const resolveEndpoint = async ({ dependency, role, api, networkId, snapshotId, hostCache }) => {
  const input = endpointInput(dependency, role);
  const value = input.resolvedValue || input.rawValue;
  const filterType = input.resolvedFilterType || input.rawFilterType;
  if (!value) return { status: "unresolved", matchCount: 0, candidateCount: 0 };
  if (filterType === "DeviceFilter") {
    return {
      status: "resolved",
      selectedValue: value,
      selectedFilterType: filterType,
      matchCount: null,
      candidateCount: 1,
    };
  }
  if (isIpOrSubnet(value)) {
    return {
      status: "resolved",
      selectedValue: value,
      selectedFilterType: filterType === "HostFilter" ? "SubnetLocationFilter" : filterType,
      matchCount: null,
      candidateCount: 1,
    };
  }
  if (filterType !== "HostFilter") {
    return { status: "review", matchCount: null, candidateCount: null };
  }
  const cacheKey = value.toLowerCase();
  if (!hostCache.has(cacheKey)) {
    const params = new URLSearchParams({ snapshotId });
    hostCache.set(
      cacheKey,
      api(
        "GET",
        `/networks/${encodeURIComponent(networkId)}/hosts/${encodeURIComponent(value)}?${params}`,
      ).then(selectResolvedHostCandidate),
    );
  }
  return hostCache.get(cacheKey);
};

const mapLimit = async (values, limit, mapper) => {
  const results = new Array(values.length);
  let cursor = 0;
  const worker = async () => {
    while (cursor < values.length) {
      const index = cursor;
      cursor += 1;
      results[index] = await mapper(values[index], index);
    }
  };
  await Promise.all(Array.from({ length: Math.min(limit, values.length) }, worker));
  return results;
};

const applyResolution = (dependency, role, resolution) => {
  const valueField = role === "source" ? "sourceResolvedValue" : "destinationResolvedValue";
  const typeField =
    role === "source" ? "sourceResolvedFilterType" : "destinationResolvedFilterType";
  const statusField = role === "source" ? "sourceResolutionStatus" : "destinationResolutionStatus";
  const next = { ...dependency, [statusField]: resolution.status };
  if (resolution.status === "resolved" && resolution.selectedValue) {
    next[valueField] = resolution.selectedValue;
    next[typeField] = resolution.selectedFilterType || "HostFilter";
  } else {
    delete next[valueField];
    delete next[typeField];
  }
  return next;
};

const mappingState = (dependency, source, destination) => {
  if (source.status === "unresolved" || destination.status === "unresolved") return "needs-map";
  if (source.status !== "resolved" || destination.status !== "resolved") return "review";
  if (dependency.mappingState === "needs-map") return "needs-map";
  if (dependency.mappingState === "review" && Number(dependency.confidence) < 90) return "review";
  return "ready";
};

export const resolveDependencyEvidence = async ({
  dependencies,
  api,
  networkId,
  snapshotId,
  concurrency = 20,
}) => {
  if (!Array.isArray(dependencies)) throw new Error("dependencies must be an array.");
  const hostCache = new Map();
  const rows = await mapLimit(dependencies, concurrency, async (dependency) => {
    const [source, destination] = await Promise.all([
      resolveEndpoint({ dependency, role: "source", api, networkId, snapshotId, hostCache }),
      resolveEndpoint({ dependency, role: "destination", api, networkId, snapshotId, hostCache }),
    ]);
    const state = mappingState(dependency, source, destination);
    return {
      dependency: {
        ...applyResolution(applyResolution(dependency, "source", source), "destination", destination),
        mappingState: state,
      },
      evidence: {
        id: dependency.id || null,
        mappingState: state,
        sourceStatus: source.status,
        destinationStatus: destination.status,
      },
    };
  });
  const evidenceRows = rows.map(({ evidence }) => evidence);
  const count = (predicate) => evidenceRows.filter(predicate).length;
  return {
    dependencies: rows.map(({ dependency }) => dependency),
    report: {
      schemaVersion: "forward-dynatrace-host-resolution/v1",
      target: { networkId, snapshotId },
      counts: {
        total: evidenceRows.length,
        ready: count((row) => row.mappingState === "ready"),
        review: count((row) => row.mappingState === "review"),
        needsMap: count((row) => row.mappingState === "needs-map"),
        ambiguous: count(
          (row) => row.sourceStatus === "ambiguous" || row.destinationStatus === "ambiguous",
        ),
        unresolved: count(
          (row) => row.sourceStatus === "unresolved" || row.destinationStatus === "unresolved",
        ),
      },
      rows: evidenceRows,
    },
  };
};

const protocolNumber = (protocol) => {
  const normalized = String(protocol || "").trim().toLowerCase();
  if (normalized === "udp") return 17;
  if (normalized === "icmp") return 1;
  return 6;
};

const buildPathQuery = (dependency) => {
  const srcIp = String(dependency.sourceResolvedValue || dependency.source || "").trim();
  const dstIp = String(dependency.destinationResolvedValue || dependency.destination || "").trim();
  if (!isIpOrSubnet(dstIp)) return null;
  const query = { dstIp, ipProto: protocolNumber(dependency.protocol) };
  if (isIpOrSubnet(srcIp)) query.srcIp = srcIp;
  else if (dependency.sourceResolvedFilterType === "DeviceFilter" || dependency.sourceFilterType === "DeviceFilter") {
    query.from = srcIp;
  } else return null;
  if (dependency.port && query.ipProto !== 1) query.dstPort = String(dependency.port);
  return query;
};

const pathStatus = (result) => {
  if (!result || result.error === true || result.errorMessage) return "failed";
  if (result.timedOut || Object.keys(result.unrecognizedValues || {}).length > 0) return "ambiguous";
  const paths = Array.isArray(result.info?.paths)
    ? result.info.paths
    : Array.isArray(result.paths)
      ? result.paths
      : [];
  if (paths.length === 0) return "blocked";
  return paths.some(
    (path) => path.forwardingOutcome === "DELIVERED" && path.securityOutcome !== "DENIED",
  )
    ? "reachable"
    : "blocked";
};

const chunks = (values, size) => {
  const output = [];
  for (let index = 0; index < values.length; index += size) {
    output.push(values.slice(index, index + size));
  }
  return output;
};

export const evaluatePathEvidence = async ({
  dependencies,
  api,
  networkId,
  snapshotId,
  batchSize = 250,
}) => {
  const planned = dependencies.map((dependency) => ({ dependency, query: buildPathQuery(dependency) }));
  const queryable = planned.filter(({ query }) => query);
  const responses = [];
  for (const batch of chunks(queryable, batchSize)) {
    const params = new URLSearchParams({ snapshotId });
    const result = await api(
      "POST",
      `/networks/${encodeURIComponent(networkId)}/paths-bulk?${params}`,
      {
        queries: batch.map(({ query }) => query),
        intent: "PREFER_DELIVERED",
        maxCandidates: 5000,
        maxResults: 1,
        maxReturnPathResults: 0,
        maxSeconds: 30,
        maxOverallSeconds: 30,
        includeTags: false,
        includeNetworkFunctions: false,
      },
    );
    if (!Array.isArray(result) || result.length !== batch.length) {
      throw new Error("Forward paths-bulk response count did not match the request.");
    }
    responses.push(...result);
  }
  let responseIndex = 0;
  const rows = planned.map(({ dependency, query }) => ({
    id: dependency.id || null,
    status: query ? pathStatus(responses[responseIndex++]) : "unmapped",
  }));
  const count = (status) => rows.filter((row) => row.status === status).length;
  const counts = {
    total: rows.length,
    queryable: rows.length - count("unmapped"),
    reachable: count("reachable"),
    blocked: count("blocked"),
    ambiguous: count("ambiguous"),
    unmapped: count("unmapped"),
    failed: count("failed"),
  };
  return {
    schemaVersion: "forward-dynatrace-path-evidence/v1",
    target: { networkId, snapshotId },
    modeledReachabilityAssessment:
      counts.blocked > 0
        ? "consistent-with-network-policy-block"
        : counts.total > 0 && counts.reachable === counts.total
          ? "no-modeled-policy-block"
          : "inconclusive",
    counts,
    rows,
  };
};
