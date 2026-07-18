#!/usr/bin/env node

import { createHash, verify as verifySignature } from "node:crypto";
import { spawn } from "node:child_process";
import { mkdir, readdir, readFile, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { pathToFileURL } from "node:url";

import { releaseSigningPayload } from "./sign-release-checksums.mjs";
import { loadReleaseResetAuthorization } from "../lib/release-reset-authorization.mjs";

const REPORT_SCHEMA = "forward-dynatrace-published-release-verification/v1";
const TRIVY_ARTIFACT = "forward-dynatrace-trivy-sarif";
const DEFAULT_REPOSITORY = "forwardnetworks/forward-dynatrace";
const RELEASE_WORKFLOW = ".github/workflows/release.yml";
const RELEASE_RUN_LIMIT = 100;
const SLSA_PROVENANCE = "https://slsa.dev/provenance/v1";
const RELEASE_TAG = /^v(?:0|[1-9][0-9]*)\.(?:0|[1-9][0-9]*)\.(?:0|[1-9][0-9]*)$/u;

const usage = `
Verify a published Forward for Dynatrace release

Usage:
  npm run release:published:verify -- \\
    --release-name v1.1.0 \\
    --output-dir /secure/evidence/forward-dynatrace-v1.1.0

Options:
  --release-name value  Exact published tag to verify.
  --output-dir path     New or empty directory for downloaded evidence.
  --repository owner/name
                        GitHub repository; defaults to ${DEFAULT_REPOSITORY}.
  --require-signature   Fail if SHA256SUMS.sig and SHA256SUMS.pub are absent.
  --help                Show help.

The verifier requires authenticated GitHub CLI access, Docker Buildx, and read
access to the release, attestations, workflow artifacts, and GHCR image. It
downloads immutable evidence, performs no release or registry writes, and emits
published-release-verification.json.
`;

const sha256 = (value) => createHash("sha256").update(value).digest("hex");
const wait = (milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds));

export const parseArgs = (argv) => {
  const args = {};
  for (let index = 0; index < argv.length; index += 1) {
    const value = argv[index];
    if (value === "--help" || value === "-h") {
      args.help = true;
      continue;
    }
    if (value === "--require-signature") {
      args.requireSignature = true;
      continue;
    }
    if (["--release-name", "--output-dir", "--repository"].includes(value)) {
      const next = argv[index + 1];
      if (!next || next.startsWith("--")) throw new Error(`Missing value for ${value}.`);
      args[value.slice(2)] = next;
      index += 1;
      continue;
    }
    throw new Error(`Unsupported option: ${value}`);
  }
  return args;
};

const requiredString = (value, label, pattern = null) => {
  const normalized = typeof value === "string" ? value.trim() : "";
  if (!normalized) throw new Error(`${label} is required.`);
  if (pattern && !pattern.test(normalized)) throw new Error(`${label} is invalid.`);
  return normalized;
};

export const runCommand = (command, args) =>
  new Promise((resolve, reject) => {
    const child = spawn(command, args, { stdio: ["ignore", "pipe", "pipe"] });
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (chunk) => { stdout += chunk; });
    child.stderr.on("data", (chunk) => { stderr += chunk; });
    child.on("error", reject);
    child.on("close", (code) => {
      if (code !== 0) {
        reject(new Error(`${command} ${args.join(" ")} exited ${code}: ${stderr || stdout}`));
        return;
      }
      resolve({ stdout, stderr });
    });
  });

export const withRetries = async (operation, {
  attempts = 3,
  sleep = wait,
  delayMs = 2000,
} = {}) => {
  if (!Number.isInteger(attempts) || attempts < 1) throw new Error("Retry attempts must be a positive integer.");
  let lastError;
  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    try {
      return await operation(attempt);
    } catch (error) {
      lastError = error;
      if (attempt < attempts) await sleep(delayMs * (2 ** (attempt - 1)));
    }
  }
  throw lastError;
};

const commandText = async (runner, command, args) =>
  (await runner(command, args)).stdout;

