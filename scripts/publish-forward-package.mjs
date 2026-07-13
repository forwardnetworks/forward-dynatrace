#!/usr/bin/env node

import { randomUUID } from "node:crypto";
import {
  chmod,
  lstat,
  mkdir,
  readFile,
  readdir,
  rename,
  rm,
  symlink,
  writeFile,
} from "node:fs/promises";
import path from "node:path";
import { pathToFileURL } from "node:url";

import { validateManifest, validatePlannedChecks } from "./forward-import-package.mjs";
import {
  validateNqeChecks,
  validateNqeDiffRequests,
} from "./forward-nqe-artifacts.mjs";

const MANIFEST = "forward-dynatrace-manifest.json";
const CHECKS = "forward-intent-checks.json";
const NQE_CHECKS = "forward-nqe-checks.json";
const NQE_DIFFS = "forward-nqe-diff-requests.json";
const SIGNATURE = "forward-dynatrace-package.sig";
const STATUS_SIDECARS = new Set([
  "forward-ingest-status.json",
  "forward-ingest-status.sha256",
  "forward-ingest-status-event.json",
]);

const usage = `
Validated atomic Forward package handoff publisher

  node scripts/publish-forward-package.mjs \
    --package-dir /secure/generated-package \
    --handoff-root /srv/forward-dynatrace-handoff

Options:
  --signature-file path          Detached package signature to publish.
  --require-signature            Reject unsigned packages.
  --max-package-age-minutes n    Manifest freshness bound (default: 60).

Publishes immutable packages/<packageId>/ bytes, then atomically repoints the
latest symlink. Existing package IDs are reusable only when every byte matches.
`;

const parseArgs = (argv) => {
  const args = {};
  for (let index = 0; index < argv.length; index += 1) {
    const value = argv[index];
    if (value === "--help") { args.help = true; continue; }
    if (value === "--require-signature") { args.requireSignature = true; continue; }
    if (!value.startsWith("--")) throw new Error(`Unexpected argument: ${value}`);
    const next = argv[index + 1];
    if (!next || next.startsWith("--")) throw new Error(`Missing value for ${value}`);
    args[value.slice(2)] = next;
    index += 1;
  }
  return args;
};

const exists = async (target) => {
  try { await lstat(target); return true; } catch (error) {
    if (error?.code === "ENOENT") return false;
    throw error;
  }
};

const parseJson = (text, label) => {
  try { return JSON.parse(text); } catch (error) {
    throw new Error(`${label} is not valid JSON: ${error.message}`);
  }
};

const safePackageId = (value) => {
  if (typeof value !== "string" || !/^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/u.test(value)) {
    throw new Error("manifest.packageId must be a path-safe identifier up to 128 characters.");
  }
  return value;
};

const packageBytes = async ({ packageDir, signatureFile, requireSignature }) => {
  const manifestPath = path.join(packageDir, MANIFEST);
  const checksPath = path.join(packageDir, CHECKS);
  const manifestBuffer = await readFile(manifestPath);
  const checksBuffer = await readFile(checksPath);
  const manifestText = manifestBuffer.toString("utf8");
  const checksText = checksBuffer.toString("utf8");
  const manifest = parseJson(manifestText, MANIFEST);
  const checks = parseJson(checksText, CHECKS);
  validatePlannedChecks(checks);

  const nqeChecksBuffer = manifest.artifacts?.nqeChecks
    ? await readFile(path.join(packageDir, manifest.artifacts.nqeChecks))
    : null;
  const nqeDiffsBuffer = manifest.artifacts?.nqeDiffRequests
    ? await readFile(path.join(packageDir, manifest.artifacts.nqeDiffRequests))
    : null;
  const nqeChecksText = nqeChecksBuffer?.toString("utf8");
  const nqeDiffsText = nqeDiffsBuffer?.toString("utf8");
  const nqeChecks = nqeChecksText ? parseJson(nqeChecksText, NQE_CHECKS) : [];
  const nqeDiffs = nqeDiffsText ? parseJson(nqeDiffsText, NQE_DIFFS) : [];

  if (nqeChecks.length > 0) {
    validateNqeChecks(nqeChecks, {
      allowedQueryIds: new Set(nqeChecks.map((item) => item.definition?.queryId)),
    });
  }
  if (nqeDiffs.length > 0) {
    validateNqeDiffRequests(nqeDiffs, {
      allowedQueryIds: new Set(nqeDiffs.map((item) => item.queryId)),
    });
  }

  const defaultSignature = path.join(packageDir, SIGNATURE);
  const resolvedSignature = signatureFile || ((await exists(defaultSignature)) ? defaultSignature : null);
  const signatureBuffer = resolvedSignature ? await readFile(resolvedSignature) : null;
  if (requireSignature && !signatureBuffer) {
    throw new Error("Package signature is required but no signature file was supplied.");
  }

  return {
    manifest,
    checks,
    nqeChecks,
    nqeDiffs,
    manifestText,
    checksText,
    nqeChecksText,
    nqeDiffsText,
    files: new Map([
      [CHECKS, checksBuffer],
      ...(nqeChecksBuffer ? [[NQE_CHECKS, nqeChecksBuffer]] : []),
      ...(nqeDiffsBuffer ? [[NQE_DIFFS, nqeDiffsBuffer]] : []),
      [MANIFEST, manifestBuffer],
      ...(signatureBuffer ? [[SIGNATURE, signatureBuffer]] : []),
    ]),
  };
};

