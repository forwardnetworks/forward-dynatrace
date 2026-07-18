#!/usr/bin/env node

import Ajv from "ajv";
import addFormats from "ajv-formats";
import { spawn } from "node:child_process";
import { mkdtemp, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

import {
  sanitizeStatusArtifact,
  toDynatraceStatusEvent,
} from "./publish-forward-status.mjs";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const queryId = "FQ_aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa";

const schemaPaths = {
  connectorConfig: "schemas/connector-config.schema.json",
  approval: "schemas/forward-approval.schema.json",
  importPlan: "schemas/forward-import-plan.schema.json",
  manifest: "schemas/forward-package-manifest.schema.json",
  intentChecks: "schemas/forward-intent-checks.schema.json",
  ingestStatus: "schemas/forward-ingest-status.schema.json",
  ingestStatusEvent: "schemas/forward-ingest-status-event.schema.json",
  networkEvidenceEvent: "schemas/forward-network-evidence-event.schema.json",
  changeContext: "schemas/forward-change-context.schema.json",
  changeValidationGate: "schemas/forward-change-validation-gate.schema.json",
  changeValidationEvent: "schemas/forward-change-validation-event.schema.json",
  guardianContext: "schemas/forward-guardian-execution-context.schema.json",
  checkHealthTransitions: "schemas/forward-check-health-transitions.schema.json",
  securityCorrelation: "schemas/forward-security-correlation.schema.json",
  securityCorrelationEventBatch: "schemas/forward-security-correlation-event-batch.schema.json",
};

const usage = `
Schema validator

Usage:
  node scripts/schema-validate.mjs
  node scripts/schema-validate.mjs --package-dir out/package --status out/forward-ingest-status.json

Options:
  --approval path          Validate an approval artifact.
  --connector-config path  Validate a connector config artifact.
  --import-plan path       Validate an immutable Forward import plan.
  --package-dir path       Validate forward-dynatrace-manifest.json and forward-intent-checks.json.
  --status path            Validate a Forward ingest status artifact.
  --status-event path      Validate a Dynatrace status event artifact.
  --network-evidence-event path
                           Validate a sanitized problem network-evidence event.
  --change-context path    Validate Dynatrace change/deployment context.
  --change-validation-gate path
                           Validate a Forward and Dynatrace gate artifact.
  --change-validation-event path
                           Validate a sanitized change-validation event.
  --guardian-context path  Validate a lifecycle Guardian execution context.
  --check-health-transitions path
                           Validate a sanitized check-health transition batch.
  --security-correlation path
                           Validate a read-only security correlation artifact.
  --security-correlation-event-batch path
                           Validate a sanitized security-correlation event batch.

Without arguments, validates committed examples and a freshly generated demo package.
`;

const parseArgs = (argv) => {
  const args = {};
  for (let index = 0; index < argv.length; index += 1) {
    const value = argv[index];
    if (value === "--help") {
      args.help = true;
      continue;
    }
    if (
      value === "--approval" ||
      value === "--connector-config" ||
      value === "--import-plan" ||
      value === "--package-dir" ||
      value === "--status" ||
      value === "--status-event" ||
      value === "--network-evidence-event" ||
      value === "--change-context" ||
      value === "--change-validation-gate" ||
      value === "--change-validation-event" ||
      value === "--guardian-context" ||
      value === "--check-health-transitions" ||
      value === "--security-correlation" ||
      value === "--security-correlation-event-batch"
    ) {
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

const readJson = async (relativeOrAbsolutePath) =>
  JSON.parse(
    await readFile(
      path.isAbsolute(relativeOrAbsolutePath)
        ? relativeOrAbsolutePath
        : path.join(root, relativeOrAbsolutePath),
      "utf8",
    ),
  );

const runJson = async (args) =>
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
      resolve(JSON.parse(stdout));
    });
  });

