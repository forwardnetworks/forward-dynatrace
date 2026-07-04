#!/usr/bin/env node

import { spawn } from "node:child_process";
import { mkdir, mkdtemp, readFile, readdir, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

const usage = `
Release artifact packager

Usage:
  node scripts/package-release-artifacts.mjs
  node scripts/package-release-artifacts.mjs --output-dir out/release --release-name v1.0.6

Builds the GitHub release archives and SHA256SUMS. By default it writes to a
temporary directory and uses the package version with a smoke suffix.
`;

const appArchiveEntries = [
  "app.config.json",
  "package.json",
  "package-lock.json",
  "README.md",
  "LICENSE",
  "dist",
  "deploy/dynatrace-dql",
  "deploy/dynatrace-dashboard",
  "deploy/dynatrace-workflows",
  "scripts/deploy-dynatrace-app.mjs",
  "docs/assets/screenshots",
  "docs/install.md",
  "docs/workflow.md",
  "docs/prospect-talk-track.md",
  "docs/dynatrace-workflow-trigger.md",
  "docs/forward-ingest-contract.md",
  "docs/forward-host-resolution.md",
  "docs/forward-path-evidence.md",
  "docs/forward-nqe-preview.md",
  "docs/forward-nqe-artifacts.md",
  "docs/forward-api-compatibility.md",
  "docs/client-trial-plan.md",
  "docs/live-demo-runbook.md",
  "docs/execution-roadmap.md",
  "docs/deployment-readiness.md",
  "docs/release-provenance.md",
  "docs/governance.md",
  "docs/customer-acceptance-checklist.md",
  "docs/customer-one-pager.md",
  "docs/dynatrace-status-dashboard.md",
  "schemas",
];

const importerArchiveEntries = [
  "Dockerfile.forward-importer",
  "api/forward-sync.function.ts",
  "config",
  "deploy",
  "package.json",
  "package-lock.json",
  "README.md",
  "LICENSE",
  "shared/demo-dynatrace-query-rows.json",
  "shared/demo-dependencies.json",
  "scripts/query-dynatrace-dependencies.mjs",
  "scripts/deploy-dynatrace-app.mjs",
  "scripts/deploy-dynatrace-app.test.mjs",
  "scripts/forward-deployment-readiness.mjs",
  "scripts/forward-deployment-readiness.test.mjs",
  "scripts/forward-resolve-hosts.mjs",
  "scripts/forward-resolve-hosts.test.mjs",
  "scripts/forward-path-evidence.mjs",
  "scripts/forward-path-evidence.test.mjs",
  "scripts/replay-dynatrace-demo-data.mjs",
  "scripts/replay-dynatrace-demo-data.test.mjs",
  "scripts/build-forward-package.mjs",
  "scripts/forward-import-package.mjs",
  "scripts/forward-nqe-live-smoke.mjs",
  "scripts/forward-nqe-live-smoke.test.mjs",
  "scripts/forward-nqe-artifacts.mjs",
  "scripts/normalize-dynatrace-dependencies.mjs",
  "scripts/demo-rehearsal.mjs",
  "scripts/load-scale-smoke.mjs",
  "scripts/runtime-slo-check.mjs",
  "scripts/runtime-slo-check.test.mjs",
  "scripts/publish-forward-status.mjs",
  "scripts/publish-dynatrace-status-event.mjs",
  "scripts/publish-dynatrace-status-event.test.mjs",
  "scripts/schema-validate.mjs",
  "scripts/schema-validate.test.mjs",
  "scripts/acceptance-bundle.mjs",
  "scripts/acceptance-bundle.test.mjs",
  "scripts/sign-forward-package.mjs",
  "scripts/sign-release-checksums.mjs",
  "scripts/sign-release-checksums.test.mjs",
  "scripts/generate-release-signing-keypair.mjs",
  "scripts/generate-release-signing-keypair.test.mjs",
  "scripts/write-release-checksums.mjs",
  "docs/forward-importer.md",
  "docs/prospect-talk-track.md",
  "docs/forward-host-resolution.md",
  "docs/forward-path-evidence.md",
  "docs/forward-nqe-preview.md",
  "docs/forward-nqe-artifacts.md",
  "docs/forward-api-compatibility.md",
  "docs/container-runtime.md",
  "docs/connector-runtime.md",
  "docs/deployment-readiness.md",
  "docs/operations-runbook.md",
  "docs/incident-response.md",
  "docs/observability.md",
  "docs/rbac.md",
  "docs/package-handoff.md",
  "docs/client-trial-plan.md",
  "docs/live-demo-runbook.md",
  "docs/execution-roadmap.md",
  "docs/release-provenance.md",
  "docs/governance.md",
  "docs/customer-acceptance-checklist.md",
  "docs/customer-one-pager.md",
  "docs/dynatrace-status-dashboard.md",
  "schemas",
];

const requiredAppMembers = [
  "app.config.json",
  "package.json",
  "package-lock.json",
  "README.md",
  "LICENSE",
  "dist",
  "deploy/dynatrace-workflows/forward-sync-schedule.payload.example.json",
  "deploy/dynatrace-workflows/forward-sync-problem.payload.example.json",
  "deploy/dynatrace-workflows/forward-sync-on-demand.payload.example.json",
  "deploy/dynatrace-dql/service-dependency-candidates-openpipeline-events.dql",
  "deploy/dynatrace-dql/service-dependencies-smartscape.dql",
  "deploy/dynatrace-dql/forward-ingest-status-latest.dql",
  "deploy/dynatrace-dql/forward-ingest-status-attention.dql",
  "deploy/dynatrace-dashboard/forward-ingest-status-dashboard.template.json",
  "scripts/deploy-dynatrace-app.mjs",
  "docs/assets/screenshots",
  "docs/install.md",
  "docs/workflow.md",
  "docs/prospect-talk-track.md",
  "docs/dynatrace-workflow-trigger.md",
  "docs/forward-ingest-contract.md",
  "docs/forward-host-resolution.md",
  "docs/forward-path-evidence.md",
  "docs/forward-nqe-preview.md",
  "docs/forward-nqe-artifacts.md",
  "docs/forward-api-compatibility.md",
  "docs/live-demo-runbook.md",
  "docs/execution-roadmap.md",
  "docs/deployment-readiness.md",
  "docs/release-provenance.md",
  "docs/governance.md",
  "docs/customer-acceptance-checklist.md",
  "docs/customer-one-pager.md",
  "docs/dynatrace-status-dashboard.md",
  "schemas/connector-config.schema.json",
  "schemas/forward-package-manifest.schema.json",
  "schemas/forward-intent-checks.schema.json",
  "schemas/forward-ingest-status.schema.json",
  "schemas/forward-ingest-status-event.schema.json",
  "schemas/forward-approval.schema.json",
  "schemas/README.md",
];

const requiredImporterMembers = [
  "Dockerfile.forward-importer",
  "README.md",
  "LICENSE",
  "api/forward-sync.function.ts",
  "config/forward-connector.config.example.json",
  "config/forward-connector.signed.config.example.json",
  "config/forward-import.approval.example.json",
  "config/forward-nqe-live-smoke.approval.example.json",
  "deploy/systemd/forward-dynatrace-connector.service",
  "deploy/docker-compose/compose.yaml",
  "deploy/docker-compose/forward-connector.config.example.json",
  "deploy/docker-compose/forward-dynatrace.env.example",
  "deploy/kubernetes/forward-dynatrace-connector-cronjob.yaml",
  "scripts/forward-import-package.mjs",
  "scripts/forward-deployment-readiness.mjs",
  "scripts/forward-resolve-hosts.mjs",
  "scripts/forward-resolve-hosts.test.mjs",
  "scripts/forward-path-evidence.mjs",
  "scripts/forward-path-evidence.test.mjs",
  "scripts/forward-nqe-live-smoke.mjs",
  "scripts/forward-nqe-live-smoke.test.mjs",
  "scripts/forward-nqe-artifacts.mjs",
  "scripts/query-dynatrace-dependencies.mjs",
  "scripts/deploy-dynatrace-app.mjs",
  "scripts/deploy-dynatrace-app.test.mjs",
  "scripts/replay-dynatrace-demo-data.mjs",
  "scripts/replay-dynatrace-demo-data.test.mjs",
  "scripts/build-forward-package.mjs",
  "scripts/normalize-dynatrace-dependencies.mjs",
  "scripts/demo-rehearsal.mjs",
  "scripts/load-scale-smoke.mjs",
  "scripts/runtime-slo-check.mjs",
  "scripts/publish-forward-status.mjs",
  "scripts/publish-dynatrace-status-event.mjs",
  "scripts/publish-dynatrace-status-event.test.mjs",
  "scripts/schema-validate.mjs",
  "scripts/schema-validate.test.mjs",
  "scripts/acceptance-bundle.mjs",
  "scripts/acceptance-bundle.test.mjs",
  "shared/demo-dynatrace-query-rows.json",
  "shared/demo-dependencies.json",
  "scripts/sign-forward-package.mjs",
  "scripts/sign-release-checksums.mjs",
  "scripts/generate-release-signing-keypair.mjs",
  "scripts/write-release-checksums.mjs",
  "docs/forward-importer.md",
  "docs/prospect-talk-track.md",
  "docs/forward-host-resolution.md",
  "docs/forward-path-evidence.md",
  "docs/forward-nqe-preview.md",
  "docs/forward-nqe-artifacts.md",
  "docs/forward-api-compatibility.md",
  "docs/container-runtime.md",
  "docs/connector-runtime.md",
  "docs/deployment-readiness.md",
  "docs/operations-runbook.md",
  "docs/incident-response.md",
  "docs/observability.md",
  "docs/rbac.md",
  "docs/package-handoff.md",
  "docs/client-trial-plan.md",
  "docs/live-demo-runbook.md",
  "docs/execution-roadmap.md",
  "docs/release-provenance.md",
  "docs/governance.md",
  "docs/customer-acceptance-checklist.md",
  "docs/customer-one-pager.md",
  "docs/dynatrace-status-dashboard.md",
  "schemas/connector-config.schema.json",
  "schemas/forward-package-manifest.schema.json",
  "schemas/forward-intent-checks.schema.json",
  "schemas/forward-ingest-status.schema.json",
  "schemas/forward-ingest-status-event.schema.json",
  "schemas/forward-approval.schema.json",
  "schemas/README.md",
];

const parseArgs = (argv) => {
  const args = {};
  for (let index = 0; index < argv.length; index += 1) {
    const value = argv[index];
    if (value === "--help") {
      args.help = true;
      continue;
    }
    if (value === "--output-dir" || value === "--release-name") {
      const next = argv[index + 1];
      if (!next || next.startsWith("--")) {
        throw new Error(`Missing value for ${value}.`);
      }
      args[value.slice(2)] = next;
      index += 1;
      continue;
    }
    throw new Error(`Unsupported option: ${value}`);
  }
  return args;
};

const run = (command, args, options = {}) =>
  new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      cwd: root,
      stdio: ["ignore", "pipe", "pipe"],
      ...options,
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
        reject(
          new Error(
            `${command} ${args.join(" ")} exited ${code}:\n${stderr || stdout}`,
          ),
        );
        return;
      }
      resolve(stdout);
    });
  });

