const ipv4Octet = "(?:25[0-5]|2[0-4]\\d|1\\d\\d|[1-9]?\\d)";
const ipv4Pattern = new RegExp(`^${ipv4Octet}(?:\\.${ipv4Octet}){3}(?:/(?:3[0-2]|[12]?\\d))?$`);
const ipv6Pattern = /^(?:[A-Fa-f0-9:]+:+[A-Fa-f0-9:]*)(?:\/(?:12[0-8]|1[01]\d|\d?\d))?$/u;

type EndpointRole = "source" | "destination";
type ResolutionStatus = "resolved" | "unresolved" | "ambiguous" | "review";
type MappingState = DependencyCandidate["mappingState"];
type PathEvidenceStatus =
  | "reachable"
  | "blocked"
  | "ambiguous"
  | "unmapped"
  | "failed";

interface EndpointResolution {
  status: ResolutionStatus;
  selectedValue?: string;
  selectedFilterType?: ForwardLocationFilterType;
  matchCount: number | null;
  candidateCount: number | null;
}

interface PathQuery {
  dstIp: string;
  ipProto: number;
  srcIp?: string;
  from?: string;
  dstPort?: string;
}

const isRecord = (value: unknown): value is Record<string, unknown> =>
  Boolean(value) && typeof value === "object" && !Array.isArray(value);

const primitiveText = (value: unknown): string =>
  typeof value === "string" ||
  typeof value === "number" ||
  typeof value === "boolean"
    ? String(value)
    : "";

export const isIpOrSubnet = (value: unknown): boolean => {
  const normalized = primitiveText(value).trim();
  return ipv4Pattern.test(normalized) || ipv6Pattern.test(normalized);
};

const uniqueStrings = (values: unknown[]): string[] => [
  ...new Set(values.map((value) => String(value).trim()).filter(Boolean)),
];