export const validateReleaseMetadata = (metadata, releaseName, repository = DEFAULT_REPOSITORY) => {
  if (!metadata || typeof metadata !== "object" || Array.isArray(metadata)) {
    throw new Error("GitHub release metadata must be a JSON object.");
  }
  if (metadata.tagName !== releaseName) throw new Error("GitHub release tag does not match the requested tag.");
  if (metadata.isDraft) throw new Error("GitHub release is still a draft.");
  const prereleaseExpected = releaseName.startsWith("v0.");
  if (Boolean(metadata.isPrerelease) !== prereleaseExpected) {
    throw new Error(
      prereleaseExpected
        ? "Pre-1.0 GitHub releases must be marked as prereleases."
        : "GitHub release is unexpectedly marked as a prerelease.",
    );
  }
  if (!Number.isFinite(Date.parse(metadata.publishedAt))) {
    throw new Error("GitHub release has no valid publication time.");
  }
  const url = new URL(requiredString(metadata.url, "GitHub release URL"));
  const expectedUrl = `https://github.com/${repository}/releases/tag/${releaseName}`;
  if (url.toString() !== expectedUrl) {
    throw new Error("GitHub release URL does not match the requested repository and tag.");
  }
  return {
    tagName: releaseName,
    publishedAt: metadata.publishedAt,
    url: url.toString(),
    targetCommitish: requiredString(metadata.targetCommitish, "GitHub release target"),
  };
};

export const parseChecksums = (text) => {
  const entries = new Map();
  const lines = String(text).trim().split(/\r?\n/u).filter(Boolean);
  for (const line of lines) {
    const match = /^([a-f0-9]{64})  ([A-Za-z0-9][A-Za-z0-9._-]*)$/u.exec(line);
    if (!match) throw new Error(`Invalid SHA256SUMS line: ${line}`);
    if (entries.has(match[2])) throw new Error(`Duplicate SHA256SUMS entry: ${match[2]}`);
    entries.set(match[2], match[1]);
  }
  return entries;
};

export const verifyDownloadedChecksums = async (directory, expectedNames) => {
  const checksumsText = await readFile(path.join(directory, "SHA256SUMS"), "utf8");
  const entries = parseChecksums(checksumsText);
  if (entries.size !== expectedNames.length || expectedNames.some((name) => !entries.has(name))) {
    throw new Error("SHA256SUMS does not contain the exact expected release artifacts.");
  }
  const verified = {};
  for (const name of expectedNames) {
    const digest = sha256(await readFile(path.join(directory, name)));
    if (digest !== entries.get(name)) throw new Error(`Checksum mismatch for ${name}.`);
    verified[name] = digest;
  }
  return { checksumsText, verified };
};

export const verifyDownloadedSignature = async (directory, { required = false } = {}) => {
  const names = new Set(await readdir(directory));
  const hasSignature = names.has("SHA256SUMS.sig");
  const hasPublicKey = names.has("SHA256SUMS.pub");
  if (hasSignature !== hasPublicKey) {
    throw new Error("Release must publish both SHA256SUMS.sig and SHA256SUMS.pub or neither.");
  }
  if (!hasSignature) {
    if (required) throw new Error("Release checksum signature is required but was not published.");
    return "not-published";
  }
  const [checksumsText, publicKey, signatureText] = await Promise.all([
    readFile(path.join(directory, "SHA256SUMS"), "utf8"),
    readFile(path.join(directory, "SHA256SUMS.pub"), "utf8"),
    readFile(path.join(directory, "SHA256SUMS.sig"), "utf8"),
  ]);
  const encodedSignature = signatureText.trim();
  if (!/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/u.test(encodedSignature)) {
    throw new Error("Release checksum signature is not valid base64.");
  }
  const signature = Buffer.from(encodedSignature, "base64");
  if (signature.length !== 64 || signature.toString("base64") !== encodedSignature) {
    throw new Error("Release checksum signature is not a canonical Ed25519 signature.");
  }
  if (!verifySignature(
    null,
    Buffer.from(releaseSigningPayload(checksumsText), "utf8"),
    publicKey,
    signature,
  )) {
    throw new Error("Release checksum signature verification failed.");
  }
  return "verified";
};

export const validateSbom = (sbom, version) => {
  if (sbom?.bomFormat !== "CycloneDX" || !/^1\.[0-9]+$/u.test(String(sbom.specVersion || ""))) {
    throw new Error("Release SBOM is not a supported CycloneDX document.");
  }
  const component = sbom.metadata?.component;
  if (component?.name !== "forward-dynatrace" || component?.version !== version) {
    throw new Error("Release SBOM component identity does not match the release.");
  }
  if (!Array.isArray(sbom.components) || sbom.components.length === 0) {
    throw new Error("Release SBOM contains no production components.");
  }
  return { format: sbom.bomFormat, specVersion: sbom.specVersion, components: sbom.components.length };
};

