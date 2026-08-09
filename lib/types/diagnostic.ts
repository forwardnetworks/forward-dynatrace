import type { ForwardAccessProfile } from "./forward.ts";

export type ForwardDiagnosticStatus = "ready" | "blocked";
export type ForwardDiagnosticCheckStatus = "passed" | "blocked" | "warning" | "not-run";

export interface ForwardConnectionDiagnosticChecks {
  configuration: ForwardDiagnosticCheckStatus;
  credentialVault: ForwardDiagnosticCheckStatus;
  verifiedHttps: ForwardDiagnosticCheckStatus;
  authentication: ForwardDiagnosticCheckStatus;
  networkAccess: ForwardDiagnosticCheckStatus;
  processedSnapshot: ForwardDiagnosticCheckStatus;
  readOnlyPilot: ForwardDiagnosticCheckStatus;
}

export interface ForwardConnectionDiagnosticResponse {
  schemaVersion: "forward-dynatrace-connection-diagnostic/v1";
  status: ForwardDiagnosticStatus;
  summary: string;
  checkedAt: string;
  correlationId: string;
  forwardAccessProfile?: ForwardAccessProfile;
  reasonCode?: string;
  httpStatusClass?: string;
  checks: ForwardConnectionDiagnosticChecks;
  boundary: "read-only-forward-api-diagnostic";
}
