import { performance } from "node:perf_hooks";

import { createForwardClient, latestProcessedSnapshot, parseCheckList } from "../lib/forward-client.ts";
import { validateConnection } from "../lib/forward-connection.ts";
import { MANAGED_BY_TAG } from "../lib/managed-check-identity.ts";

const ALLOWED_NETWORK_ID = "252606";
const INVOCATION_BUDGET_MS = 120_000;
const PROBE_NOTE_SUFFIX = "\n[forward-dynatrace PATCH throughput probe]";

interface Arguments {
  checkId?: string;
  confirmNetworkId?: string;
  execute: boolean;
  forwardBaseUrl: string;
  forwardNetworkId: string;
}

const isRecord = (value: unknown): value is Record<string, unknown> =>
  Boolean(value) && typeof value === "object" && !Array.isArray(value);

const requiredString = (value: unknown, label: string): string => {
  const normalized = typeof value === "string" ? value.trim() : "";
  if (!normalized) throw new Error(`${label} must be a non-empty string.`);
  return normalized;
};

const parseArguments = (argv: string[]): Arguments => {
  const values = new Map<string, string>();
  let execute = false;
  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index];
    if (argument === "--execute") {
      execute = true;
      continue;
    }
    if (!argument.startsWith("--")) {
      throw new Error(`Unsupported positional argument: ${argument}`);
    }
    const next = argv[index + 1];
    if (!next || next.startsWith("--")) {
      throw new Error(`Missing value for ${argument}.`);
    }
    values.set(argument.slice(2), next);
    index += 1;
  }
  const forwardBaseUrl = values.get("forward-base-url") ?? process.env.FORWARD_BASE_URL ?? "";
  const forwardNetworkId = values.get("forward-network-id") ?? process.env.FORWARD_NETWORK_ID ?? "";
  return {
    checkId: values.get("check-id"),
    confirmNetworkId: values.get("confirm-network-id"),
    execute,
    forwardBaseUrl: requiredString(forwardBaseUrl, "Forward base URL"),
    forwardNetworkId: requiredString(forwardNetworkId, "Forward network ID"),
  };
};

const apiBaseUrl = (value: string): string => {
  const url = new URL(value);
  if (url.pathname === "/" || url.pathname === "") url.pathname = "/api";
  return url.toString().replace(/\/+$/u, "");
};

interface RestorablePatchPayload extends Record<string, unknown> {
  note: string;
}

const patchPayload = (check: unknown): RestorablePatchPayload => {
  if (!isRecord(check) || !isRecord(check.definition)) {
    throw new Error("Selected Forward check has no patchable definition.");
  }
  const payload: Record<string, unknown> = { definition: structuredClone(check.definition) };
  for (const key of ["enabled", "name", "note", "perfMonitoringEnabled", "priority", "tags"]) {
    if (check[key] !== undefined) payload[key] = structuredClone(check[key]);
  }
  if (!Array.isArray(payload.tags) || !payload.tags.includes(MANAGED_BY_TAG)) {
    throw new Error("Selected Forward check is not managed by this integration.");
  }
  if (typeof payload.note !== "string") {
    throw new Error("Selected Forward check must have a string note so the probe can restore it exactly.");
  }
  return { ...payload, note: payload.note };
};

const stableValue = (value: unknown): unknown => {
  if (Array.isArray(value)) return value.map(stableValue);
  if (!isRecord(value)) return value;
  return Object.fromEntries(
    Object.entries(value)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, child]) => [key, stableValue(child)]),
  );
};

const stableJson = (value: unknown): string => JSON.stringify(stableValue(value));

