import assert from "node:assert/strict";
import test from "node:test";

import {
  parseArgs,
  validateRemoteState,
  verifyReleaseImmutability,
} from "./validate-release-immutability.mjs";

const commitSha = "a".repeat(40);
const runId = 123;
const currentRun = { id: runId, head_branch: "v0.11.0", head_sha: commitSha };
const workflowPages = [{ total_count: 1, workflow_runs: [currentRun] }];
const releasePages = [[]];

test("parses the immutable release identity", () => {
  assert.deepEqual(parseArgs([
    "--release-name", "v0.11.0",
    "--repository", "forwardnetworks/forward-dynatrace",
    "--commit-sha", commitSha,
    "--run-id", String(runId),
    "--run-attempt", "1",
  ]), {
    "release-name": "v0.11.0",
    repository: "forwardnetworks/forward-dynatrace",
    "commit-sha": commitSha,
    "run-id": String(runId),
    "run-attempt": "1",
  });
});

test("accepts a first publication with no prior workflow or release state", () => {
  assert.deepEqual(validateRemoteState({
    releaseName: "v0.11.0",
    commitSha,
    runId,
    workflowPages,
    releasePages,
  }), {
    observedWorkflowRuns: 1,
    existingReleases: 0,
  });
});

test("fails closed on prior workflow or release state", () => {
  assert.throws(() => validateRemoteState({
    releaseName: "v0.11.0",
    commitSha,
    runId,
    workflowPages: [{
      total_count: 2,
      workflow_runs: [currentRun, { id: 99, head_branch: "v0.11.0", head_sha: "b".repeat(40) }],
    }],
    releasePages,
  }), /already has workflow history/);
  assert.throws(() => validateRemoteState({
    releaseName: "v0.11.0",
    commitSha,
    runId,
    workflowPages,
    releasePages: [[{ tag_name: "v0.11.0" }]],
  }), /already exists/);
});

test("orchestrates read-only GitHub checks without any registry probe", async () => {
  const commands = [];
  const runner = async (command, args) => {
    commands.push([command, ...args]);
    if (args.some((arg) => String(arg).includes("actions/workflows/release.yml/runs"))) {
      return { stdout: JSON.stringify(workflowPages), stderr: "" };
    }
    if (args.some((arg) => String(arg).includes("repos/forwardnetworks/forward-dynatrace/releases"))) {
      return { stdout: JSON.stringify(releasePages), stderr: "" };
    }
    throw new Error(`Unexpected command: ${command} ${args.join(" ")}`);
  };
  const report = await verifyReleaseImmutability({
    releaseName: "v0.11.0",
    repository: "forwardnetworks/forward-dynatrace",
    commitSha,
    runId,
    runAttempt: 1,
    runner,
    sleep: async () => {},
  });
  assert.equal(report.status, "available");
  assert.equal(report.releaseName, "v0.11.0");
  assert.equal(commands.every(([command]) => command === "gh"), true);
  assert.equal(JSON.stringify(report).includes("image"), false);
});
