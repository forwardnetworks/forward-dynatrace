export type ProofStatus = "pass" | "fail" | "unknown";

export interface NetworkProofRequest {
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

export interface NetworkProofResponse {
  status: ProofStatus;
  summary: string;
  serviceEntityId: string;
  checkedAt: string;
  forwardQuery?: string;
  evidence: EvidenceRow[];
  nextSteps: string[];
}

export interface EvidenceRow {
  label: string;
  value: string;
}