export const selectReleaseRun = (
  runs,
  { releaseName, commitSha, resetAuthorization = null },
) => {
  if (!Array.isArray(runs)) throw new Error("GitHub release workflow runs must be an array.");
  if (runs.length >= RELEASE_RUN_LIMIT) {
    throw new Error(`Release workflow history for ${releaseName} reached the bounded query limit.`);
  }
  if (resetAuthorization && resetAuthorization.releaseName !== releaseName) {
    throw new Error(`Release reset authorization does not apply to ${releaseName}.`);
  }
  const tagRuns = runs.filter((run) => run.headBranch === releaseName);
  const retiredRuns = new Map(
    (resetAuthorization?.retiredRuns || []).map((run) => [run.runId, run.commitSha]),
  );
  const observedRetiredRunIds = new Set();
  const conflicting = tagRuns.filter((run) => {
    if (run.headSha === commitSha) return false;
    if (retiredRuns.get(run.databaseId) === run.headSha) {
      observedRetiredRunIds.add(run.databaseId);
      return false;
    }
    return true;
  });
  if (conflicting.length > 0) {
    const evidence = conflicting.map((run) => `${run.databaseId ?? "unknown"}:${run.headSha ?? "missing"}`).join(", ");
    throw new Error(
      `Release tag ${releaseName} has workflow history for a different commit; tag immutability is violated (${evidence}).`,
    );
  }
  const missingRetired = [...retiredRuns.keys()].filter((id) => !observedRetiredRunIds.has(id));
  if (missingRetired.length > 0) {
    throw new Error(`Release reset history for ${releaseName} is incomplete.`);
  }
  const matching = tagRuns.filter(
    (run) => run.headSha === commitSha && run.status === "completed",
  );
  const successful = matching.filter((run) => run.conclusion === "success")
    .sort((left, right) => Date.parse(right.createdAt) - Date.parse(left.createdAt));
  if (successful.length !== 1) {
    throw new Error(`Expected exactly one successful completed release run for ${releaseName}; found ${successful.length}.`);
  }
  const run = successful[0];
  if (!Number.isInteger(run.databaseId) || run.databaseId <= 0) {
    throw new Error("Release workflow run has no valid database ID.");
  }
  return run;
};

export const parseImageDigest = (text) => {
  const match = /^Digest:\s*(sha256:[a-f0-9]{64})\s*$/mu.exec(String(text));
  if (!match) throw new Error("Published image inspection did not return a registry digest.");
  return match[1];
};

export const validateTrivySarif = (sarif) => {
  if (sarif?.version !== "2.1.0" || !Array.isArray(sarif.runs) || sarif.runs.length === 0) {
    throw new Error("Trivy artifact is not a valid SARIF 2.1.0 result.");
  }
  if (sarif.runs.some((run) => run?.tool?.driver?.name !== "Trivy")) {
    throw new Error("SARIF artifact was not produced by Trivy.");
  }
  const results = sarif.runs.reduce((count, run) => count + (Array.isArray(run.results) ? run.results.length : 0), 0);
  if (results !== 0) throw new Error(`Trivy SARIF contains ${results} HIGH/CRITICAL result(s).`);
  return { tool: "Trivy", runs: sarif.runs.length, results };
};

export const validateAttestationResults = (results, {
  repository,
  commitSha,
  releaseName,
  workflowRunId,
  subjectName,
  subjectDigest,
}) => {
  if (!Array.isArray(results) || results.length === 0) {
    throw new Error(`No verified attestations were returned for ${subjectName}.`);
  }
  const sourceRef = `refs/tags/${releaseName}`;
  const sourceUri = `https://github.com/${repository}`;
  const signerUri = `${sourceUri}/${RELEASE_WORKFLOW}@${sourceRef}`;
  const invocationPrefix = `${sourceUri}/actions/runs/${workflowRunId}/attempts/`;
  const expectedDigest = subjectDigest.replace(/^sha256:/u, "");
  const matching = results.find(({ verificationResult }) => {
    const certificate = verificationResult?.signature?.certificate;
    const statement = verificationResult?.statement;
    const invocation = certificate?.runInvocationURI;
    return certificate?.sourceRepositoryURI === sourceUri &&
      certificate?.sourceRepositoryDigest === commitSha &&
      certificate?.sourceRepositoryRef === sourceRef &&
      certificate?.buildSignerURI === signerUri &&
      certificate?.runnerEnvironment === "github-hosted" &&
      typeof invocation === "string" &&
      invocation.startsWith(invocationPrefix) &&
      /^[1-9][0-9]*$/u.test(invocation.slice(invocationPrefix.length)) &&
      statement?.predicateType === SLSA_PROVENANCE &&
      Array.isArray(statement?.subject) &&
      statement.subject.some((subject) =>
        subject?.name === subjectName && subject?.digest?.sha256 === expectedDigest);
  });
  if (!matching) {
    throw new Error(
      `Verified attestation for ${subjectName} does not match the exact release workflow run and subject digest.`,
    );
  }
  return matching.verificationResult.signature.certificate.runInvocationURI;
};

