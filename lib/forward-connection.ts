import * as appSettingsV2 from "@dynatrace-sdk/client-app-settings-v2";
import * as classicEnvironmentV2 from "@dynatrace-sdk/client-classic-environment-v2";

import { isForwardAccessProfile } from "./forward-access-profile.ts";
import type { ForwardAccessProfile } from "./types/index.ts";

const CONNECTION_SCHEMA = "forward-api-connection";

export interface ForwardConnection {
  baseUrl: string;
  networkId: string;
  authorization: string;
  forwardAccessProfile: ForwardAccessProfile;
  approvedLibraryQueryIds: string[];
  approvedQueryDigests: string[];
}

export interface ForwardConnectionReference {
  baseUrl: string;
  networkId: string;
  credentialVaultId: string;
  forwardAccessProfile: ForwardAccessProfile;
  approvedLibraryQueryIds: string[];
  approvedQueryDigests: string[];
}

interface AppSettingsConnectionClient {
  getAppSettingsObjectByObjectId: (input: {
    objectId: string;
  }) => Promise<unknown>;
}

interface CredentialVaultClient {
  getCredentialsDetails: (input: { id: string }) => Promise<unknown>;
}

export type ConnectionLoader = (connectionId: string) => Promise<unknown>;
export type CredentialLoader = (credentialVaultId: string) => Promise<unknown>;

const isRecord = (value: unknown): value is Record<string, unknown> =>
  Boolean(value) && typeof value === "object" && !Array.isArray(value);

const isAppSettingsConnectionClient = (
  value: unknown,
): value is AppSettingsConnectionClient =>
  isRecord(value) &&
  typeof value.getAppSettingsObjectByObjectId === "function";

const isCredentialVaultClient = (
  value: unknown,
): value is CredentialVaultClient =>
  isRecord(value) && typeof value.getCredentialsDetails === "function";

const defaultAppSettingsExport: unknown = Reflect.get(appSettingsV2, "default");
const defaultAppSettingsClient = isRecord(defaultAppSettingsExport)
  ? defaultAppSettingsExport.appSettingsObjectsClient
  : undefined;
const namedAppSettingsClient: unknown = appSettingsV2.appSettingsObjectsClient;
const appSettingsObjectsClient = isAppSettingsConnectionClient(
  namedAppSettingsClient,
)
  ? namedAppSettingsClient
  : isAppSettingsConnectionClient(defaultAppSettingsClient)
    ? defaultAppSettingsClient
    : undefined;

const defaultClassicExport: unknown = Reflect.get(classicEnvironmentV2, "default");
const defaultCredentialVaultClient = isRecord(defaultClassicExport)
  ? defaultClassicExport.credentialVaultClient
  : undefined;
const namedCredentialVaultClient: unknown = Reflect.get(
  classicEnvironmentV2,
  "credentialVaultClient",
);
const credentialVaultClient = isCredentialVaultClient(namedCredentialVaultClient)
  ? namedCredentialVaultClient
  : isCredentialVaultClient(defaultCredentialVaultClient)
    ? defaultCredentialVaultClient
    : undefined;

const requiredString = (
  value: unknown,
  label: string,
  maxLength = 4096,
): string => {
  const normalized = typeof value === "string" ? value.trim() : "";
  if (!normalized) throw new Error(`${label} must be a non-empty string.`);
  if (normalized.length > maxLength) throw new Error(`${label} exceeds ${maxLength} characters.`);
  return normalized;
};

const assertKnownKeys = (
  value: Record<string, unknown>,
  allowed: ReadonlySet<string>,
  label: string,
): void => {
  const unknown = Object.keys(value).filter((key) => !allowed.has(key));
  if (unknown.length > 0) {
    throw new Error(`${label} contains unsupported fields: ${unknown.join(", ")}.`);
  }
};

export const validateForwardBaseUrl = (value: unknown): string => {
  const url = new URL(requiredString(value, "Forward API URL", 2048));
  if (url.protocol !== "https:") throw new Error("Forward API URL must use HTTPS.");
  if (url.username || url.password || url.search || url.hash) {
    throw new Error("Forward API URL must not contain credentials, query parameters, or fragments.");
  }
  url.pathname = url.pathname.replace(/\/+$/u, "");
  if (url.pathname !== "/api") {
    throw new Error("Forward API URL must end with /api.");
  }
  return url.toString().replace(/\/+$/u, "");
};

export const loadDynatraceConnection: ConnectionLoader = async (
  connectionId,
) =>
  appSettingsObjectsClient?.getAppSettingsObjectByObjectId({ objectId: connectionId });

export const loadDynatraceCredential: CredentialLoader = async (
  credentialVaultId,
) => {
  if (!credentialVaultClient) {
    throw new Error("Dynatrace Credential Vault client is unavailable.");
  }
  return credentialVaultClient.getCredentialsDetails({ id: credentialVaultId });
};