const ensureExists = async (relativePath) => {
  try {
    return await stat(path.join(root, relativePath));
  } catch {
    throw new Error(`Missing release input: ${relativePath}`);
  }
};

const ensureInputs = async () => {
  for (const entry of new Set([...appArchiveEntries, ...importerArchiveEntries])) {
    await ensureExists(entry);
  }

  const distEntries = await readdir(path.join(root, "dist"));
  if (distEntries.length === 0) {
    throw new Error("dist is empty. Run npm run build before packaging release artifacts.");
  }
};

const safeReleaseName = (releaseName) =>
  releaseName
    .trim()
    .replace(/\/+/g, "-")
    .replace(/[^A-Za-z0-9._-]+/g, "-")
    .replace(/^-|-$/g, "");

const listArchive = async (archivePath) => {
  const output = await run("tar", ["-tzf", archivePath]);
  return output
    .split(/\r?\n/)
    .map((line) => line.replace(/\/$/, ""))
    .filter(Boolean);
};

const assertArchiveMembers = (archiveName, members, requiredMembers) => {
  for (const requiredMember of requiredMembers) {
    const found = members.some(
      (member) => member === requiredMember || member.startsWith(`${requiredMember}/`),
    );
    if (!found) {
      throw new Error(`${archiveName} is missing ${requiredMember}`);
    }
  }
};

