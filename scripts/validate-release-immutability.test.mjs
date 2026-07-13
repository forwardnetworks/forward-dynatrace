import assert from "node:assert/strict";
import { test } from "node:test";

import {
  validateRemoteState,
  verifyReleaseImmutability,
} from "./validate-release-immutability.mjs";

const releaseName = "v2.0.0";
const repository = "forwardnetworks/forward-dynatrace";
const commitSha = "a".repeat(40);
const runId = 123456;
const currentRun = {
  id: runId,
  head_branch: releaseName,
  head_sha: commitSha,
  status: "in_progress",
  conclusion: null,
};

test("accepts only a first publication attempt for the exact tag and commit", () => {
  assert.deepEqual(validateRemoteState({
    releaseName,
    commitSha,
    runId,
    workflowPages: [{ total_count: 1, workflow_runs: [currentRun] }],
    releasePages: [[]],
  }), { observedWorkflowRuns: 1, existingReleases: 0 });
  assert.deepEqual(validateRemoteState({
    releaseName,
    commitSha,
    runId,
    workflowPages: [{ total_count: 0, workflow_runs: [] }],
    releasePages: [[]],
  }), { observedWorkflowRuns: 0, existingReleases: 0 });
});

test("rejects prior workflow history, mismatched current identity, and an existing release", () => {
  assert.throws(() => validateRemoteState({
    releaseName,
    commitSha,
    runId,
    workflowPages: [{ total_count: 2, workflow_runs: [currentRun, { ...currentRun, id: 123455 }] }],
    releasePages: [[]],
  }), /already has workflow history/u);
  assert.throws(() => validateRemoteState({
    releaseName,
    commitSha,
    runId,
    workflowPages: [{ total_count: 1, workflow_runs: [{ ...currentRun, head_sha: "b".repeat(40) }] }],
    releasePages: [[]],
  }), /identity does not match/u);
  assert.throws(() => validateRemoteState({
    releaseName,
    commitSha,
    runId,
    workflowPages: [{ total_count: 1, workflow_runs: [currentRun] }],
    releasePages: [[{ tag_name: releaseName }]],
  }), /already exists/u);
});

test("rejects incomplete workflow pagination and malformed release history", () => {
  assert.throws(() => validateRemoteState({
    releaseName,
    commitSha,
    runId,
    workflowPages: [{ total_count: 2, workflow_runs: [currentRun] }],
    releasePages: [[]],
  }), /pagination is incomplete/u);
  assert.throws(() => validateRemoteState({
    releaseName,
    commitSha,
    runId,
    workflowPages: [{ total_count: 1, workflow_runs: [currentRun] }],
    releasePages: [[{ tag_name: "" }]],
  }), /releases response is invalid/u);
});

test("orchestrates paginated GitHub checks and proves the GHCR tag is absent", async () => {
  const calls = [];
  let imageProbes = 0;
  const imageReference = "ghcr.io/forwardnetworks/forward-dynatrace-importer:v2.0.0";
  const runner = async (command, args) => {
    calls.push([command, ...args]);
    if (command === "gh" && args.at(-1).includes("/actions/workflows/")) {
      return { stdout: JSON.stringify([{ total_count: 1, workflow_runs: [currentRun] }]), stderr: "" };
    }
    if (command === "gh") return { stdout: JSON.stringify([[]]), stderr: "" };
    if (command === "docker") {
      imageProbes += 1;
      if (imageProbes === 1) throw new Error("temporary registry timeout");
      throw new Error(`ERROR: ${imageReference}: not found`);
    }
    throw new Error(`Unexpected command: ${command}`);
  };

  const report = await verifyReleaseImmutability({
    releaseName,
    repository,
    commitSha,
    runId,
    runner,
    attempts: 2,
    sleep: async () => {},
  });
  assert.equal(report.status, "available");
  assert.equal(report.imageTagStatus, "absent");
  assert.equal(imageProbes, 2);
  assert.equal(calls.filter((call) => call[0] === "gh").length, 2);
  assert.ok(calls.some((call) => call.includes("--paginate") && call.includes("--slurp")));
});

test("fails closed when the versioned GHCR tag exists or its absence cannot be proven", async () => {
  const baseRunner = async (command, args) => {
    if (command === "gh" && args.at(-1).includes("/actions/workflows/")) {
      return { stdout: JSON.stringify([{ total_count: 1, workflow_runs: [currentRun] }]), stderr: "" };
    }
    if (command === "gh") return { stdout: JSON.stringify([[]]), stderr: "" };
    return { stdout: "Name: existing image\n", stderr: "" };
  };
  await assert.rejects(verifyReleaseImmutability({
    releaseName, repository, commitSha, runId, runner: baseRunner,
  }), /GHCR image tag .* already exists/u);

  const uncertainRunner = async (command, args) => {
    if (command === "gh" && args.at(-1).includes("/actions/workflows/")) {
      return { stdout: JSON.stringify([{ total_count: 1, workflow_runs: [currentRun] }]), stderr: "" };
    }
    if (command === "gh") return { stdout: JSON.stringify([[]]), stderr: "" };
    throw new Error("registry authorization failed");
  };
  await assert.rejects(verifyReleaseImmutability({
    releaseName,
    repository,
    commitSha,
    runId,
    runner: uncertainRunner,
    attempts: 1,
  }), /Unable to prove GHCR tag absence/u);
});
