import assert from "node:assert/strict";
import { createHash, generateKeyPairSync, sign } from "node:crypto";
import { mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";

import { releaseSigningPayload } from "./sign-release-checksums.mjs";
import {
  parseChecksums,
  selectReleaseRun,
  validateAttestationResults,
  validateReleaseMetadata,
  validateSbom,
  verifyDownloadedSignature,
  verifyPublishedRelease,
  withRetries,
} from "./verify-published-release.mjs";

const digest = (value) => createHash("sha256").update(value).digest("hex");
const commitSha = "a".repeat(40);
const repository = "forwardnetworks/forward-dynatrace";
const releaseMetadata = {
  tagName: "v0.11.0",
  isDraft: false,
  isPrerelease: true,
  publishedAt: "2026-07-18T18:30:00.000Z",
  url: "https://github.com/forwardnetworks/forward-dynatrace/releases/tag/v0.11.0",
  targetCommitish: "main",
};
const releaseRun = {
  databaseId: 123456,
  headSha: commitSha,
  headBranch: "v0.11.0",
  status: "completed",
  conclusion: "success",
  url: "https://github.com/forwardnetworks/forward-dynatrace/actions/runs/123456",
  createdAt: "2026-07-18T18:31:00.000Z",
};

const attestationResults = ({ subjectName, subjectDigest }) => [{
  verificationResult: {
    signature: {
      certificate: {
        sourceRepositoryURI: `https://github.com/${repository}`,
        sourceRepositoryDigest: commitSha,
        sourceRepositoryRef: "refs/tags/v0.11.0",
        buildSignerURI: `https://github.com/${repository}/.github/workflows/release.yml@refs/tags/v0.11.0`,
        runnerEnvironment: "github-hosted",
        runInvocationURI: `https://github.com/${repository}/actions/runs/123456/attempts/1`,
      },
    },
    statement: {
      predicateType: "https://slsa.dev/provenance/v1",
      subject: [{ name: subjectName, digest: { sha256: subjectDigest } }],
    },
  },
}];

test("validates app-only release metadata, workflow, SBOM, and checksums", () => {
  assert.equal(validateReleaseMetadata(releaseMetadata, "v0.11.0").tagName, "v0.11.0");
  assert.equal(selectReleaseRun([releaseRun], {
    releaseName: "v0.11.0",
    commitSha,
  }).databaseId, 123456);
  assert.deepEqual(validateSbom({
    bomFormat: "CycloneDX",
    specVersion: "1.5",
    metadata: { component: { name: "forward-dynatrace", version: "0.11.0" } },
    components: [{}],
  }, "0.11.0"), { format: "CycloneDX", specVersion: "1.5", components: 1 });
  assert.equal(parseChecksums(`${"b".repeat(64)}  forward-dynatrace-app-v0.11.0.zip\n`).size, 1);
});

test("binds release attestations to the exact app artifact and workflow run", () => {
  const subjectName = "forward-dynatrace-app-v0.11.0.zip";
  const subjectDigest = "c".repeat(64);
  const result = validateAttestationResults(attestationResults({ subjectName, subjectDigest }), {
    repository,
    commitSha,
    releaseName: "v0.11.0",
    workflowRunId: 123456,
    subjectName,
    subjectDigest,
  });
  assert.equal(result, `https://github.com/${repository}/actions/runs/123456/attempts/1`);
});

test("verifies optional detached checksum signatures", async () => {
  const directory = await mkdtemp(path.join(tmpdir(), "forward-dynatrace-signature-"));
  const checksumsText = `${"a".repeat(64)}  artifact.tgz\n`;
  const { privateKey, publicKey } = generateKeyPairSync("ed25519");
  const signature = sign(
    null,
    Buffer.from(releaseSigningPayload(checksumsText)),
    privateKey,
  ).toString("base64");
  await Promise.all([
    writeFile(path.join(directory, "SHA256SUMS"), checksumsText),
    writeFile(path.join(directory, "SHA256SUMS.sig"), `${signature}\n`),
    writeFile(path.join(directory, "SHA256SUMS.pub"), publicKey.export({ type: "spki", format: "pem" })),
  ]);
  assert.equal(await verifyDownloadedSignature(directory, { required: true }), "verified");
});

test("retries bounded read operations", async () => {
  let calls = 0;
  const delays = [];
  const result = await withRetries(async () => {
    calls += 1;
    if (calls < 3) throw new Error("transient");
    return "ok";
  }, { attempts: 3, sleep: async (delay) => { delays.push(delay); } });
  assert.equal(result, "ok");
  assert.deepEqual(delays, [2000, 4000]);
});

test("orchestrates an app-only published release verification", async () => {
  const outputDir = await mkdtemp(path.join(tmpdir(), "forward-dynatrace-verify-"));
  const calls = [];
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
      const appName = "forward-dynatrace-app-v0.11.0.zip";
      const sbomName = "forward-dynatrace-sbom-v0.11.0.cdx.json";
      const app = Buffer.from("app archive");
      const sbom = Buffer.from(JSON.stringify({
        bomFormat: "CycloneDX",
        specVersion: "1.5",
        metadata: { component: { name: "forward-dynatrace", version: "0.11.0" } },
        components: [{}],
      }));
      await Promise.all([
        writeFile(path.join(outputDir, appName), app),
        writeFile(path.join(outputDir, sbomName), sbom),
        writeFile(path.join(outputDir, "SHA256SUMS"), `${digest(app)}  ${appName}\n${digest(sbom)}  ${sbomName}\n`),
      ]);
      return { stdout: "", stderr: "" };
    }
    if (command === "gh" && args[0] === "attestation") {
      const subject = args[2];
      return {
        stdout: JSON.stringify(attestationResults({
          subjectName: path.basename(subject),
          subjectDigest: digest(await readFile(subject)),
        })),
        stderr: "",
      };
    }
    throw new Error(`Unexpected command: ${command} ${args.join(" ")}`);
  };
  const { report, reportPath } = await verifyPublishedRelease({
    releaseName: "v0.11.0",
    outputDir,
    runner,
    sleep: async () => {},
    now: () => "2026-07-18T18:40:00.000Z",
  });
  assert.equal(report.status, "verified");
  assert.equal(report.release.workflowRunId, 123456);
  assert.equal(report.sbom.components, 1);
  assert.equal("image" in report, false);
  assert.equal("trivy" in report, false);
  assert.deepEqual(JSON.parse(await readFile(reportPath, "utf8")), report);
  assert.equal(calls.every(([command]) => command === "gh"), true);
  assert.equal(calls.filter((call) => call[1] === "attestation").length, 3);
});