const main = async () => {
  const args = parseArgs(process.argv.slice(2));
  if (args.help) {
    process.stdout.write(usage);
    return;
  }

  const packageJson = JSON.parse(await readFile(path.join(root, "package.json"), "utf8"));
  const releaseName = safeReleaseName(args["release-name"] || `v${packageJson.version}-smoke`);
  if (!releaseName) {
    throw new Error("Release name must contain at least one safe filename character.");
  }

  const outputDir = args["output-dir"]
    ? path.resolve(root, args["output-dir"])
    : await mkdtemp(path.join(tmpdir(), "forward-dynatrace-release-"));
  await mkdir(outputDir, { recursive: true });
  await ensureInputs();

  const appArchive = path.join(outputDir, `forward-dynatrace-app-${releaseName}.tgz`);
  const importerArchive = path.join(
    outputDir,
    `forward-dynatrace-importer-${releaseName}.tgz`,
  );
  const sbom = path.join(outputDir, `forward-dynatrace-sbom-${releaseName}.cdx.json`);
  const checksums = path.join(outputDir, "SHA256SUMS");

  await run("tar", ["-czf", appArchive, ...appArchiveEntries]);
  await run("tar", ["-czf", importerArchive, ...importerArchiveEntries]);
  await run("npm", ["sbom", "--omit=dev", "--sbom-format=cyclonedx"], {
    stdio: ["ignore", "pipe", "pipe"],
  }).then((stdout) => writeFile(sbom, stdout));
  await run(process.execPath, [
    "scripts/write-release-checksums.mjs",
    "--output",
    checksums,
    appArchive,
    importerArchive,
    sbom,
  ]);

  assertArchiveMembers(
    path.basename(appArchive),
    await listArchive(appArchive),
    requiredAppMembers,
  );
  assertArchiveMembers(
    path.basename(importerArchive),
    await listArchive(importerArchive),
    requiredImporterMembers,
  );

  const checksumLines = (await readFile(checksums, "utf8")).trim().split(/\r?\n/);
  if (checksumLines.length !== 3) {
    throw new Error(`SHA256SUMS must contain exactly three entries; found ${checksumLines.length}.`);
  }

  process.stdout.write(
    JSON.stringify(
      {
        status: "ok",
        outputDir,
        artifacts: [
          path.basename(appArchive),
          path.basename(importerArchive),
          path.basename(sbom),
          path.basename(checksums),
        ],
      },
      null,
      2,
    ) + "\n",
  );
};

main().catch((error) => {
  process.stderr.write(`${error.message}\n`);
  process.exit(1);
});