const FORWARD_QUERY_ID = /^FQ_[A-Fa-f0-9]{40}$/u;
const FORWARD_QUERY_DIGEST = /^[a-fA-F0-9]{64}$/u;
const CREDENTIAL_VAULT_ID = /^CREDENTIALS_VAULT-[A-Za-z0-9_-]{1,128}$/u;

const approvedLibraryQueryIds = (value: unknown): string[] => {
  if (value === undefined || value === null || value === "") return [];
  if (typeof value !== "string" || value.length > 5000) {
    throw new Error("Approved Forward Library NQE query IDs must be a bounded string.");
  }
  const ids = [...new Set(value.split(/[\s,]+/u).map((item) => item.trim()).filter(Boolean))];
  if (ids.some((id) => !FORWARD_QUERY_ID.test(id))) {
    throw new Error("Approved Forward Library NQE query IDs must use the FQ_<40 hex chars> form.");
  }
  return ids;
};

const approvedQueryDigests = (value: unknown): string[] => {
  if (value === undefined || value === null || value === "") return [];
  if (typeof value !== "string" || value.length > 5000) {
    throw new Error("Approved Forward arbitrary NQE query digests must be a bounded string.");
  }
  const digests = [...new Set(value.split(/[\s,]+/u).map((item) => item.trim()).filter(Boolean))];
  if (digests.some((digest) => !FORWARD_QUERY_DIGEST.test(digest))) {
    throw new Error("Approved Forward arbitrary NQE query digests must be 64 hex characters.");
  }
  return digests.map((digest) => digest.toLowerCase());
};

export const validateConnectionReference = (
  connection: unknown,
): ForwardConnectionReference => {
  if (!isRecord(connection)) {
    throw new Error("Forward connection could not be loaded.");
  }
  if (connection.schemaId && connection.schemaId !== CONNECTION_SCHEMA) {
    throw new Error(`Forward connection must use settings schema ${CONNECTION_SCHEMA}.`);
  }
  const value = connection.value;
  if (!isRecord(value)) {
    throw new Error("Forward connection value is invalid.");
  }
  assertKnownKeys(
    value,
    new Set([
      "name",
      "baseUrl",
      "networkId",
      "credentialVaultId",
      "forwardAccessProfile",
      "approvedLibraryQueryIds",
      "approvedQueryDigests",
    ]),
    "Forward connection",
  );
  requiredString(value.name, "Forward connection name", 100);
  const forwardAccessProfile = requiredString(
    value.forwardAccessProfile,
    "Forward access profile",
    32,
  );
  if (!isForwardAccessProfile(forwardAccessProfile)) {
    throw new Error("Forward access profile must be read-only, network-operator, or network-admin.");
  }
  const credentialVaultId = requiredString(
    value.credentialVaultId,
    "Dynatrace Credential Vault ID",
    160,
  );
  if (!CREDENTIAL_VAULT_ID.test(credentialVaultId)) {
    throw new Error("Dynatrace Credential Vault ID must use the CREDENTIALS_VAULT- entity form.");
  }
  return {
    baseUrl: validateForwardBaseUrl(value.baseUrl),
    networkId: requiredString(value.networkId, "Forward network ID", 128),
    credentialVaultId,
    forwardAccessProfile,
    approvedLibraryQueryIds: approvedLibraryQueryIds(value.approvedLibraryQueryIds),
    approvedQueryDigests: approvedQueryDigests(value.approvedQueryDigests),
  };
};

const authorizationFromCredential = (
  credential: unknown,
  expectedCredentialVaultId: string,
): string => {
  if (!isRecord(credential) || credential.type !== "USERNAME_PASSWORD") {
    throw new Error("Forward credential must be a Dynatrace Credential Vault username/password entry.");
  }
  if (
    typeof credential.id === "string" &&
    credential.id.trim() &&
    credential.id.trim() !== expectedCredentialVaultId
  ) {
    throw new Error("Dynatrace Credential Vault returned a different credential entity.");
  }
  const username = requiredString(credential.username, "Forward service username", 255);
  const password = requiredString(credential.password, "Forward service password", 4096);
  if (username.includes(":")) throw new Error("Forward service username must not contain a colon.");
  return `Basic ${Buffer.from(`${username}:${password}`, "utf8").toString("base64")}`;
};

export const validateConnection = (
  connection: unknown,
  credential: unknown,
): ForwardConnection => {
  const reference = validateConnectionReference(connection);
  return {
    baseUrl: reference.baseUrl,
    networkId: reference.networkId,
    forwardAccessProfile: reference.forwardAccessProfile,
    approvedLibraryQueryIds: reference.approvedLibraryQueryIds,
    approvedQueryDigests: reference.approvedQueryDigests,
    authorization: authorizationFromCredential(credential, reference.credentialVaultId),
  };
};

export const resolveForwardConnection = async (
  connection: unknown,
  loadCredential: CredentialLoader = loadDynatraceCredential,
): Promise<ForwardConnection> => {
  const reference = validateConnectionReference(connection);
  const credential = await loadCredential(reference.credentialVaultId);
  return validateConnection(connection, credential);
};