const buildValidator = async () => {
  const ajv = new Ajv({ allErrors: true, allowUnionTypes: true, strict: true });
  addFormats(ajv);
  const schemas = Object.fromEntries(
    await Promise.all(
      Object.entries(schemaPaths).map(async ([name, schemaPath]) => [name, await readJson(schemaPath)]),
    ),
  );
  for (const schema of Object.values(schemas)) ajv.addSchema(schema);
  const validators = {};
  for (const [name, schema] of Object.entries(schemas)) {
    validators[name] = ajv.getSchema(schema.$id);
  }
  return validators;
};

const failText = (validator) =>
  (validator.errors || [])
    .map((error) => `${error.instancePath || "/"} ${error.message}`)
    .join("; ");

const validate = (validator, label, value, results) => {
  if (!validator(value)) {
    throw new Error(`${label} failed schema validation: ${failText(validator)}`);
  }
  results.push(label);
};

const validatePackageDir = async (validators, packageDir, results) => {
  validate(
    validators.manifest,
    `${packageDir}/forward-dynatrace-manifest.json`,
    await readJson(path.join(packageDir, "forward-dynatrace-manifest.json")),
    results,
  );
  validate(
    validators.intentChecks,
    `${packageDir}/forward-intent-checks.json`,
    await readJson(path.join(packageDir, "forward-intent-checks.json")),
    results,
  );
};

const buildDemoArtifacts = async () => {
  const outputDir = await mkdtemp(path.join(tmpdir(), "forward-dynatrace-schema-"));
  await runJson([
    "--disable-warning=MODULE_TYPELESS_PACKAGE_JSON",
    "--experimental-strip-types",
    "scripts/build-forward-package.mjs",
    "--dependencies",
    "shared/demo-dependencies.json",
    "--output-dir",
    outputDir,
    "--source-instance-id",
    "dt-schema-validation",
    "--nqe-query-id",
    queryId,
    "--nqe-diff-query-id",
    queryId,
    "--nqe-diff-before-snapshot-id",
    "snapshot-before",
    "--nqe-diff-after-snapshot-id",
    "snapshot-after",
  ]);
  await runJson([
    "scripts/forward-import-package.mjs",
    "--checks",
    path.join(outputDir, "forward-intent-checks.json"),
    "--manifest",
    path.join(outputDir, "forward-dynatrace-manifest.json"),
    "--nqe-checks",
    path.join(outputDir, "forward-nqe-checks.json"),
    "--nqe-diff-requests",
    path.join(outputDir, "forward-nqe-diff-requests.json"),
    "--nqe-query-id-allowlist",
    queryId,
    "--validate-only",
    "--status-artifact",
    path.join(outputDir, "forward-ingest-status.json"),
  ]);
  return outputDir;
};

