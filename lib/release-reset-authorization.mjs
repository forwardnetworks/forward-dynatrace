import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const DEFAULT_FILE = path.join(root, "config/release-reset-authorizations.json");
const RELEASE_TAG = /^v(?:0|[1-9][0-9]*)\.(?:0|[1-9][0-9]*)\.(?:0|[1-9][0-9]*)$/u;
const SHA256 = /^[a-f0-9]{40}$/u;
const IMAGE_DIGEST = /^sha256:[a-f0-9]{64}$/u;
const MAX_RESET_WINDOW_MS = 7 * 24 * 60 * 60 * 1000;

const exactKeys = (value, expected, label) => {
  const actual = Object.keys(value).sort();
  const wanted = [...expected].sort();
  if (JSON.stringify(actual) !== JSON.stringify(wanted)) {
    throw new Error(`${label} fields must be exactly: ${wanted.join(", ")}.`);
  }
};

const validDate = (value, label) => {
  const milliseconds = Date.parse(value || "");
  if (!Number.isFinite(milliseconds)) throw new Error(`${label} must be an ISO timestamp.`);
  return milliseconds;
};

const uniqueArray = (value, predicate, label) => {
  if (!Array.isArray(value) || value.length === 0 || value.some((item) => !predicate(item))) {
    throw new Error(`${label} must be a non-empty valid array.`);
  }
};

export const validateReleaseResetAuthorizations = (document) => {
  if (!document || typeof document !== "object" || Array.isArray(document)) {
    throw new Error("Release reset authorization document must be an object.");
  }
  exactKeys(document, ["schemaVersion", "authorizations"], "Release reset authorization document");
  if (document.schemaVersion !== "forward-dynatrace-release-reset-authorizations/v1") {
    throw new Error("Release reset authorization schemaVersion is unsupported.");
  }
  if (!Array.isArray(document.authorizations)) {
    throw new Error("Release reset authorizations must be an array.");
  }
  if (document.authorizations.length > 1) {
    throw new Error("Only one pre-customer release reset authorization is permitted.");
  }
  const names = new Set();
  for (const [index, authorization] of document.authorizations.entries()) {
    if (!authorization || typeof authorization !== "object" || Array.isArray(authorization)) {
      throw new Error(`Release reset authorization ${index} must be an object.`);
    }
    exactKeys(authorization, [
      "releaseName",
      "reason",
      "approvedAt",
      "resetDeadline",
      "replacementPolicy",
      "retiredReleasePublishedAt",
      "retiredRuns",
      "retiredImageDigest",
    ], `Release reset authorization ${index}`);
    if (!RELEASE_TAG.test(authorization.releaseName || "")) {
      throw new Error(`Release reset authorization ${index} releaseName is invalid.`);
    }
    if (names.has(authorization.releaseName)) {
      throw new Error(`Release reset authorization ${authorization.releaseName} is duplicated.`);
    }
    names.add(authorization.releaseName);
    if (typeof authorization.reason !== "string" || authorization.reason.trim().length < 32) {
      throw new Error(`Release reset authorization ${authorization.releaseName} needs a durable reason.`);
    }
    const approvedAt = validDate(authorization.approvedAt, "approvedAt");
    const deadline = validDate(authorization.resetDeadline, "resetDeadline");
    if (deadline <= approvedAt) {
      throw new Error(`Release reset authorization ${authorization.releaseName} deadline must follow approval.`);
    }
    if (deadline - approvedAt > MAX_RESET_WINDOW_MS) {
      throw new Error(`Release reset authorization ${authorization.releaseName} window exceeds seven days.`);
    }
    const retiredPublishedAt = validDate(
      authorization.retiredReleasePublishedAt,
      "retiredReleasePublishedAt",
    );
    if (retiredPublishedAt >= approvedAt) {
      throw new Error(`Release reset authorization ${authorization.releaseName} must retire an older release.`);
    }
    if (authorization.replacementPolicy !== "one-successful-replacement") {
      throw new Error(`Release reset authorization ${authorization.releaseName} policy is unsupported.`);
    }
    uniqueArray(
      authorization.retiredRuns,
      (value) =>
        Boolean(value) &&
        typeof value === "object" &&
        !Array.isArray(value) &&
        Object.keys(value).sort().join(",") === "commitSha,runId" &&
        Number.isSafeInteger(value.runId) &&
        value.runId > 0 &&
        SHA256.test(value.commitSha || ""),
      "retiredRuns",
    );
    if (new Set(authorization.retiredRuns.map((item) => item.runId)).size !== authorization.retiredRuns.length) {
      throw new Error(`Release reset authorization ${authorization.releaseName} has duplicate retired run IDs.`);
    }
    if (!IMAGE_DIGEST.test(authorization.retiredImageDigest || "")) {
      throw new Error(`Release reset authorization ${authorization.releaseName} image digest is invalid.`);
    }
  }
  return document;
};

export const loadReleaseResetAuthorization = async (
  releaseName,
  { filePath = DEFAULT_FILE, enforceDeadline = false, now = Date.now } = {},
) => {
  const document = validateReleaseResetAuthorizations(
    JSON.parse(await readFile(filePath, "utf8")),
  );
  const authorization = document.authorizations.find((item) => item.releaseName === releaseName) || null;
  if (authorization && enforceDeadline && Date.parse(authorization.resetDeadline) <= now()) {
    throw new Error(`Release reset authorization for ${releaseName} has expired.`);
  }
  return authorization;
};
