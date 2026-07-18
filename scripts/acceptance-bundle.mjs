#!/usr/bin/env node

import { createHash } from "node:crypto";
import { spawn } from "node:child_process";
import { access, mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

const usage = `
Acceptance evidence bundle

Usage:
  node scripts/acceptance-bundle.mjs --dependencies shared/demo-dependencies.json --output-dir out/acceptance

Options:
  --dependencies path                Normalized Dynatrace dependency candidates.
  --output-dir path                  Directory for generated evidence.
  --source-instance-id id           Stable opaque Dynatrace source ID. Required.
  --forward-base-url url             Optional Forward URL metadata only; no network calls.
  --forward-network-id id            Optional Forward network ID metadata only; no network calls.
  --forward-access-profile name      read-only, network-operator, or network-admin. Default: read-only.
  --include-review                   Include mappingState=review rows in generated artifacts.
  --nqe-query-id FQ_...              Include optional NQE check artifact.
  --nqe-diff-query-id FQ_...         Include optional NQE diff request artifact.
  --nqe-diff-before-snapshot-id id   Optional NQE diff base snapshot.
  --nqe-diff-after-snapshot-id id    Optional NQE diff target snapshot.
  --release-dir path                 Verify SHA256SUMS and release signature files when present.
  --sync-mode data-connector         manual-import, data-connector, or intent-package.

The bundle is read-only. It builds a Forward package, validates it, emits sanitized status telemetry, and writes
customer acceptance evidence. It never contacts Forward and never applies checks.
`;

const parseArgs = (argv) => {
  const args = {};
  for (let index = 0; index < argv.length; index += 1) {
    const value = argv[index];
    if (value === "--help" || value === "--include-review") {
      args[value.slice(2)] = true;
      continue;
    }
    if (!value.startsWith("--")) {
      throw new Error(`Unexpected positional argument: ${value}`);
    }
    const key = value.slice(2);
    const next = argv[index + 1];
    if (!next || next.startsWith("--")) {
      throw new Error(`Missing value for ${value}.`);
    }
    args[key] = next;
    index += 1;
  }
  return args;
};

const required = (args, key) => {
  if (!args[key]) {
    throw new Error(`Missing required option: --${key}`);
  }
  return args[key];
};

const fileExists = async (filePath) => {
  try {
    await access(filePath);
    return true;
  } catch {
    return false;
  }
};

const run = async (args) =>
  new Promise((resolve, reject) => {
    const child = spawn(process.execPath, args, {
      cwd: root,
      stdio: ["ignore", "pipe", "pipe"],
    });
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (chunk) => {
      stdout += chunk;
    });
    child.stderr.on("data", (chunk) => {
      stderr += chunk;
    });
    child.on("error", reject);
    child.on("close", (code) => {
      if (code !== 0) {
        reject(new Error(`${process.execPath} ${args.join(" ")} exited ${code}: ${stderr || stdout}`));
        return;
      }
      resolve(stdout);
    });
  });

const runJson = async (args) => JSON.parse(await run(args));

const sha256File = async (filePath) =>
  createHash("sha256").update(await readFile(filePath)).digest("hex");

const verifyChecksums = async (releaseDir) => {
  const checksumsText = await readFile(path.join(releaseDir, "SHA256SUMS"), "utf8");
  const verified = [];
  for (const [lineNumber, line] of checksumsText.trim().split("\n").entries()) {
    const match = line.match(/^([a-f0-9]{64})\s+\*?(.+)$/i);
    if (!match) {
      throw new Error(`Invalid SHA256SUMS line ${lineNumber + 1}.`);
    }
    const [, expected, fileName] = match;
    const actual = await sha256File(path.join(releaseDir, fileName));
    if (actual !== expected.toLowerCase()) {
      throw new Error(`Checksum mismatch for ${fileName}.`);
    }
    verified.push(fileName);
  }
  return verified;
};