const samePublishedPackage = async (targetDir, files) => {
  const names = (await readdir(targetDir)).sort();
  const expected = [...files.keys()].sort();
  const unexpected = names.filter(
    (name) => !files.has(name) && !STATUS_SIDECARS.has(name),
  );
  if (unexpected.length > 0 || expected.some((name) => !names.includes(name))) {
    return false;
  }
  for (const [name, expectedBytes] of files) {
    const actual = await readFile(path.join(targetDir, name));
    if (!actual.equals(expectedBytes)) return false;
  }
  return true;
};

const writeImmutablePackage = async (packagesRoot, packageId, files) => {
  const targetDir = path.join(packagesRoot, packageId);
  if (await exists(targetDir)) {
    if (!(await samePublishedPackage(targetDir, files))) {
      throw new Error(`Immutable package conflict: ${packageId} already exists with different bytes.`);
    }
    return { targetDir, created: false };
  }

  const temporaryDir = path.join(packagesRoot, `.tmp-${packageId}-${randomUUID()}`);
  await mkdir(temporaryDir, { mode: 0o700 });
  try {
    for (const [name, bytes] of files) {
      const target = path.join(temporaryDir, name);
      await writeFile(target, bytes, { mode: 0o600 });
      await chmod(target, 0o600);
    }
    await rename(temporaryDir, targetDir);
    return { targetDir, created: true };
  } catch (error) {
    await rm(temporaryDir, { recursive: true, force: true });
    if (error?.code === "EEXIST" && await samePublishedPackage(targetDir, files)) {
      return { targetDir, created: false };
    }
    throw error;
  }
};

const updateLatest = async (handoffRoot, packageId) => {
  const latest = path.join(handoffRoot, "latest");
  const temporaryLink = path.join(handoffRoot, `.latest-${randomUUID()}`);
  const relativeTarget = path.join("packages", packageId);
  await symlink(relativeTarget, temporaryLink, "dir");
  try {
    await rename(temporaryLink, latest);
  } catch (error) {
    await rm(temporaryLink, { force: true });
    throw error;
  }
  return { latest, relativeTarget };
};

export const publishPackageHandoff = async ({
  packageDir,
  handoffRoot,
  signatureFile,
  requireSignature = false,
  maxPackageAgeMinutes = 60,
}) => {
  if (!Number.isFinite(maxPackageAgeMinutes) || maxPackageAgeMinutes <= 0) {
    throw new Error("maxPackageAgeMinutes must be a positive number.");
  }
  const source = await packageBytes({ packageDir, signatureFile, requireSignature });
  validateManifest(source.manifest, source.checks, {
    checksText: source.checksText,
    nqeChecks: source.nqeChecks,
    nqeChecksText: source.nqeChecksText,
    nqeDiffRequests: source.nqeDiffs,
    nqeDiffRequestsText: source.nqeDiffsText,
    maxPackageAgeMinutes,
  });
  const packageId = safePackageId(source.manifest.packageId);
  await mkdir(handoffRoot, { recursive: true, mode: 0o700 });
  const packagesRoot = path.join(handoffRoot, "packages");
  await mkdir(packagesRoot, { recursive: true, mode: 0o700 });
  const published = await writeImmutablePackage(packagesRoot, packageId, source.files);
  const pointer = await updateLatest(handoffRoot, packageId);
  return {
    status: "ok",
    packageId,
    created: published.created,
    packagePath: published.targetDir,
    latestPath: pointer.latest,
    latestTarget: pointer.relativeTarget,
    files: [...source.files.keys()],
    signature: source.files.has(SIGNATURE) ? "present" : "absent",
  };
};

export const run = async (argv = process.argv.slice(2)) => {
  const args = parseArgs(argv);
  if (args.help) return process.stdout.write(usage);
  if (!args["package-dir"]) throw new Error("Missing required option: --package-dir");
  if (!args["handoff-root"]) throw new Error("Missing required option: --handoff-root");
  const result = await publishPackageHandoff({
    packageDir: path.resolve(args["package-dir"]),
    handoffRoot: path.resolve(args["handoff-root"]),
    signatureFile: args["signature-file"] ? path.resolve(args["signature-file"]) : undefined,
    requireSignature: Boolean(args.requireSignature),
    maxPackageAgeMinutes: args["max-package-age-minutes"]
      ? Number(args["max-package-age-minutes"])
      : 60,
  });
  process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
};

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  run().catch((error) => {
    process.stderr.write(`${error.message}\n`);
    process.exitCode = 1;
  });
}
