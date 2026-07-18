import assert from "node:assert/strict";
import { test } from "node:test";

import {
  loadReleaseResetAuthorization,
  validateReleaseResetAuthorizations,
} from "../lib/release-reset-authorization.mjs";
import {
  validateRemoteState,
  verifyReleaseImmutability,
} from "./validate-release-immutability.mjs";

const releaseName = "v1.1.0";
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
const retiredRun = {
  id: 100001,
  head_branch: "v1.0.0",
  head_sha: "b".repeat(40),
  status: "completed",
  conclusion: "success",
};
const resetAuthorization = {
  releaseName: "v1.0.0",
  retiredReleasePublishedAt: "2026-07-04T14:50:15Z",
  retiredRuns: [{ runId: retiredRun.id, commitSha: retiredRun.head_sha }],
  retiredImageDigest: `sha256:${"c".repeat(64)}`,
};

test("validates the committed one-time release reset ledger", async () => {
  const authorization = await loadReleaseResetAuthorization("v1.0.0");
  assert.equal(authorization.releaseName, "v1.0.0");
  assert.equal(authorization.replacementPolicy, "one-successful-replacement");
  assert.equal(authorization.retiredRuns.length, 3);

  assert.throws(() => validateReleaseResetAuthorizations({
    schemaVersion: "forward-dynatrace-release-reset-authorizations/v1",
    authorizations: [authorization, { ...authorization, releaseName: "v1.0.1" }],
  }), /Only one pre-customer release reset/u);
  await assert.rejects(loadReleaseResetAuthorization("v1.0.0", {
    enforceDeadline: true,
    now: () => Date.parse(authorization.resetDeadline) + 1,
  }), /has expired/u);
});

test("accepts only a first publication attempt for the exact tag and commit", () => {
  assert.deepEqual(validateRemoteState({
    releaseName,
    commitSha,
    runId,
    workflowPages: [{ total_count: 1, workflow_runs: [currentRun] }],
    releasePages: [[]],
  }), {
    observedWorkflowRuns: 1,
    existingReleases: 0,
    releaseResetAuthorized: false,
    replacementAttempts: 0,
  });
  assert.deepEqual(validateRemoteState({
    releaseName,
    commitSha,
    runId,
    workflowPages: [{ total_count: 0, workflow_runs: [] }],
    releasePages: [[]],
  }), {
    observedWorkflowRuns: 0,
    existingReleases: 0,
    releaseResetAuthorized: false,
    replacementAttempts: 0,
  });
});

test("accepts only the exact retired lineage for a one-time release reset", () => {
  const replacement = {
    ...currentRun,
    head_branch: "v1.0.0",
  };
  assert.deepEqual(validateRemoteState({
    releaseName: "v1.0.0",
    commitSha,
    runId,
    workflowPages: [{ total_count: 2, workflow_runs: [replacement, retiredRun] }],
    releasePages: [[{
      tag_name: "v1.0.0",
      published_at: resetAuthorization.retiredReleasePublishedAt,
    }]],
    resetAuthorization,
  }), {
    observedWorkflowRuns: 2,
    existingReleases: 1,
    releaseResetAuthorized: true,
    replacementAttempts: 0,
  });

  assert.throws(() => validateRemoteState({
    releaseName: "v1.0.0",
    commitSha,
    runId,
    workflowPages: [{
      total_count: 3,
      workflow_runs: [replacement, retiredRun, { ...retiredRun, id: 100002 }],
    }],
    releasePages: [[]],
    resetAuthorization,
  }), /does not match its authorization/u);

  assert.throws(() => validateRemoteState({
    releaseName: "v1.0.0",
    commitSha,
    runId,
    workflowPages: [{
      total_count: 3,
      workflow_runs: [
        replacement,
        retiredRun,
        { ...replacement, id: 100003, conclusion: "success", status: "completed" },
      ],
    }],
    releasePages: [[]],
    resetAuthorization,
  }), /does not match its authorization/u);
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
  const imageReference = "ghcr.io/forwardnetworks/forward-dynatrace-importer:v1.1.0";
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
    resetAuthorization: null,
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
    return { stdout: `Name: existing image\nDigest: sha256:${"d".repeat(64)}\n`, stderr: "" };
  };
  await assert.rejects(verifyReleaseImmutability({
    releaseName, repository, commitSha, runId, runner: baseRunner, resetAuthorization: null,
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
    resetAuthorization: null,
  }), /Unable to prove GHCR tag absence/u);
});

test("authorizes the recorded retired release and image exactly once", async () => {
  const resetReleaseName = "v1.0.0";
  const replacement = { ...currentRun, head_branch: resetReleaseName };
  const runner = async (command, args) => {
    if (command === "gh" && args.at(-1).includes("/actions/workflows/")) {
      return {
        stdout: JSON.stringify([{
          total_count: 2,
          workflow_runs: [replacement, retiredRun],
        }]),
        stderr: "",
      };
    }
    if (command === "gh") {
      return {
        stdout: JSON.stringify([[{
          tag_name: resetReleaseName,
          published_at: resetAuthorization.retiredReleasePublishedAt,
        }]]),
        stderr: "",
      };
    }
    return {
      stdout: `Name: image\nDigest: ${resetAuthorization.retiredImageDigest}\n`,
      stderr: "",
    };
  };

  const report = await verifyReleaseImmutability({
    releaseName: resetReleaseName,
    repository,
    commitSha,
    runId,
    runner,
    resetAuthorization,
  });
  assert.equal(report.releaseResetAuthorized, true);
  assert.equal(report.existingReleases, 1);
  assert.equal(report.priorImageDigest, resetAuthorization.retiredImageDigest);

  const partialDigestRunner = async (command, args) => {
    if (command === "gh" && args.at(-1).includes("/actions/workflows/")) {
      return {
        stdout: JSON.stringify([{
          total_count: 2,
          workflow_runs: [replacement, retiredRun],
        }]),
        stderr: "",
      };
    }
    if (command === "gh") {
      return {
        stdout: JSON.stringify([[{
          tag_name: resetReleaseName,
          published_at: resetAuthorization.retiredReleasePublishedAt,
        }]]),
        stderr: "",
      };
    }
    return { stdout: `Name: image\nDigest: sha256:${"d".repeat(64)}\n`, stderr: "" };
  };
  await assert.rejects(verifyReleaseImmutability({
    releaseName: resetReleaseName,
    repository,
    commitSha,
    runId,
    runAttempt: 1,
    runner: partialDigestRunner,
    resetAuthorization,
  }), /does not match the retired release authorization/u);
  const retryReport = await verifyReleaseImmutability({
    releaseName: resetReleaseName,
    repository,
    commitSha,
    runId,
    runAttempt: 2,
    runner: partialDigestRunner,
    resetAuthorization,
  });
  assert.equal(retryReport.workflowRunAttempt, 2);
});
