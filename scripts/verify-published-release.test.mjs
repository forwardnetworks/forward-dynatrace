import assert from "node:assert/strict";
import { createHash, generateKeyPairSync, sign } from "node:crypto";
import { mkdir, mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { test } from "node:test";

import { releaseSigningPayload } from "./sign-release-checksums.mjs";
import {
  parseChecksums,
  parseImageDigest,
  selectReleaseRun,
  validateAttestationResults,
  validateReleaseMetadata,
  validateSbom,
  validateTrivySarif,
  verifyDownloadedSignature,
  verifyPublishedRelease,
  withRetries,
} from "./verify-published-release.mjs";

const digest = (value) => createHash("sha256").update(value).digest("hex");
const commitSha = "a".repeat(40);
const imageDigest = `sha256:${"b".repeat(64)}`;
const repository = "forwardnetworks/forward-dynatrace";

const releaseMetadata = {
  tagName: "v1.1.0",
  isDraft: false,
  isPrerelease: false,
  publishedAt: "2026-07-15T18:30:00.000Z",
  url: "https://github.com/forwardnetworks/forward-dynatrace/releases/tag/v1.1.0",
  targetCommitish: "main",
};

const releaseRun = {
  databaseId: 123456,
  headSha: commitSha,
  headBranch: "v1.1.0",
  status: "completed",
  conclusion: "success",
  url: "https://github.com/forwardnetworks/forward-dynatrace/actions/runs/123456",
  createdAt: "2026-07-15T18:31:00.000Z",
};

const attestationResults = ({
  subjectName,
  subjectDigest,
  runId = releaseRun.databaseId,
  sourceDigest = commitSha,
} = {}) => [{
  verificationResult: {
    signature: {
      certificate: {
        sourceRepositoryURI: `https://github.com/${repository}`,
        sourceRepositoryDigest: sourceDigest,
        sourceRepositoryRef: "refs/tags/v1.1.0",
        buildSignerURI:
          `https://github.com/${repository}/.github/workflows/release.yml@refs/tags/v1.1.0`,
        runnerEnvironment: "github-hosted",
        runInvocationURI: `https://github.com/${repository}/actions/runs/${runId}/attempts/1`,
      },
    },
    statement: {
      predicateType: "https://slsa.dev/provenance/v1",
      subject: [{
        name: subjectName,
        digest: { sha256: subjectDigest.replace(/^sha256:/u, "") },
      }],
    },
  },
}];

test("validates release metadata, workflow identity, image digest, SBOM, and empty SARIF", () => {
  assert.equal(validateReleaseMetadata(releaseMetadata, "v1.1.0").tagName, "v1.1.0");
  assert.equal(selectReleaseRun([releaseRun], { releaseName: "v1.1.0", commitSha }).databaseId, 123456);
  assert.equal(parseImageDigest(`Name: image\nDigest: ${imageDigest}\n`), imageDigest);
  assert.deepEqual(validateSbom({
    bomFormat: "CycloneDX",
    specVersion: "1.5",
    metadata: { component: { name: "forward-dynatrace", version: "1.1.0" } },
    components: [{}],
  }, "1.1.0"), { format: "CycloneDX", specVersion: "1.5", components: 1 });
  assert.deepEqual(validateTrivySarif({
    version: "2.1.0",
    runs: [{ tool: { driver: { name: "Trivy" } }, results: [] }],
  }), {
    tool: "Trivy",
    runs: 1,
    results: 0,
  });
});

test("binds attestations to the exact release workflow run, source, and subject digest", () => {
  const subjectName = "forward-dynatrace-app-v1.1.0.tgz";
  const subjectDigest = "c".repeat(64);
  const results = attestationResults({ subjectName, subjectDigest });
  assert.equal(validateAttestationResults(results, {
    repository,
    commitSha,
    releaseName: "v1.1.0",
    workflowRunId: releaseRun.databaseId,
    subjectName,
    subjectDigest,
  }), `https://github.com/${repository}/actions/runs/123456/attempts/1`);

  assert.throws(() => validateAttestationResults(results, {
    repository,
    commitSha,
    releaseName: "v1.1.0",
    workflowRunId: 999999,
    subjectName,
    subjectDigest,
  }), /does not match the exact release workflow run/u);
  assert.throws(() => validateAttestationResults(results, {
    repository,
    commitSha,
    releaseName: "v1.1.0",
    workflowRunId: releaseRun.databaseId,
    subjectName,
    subjectDigest: "d".repeat(64),
  }), /does not match the exact release workflow run/u);
});

test("fails closed on draft releases, mismatched runs, malformed checksums, and vulnerability results", () => {
  assert.throws(
    () => validateReleaseMetadata({ ...releaseMetadata, isDraft: true }, "v1.1.0"),
    /still a draft/u,
  );
  assert.throws(
    () => selectReleaseRun([{ ...releaseRun, headBranch: "main" }], { releaseName: "v1.1.0", commitSha }),
    /found 0/u,
  );
  assert.throws(
    () => selectReleaseRun([
      releaseRun,
      { ...releaseRun, databaseId: 123455, headSha: "f".repeat(40) },
    ], { releaseName: "v1.1.0", commitSha }),
    /tag immutability is violated/u,
  );
  assert.throws(
    () => selectReleaseRun(Array.from({ length: 100 }, (_, index) => ({
      ...releaseRun,
      databaseId: index + 1,
    })), { releaseName: "v1.1.0", commitSha }),
    /reached the bounded query limit/u,
  );
  assert.throws(() => parseChecksums(`${"a".repeat(64)} *artifact.tgz\n`), /Invalid SHA256SUMS/u);
  assert.throws(
    () => validateTrivySarif({
      version: "2.1.0",
      runs: [{ tool: { driver: { name: "Trivy" } }, results: [{}] }],
    }),
    /contains 1 HIGH\/CRITICAL/u,
  );
  assert.throws(
    () => validateTrivySarif({
      version: "2.1.0",
      runs: [{ tool: { driver: { name: "not-trivy" } }, results: [] }],
    }),
    /not produced by Trivy/u,
  );
  assert.throws(
    () => validateReleaseMetadata({
      ...releaseMetadata,
      url: "https://github.com/other/repository/releases/tag/v1.1.0",
    }, "v1.1.0", repository),
    /does not match the requested repository and tag/u,
  );
});

test("verifies an optional detached checksum signature and enforces paired files", async () => {
  const directory = await mkdtemp(path.join(tmpdir(), "published-release-signature-"));
  const checksumsText = `${"a".repeat(64)}  artifact.tgz\n`;
  const { privateKey, publicKey } = generateKeyPairSync("ed25519");
  const signature = sign(null, Buffer.from(releaseSigningPayload(checksumsText)), privateKey).toString("base64");
  await Promise.all([
    writeFile(path.join(directory, "SHA256SUMS"), checksumsText),
    writeFile(path.join(directory, "SHA256SUMS.sig"), `${signature}\n`),
    writeFile(path.join(directory, "SHA256SUMS.pub"), publicKey.export({ type: "spki", format: "pem" })),
  ]);
  assert.equal(await verifyDownloadedSignature(directory, { required: true }), "verified");

  const incomplete = await mkdtemp(path.join(tmpdir(), "published-release-signature-"));
  await writeFile(path.join(incomplete, "SHA256SUMS.sig"), `${signature}\n`);
  await assert.rejects(verifyDownloadedSignature(incomplete), /both SHA256SUMS.sig/u);

  await writeFile(path.join(directory, "SHA256SUMS.sig"), "not-base64!\n");
  await assert.rejects(verifyDownloadedSignature(directory), /not valid base64/u);
});

test("rejects a non-empty output directory and malformed release tag before network access", async () => {
  const outputDir = await mkdtemp(path.join(tmpdir(), "published-release-verification-"));
  await writeFile(path.join(outputDir, "stale.json"), "{}\n");
  const runner = async () => {
    throw new Error("runner must not be called");
  };
  await assert.rejects(
    verifyPublishedRelease({ releaseName: "v1.1.0", outputDir, runner }),
    /must be new or empty/u,
  );

  const emptyOutputDir = await mkdtemp(path.join(tmpdir(), "published-release-verification-"));
  await assert.rejects(
    verifyPublishedRelease({ releaseName: "release-1.1.0", outputDir: emptyOutputDir, runner }),
    /--release-name is invalid/u,
  );
});

test("retries bounded read operations with exponential delays and preserves the final error", async () => {
  const delays = [];
  let calls = 0;
  const result = await withRetries(async () => {
    calls += 1;
    if (calls < 3) throw new Error(`transient-${calls}`);
    return "ok";
  }, {
    attempts: 3,
    sleep: async (delay) => { delays.push(delay); },
  });
  assert.equal(result, "ok");
  assert.equal(calls, 3);
  assert.deepEqual(delays, [2000, 4000]);

  await assert.rejects(withRetries(
    async () => { throw new Error("still unavailable"); },
    { attempts: 2, sleep: async () => {} },
  ), /still unavailable/u);
});

test("orchestrates published release verification and writes bounded evidence", async () => {
  const outputDir = await mkdtemp(path.join(tmpdir(), "published-release-verification-"));
  const calls = [];
  let trivyAttempts = 0;
  const runner = async (command, args) => {
    calls.push([command, ...args]);
    if (command === "gh" && args[0] === "release" && args[1] === "view") {
      return { stdout: JSON.stringify(releaseMetadata), stderr: "" };
    }
    if (command === "gh" && args[0] === "api") return { stdout: `${commitSha}\n`, stderr: "" };
    if (command === "gh" && args[0] === "run" && args[1] === "list") {
      return { stdout: JSON.stringify([releaseRun]), stderr: "" };
    }
    if (command === "gh" && args[0] === "release" && args[1] === "download") {
      const names = [
        "forward-dynatrace-app-v1.1.0.tgz",
        "forward-dynatrace-importer-v1.1.0.tgz",
        "forward-dynatrace-sbom-v1.1.0.cdx.json",
      ];
      const contents = [
        Buffer.from("app archive"),
        Buffer.from("importer archive"),
        Buffer.from(JSON.stringify({
          bomFormat: "CycloneDX",
          specVersion: "1.5",
          metadata: { component: { name: "forward-dynatrace", version: "1.1.0" } },
          components: [{}],
        })),
      ];
      await Promise.all(names.map((name, index) => writeFile(path.join(outputDir, name), contents[index])));
      await writeFile(path.join(outputDir, "SHA256SUMS"), `${names.map(
        (name, index) => `${digest(contents[index])}  ${name}`,
      ).join("\n")}\n`);
      return { stdout: "", stderr: "" };
    }
    if (command === "gh" && args[0] === "attestation") {
      const subject = args[2];
      if (subject.startsWith("oci://")) {
        return {
          stdout: JSON.stringify(attestationResults({
            subjectName: "ghcr.io/forwardnetworks/forward-dynatrace-importer",
            subjectDigest: imageDigest,
          })),
          stderr: "",
        };
      }
      return {
        stdout: JSON.stringify(attestationResults({
          subjectName: path.basename(subject),
          subjectDigest: digest(await readFile(subject)),
        })),
        stderr: "",
      };
    }
    if (command === "docker") {
      return { stdout: `Name: image\nDigest: ${imageDigest}\n`, stderr: "" };
    }
    if (command === "gh" && args[0] === "run" && args[1] === "download") {
      const trivyDir = args[args.indexOf("--dir") + 1];
      await mkdir(trivyDir, { recursive: true });
      trivyAttempts += 1;
      if (trivyAttempts === 1) {
        await writeFile(path.join(trivyDir, "partial.sarif"), "partial");
        throw new Error("transient Trivy artifact download failure");
      }
      await assert.rejects(readFile(path.join(trivyDir, "partial.sarif")), /ENOENT/u);
      await writeFile(path.join(trivyDir, "trivy-results.sarif"), JSON.stringify({
        version: "2.1.0",
        runs: [{ tool: { driver: { name: "Trivy" } }, results: [] }],
      }));
      return { stdout: "", stderr: "" };
    }
    throw new Error(`Unexpected command: ${command} ${args.join(" ")}`);
  };

  const { report, reportPath } = await verifyPublishedRelease({
    releaseName: "v1.1.0",
    outputDir,
    runner,
    commandAttempts: 2,
    sleep: async () => {},
    now: () => "2026-07-15T18:40:00.000Z",
  });
  assert.equal(report.status, "verified");
  assert.equal(report.release.workflowRunId, 123456);
  assert.equal(report.artifacts.checksumSignature, "not-published");
  assert.equal(
    report.artifacts.attestations[0].workflowInvocation,
    `https://github.com/${repository}/actions/runs/123456/attempts/1`,
  );
  assert.equal(report.image.digest, imageDigest);
  assert.equal(
    report.image.attestationWorkflowInvocation,
    `https://github.com/${repository}/actions/runs/123456/attempts/1`,
  );
  assert.equal(report.trivy.results, 0);
  assert.equal(trivyAttempts, 2);
  assert.deepEqual(JSON.parse(await readFile(reportPath, "utf8")), report);
  const attestationCalls = calls.filter((call) => call[0] === "gh" && call[1] === "attestation");
  assert.equal(attestationCalls.length, 5);
  for (const call of attestationCalls) {
    assert.ok(call.includes("--deny-self-hosted-runners"));
    assert.ok(call.includes("--source-digest"));
    assert.ok(call.includes(commitSha));
    assert.ok(call.includes("refs/tags/v1.1.0"));
    assert.ok(call.includes(`${repository}/.github/workflows/release.yml`));
  }
  const runListCall = calls.find((call) => call[0] === "gh" && call[1] === "run" && call[2] === "list");
  assert.ok(runListCall.includes("--branch"));
  assert.ok(runListCall.includes("v1.1.0"));
  assert.ok(!runListCall.includes("--commit"));
  assert.ok(runListCall.includes("100"));
  const releaseDownloadCall = calls.find((call) =>
    call[0] === "gh" && call[1] === "release" && call[2] === "download");
  assert.ok(releaseDownloadCall.includes("--clobber"));
});