const selectResolvedHostCandidate = (payload: unknown): EndpointResolution => {
  const hostsValue = isRecord(payload) ? payload.hosts : undefined;
  const hosts = Array.isArray(hostsValue)
    ? hostsValue.filter(isRecord)
    : [];
  const candidates = hosts.flatMap((host) =>
    uniqueStrings(Array.isArray(host.subnets) ? host.subnets : []).map((subnet) => ({
      value: subnet,
      filterType: "HostFilter" as const,
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

const endpointInput = (
  dependency: DependencyCandidate,
  role: EndpointRole,
): {
  rawValue: string;
  rawFilterType: ForwardLocationFilterType;
  resolvedValue: string;
  resolvedFilterType: ForwardLocationFilterType | undefined;
} => ({
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

const resolveEndpoint = async ({
  dependency,
  role,
  api,
  networkId,
  snapshotId,
  hostCache,
}: {
  dependency: DependencyCandidate;
  role: EndpointRole;
  api: ForwardApiClient;
  networkId: string;
  snapshotId: string;
  hostCache: Map<string, Promise<EndpointResolution>>;
}): Promise<EndpointResolution> => {
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
  const cached = hostCache.get(cacheKey);
  if (!cached) {
    throw new Error("Forward host resolution cache entry was not created.");
  }
  return cached;
};

const mapLimit = async <Input, Output>(
  values: Input[],
  limit: number,
  mapper: (value: Input, index: number) => Promise<Output>,
): Promise<Output[]> => {
  const results: Output[] = new Array<Output>(values.length);
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

const applyResolution = (
  dependency: DependencyCandidate,
  role: EndpointRole,
  resolution: EndpointResolution,
): DependencyCandidate => {
  const next = { ...dependency };
  if (role === "source") {
    next.sourceResolutionStatus = resolution.status;
    if (resolution.status === "resolved" && resolution.selectedValue) {
      next.sourceResolvedValue = resolution.selectedValue;
      next.sourceResolvedFilterType =
        resolution.selectedFilterType || "HostFilter";
    } else {
      delete next.sourceResolvedValue;
      delete next.sourceResolvedFilterType;
    }
  } else {
    next.destinationResolutionStatus = resolution.status;
    if (resolution.status === "resolved" && resolution.selectedValue) {
      next.destinationResolvedValue = resolution.selectedValue;
      next.destinationResolvedFilterType =
        resolution.selectedFilterType || "HostFilter";
    } else {
      delete next.destinationResolvedValue;
      delete next.destinationResolvedFilterType;
    }
  }
  return next;
};

const mappingState = (
  dependency: DependencyCandidate,
  source: EndpointResolution,
  destination: EndpointResolution,
): MappingState => {
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
}: {
  dependencies: DependencyCandidate[];
  api: ForwardApiClient;
  networkId: string;
  snapshotId: string;
  concurrency?: number;
}) => {
  if (!Array.isArray(dependencies)) throw new Error("dependencies must be an array.");
  const hostCache = new Map<string, Promise<EndpointResolution>>();
  const rows = await mapLimit(dependencies, concurrency, async (dependency) => {
    const [source, destination] = await Promise.all([
      resolveEndpoint({ dependency, role: "source", api, networkId, snapshotId, hostCache }),
      resolveEndpoint({ dependency, role: "destination", api, networkId, snapshotId, hostCache }),
    ]);
    const state = mappingState(dependency, source, destination);
    const resolvedDependency = applyResolution(
      applyResolution(dependency, "source", source),
      "destination",
      destination,
    );
    const dependencyWithState: DependencyCandidate =
      dependency.mappingState === "needs-map" || state === "needs-map"
        ? { ...resolvedDependency, mappingState: "needs-map" }
        : {
            ...resolvedDependency,
            serviceEntityId: dependency.serviceEntityId,
            source: dependency.source,
            destination: dependency.destination,
            mappingState: state,
          };
    return {
      dependency: dependencyWithState,
      evidence: {
        id: dependency.id || null,
        mappingState: state,
        sourceStatus: source.status,
        destinationStatus: destination.status,
      },
    };
  });
  const evidenceRows = rows.map(({ evidence }) => evidence);
  const count = (
    predicate: (row: (typeof evidenceRows)[number]) => boolean,
  ): number => evidenceRows.filter(predicate).length;
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

const protocolNumber = (protocol: unknown): number => {
  const normalized = primitiveText(protocol).trim().toLowerCase();
  if (normalized === "udp") return 17;
  if (normalized === "icmp") return 1;
  return 6;
};

const buildPathQuery = (
  dependency: DependencyCandidate,
): PathQuery | null => {
  const srcIp = String(dependency.sourceResolvedValue || dependency.source || "").trim();
  const dstIp = String(dependency.destinationResolvedValue || dependency.destination || "").trim();
  if (!isIpOrSubnet(dstIp)) return null;
  const ipProto = protocolNumber(dependency.protocol);
  const source =
    isIpOrSubnet(srcIp)
      ? { srcIp }
      : dependency.sourceResolvedFilterType === "DeviceFilter" ||
          dependency.sourceFilterType === "DeviceFilter"
        ? { from: srcIp }
        : null;
  if (!source) return null;
  return {
    dstIp,
    ipProto,
    ...source,
    ...(dependency.port && ipProto !== 1
      ? { dstPort: String(dependency.port) }
      : {}),
  };
};

const pathStatus = (result: unknown): PathEvidenceStatus => {
  if (
    !isRecord(result) ||
    result.error === true ||
    Boolean(result.errorMessage)
  ) {
    return "failed";
  }
  const unrecognizedValues = isRecord(result.unrecognizedValues)
    ? result.unrecognizedValues
    : {};
  if (result.timedOut || Object.keys(unrecognizedValues).length > 0) {
    return "ambiguous";
  }
  const info = isRecord(result.info) ? result.info : {};
  const paths = Array.isArray(info.paths)
    ? info.paths
    : Array.isArray(result.paths)
      ? result.paths
      : [];
  if (paths.length === 0) return "blocked";
  return paths.some(
    (path) =>
      isRecord(path) &&
      path.forwardingOutcome === "DELIVERED" &&
      path.securityOutcome !== "DENIED",
  )
    ? "reachable"
    : "blocked";
};

const chunks = <Value>(values: Value[], size: number): Value[][] => {
  const output: Value[][] = [];
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
}: {
  dependencies: DependencyCandidate[];
  api: ForwardApiClient;
  networkId: string;
  snapshotId: string;
  batchSize?: number;
}) => {
  const planned = dependencies.map((dependency) => ({ dependency, query: buildPathQuery(dependency) }));
  const queryable = planned.filter(({ query }) => query);
  const responses: unknown[] = [];
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
      // /paths-bulk is a POST-shaped read. It mutates nothing, so a transient
      // status may safely be retried.
      { retryable: true },
    );
    if (!Array.isArray(result) || result.length !== batch.length) {
      throw new Error("Forward paths-bulk response count did not match the request.");
    }
    const resultRows: unknown[] = result;
    responses.push(...resultRows);
  }
  let responseIndex = 0;
  const rows = planned.map(({ dependency, query }) => ({
    id: dependency.id || null,
    status: query ? pathStatus(responses[responseIndex++]) : "unmapped",
  }));
  const count = (status: PathEvidenceStatus): number =>
    rows.filter((row) => row.status === status).length;
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
import type {
  DependencyCandidate,
  ForwardApiClient,
  ForwardLocationFilterType,
} from "./types/index.ts";