const verifyReleaseSignature = async (releaseDir) => {
  const signaturePath = path.join(releaseDir, "SHA256SUMS.sig");
  const publicKeyPath = path.join(releaseDir, "SHA256SUMS.pub");
  if (!(await fileExists(signaturePath)) || !(await fileExists(publicKeyPath))) {
    return "not-present";
  }
  await run([
    "scripts/sign-release-checksums.mjs",
    "--verify",
    "--checksums",
    path.join(releaseDir, "SHA256SUMS"),
    "--public-key",
    publicKeyPath,
    "--signature",
    signaturePath,
  ]);
  return "verified";
};

const redactedEnvironment = (args) => {
  let forwardUrl = null;
  if (args["forward-base-url"]) {
    const url = new URL(args["forward-base-url"]);
    forwardUrl = {
      protocol: url.protocol,
      hostname: url.hostname,
      portSupplied: Boolean(url.port),
    };
  }
  return {
    schemaVersion: "forward-dynatrace-acceptance-environment/v1",
    generatedAt: new Date().toISOString(),
    forwardBaseUrl: forwardUrl,
    forwardNetworkIdSupplied: Boolean(args["forward-network-id"]),
    dependenciesSource: path.basename(args.dependencies),
    releaseDirSupplied: Boolean(args["release-dir"]),
    writePolicy: "acceptance-bundle-never-contacts-forward",
  };
};

const writeAcceptanceMarkdown = async ({ outputDir, summary }) => {
  const lines = [
    "# Acceptance Evidence Bundle",
    "",
    `Generated: ${summary.generatedAt}`,
    "",
    "## Result",
    "",
    `- Package status: ${summary.package.status}`,
    `- Dependencies: ${summary.package.dependencies}`,
    `- Intent checks: ${summary.package.intentChecks}`,
    `- Optional NQE checks: ${summary.package.nqeChecks}`,
    `- Optional NQE diff requests: ${summary.package.nqeDiffRequests}`,
    `- Import validation: ${summary.import.status}`,
    `- Schema validation: ${summary.schemas.status}`,
    `- Release signature: ${summary.release.signatureStatus}`,
    "",
    "## Evidence Files",
    "",
    "- `package/forward-dynatrace-manifest.json`",
    "- `package/forward-intent-checks.json`",
    "- `package/forward-eligibility-report.json`",
    "- `forward-import-report.json`",
    "- `forward-ingest-status.json`",
    "- `dynatrace-status/forward-ingest-status-event.json`",
    "- `acceptance-summary.json`",
    "- `redacted-environment.json`",
    "",
    "## Forward Boundary",
    "",
    "This bundle uses `--validate-only`. It does not contact Forward and does not apply checks. Forward writes remain in the Forward-controlled importer or connector workflow after customer approval.",
    "",
  ];
  await writeFile(path.join(outputDir, "ACCEPTANCE.md"), `${lines.join("\n")}\n`);
};

