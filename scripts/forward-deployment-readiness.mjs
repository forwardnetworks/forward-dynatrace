#!/usr/bin/env node

import { spawn } from "node:child_process";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { loadConnectorConfig } from "./forward-import-package.mjs";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

const usage = `
Forward for Dynatrace deployment readiness

Usage:
  node scripts/forward-deployment-readiness.mjs --config /secure/path/forward-connector.config.json
  node scripts/forward-deployment-readiness.mjs --checks forward-intent-checks.json --manifest forward-dynatrace-manifest.json
  node scripts/forward-deployment-readiness.mjs --config /secure/path/forward-connector.config.json --dry-run

Options:
  --config path                 Non-secret connector config.
  --checks path                 Local forward-intent-checks.json.
  --manifest path               Local forward-dynatrace-manifest.json.
  --package-url url             Package base URL.
  --checks-url url              Checks artifact URL.
  --manifest-url url            Manifest artifact URL.
  --signature path              Detached package signature.
  --signature-url url           Detached package signature URL.
  --public-key path             Trusted package-signature public key.
  --public-key-url url          Trusted package-signature public key URL.
  --require-signature           Require package signature verification.
  --nqe-checks path             Optional forward-nqe-checks.json.
  --nqe-checks-url url          Optional NQE checks URL.
  --nqe-diff-requests path      Optional forward-nqe-diff-requests.json.
  --nqe-diff-requests-url url   Optional NQE diff requests URL.
  --nqe-query-id-allowlist ids  Comma-separated Forward-owned query IDs for optional NQE artifacts.
  --max-package-age-minutes n   Reject stale package manifests.
  --dry-run                     Contact Forward and run importer dry-run reconciliation.
  --nqe-plan                    Validate optional read-only NQE smoke request without execution.
  --nqe-execute                 Execute optional read-only NQE smoke request.
  --nqe-template-id id          NQE smoke template. Defaults to endpoint-inventory-smoke.
  --nqe-query-id FQ_...         Optional Forward-owned query ID for NQE smoke.
  --nqe-approval-file path      Approval artifact required with --nqe-execute.
  --nqe-authorization-file path File containing read-only Forward Authorization header for NQE smoke.
  --output path                 Write readiness report JSON.
  --fail-on-warning             Exit 2 when warnings are present.

This command never applies Forward changes. It runs package validation first and
only performs a Forward dry-run when --dry-run is supplied.
`;

const booleanArgs = new Set([
  "dry-run",
  "fail-on-warning",
  "help",
  "nqe-execute",
  "nqe-plan",
  "require-signature",
]);

const readinessOnlyArgs = new Set([
  "dry-run",
  "fail-on-warning",
  "nqe-approval-file",
  "nqe-authorization-file",
  "nqe-execute",
  "nqe-plan",
  "nqe-query-id",
  "nqe-template-id",
  "output",
]);

const supportedArgs = new Set([
  ...booleanArgs,
  ...readinessOnlyArgs,
  "checks",
  "checks-url",
  "config",
  "manifest",
  "manifest-url",
  "max-package-age-minutes",
  "nqe-checks",
  "nqe-checks-url",
  "nqe-diff-requests",
  "nqe-diff-requests-url",
  "nqe-query-id-allowlist",
  "package-url",
  "public-key",
  "public-key-url",
  "signature",
  "signature-url",
]);

const forwardedBooleanArgs = new Set(["require-signature"]);

const parseArgs = (argv) => {
  const args = {};
  for (let index = 0; index < argv.length; index += 1) {
    const value = argv[index];
    if (!value.startsWith("--")) {
      throw new Error(`Unsupported positional argument: ${value}`);
    }
    const key = value.slice(2);
    if (!supportedArgs.has(key)) {
      throw new Error(`Unsupported option: --${key}`);
    }
    if (booleanArgs.has(key)) {
      args[key] = true;
      continue;
    }
    const next = argv[index + 1];
    if (!next || next.startsWith("--")) {
      throw new Error(`Missing value for --${key}`);
    }
    args[key] = next;
    index += 1;
  }
  return args;
};

const buildImporterArgs = (args, extraArgs = []) => {
  const forwarded = [];
  for (const [key, value] of Object.entries(args)) {
    if (readinessOnlyArgs.has(key) || key === "help") {
      continue;
    }
    if (forwardedBooleanArgs.has(key)) {
      if (value) {
        forwarded.push(`--${key}`);
      }
      continue;
    }
    forwarded.push(`--${key}`, value);
  }
  return ["scripts/forward-import-package.mjs", ...forwarded, ...extraArgs];
};

