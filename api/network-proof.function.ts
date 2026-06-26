type ProofStatus = "pass" | "fail" | "unknown";

interface NetworkProofRequest {
  serviceEntityId: string;
  problemId?: string;
  source?: string;
  destination?: string;
  port?: string;
  protocol: "tcp" | "udp";
  forwardBaseUrl?: string;
  forwardNetworkId?: string;
  appName?: string;
  environment?: string;
  owner?: string;
  criticality?: string;
}

interface NetworkProofResponse {
  status: ProofStatus;
  summary: string;
  serviceEntityId: string;
  checkedAt: string;
  forwardQuery?: string;
  evidence: EvidenceRow[];
  nextSteps: string[];
}

interface EvidenceRow {
  label: string;
  value: string;
}

const missing = (value: string | undefined): boolean => !value?.trim();

const buildForwardQuery = ({
  source,
  destination,
  port,
  protocol,
}: NetworkProofRequest): string => {
  const clauses = [
    source ? `from(${source})` : "from(<source>)",
    destination ? `to(${destination})` : "to(<destination>)",
    port ? `${protocol}-port(${port})` : `${protocol}-port(<port>)`,
  ];
  return clauses.join(" ");
};

export default function (
  payload?: NetworkProofRequest,
): NetworkProofResponse {
  const checkedAt = new Date().toISOString();

  if (!payload || missing(payload.serviceEntityId)) {
    return {
      status: "unknown",
      summary: "Enter a Dynatrace service entity ID to stage a Forward path preview.",
      serviceEntityId: "",
      checkedAt,
      evidence: [],
      nextSteps: ["Choose a service or paste a SERVICE-* entity ID."],
    };
  }

  const forwardQuery = buildForwardQuery(payload);
  const evidence: EvidenceRow[] = [
    { label: "Application", value: payload.appName || "not supplied" },
    { label: "Environment", value: payload.environment || "not supplied" },
    { label: "Dynatrace service", value: payload.serviceEntityId },
    { label: "Problem", value: payload.problemId || "none supplied" },
    { label: "Forward query", value: forwardQuery },
    { label: "Owner", value: payload.owner || "not supplied" },
    { label: "Criticality", value: payload.criticality || "not supplied" },
  ];

  if (missing(payload.forwardBaseUrl) || missing(payload.forwardNetworkId)) {
    return {
      status: "unknown",
      summary:
        "Path preview ready. Add Forward URL and network ID as package metadata if useful.",
      serviceEntityId: payload.serviceEntityId,
      checkedAt,
      forwardQuery,
      evidence,
      nextSteps: [
        "Keep Forward write credentials out of Dynatrace.",
        "Export preview context for manual Forward review or Forward-side connector ingestion.",
        "Add read-only Forward lookup only after an approved credential storage pattern exists.",
      ],
    };
  }

  return {
    status: "unknown",
    summary:
      "Forward target configured. API call implementation is intentionally stubbed until auth storage is selected.",
    serviceEntityId: payload.serviceEntityId,
    checkedAt,
    forwardQuery,
    evidence: [
      ...evidence,
      { label: "Forward base URL", value: payload.forwardBaseUrl },
      { label: "Forward network ID", value: payload.forwardNetworkId },
    ],
    nextSteps: [
      "Do not write to Forward from this function.",
      "Use Forward-side ingest to reconcile checks.",
      "Optionally map Forward PASS/FAIL into a read-only Dynatrace display.",
    ],
  };
}
