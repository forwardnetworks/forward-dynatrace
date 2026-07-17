#!/usr/bin/env node

import { pathToFileURL } from "node:url";

import { runCommand, withRetries } from "./verify-published-release.mjs";

const REPORT_SCHEMA = "forward-dynatrace-release-immutability/v1";
const RELEASE_TAG = /^v(?:0|[1-9][0-9]*)\.(?:0|[1-9][0-9]*)\.(?:0|[1-9][0-9]*)$/u;
const DEFAULT_REPOSITORY = "forwardnetworks/forward-dynatrace";

const usage = `
Validate that a release tag has no prior publication state

Usage:
  node scripts/validate-release-immutability.mjs \\
    --release-name v1.1.0 \\
    --repository forwardnetworks/forward-dynatrace \\
    --commit-sha <40-hex-sha> \\
    --run-id <github-actions-run-id>

Options default to GITHUB_REF_NAME, GITHUB_REPOSITORY, GITHUB_SHA, and
GITHUB_RUN_ID. The command is read-only and fails before release writes when a
prior release workflow run, GitHub release, or versioned GHCR tag exists.
`;

export const parseArgs = (argv) => {
  const args = {};
  for (let index = 0; index < argv.length; index += 1) {
    const value = argv[index];
    if (value === "--help" || value === "-h") {
      args.help = true;
      continue;
    }
    if (["--release-name", "--repository", "--commit-sha", "--run-id"].includes(value)) {
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

const requiredString = (value, label, pattern) => {
  const normalized = typeof value === "string" ? value.trim() : "";
  if (!normalized) throw new Error(`${label} is required.`);
  if (!pattern.test(normalized)) throw new Error(`${label} is invalid.`);
  return normalized;
};

const parseRunId = (value) => {
  const normalized = requiredString(String(value ?? ""), "--run-id", /^[1-9][0-9]*$/u);
  const runId = Number(normalized);
  if (!Number.isSafeInteger(runId)) throw new Error("--run-id is outside the safe integer range.");
  return runId;
};

const parseJson = (text, label) => {
  try {
    return JSON.parse(text);
  } catch {
    throw new Error(`${label} did not return valid JSON.`);
  }
};

const workflowRunsFromPages = (pages) => {
  if (!Array.isArray(pages) || pages.length === 0 || pages.some((page) =>
    !page || typeof page !== "object" || Array.isArray(page) ||
    !Number.isSafeInteger(page.total_count) || page.total_count < 0 ||
    !Array.isArray(page.workflow_runs))) {
    throw new Error("Release workflow history response is invalid.");
  }
  const workflowRuns = pages.flatMap((page) => page.workflow_runs);
  if (pages.some((page) => page.total_count !== pages[0].total_count) ||
      pages[0].total_count !== workflowRuns.length) {
    throw new Error("Release workflow history pagination is incomplete.");
  }
  return workflowRuns;
};

const releasesFromPages = (pages) => {
  if (!Array.isArray(pages) || pages.length === 0 || pages.some((page) =>
    !Array.isArray(page) || page.some((release) =>
      !release || typeof release !== "object" || Array.isArray(release) ||
      typeof release.tag_name !== "string" || !release.tag_name.trim()))) {
    throw new Error("GitHub releases response is invalid.");
  }
  return pages.flat();
};

export const validateRemoteState = ({
  releaseName,
  commitSha,
  runId,
  workflowPages,
  releasePages,
}) => {
  const workflowRuns = workflowRunsFromPages(workflowPages);
  const currentRuns = workflowRuns.filter((run) => run?.id === runId);
  if (currentRuns.length > 1) throw new Error("Current release workflow run appears more than once.");
  if (currentRuns.some((run) => run.head_branch !== releaseName || run.head_sha !== commitSha)) {
    throw new Error("Current release workflow identity does not match the requested tag and commit.");
  }
  const priorRuns = workflowRuns.filter((run) => run?.id !== runId);
  if (priorRuns.length > 0) {
    const evidence = priorRuns
      .map((run) => `${run?.id ?? "unknown"}:${run?.head_sha ?? "missing"}`)
      .join(", ");
    throw new Error(`Release tag ${releaseName} already has workflow history (${evidence}).`);
  }

  const releases = releasesFromPages(releasePages);
  const existing = releases.filter((release) => release?.tag_name === releaseName);
  if (existing.length > 0) throw new Error(`GitHub release ${releaseName} already exists.`);
  return { observedWorkflowRuns: workflowRuns.length, existingReleases: 0 };
};

const probeImageTag = async (runner, imageReference) => {
  try {
    await runner("docker", ["buildx", "imagetools", "inspect", imageReference]);
    return "exists";
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    if (message.includes(`${imageReference}: not found`)) return "absent";
    throw new Error(`Unable to prove GHCR tag absence: ${message}`);
  }
};

const commandText = async (runner, command, args) => (await runner(command, args)).stdout;

export const verifyReleaseImmutability = async ({
  releaseName,
  repository = DEFAULT_REPOSITORY,
  commitSha,
  runId,
  runner = runCommand,
  attempts = 3,
  sleep,
} = {}) => {
  const tag = requiredString(releaseName, "--release-name", RELEASE_TAG);
  const repo = requiredString(repository, "--repository", /^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/u);
  const sha = requiredString(commitSha, "--commit-sha", /^[a-f0-9]{40}$/u);
  const actionRunId = parseRunId(runId);
  const readRunner = (command, args) => withRetries(
    () => runner(command, args),
    { attempts, ...(sleep ? { sleep } : {}) },
  );

  const encodedTag = encodeURIComponent(tag);
  const workflowPages = parseJson(await commandText(readRunner, "gh", [
    "api", "--paginate", "--slurp",
    `repos/${repo}/actions/workflows/release.yml/runs?branch=${encodedTag}&event=push&per_page=100`,
  ]), "Release workflow history");
  const releasePages = parseJson(await commandText(readRunner, "gh", [
    "api", "--paginate", "--slurp", `repos/${repo}/releases?per_page=100`,
  ]), "GitHub releases");
  const state = validateRemoteState({
    releaseName: tag,
    commitSha: sha,
    runId: actionRunId,
    workflowPages,
    releasePages,
  });

  const owner = repo.split("/")[0].toLowerCase();
  const imageReference = `ghcr.io/${owner}/forward-dynatrace-importer:${tag}`;
  const imageTagStatus = await withRetries(
    () => probeImageTag(runner, imageReference),
    { attempts, ...(sleep ? { sleep } : {}) },
  );
  if (imageTagStatus !== "absent") throw new Error(`GHCR image tag ${imageReference} already exists.`);

  return {
    schemaVersion: REPORT_SCHEMA,
    status: "available",
    repository: repo,
    releaseName: tag,
    commitSha: sha,
    workflowRunId: actionRunId,
    observedWorkflowRuns: state.observedWorkflowRuns,
    existingReleases: state.existingReleases,
    imageReference,
    imageTagStatus,
  };
};

export const run = async (argv = process.argv.slice(2), env = process.env) => {
  const args = parseArgs(argv);
  if (args.help) {
    process.stdout.write(usage);
    return 0;
  }
  const report = await verifyReleaseImmutability({
    releaseName: args["release-name"] || env.GITHUB_REF_NAME,
    repository: args.repository || env.GITHUB_REPOSITORY,
    commitSha: args["commit-sha"] || env.GITHUB_SHA,
    runId: args["run-id"] || env.GITHUB_RUN_ID,
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