const main = async () => {
  const args = parseArgs(process.argv.slice(2));
  if (args.help) {
    process.stdout.write(usage);
    return;
  }

  const dependencies = required(args, "dependencies");
  const outputDir = required(args, "output-dir");
  const sourceInstanceId = required(args, "source-instance-id");
  const packageDir = path.join(outputDir, "package");
  const statusDir = path.join(outputDir, "dynatrace-status");
  const eligibilityReport = path.join(packageDir, "forward-eligibility-report.json");
  const importReport = path.join(outputDir, "forward-import-report.json");
  const statusArtifact = path.join(outputDir, "forward-ingest-status.json");

  await mkdir(packageDir, { recursive: true });
  await mkdir(statusDir, { recursive: true });

  const buildArgs = [
    "--disable-warning=MODULE_TYPELESS_PACKAGE_JSON",
    "--experimental-strip-types",
    "scripts/build-forward-package.mjs",
    "--dependencies",
    dependencies,
    "--output-dir",
    packageDir,
    "--source-instance-id",
    sourceInstanceId,
    "--forward-access-profile",
    args["forward-access-profile"] || "read-only",
    "--eligibility-report",
    eligibilityReport,
    "--sync-mode",
    args["sync-mode"] || "manual-import",
  ];
  if (args["forward-base-url"]) {
    buildArgs.push("--forward-base-url", args["forward-base-url"]);
  }
  if (args["forward-network-id"]) {
    buildArgs.push("--forward-network-id", args["forward-network-id"]);
  }
  if (args["include-review"]) {
    buildArgs.push("--include-review");
  }
  if (args["nqe-query-id"]) {
    buildArgs.push("--nqe-query-id", args["nqe-query-id"]);
  }
  if (
    args["nqe-diff-query-id"] ||
    args["nqe-diff-before-snapshot-id"] ||
    args["nqe-diff-after-snapshot-id"]
  ) {
    buildArgs.push(
      "--nqe-diff-query-id",
      required(args, "nqe-diff-query-id"),
      "--nqe-diff-before-snapshot-id",
      required(args, "nqe-diff-before-snapshot-id"),
      "--nqe-diff-after-snapshot-id",
      required(args, "nqe-diff-after-snapshot-id"),
    );
  }

  const buildSummary = await runJson(buildArgs);
  const importArgs = [
    "scripts/forward-import-package.mjs",
    "--checks",
    path.join(packageDir, "forward-intent-checks.json"),
    "--manifest",
    path.join(packageDir, "forward-dynatrace-manifest.json"),
    "--validate-only",
    "--report",
    importReport,
    "--status-artifact",
    statusArtifact,
  ];
  if (buildSummary.nqeChecks > 0) {
    importArgs.push("--nqe-checks", path.join(packageDir, "forward-nqe-checks.json"));
  }
  if (buildSummary.nqeDiffRequests > 0) {
    importArgs.push(
      "--nqe-diff-requests",
      path.join(packageDir, "forward-nqe-diff-requests.json"),
    );
  }
  if (args["nqe-query-id"]) {
    importArgs.push("--nqe-query-id-allowlist", args["nqe-query-id"]);
  }
  const importSummary = await runJson(importArgs);

  const publishSummary = await runJson([
    "scripts/publish-forward-status.mjs",
    "--status",
    statusArtifact,
    "--output-dir",
    statusDir,
  ]);

  const schemaSummary = await runJson([
    "scripts/schema-validate.mjs",
    "--package-dir",
    packageDir,
    "--status",
    statusArtifact,
    "--status-event",
    path.join(statusDir, "forward-ingest-status-event.json"),
  ]);

  const release = {
    checksumFiles: [],
    signatureStatus: "not-requested",
  };
  if (args["release-dir"]) {
    release.checksumFiles = await verifyChecksums(args["release-dir"]);
    release.signatureStatus = await verifyReleaseSignature(args["release-dir"]);
  }

  const generatedAt = new Date().toISOString();
  const summary = {
    schemaVersion: "forward-dynatrace-acceptance-bundle/v1",
    generatedAt,
    outputDir,
    package: buildSummary,
    import: importSummary,
    publish: publishSummary,
    schemas: schemaSummary,
    release,
    writePolicy: "validate-only-no-forward-contact",
  };

  await writeFile(
    path.join(outputDir, "redacted-environment.json"),
    `${JSON.stringify(redactedEnvironment(args), null, 2)}\n`,
  );
  await writeFile(path.join(outputDir, "acceptance-summary.json"), `${JSON.stringify(summary, null, 2)}\n`);
  await writeAcceptanceMarkdown({ outputDir, summary });

  process.stdout.write(`${JSON.stringify(summary, null, 2)}\n`);
};

main().catch((error) => {
  process.stderr.write(`${error.message}\n`);
  process.stderr.write(usage);
  process.exit(1);
});