const main = async (): Promise<void> => {
  const args = parseArguments(process.argv.slice(2));
  if (args.forwardNetworkId !== ALLOWED_NETWORK_ID) {
    throw new Error(`This harness is locked to Forward network ${ALLOWED_NETWORK_ID}.`);
  }
  const username = requiredString(process.env.FORWARD_USER, "FORWARD_USER");
  const password = requiredString(process.env.FORWARD_PASS, "FORWARD_PASS");
  const connection = validateConnection(
    {
      schemaId: "forward-api-connection",
      value: {
        name: "PATCH throughput probe",
        baseUrl: apiBaseUrl(args.forwardBaseUrl),
        networkId: args.forwardNetworkId,
        credentialVaultId: "CREDENTIALS_VAULT-LOCALTHROUGHPUT01",
        forwardAccessProfile: "network-admin",
      },
    },
    { type: "USERNAME_PASSWORD", username, password },
  );
  const api = createForwardClient({ connection });
  const snapshotId = latestProcessedSnapshot(await api(
    "GET",
    `/networks/${encodeURIComponent(connection.networkId)}/snapshots/latestProcessed`,
  ));
  const checks = parseCheckList(await api(
    "GET",
    `/snapshots/${encodeURIComponent(snapshotId)}/checks?type=Existential`,
  ));
  const candidates = checks
    .filter((check) => isRecord(check) && Array.isArray(check.tags) && check.tags.includes(MANAGED_BY_TAG))
    .filter((check) => isRecord(check) && (typeof check.id === "string" || typeof check.id === "number"))
    .sort((left, right) => String((left as Record<string, unknown>).id).localeCompare(
      String((right as Record<string, unknown>).id),
    ));
  const selected = args.checkId
    ? candidates.find((check) => isRecord(check) && String(check.id) === args.checkId)
    : candidates[0];
  if (!selected || !isRecord(selected)) {
    throw new Error("No matching integration-managed Existential check was found.");
  }
  const checkId = requiredString(String(selected.id), "Selected check ID");
  const originalPayload = patchPayload(selected);
  process.stdout.write(`${JSON.stringify({
    mode: args.execute ? "execute" : "dry-run",
    networkId: connection.networkId,
    snapshotId,
    managedCandidateCount: candidates.length,
    selectedCheckId: checkId,
  }, null, 2)}\n`);
  if (!args.execute) return;
  if (args.confirmNetworkId !== ALLOWED_NETWORK_ID) {
    throw new Error(`--execute requires --confirm-network-id ${ALLOWED_NETWORK_ID}.`);
  }

  const before = patchPayload(await api(
    "GET",
    `/snapshots/${encodeURIComponent(snapshotId)}/checks/${encodeURIComponent(checkId)}`,
  ));
  if (stableJson(before) !== stableJson(originalPayload)) {
    throw new Error("Selected check changed after inventory read; no PATCH was attempted.");
  }
  const originalNote = originalPayload.note;
  const probePayload = { ...originalPayload, note: `${originalNote}${PROBE_NOTE_SUFFIX}` };
  let timedPatchMs: number | null = null;
  let restorePatchMs: number | null = null;
  let probeError: unknown;
  try {
    const startedAt = performance.now();
    await api(
      "PATCH",
      `/snapshots/${encodeURIComponent(snapshotId)}/checks/${encodeURIComponent(checkId)}`,
      probePayload,
    );
    timedPatchMs = performance.now() - startedAt;
  } catch (error) {
    probeError = error;
  } finally {
    const restoreStartedAt = performance.now();
    await api(
      "PATCH",
      `/snapshots/${encodeURIComponent(snapshotId)}/checks/${encodeURIComponent(checkId)}`,
      originalPayload,
    );
    restorePatchMs = performance.now() - restoreStartedAt;
  }
  const restored = patchPayload(await api(
    "GET",
    `/snapshots/${encodeURIComponent(snapshotId)}/checks/${encodeURIComponent(checkId)}`,
  ));
  if (stableJson(restored) !== stableJson(originalPayload)) {
    throw new Error("Forward PATCH probe restoration did not match the original payload.");
  }
  if (probeError instanceof Error) throw probeError;
  if (probeError !== undefined) {
    throw new Error("Forward PATCH probe failed with a non-Error value.");
  }
  if (timedPatchMs === null || restorePatchMs === null) {
    throw new Error("Forward PATCH timing did not complete.");
  }
  const slowerObservedPatchMs = Math.max(timedPatchMs, restorePatchMs);
  process.stdout.write(`${JSON.stringify({
    status: "restored",
    timedPatchMs: Math.round(timedPatchMs),
    restorePatchMs: Math.round(restorePatchMs),
    rawUpdatesPer120Seconds: Math.floor(INVOCATION_BUDGET_MS / slowerObservedPatchMs),
  }, null, 2)}\n`);
};

await main();
