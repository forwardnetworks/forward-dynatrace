import {
  createForwardClient,
  latestProcessedSnapshot,
} from "./forward-client.ts";
import type { ForwardClientOptions } from "./forward-client.ts";
import {
  loadDynatraceConnection,
  loadDynatraceCredential,
  resolveForwardConnection,
} from "./forward-connection.ts";
import type { CredentialLoader } from "./forward-connection.ts";
import {
  writeOperationalLog,
} from "./operational-log.ts";
import type {
  OperationalLogWriter,
} from "./operational-log.ts";
import type {
  ForwardConnectionDiagnosticChecks,
  ForwardConnectionDiagnosticResponse,
} from "./types/index.ts";

type ConnectionLoader = (connectionId: string) => Promise<unknown>;

const isRecord = (value: unknown): value is Record<string, unknown> =>
  Boolean(value) && typeof value === "object" && !Array.isArray(value);

const diagnosticChecks = (): ForwardConnectionDiagnosticChecks => ({
  configuration: "not-run",
  credentialVault: "not-run",
  verifiedHttps: "not-run",
  authentication: "not-run",
  networkAccess: "not-run",
  processedSnapshot: "not-run",
  readOnlyPilot: "not-run",
});

const diagnosticReason = (error: unknown): {
  reasonCode: string;
  httpStatusClass?: string;
  summary: string;
} => {
  const message = error instanceof Error ? error.message : "";
  const httpStatus = message.match(/HTTP (\d{3})/u)?.[1];
  const httpStatusClass = httpStatus ? `${httpStatus[0]}xx` : undefined;
  if (/Credential Vault client is unavailable/u.test(message)) {
    return {
      reasonCode: "credential-vault-unavailable",
      summary: "Dynatrace could not access Credential Vault from the app function.",
    };
  }
  if (/Credential Vault|credential|USERNAME_PASSWORD|service username/u.test(message)) {
    return {
      reasonCode: "credential-vault-invalid",
      summary: "The saved connection does not resolve to a usable Credential Vault token pair.",
    };
  }
  if (/no processed collection snapshot/u.test(message)) {
    return {
      reasonCode: "no-processed-snapshot",
      summary: "The configured Forward network has no processed collection snapshot.",
    };
  }
  if (httpStatus === "401" || httpStatus === "403") {
    return {
      reasonCode: "authentication-or-external-request-denied",
      httpStatusClass,
      summary: "Forward authentication or the Dynatrace external-request policy denied the diagnostic.",
    };
  }
  if (httpStatus === "404") {
    return {
      reasonCode: "network-not-found",
      httpStatusClass,
      summary: "The configured Forward network was not accessible to this service identity.",
    };
  }
  if (httpStatus === "429") {
    return {
      reasonCode: "rate-limited",
      httpStatusClass,
      summary: "Forward rate-limited the diagnostic. Retry after the service window clears.",
    };
  }
  if (httpStatus?.startsWith("5")) {
    return {
      reasonCode: "forward-unavailable",
      httpStatusClass,
      summary: "Forward returned a temporary server error during the diagnostic.",
    };
  }
  if (/before an HTTP response|redirected|invalid JSON|deadline|retry budget/u.test(message)) {
    return {
      reasonCode: "forward-transport-failed",
      summary: "Dynatrace could not complete verified HTTPS communication with Forward.",
    };
  }
  if (/connection|settings schema|unsupported fields|must use HTTPS|must end with/u.test(message)) {
    return {
      reasonCode: "connection-configuration-invalid",
      summary: "The selected Forward connection is missing or invalid.",
    };
  }
  return {
    reasonCode: "unexpected-diagnostic-failure",
    ...(httpStatusClass ? { httpStatusClass } : {}),
    summary: "The Read Only Forward diagnostic did not complete. Review the correlation ID in app-function logs.",
  };
};

const connectionIdFrom = (payload: unknown): string => {
  if (!isRecord(payload)) {
    throw new Error("Forward connection diagnostic input must be a JSON object.");
  }
  const unknown = Object.keys(payload).filter((key) => key !== "connectionId");
  if (unknown.length > 0) {
    throw new Error(`Forward connection diagnostic contains unsupported fields: ${unknown.join(", ")}.`);
  }
  const connectionId = typeof payload.connectionId === "string"
    ? payload.connectionId.trim()
    : "";
  if (!connectionId || connectionId.length > 256) {
    throw new Error("Forward connection ID must be a non-empty string of at most 256 characters.");
  }
  return connectionId;
};