const runJson = async (commandArgs, env = process.env) =>
  new Promise((resolve) => {
    const child = spawn(process.execPath, commandArgs, {
      cwd: root,
      env,
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
    child.on("error", (error) => {
      resolve({ ok: false, code: 1, error: error.message, stdout, stderr });
    });
    child.on("close", (code) => {
      if (code !== 0) {
        resolve({ ok: false, code, stdout, stderr });
        return;
      }
      try {
        resolve({ ok: true, code, json: JSON.parse(stdout), stdout, stderr });
      } catch (error) {
        resolve({
          ok: false,
          code: 1,
          error: `Command returned non-JSON output: ${error.message}`,
          stdout,
          stderr,
        });
      }
    });
  });

const gate = ({
  id,
  label,
  status,
  owner,
  summary,
  evidence = undefined,
  nextStep = undefined,
}) => ({
  id,
  label,
  status,
  owner,
  summary,
  ...(evidence ? { evidence } : {}),
  ...(nextStep ? { nextStep } : {}),
});

const commandErrorSummary = (result) =>
  (result.stderr || result.error || result.stdout || "Command failed.").trim().slice(0, 1200);

const connectorMutationFields = (config) =>
  [
    config.apply ? "apply" : null,
    config.applyUpdates ? "applyUpdates" : null,
    config.deactivateStale ? "deactivateStale" : null,
  ].filter(Boolean);

const runtimeValue = (envName, configValue) => process.env[envName] || configValue;

const writeJson = async (filePath, value) => {
  const outputPath = path.resolve(filePath);
  await mkdir(path.dirname(outputPath), { recursive: true });
  await writeFile(outputPath, `${JSON.stringify(value, null, 2)}\n`);
};

const buildNqeArgs = (args, config) => {
  const forwardBaseUrl = runtimeValue("FORWARD_BASE_URL", config.forwardBaseUrl);
  const forwardNetworkId = runtimeValue("FORWARD_NETWORK_ID", config.forwardNetworkId);
  const commandArgs = [
    "--disable-warning=MODULE_TYPELESS_PACKAGE_JSON",
    "--experimental-strip-types",
    "scripts/forward-nqe-live-smoke.mjs",
  ];
  if (forwardBaseUrl) {
    commandArgs.push("--forward-base-url", forwardBaseUrl);
  }
  if (forwardNetworkId) {
    commandArgs.push("--forward-network-id", forwardNetworkId);
  }
  if (args["nqe-template-id"]) {
    commandArgs.push("--template-id", args["nqe-template-id"]);
  }
  if (args["nqe-query-id"]) {
    commandArgs.push("--query-id", args["nqe-query-id"]);
    commandArgs.push("--allow-query-id", args["nqe-query-id"]);
  }
  if (args["nqe-approval-file"]) {
    commandArgs.push("--approval-file", args["nqe-approval-file"]);
  }
  if (args["nqe-authorization-file"]) {
    commandArgs.push("--authorization-file", args["nqe-authorization-file"]);
  }
  if (args["nqe-execute"]) {
    commandArgs.push("--execute");
  }
  return commandArgs;
};

const toOverallStatus = (gates) => {
  if (gates.some((item) => item.status === "fail")) {
    return "failed";
  }
  if (gates.some((item) => item.status === "warn")) {
    return "needs-action";
  }
  return "ready";
};

const main = async () => {
  const args = parseArgs(process.argv.slice(2));
  if (args.help) {
    process.stdout.write(usage);
    return;
  }

  const generatedAt = new Date().toISOString();
  const gates = [];
  const connectorConfig = args.config ? await loadConnectorConfig(args.config) : {};
  const mutationFields = connectorMutationFields(connectorConfig);

  gates.push(
    gate({
      id: "connector-mutation-policy",
      label: "Connector mutation policy",
      status: mutationFields.length > 0 ? "fail" : "pass",
      owner: "forward",
      summary:
        mutationFields.length > 0
          ? `Readiness refuses connector configs with mutation fields enabled: ${mutationFields.join(", ")}.`
          : "Connector config is non-mutating for readiness validation.",
      nextStep:
        mutationFields.length > 0
          ? "Set apply, applyUpdates, and deactivateStale to false for readiness checks."
          : undefined,
    }),
  );

  const validateResult = await runJson(
    buildImporterArgs(args, ["--validate-only"]),
  );
  if (validateResult.ok) {
    gates.push(
      gate({
        id: "package-validation",
        label: "Package validation",
        status: "pass",
        owner: "shared",
        summary: "Package schema, manifest, checksum, dedupe keys, and optional NQE artifacts validate.",
        evidence: {
          packageId: validateResult.json.packageId,
          plannedChecks: validateResult.json.plannedChecks,
          plannedNqeChecks: validateResult.json.plannedNqeChecks,
          plannedNqeDiffRequests: validateResult.json.plannedNqeDiffRequests,
        },
      }),
    );
    const signatureStatus = validateResult.json.packageSignature?.status || "not-provided";
    gates.push(
      gate({
        id: "package-signature",
        label: "Package signature",
        status:
          signatureStatus === "verified"
            ? "pass"
            : args["require-signature"]
              ? "fail"
              : "skip",
        owner: "forward",
        summary:
          signatureStatus === "verified"
            ? "Detached package signature verified."
            : args["require-signature"]
              ? "Signature is required but was not verified."
              : "Signature not required for this readiness run.",
        evidence: { status: signatureStatus },
      }),
    );
  } else {
    gates.push(
      gate({
        id: "package-validation",
        label: "Package validation",
        status: "fail",
        owner: "shared",
        summary: commandErrorSummary(validateResult),
        nextStep: "Regenerate the package or fix the connector package source before running Forward dry-run.",
      }),
    );
  }

  let dryRunResult = null;
  const canDryRun =
    Boolean(args["dry-run"]) &&
    validateResult.ok &&
    mutationFields.length === 0;
  if (args["dry-run"] && !canDryRun) {
    gates.push(
      gate({
        id: "forward-dry-run",
        label: "Forward dry-run",
        status: "skip",
        owner: "forward",
        summary: "Skipped because package validation or mutation-policy gates failed.",
      }),
    );
  } else if (args["dry-run"]) {
    dryRunResult = await runJson(buildImporterArgs(args));
    if (dryRunResult.ok) {
      const changed = dryRunResult.json.counts?.changed ?? 0;
      const stale = dryRunResult.json.counts?.stale ?? 0;
      gates.push(
        gate({
          id: "forward-connectivity",
          label: "Forward connectivity",
          status: "pass",
          owner: "forward",
          summary: "Forward latest-processed snapshot and check inventory were read successfully.",
          evidence: {
            networkId: dryRunResult.json.networkId,
            snapshotId: dryRunResult.json.snapshotId,
            existingDynatraceManagedChecks:
              dryRunResult.json.existingDynatraceManagedChecks,
          },
        }),
      );
      gates.push(
        gate({
          id: "forward-reconciliation",
          label: "Forward reconciliation",
          status: changed > 0 || stale > 0 ? "warn" : "pass",
          owner: "forward",
          summary:
            changed > 0 || stale > 0
              ? "Dry-run found changed or stale Dynatrace-managed checks requiring Forward review."
              : "Dry-run found no unresolved changed or stale generated checks.",
          evidence: dryRunResult.json.counts,
          nextStep:
            changed > 0 || stale > 0
              ? "Review changed/stale checks and use the approval-gated workflow only if replacement or retirement is approved."
              : undefined,
        }),
      );
    } else {
      gates.push(
        gate({
          id: "forward-connectivity",
          label: "Forward connectivity",
          status: "fail",
          owner: "forward",
          summary: commandErrorSummary(dryRunResult),
          nextStep:
            "Check Forward URL, credentials, network ID, latest processed snapshot, and endpoint location compatibility.",
        }),
      );
    }
  } else {
    gates.push(
      gate({
        id: "forward-dry-run",
        label: "Forward dry-run",
        status: "skip",
        owner: "forward",
        summary: "Supply --dry-run to verify Forward credentials, snapshot access, and reconciliation.",
      }),
    );
  }

  let nqeResult = null;
  if (args["nqe-plan"] || args["nqe-execute"]) {
    nqeResult = await runJson(buildNqeArgs(args, connectorConfig));
    gates.push(
      gate({
        id: "optional-nqe",
        label: "Optional read-only NQE",
        status:
          nqeResult.ok && ["planned", "ready"].includes(nqeResult.json.status)
            ? "pass"
            : "fail",
        owner: "forward",
        summary: nqeResult.ok
          ? nqeResult.json.summary
          : commandErrorSummary(nqeResult),
        evidence: nqeResult.ok
          ? {
              mode: nqeResult.json.mode,
              status: nqeResult.json.status,
              path: nqeResult.json.requestPreview?.path,
            }
          : undefined,
        nextStep:
          nqeResult.ok && ["planned", "ready"].includes(nqeResult.json.status)
            ? undefined
            : "Validate the read-only NQE approval file, authorization model, query ID allowlist, and Forward NQE permission.",
      }),
    );
  } else {
    gates.push(
      gate({
        id: "optional-nqe",
        label: "Optional read-only NQE",
        status: "skip",
        owner: "forward",
        summary: "Not checked. Supply --nqe-plan or --nqe-execute when the deployment uses dynamic NQE preview.",
      }),
    );
  }

  const report = {
    schemaVersion: "forward-dynatrace-deployment-readiness/v1",
    generatedAt,
    overallStatus: toOverallStatus(gates),
    mode: {
      packageValidation: "validate-only",
      forwardDryRun: Boolean(args["dry-run"]),
      nqe: args["nqe-execute"] ? "execute" : args["nqe-plan"] ? "plan" : "skipped",
    },
    gates,
    validateOnly: validateResult.ok ? validateResult.json : null,
    dryRun: dryRunResult?.ok ? dryRunResult.json : null,
    nqe: nqeResult?.ok ? nqeResult.json : null,
    nextSteps: gates
      .filter((item) => item.status === "fail" || item.status === "warn")
      .map((item) => item.nextStep)
      .filter(Boolean),
  };

  if (args.output) {
    await writeJson(args.output, report);
  }
  process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);

  if (report.overallStatus === "failed") {
    process.exitCode = 1;
  } else if (report.overallStatus === "needs-action" && args["fail-on-warning"]) {
    process.exitCode = 2;
  }
};

main().catch((error) => {
  process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
  process.stderr.write(usage);
  process.exitCode = 1;
});
