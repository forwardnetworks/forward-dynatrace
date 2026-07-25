import * as appSettingsV2 from "@dynatrace-sdk/client-app-settings-v2";

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

interface AppSettingsConnectionClient {
  getAppSettingsObjectByObjectId: (input: {
    objectId: string;
  }) => Promise<unknown>;
}

export type ConnectionLoader = (connectionId: string) => Promise<unknown>;

const isRecord = (value: unknown): value is Record<string, unknown> =>
  Boolean(value) && typeof value === "object" && !Array.isArray(value);

const isAppSettingsConnectionClient = (
  value: unknown,
): value is AppSettingsConnectionClient =>
  isRecord(value) &&
  typeof value.getAppSettingsObjectByObjectId === "function";

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

const FORWARD_QUERY_ID = /^FQ_[A-Fa-f0-9]{40}$/u;
const FORWARD_QUERY_DIGEST = /^[a-fA-F0-9]{64}$/u;

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

export const validateConnection = (connection: unknown): ForwardConnection => {
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
      "username",
      "password",
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
  const username = requiredString(value.username, "Forward username", 255);
  const password = requiredString(value.password, "Forward password", 4096);
  if (username.includes(":")) throw new Error("Forward username must not contain a colon.");
  return {
    baseUrl: validateForwardBaseUrl(value.baseUrl),
    networkId: requiredString(value.networkId, "Forward network ID", 128),
    authorization: `Basic ${Buffer.from(`${username}:${password}`, "utf8").toString("base64")}`,
    forwardAccessProfile,
    approvedLibraryQueryIds: approvedLibraryQueryIds(value.approvedLibraryQueryIds),
    approvedQueryDigests: approvedQueryDigests(value.approvedQueryDigests),
  };
};