export const createForwardConnectionDiagnostic = ({
  loadConnection = loadDynatraceConnection,
  loadCredential = loadDynatraceCredential,
  fetchImpl = globalThis.fetch,
  forwardClientOptions = {},
  now = () => new Date(),
  correlationIdFactory = () => globalThis.crypto.randomUUID(),
  logWriter,
}: {
  loadConnection?: ConnectionLoader;
  loadCredential?: CredentialLoader;
  fetchImpl?: typeof globalThis.fetch;
  forwardClientOptions?: ForwardClientOptions;
  now?: () => Date;
  correlationIdFactory?: () => string;
  logWriter?: OperationalLogWriter;
} = {}) => async (payload: unknown): Promise<ForwardConnectionDiagnosticResponse> => {
  const startedAt = Date.now();
  const checkedAt = now().toISOString();
  const correlationId = correlationIdFactory();
  const checks = diagnosticChecks();
  let forwardAccessProfile: ForwardConnectionDiagnosticResponse["forwardAccessProfile"];

  try {
    const connectionId = connectionIdFrom(payload);
    const connectionValue = await loadConnection(connectionId);
    checks.configuration = "passed";
    checks.verifiedHttps = "passed";

    const connection = await resolveForwardConnection(connectionValue, async (credentialVaultId) => {
      const credential = await loadCredential(credentialVaultId);
      checks.credentialVault = "passed";
      return credential;
    });
    forwardAccessProfile = connection.forwardAccessProfile;

    const api = createForwardClient({
      connection,
      fetchImpl,
      ...forwardClientOptions,
    });
    const snapshotResponse = await api(
      "GET",
      `/networks/${encodeURIComponent(connection.networkId)}/snapshots/latestProcessed`,
    );
    latestProcessedSnapshot(snapshotResponse);
    checks.authentication = "passed";
    checks.networkAccess = "passed";
    checks.processedSnapshot = "passed";
    checks.readOnlyPilot = connection.forwardAccessProfile === "read-only" ? "passed" : "warning";

    writeOperationalLog({
      level: "info",
      event: "forward.connection.diagnostic",
      correlationId,
      fields: {
        status: "ready",
        durationMs: Math.max(0, Date.now() - startedAt),
        forwardAccessProfile: connection.forwardAccessProfile,
        snapshotState: "PROCESSED",
      },
      now,
      ...(logWriter ? { writer: logWriter } : {}),
    });

    return {
      schemaVersion: "forward-dynatrace-connection-diagnostic/v1",
      status: "ready",
      summary: connection.forwardAccessProfile === "read-only"
        ? "Credential Vault, verified HTTPS, Forward authentication, network access, and a processed snapshot are ready for a Read Only plan."
        : "The connection is reachable, but it is not declared Read Only. Use a Read Only connection for sandbox acceptance.",
      checkedAt,
      correlationId,
      forwardAccessProfile: connection.forwardAccessProfile,
      checks,
      boundary: "read-only-forward-api-diagnostic",
    };
  } catch (error) {
    const reason = diagnosticReason(error);
    if (checks.credentialVault === "passed") {
      checks.authentication = "blocked";
      checks.networkAccess = "blocked";
      checks.processedSnapshot = "blocked";
    } else if (checks.configuration === "passed") {
      checks.credentialVault = "blocked";
    } else {
      checks.configuration = "blocked";
      checks.verifiedHttps = "blocked";
    }
    checks.readOnlyPilot = "blocked";

    writeOperationalLog({
      level: "warn",
      event: "forward.connection.diagnostic",
      correlationId,
      fields: {
        status: "blocked",
        durationMs: Math.max(0, Date.now() - startedAt),
        reasonCode: reason.reasonCode,
        ...(reason.httpStatusClass ? { httpStatusClass: reason.httpStatusClass } : {}),
        ...(forwardAccessProfile ? { forwardAccessProfile } : {}),
      },
      now,
      ...(logWriter ? { writer: logWriter } : {}),
    });

    return {
      schemaVersion: "forward-dynatrace-connection-diagnostic/v1",
      status: "blocked",
      summary: reason.summary,
      checkedAt,
      correlationId,
      ...(forwardAccessProfile ? { forwardAccessProfile } : {}),
      reasonCode: reason.reasonCode,
      ...(reason.httpStatusClass ? { httpStatusClass: reason.httpStatusClass } : {}),
      checks,
      boundary: "read-only-forward-api-diagnostic",
    };
  }
};

export default createForwardConnectionDiagnostic();