const attestationPolicyArgs = ({ repository, commitSha, releaseName }) => [
  "--signer-workflow", `${repository}/${RELEASE_WORKFLOW}`,
  "--source-digest", commitSha,
  "--source-ref", `refs/tags/${releaseName}`,
  "--deny-self-hosted-runners",
  "--format", "json",
];

const recursiveFiles = async (directory) => {
  const output = [];
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const entryPath = path.join(directory, entry.name);
    if (entry.isDirectory()) output.push(...await recursiveFiles(entryPath));
    else if (entry.isFile()) output.push(entryPath);
  }
  return output;
};

const prepareOutputDirectory = async (directory) => {
  await mkdir(directory, { recursive: true, mode: 0o700 });
  if ((await readdir(directory)).length !== 0) {
    throw new Error("--output-dir must be new or empty so stale release evidence cannot be accepted.");
  }
};

export const verifyPublishedRelease = async ({
  releaseName,
  outputDir,
  repository = DEFAULT_REPOSITORY,
  requireSignature = false,
  runner = runCommand,
  commandAttempts = 3,
  sleep = wait,
  now = () => new Date().toISOString(),
  resetAuthorization,
} = {}) => {
  const tag = requiredString(releaseName, "--release-name", RELEASE_TAG);
  const authorizedReset = resetAuthorization === undefined
    ? await loadReleaseResetAuthorization(tag)
    : resetAuthorization;
  const repo = requiredString(repository, "--repository", /^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/u);
  const owner = repo.split("/")[0];
  const destination = path.resolve(requiredString(outputDir, "--output-dir"));
  await prepareOutputDirectory(destination);
  const readRunner = (command, args) => withRetries(
    () => runner(command, args),
    { attempts: commandAttempts, sleep },
  );

  const metadata = validateReleaseMetadata(JSON.parse(await commandText(readRunner, "gh", [
    "release", "view", tag, "--repo", repo,
    "--json", "tagName,isDraft,isPrerelease,publishedAt,url,targetCommitish",
  ])), tag, repo);
  if (authorizedReset && Date.parse(metadata.publishedAt) <= Date.parse(authorizedReset.approvedAt)) {
    throw new Error("Replacement release publication time does not follow its reset approval.");
  }
  const commitSha = (await commandText(readRunner, "gh", [
    "api", `repos/${repo}/commits/${tag}`, "--jq", ".sha",
  ])).trim();
  if (!/^[a-f0-9]{40}$/u.test(commitSha)) throw new Error("Release tag did not resolve to a commit SHA.");

  const releaseRuns = JSON.parse(await commandText(readRunner, "gh", [
    "run", "list", "--repo", repo, "--workflow", "release.yml", "--event", "push",
    "--branch", tag, "--limit", String(RELEASE_RUN_LIMIT),
    "--json", "databaseId,headSha,headBranch,status,conclusion,url,createdAt",
  ]));
  const releaseRun = selectReleaseRun(releaseRuns, {
    releaseName: tag,
    commitSha,
    resetAuthorization: authorizedReset,
  });

  await readRunner("gh", [
    "release", "download", tag, "--repo", repo, "--dir", destination, "--clobber",
  ]);
  const version = tag.slice(1);
  const expectedArtifacts = [
    `forward-dynatrace-app-${tag}.tgz`,
    `forward-dynatrace-importer-${tag}.tgz`,
    `forward-dynatrace-sbom-${tag}.cdx.json`,
  ];
  const allowedAssets = new Set([...expectedArtifacts, "SHA256SUMS", "SHA256SUMS.sig", "SHA256SUMS.pub"]);
  const downloadedAssets = (await readdir(destination)).sort();
  const unexpected = downloadedAssets.filter((name) => !allowedAssets.has(name));
  if (unexpected.length > 0 || expectedArtifacts.some((name) => !downloadedAssets.includes(name)) ||
      !downloadedAssets.includes("SHA256SUMS")) {
    throw new Error(`GitHub release asset membership is invalid${unexpected.length ? `: ${unexpected.join(", ")}` : "."}`);
  }

  const { verified: checksums } = await verifyDownloadedChecksums(destination, expectedArtifacts);
  const signatureStatus = await verifyDownloadedSignature(destination, { required: requireSignature });
  const sbom = validateSbom(
    JSON.parse(await readFile(path.join(destination, expectedArtifacts[2]), "utf8")),
    version,
  );

  const attestationPolicy = attestationPolicyArgs({ repository: repo, commitSha, releaseName: tag });
  const artifactAttestations = [];
  for (const asset of downloadedAssets) {
    const assetPath = path.join(destination, asset);
    const assetDigest = sha256(await readFile(assetPath));
    const results = JSON.parse(await commandText(readRunner, "gh", [
      "attestation", "verify", assetPath, "--repo", repo, ...attestationPolicy,
    ]));
    artifactAttestations.push({
      name: asset,
      status: "verified",
      workflowInvocation: validateAttestationResults(results, {
        repository: repo,
        commitSha,
        releaseName: tag,
        workflowRunId: releaseRun.databaseId,
        subjectName: asset,
        subjectDigest: assetDigest,
      }),
    });
  }

  const imageReference = `ghcr.io/${owner}/forward-dynatrace-importer:${tag}`;
  const imageDigest = parseImageDigest(await commandText(
    readRunner,
    "docker",
    ["buildx", "imagetools", "inspect", imageReference],
  ));
  const imageAttestations = JSON.parse(await commandText(readRunner, "gh", [
    "attestation", "verify", `oci://${imageReference}`, "--owner", owner, ...attestationPolicy,
  ]));
  const imageAttestationInvocation = validateAttestationResults(imageAttestations, {
    repository: repo,
    commitSha,
    releaseName: tag,
    workflowRunId: releaseRun.databaseId,
    subjectName: imageReference.slice(0, imageReference.lastIndexOf(":")),
    subjectDigest: imageDigest,
  });

  const trivyDir = path.join(destination, "trivy");
  await withRetries(async () => {
    await rm(trivyDir, { recursive: true, force: true });
    await mkdir(trivyDir, { mode: 0o700 });
    return runner("gh", [
      "run", "download", String(releaseRun.databaseId), "--repo", repo,
      "--name", TRIVY_ARTIFACT, "--dir", trivyDir,
    ]);
  }, { attempts: commandAttempts, sleep });
  const sarifFiles = (await recursiveFiles(trivyDir)).filter((file) => file.endsWith(".sarif"));
  if (sarifFiles.length !== 1) throw new Error(`Expected one Trivy SARIF file; found ${sarifFiles.length}.`);
  const trivy = validateTrivySarif(JSON.parse(await readFile(sarifFiles[0], "utf8")));

  const report = {
    schemaVersion: REPORT_SCHEMA,
    status: "verified",
    verifiedAt: now(),
    repository: repo,
    release: {
      tag,
      url: metadata.url,
      publishedAt: metadata.publishedAt,
      commitSha,
      workflowRunId: releaseRun.databaseId,
      workflowRunUrl: releaseRun.url,
      reset: authorizedReset
        ? {
            authorized: true,
            reason: authorizedReset.reason,
            approvedAt: authorizedReset.approvedAt,
            resetDeadline: authorizedReset.resetDeadline,
            replacementPolicy: authorizedReset.replacementPolicy,
            retiredReleasePublishedAt: authorizedReset.retiredReleasePublishedAt,
            retiredWorkflowRunIds: authorizedReset.retiredRuns.map((run) => run.runId),
            retiredImageDigest: authorizedReset.retiredImageDigest,
          }
        : { authorized: false },
    },
    artifacts: {
      checksums,
      checksumSignature: signatureStatus,
      attestations: artifactAttestations,
    },
    sbom,
    image: {
      reference: imageReference,
      digest: imageDigest,
      pinnedReference: `ghcr.io/${owner}/forward-dynatrace-importer@${imageDigest}`,
      attestation: "verified",
      attestationWorkflowInvocation: imageAttestationInvocation,
    },
    trivy: {
      workflowArtifact: TRIVY_ARTIFACT,
      sarifFile: path.basename(sarifFiles[0]),
      ...trivy,
    },
  };
  const reportPath = path.join(destination, "published-release-verification.json");
  await writeFile(reportPath, `${JSON.stringify(report, null, 2)}\n`, { mode: 0o600 });
  return { report, reportPath };
};

export const run = async (argv = process.argv.slice(2)) => {
  const args = parseArgs(argv);
  if (args.help) {
    process.stdout.write(usage);
    return 0;
  }
  const { report } = await verifyPublishedRelease({
    releaseName: args["release-name"],
    outputDir: args["output-dir"],
    repository: args.repository,
    requireSignature: args.requireSignature,
  });
  process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
  return 0;
};

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  run().then((code) => { process.exitCode = code; }).catch((error) => {
    process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
    process.exitCode = 1;
  });
}