const main = async () => {
  const args = parseArgs(process.argv.slice(2));
  if (args.help) {
    process.stdout.write(usage);
    return;
  }

  const validators = await buildValidator();
  const results = [];
  const hasExplicitArtifacts = Boolean(
    args.approval ||
      args["connector-config"] ||
      args["import-plan"] ||
      args["package-dir"] ||
      args.status ||
      args["status-event"] ||
      args["network-evidence-event"] ||
      args["change-context"] ||
      args["change-validation-gate"] ||
      args["change-validation-event"] ||
      args["guardian-context"] ||
      args["check-health-transitions"] ||
      args["security-correlation"] ||
      args["security-correlation-event-batch"],
  );

  if (!hasExplicitArtifacts) {
    for (const connectorConfig of [
      "config/forward-connector.config.example.json",
      "config/forward-connector.network-operator.config.example.json",
      "config/forward-connector.network-admin.config.example.json",
      "config/forward-connector.signed.config.example.json",
      "deploy/docker-compose/forward-connector.config.example.json",
      "deploy/systemd/forward-connector.config.example.json",
      "deploy/cron/forward-connector.config.example.json",
    ]) {
      validate(validators.connectorConfig, connectorConfig, await readJson(connectorConfig), results);
    }

    validate(
      validators.approval,
      "config/forward-import.approval.example.json",
      await readJson("config/forward-import.approval.example.json"),
      results,
    );
    validate(
      validators.changeContext,
      "config/forward-change-context.example.json",
      await readJson("config/forward-change-context.example.json"),
      results,
    );
    validate(
      validators.guardianContext,
      "config/forward-guardian-execution-context.example.json",
      await readJson("config/forward-guardian-execution-context.example.json"),
      results,
    );

    const demoPackageDir = await buildDemoArtifacts();
    await validatePackageDir(validators, demoPackageDir, results);
    const status = await readJson(path.join(demoPackageDir, "forward-ingest-status.json"));
    validate(validators.ingestStatus, `${demoPackageDir}/forward-ingest-status.json`, status, results);
    validate(
      validators.ingestStatusEvent,
      "generated forward-ingest-status-event.json",
      toDynatraceStatusEvent(sanitizeStatusArtifact(status)),
      results,
    );

    const sharedStatus = await readJson("shared/demo-forward-ingest-status.json");
    validate(validators.ingestStatus, "shared/demo-forward-ingest-status.json", sharedStatus, results);
    validate(
      validators.ingestStatusEvent,
      "shared demo status event",
      toDynatraceStatusEvent(sanitizeStatusArtifact(sharedStatus)),
      results,
    );
  }

  if (args["connector-config"]) {
    validate(
      validators.connectorConfig,
      args["connector-config"],
      await readJson(args["connector-config"]),
      results,
    );
  }
  if (args.approval) {
    validate(validators.approval, args.approval, await readJson(args.approval), results);
  }
  if (args["import-plan"]) {
    validate(
      validators.importPlan,
      args["import-plan"],
      await readJson(args["import-plan"]),
      results,
    );
  }
  if (args["package-dir"]) {
    await validatePackageDir(validators, args["package-dir"], results);
  }
  if (args.status) {
    validate(validators.ingestStatus, args.status, await readJson(args.status), results);
  }
  if (args["status-event"]) {
    validate(
      validators.ingestStatusEvent,
      args["status-event"],
      await readJson(args["status-event"]),
      results,
    );
  }
  if (args["network-evidence-event"]) {
    validate(
      validators.networkEvidenceEvent,
      args["network-evidence-event"],
      await readJson(args["network-evidence-event"]),
      results,
    );
  }
  if (args["change-context"]) {
    validate(
      validators.changeContext,
      args["change-context"],
      await readJson(args["change-context"]),
      results,
    );
  }
  if (args["change-validation-gate"]) {
    validate(
      validators.changeValidationGate,
      args["change-validation-gate"],
      await readJson(args["change-validation-gate"]),
      results,
    );
  }
  if (args["change-validation-event"]) {
    validate(
      validators.changeValidationEvent,
      args["change-validation-event"],
      await readJson(args["change-validation-event"]),
      results,
    );
  }
  if (args["guardian-context"]) {
    validate(
      validators.guardianContext,
      args["guardian-context"],
      await readJson(args["guardian-context"]),
      results,
    );
  }
  if (args["check-health-transitions"]) {
    validate(
      validators.checkHealthTransitions,
      args["check-health-transitions"],
      await readJson(args["check-health-transitions"]),
      results,
    );
  }
  if (args["security-correlation"]) {
    validate(
      validators.securityCorrelation,
      args["security-correlation"],
      await readJson(args["security-correlation"]),
      results,
    );
  }
  if (args["security-correlation-event-batch"]) {
    validate(
      validators.securityCorrelationEventBatch,
      args["security-correlation-event-batch"],
      await readJson(args["security-correlation-event-batch"]),
      results,
    );
  }

  process.stdout.write(
    `${JSON.stringify(
      {
        status: "ok",
        validated: results.length,
        artifacts: results,
      },
      null,
      2,
    )}\n`,
  );
};

main().catch((error) => {
  process.stderr.write(`${error.message}\n`);
  process.stderr.write(usage);
  process.exit(1);
});
