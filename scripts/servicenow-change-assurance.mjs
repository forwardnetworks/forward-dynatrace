#!/usr/bin/env node

import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { pathToFileURL } from "node:url";

import { buildChangeValidationGate, sha256 } from "./forward-change-validation-gate.mjs";
import {
  buildServiceNowChangePreflight,
  fetchServiceNowChange,
} from "./servicenow-change-preflight.mjs";
import {
  buildFeedbackReceipt,
  buildServiceNowFeedbackPlan,
  publishServiceNowFeedback,
  verifyServiceNowFeedbackRetry,
} from "./servicenow-change-feedback.mjs";
import {
  buildChangeGateEvent,
  publishChangeGateEvent,
} from "./publish-dynatrace-change-gate.mjs";
import {
  readToken,
  toOpenPipelineApiBaseUrl,
} from "./publish-dynatrace-status-event.mjs";
import { validateScopeResolution } from "./resolve-servicenow-scope.mjs";

const SUMMARY_SCHEMA = "forward-dynatrace-servicenow-change-assurance/v2";

const usage = `
Finalize ServiceNow-first Forward and Dynatrace change assurance

Usage:
  npm run servicenow:change-assurance -- \\
    --preflight servicenow-change-preflight.json \\
    --context forward-change-context.json \\
    --before-evidence forward-before-path-evidence.json \\
    --after-evidence forward-after-path-evidence.json \\
    --reconciliation-status forward-ingest-status.json \\
    --evidence-source live-customer-dependencies \\
    --output-dir /secure/evidence/change-assurance

Options:
  --preflight path               Eligible authoritative ServiceNow preflight.
  --context path                 Stabilized Dynatrace deployment/health context.
  --before-evidence path         Executed Forward evidence from the before snapshot.
  --after-evidence path          Executed Forward evidence from the after snapshot.
  --reconciliation-status path   Read-only Forward reconciliation status.
  --output-dir path              Evidence output directory.
  --scope-resolution path        Optional protected resolved-scope artifact.
  --evidence-source value        Publish-safe cross-domain evidence source for live finalization.
  --synthetic                    Mark the result synthetic when any input is replay/demo evidence.
  --publish-servicenow           Submit to the ServiceNow assurance ledger ingress.
  --verify-servicenow-retry      With ServiceNow publication, submit the exact evidence
                                 twice and require duplicate-free existing receipts.
  --publish-dynatrace            Publish aggregate gate event to Dynatrace.
  --dynatrace-environment-url    Dynatrace Apps environment URL.
  --dynatrace-api-base-url       Override Dynatrace OpenPipeline API origin.
  --dynatrace-token-file path    Platform token file outside the repository.
  --report-only                  Exit 0 for warn/fail after writing artifacts.
  --use-saved-preflight          Offline tests only; skip the final authoritative re-read.
  --help                         Show help.

Dry-run is the default. This conductor consumes already-collected evidence and
does not deploy applications or mutate Forward checks. Warn/fail exits 2 by default.
`;

export const parseArgs = (argv) => {
  const args = {};
  const flags = new Set([
    "help",
    "publish-servicenow",
    "verify-servicenow-retry",
    "publish-dynatrace",
    "fail-on-non-pass",
    "report-only",
    "use-saved-preflight",
    "synthetic",
  ]);
  for (let index = 0; index < argv.length; index += 1) {
    const value = argv[index];
    if (!value.startsWith("--")) throw new Error(`Unexpected argument: ${value}`);
    const key = value.slice(2);
    if (flags.has(key)) {
      args[key] = true;
      continue;
    }
    const next = argv[index + 1];
    if (!next || next.startsWith("--")) throw new Error(`Missing value for ${value}.`);
    args[key] = next;
    index += 1;
  }
  return args;
};

const required = (args, key) => {
  if (!args[key]) throw new Error(`Missing required option: --${key}.`);
  return args[key];
};

const canonicalJson = (value) => `${JSON.stringify(value, null, 2)}\n`;
const sortedUnique = (values) => [...new Set(values)].sort();
const EVIDENCE_SOURCE_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/;

const provenanceFromArgs = (args) => {
  if (args["use-saved-preflight"]) {
    return { evidenceSource: "servicenow-saved-offline-rehearsal", synthetic: true };
  }
  const evidenceSource = required(args, "evidence-source");
  if (!EVIDENCE_SOURCE_PATTERN.test(evidenceSource)) {
    throw new Error("--evidence-source must be a publish-safe label up to 128 characters.");
  }
  return { evidenceSource, synthetic: Boolean(args.synthetic) };
};

export const validatePreflightContextAlignment = (preflight, context) => {
  if (preflight.authorization?.status !== "eligible") {
    throw new Error("ServiceNow preflight authorization must be eligible before assurance finalization.");
  }
  if (preflight.change?.number !== context.changeId) {
    throw new Error("ServiceNow change number must match the Dynatrace change context ID.");
  }
  if (preflight.change?.deploymentId !== context.deploymentId) {
    throw new Error("ServiceNow deployment ID must match the Dynatrace change context deployment ID.");
  }
  if (
    JSON.stringify(sortedUnique(preflight.scope?.serviceEntityIds || [])) !==
    JSON.stringify(sortedUnique(context.serviceEntityIds || []))
  ) {
    throw new Error("ServiceNow affected services must exactly match the Dynatrace change context.");
  }
  return { preflight, context };
};

export const buildAssuranceArtifacts = ({
  preflight,
  context,
  beforeEvidence,
  afterEvidence,
  reconciliationStatus,
  inputTexts,
  provenance,
  scopeMapping = null,
}) => {
  validatePreflightContextAlignment(preflight, context);
  if (
    !provenance ||
    typeof provenance.evidenceSource !== "string" ||
    !EVIDENCE_SOURCE_PATTERN.test(provenance.evidenceSource) ||
    typeof provenance.synthetic !== "boolean"
  ) {
    throw new Error("ServiceNow assurance requires explicit evidence source and synthetic provenance.");
  }
  const evidenceHashes = {
    contextSha256: sha256(inputTexts.context),
    beforePathEvidenceSha256: sha256(inputTexts.beforeEvidence),
    afterPathEvidenceSha256: sha256(inputTexts.afterEvidence),
    reconciliationStatusSha256: sha256(inputTexts.reconciliationStatus),
  };
  const gate = buildChangeValidationGate({
    context,
    beforeEvidence,
    afterEvidence,
    reconciliationStatus,
    evidenceHashes,
  });
  const gateText = canonicalJson(gate);
  const runId = `servicenow-change-assurance-${sha256(gateText).slice(0, 16)}`;
  const serviceNowPlan = buildServiceNowFeedbackPlan({ preflight, gate });
  const dynatraceEvent = buildChangeGateEvent(gate, {
    runId,
    gateSha256: sha256(gateText),
    serviceNowEvidenceSha256: serviceNowPlan.evidenceSha256,
    serviceNowIdempotencyKey: serviceNowPlan.idempotencyKey,
    evidenceSource: provenance?.evidenceSource,
    synthetic: provenance?.synthetic,
    scopeMapping,
  });
  return { gate, gateText, runId, dynatraceEvent, serviceNowPlan };
};

const readInput = async (filePath) => {
  const text = await readFile(path.resolve(filePath), "utf8");
  return { text, value: JSON.parse(text) };
};

export const run = async (argv = process.argv.slice(2)) => {
  const args = parseArgs(argv);
  if (args.help) {
    process.stdout.write(usage);
    return 0;
  }
  if (args["use-saved-preflight"] && (args["publish-servicenow"] || args["publish-dynatrace"])) {
    throw new Error("--use-saved-preflight is report-only and cannot publish externally.");
  }
  if (args["verify-servicenow-retry"] && !args["publish-servicenow"]) {
    throw new Error("--verify-servicenow-retry requires --publish-servicenow.");
  }
  const provenance = provenanceFromArgs(args);
  const [preflight, context, beforeEvidence, afterEvidence, reconciliationStatus] = await Promise.all([
    readInput(required(args, "preflight")),
    readInput(required(args, "context")),
    readInput(required(args, "before-evidence")),
    readInput(required(args, "after-evidence")),
    readInput(required(args, "reconciliation-status")),
  ]);
  const scopeResolution = args["scope-resolution"]
    ? await readInput(args["scope-resolution"])
    : null;
  const outputDir = path.resolve(required(args, "output-dir"));
  await mkdir(outputDir, { recursive: true });

  let effectivePreflight = preflight.value;
  let preflightSource = "authoritative-refresh";
  if (args["use-saved-preflight"]) {
    preflightSource = "saved-offline";
  } else {
    const record = await fetchServiceNowChange({
      baseUrl: process.env.SERVICENOW_BASE_URL,
      user: process.env.SERVICENOW_USER,
      password: process.env.SERVICENOW_PASSWORD,
      changeNumber: preflight.value.change.number,
    });
    effectivePreflight = buildServiceNowChangePreflight({
      record,
      observedAt: new Date().toISOString(),
      instanceAlias: preflight.value.source.instanceAlias,
      deploymentId: preflight.value.change.deploymentId,
      networkId: preflight.value.scope.forwardNetworkId,
      serviceEntityIds: preflight.value.scope.serviceEntityIds,
      eligibleStateValues: preflight.value.authorization.eligibleStateValues,
      approvedValues: preflight.value.authorization.approvedValues,
    });
    if (effectivePreflight.change.sysId !== preflight.value.change.sysId) {
      throw new Error("Authoritative ServiceNow refresh returned a different change sys_id.");
    }
  }
  const effectivePreflightPath = path.join(outputDir, "servicenow-change-preflight-final.json");
  await writeFile(effectivePreflightPath, canonicalJson(effectivePreflight));

  if (scopeResolution) {
    validateScopeResolution(scopeResolution.value, {
      asOf: new Date().toISOString(),
      forwardNetworkId: effectivePreflight.scope.forwardNetworkId,
      serviceEntityIds: effectivePreflight.scope.serviceEntityIds,
      serviceNowInstanceAlias: effectivePreflight.source.instanceAlias,
    });
  }
  const scopeMapping = scopeResolution ? {
    mappingId: scopeResolution.value.mappingId,
    mappingSha256: scopeResolution.value.mappingSha256,
    environmentId: scopeResolution.value.environmentId,
    sourceRecords: scopeResolution.value.sourceRecords,
    resolvedAt: scopeResolution.value.resolvedAt,
    expiresAt: scopeResolution.value.validity.mappingExpiresAt,
  } : null;

  const artifacts = buildAssuranceArtifacts({
    preflight: effectivePreflight,
    context: context.value,
    beforeEvidence: beforeEvidence.value,
    afterEvidence: afterEvidence.value,
    reconciliationStatus: reconciliationStatus.value,
    inputTexts: {
      context: context.text,
      beforeEvidence: beforeEvidence.text,
      afterEvidence: afterEvidence.text,
      reconciliationStatus: reconciliationStatus.text,
    },
    provenance,
    scopeMapping,
  });

  const gatePath = path.join(outputDir, "forward-change-validation-gate.json");
  const eventPath = path.join(outputDir, "forward-change-validation-event.json");
  const evidencePath = path.join(outputDir, artifacts.serviceNowPlan.attachmentFileName);
  const feedbackPath = path.join(outputDir, "servicenow-change-feedback.json");
  const feedbackRetryPath = path.join(outputDir, "servicenow-change-feedback-retry.json");
  const summaryPath = path.join(outputDir, "servicenow-change-assurance.json");
  await Promise.all([
    writeFile(gatePath, artifacts.gateText),
    writeFile(eventPath, canonicalJson(artifacts.dynatraceEvent)),
    writeFile(evidencePath, artifacts.serviceNowPlan.attachmentText),
  ]);

  let serviceNowPublication = {
    workNote: { status: "planned", sysId: null },
    attachment: { status: "planned", sysId: null },
  };
  let serviceNowRetryVerification = null;
  if (args["publish-servicenow"]) {
    const result = await publishServiceNowFeedback({
      preflight: effectivePreflight,
      gate: artifacts.gate,
      baseUrl: process.env.SERVICENOW_BASE_URL,
      user: process.env.SERVICENOW_FEEDBACK_USER || process.env.SERVICENOW_USER,
      password: process.env.SERVICENOW_FEEDBACK_PASSWORD || process.env.SERVICENOW_PASSWORD,
    });
    serviceNowPublication = result.publication;
    if (args["verify-servicenow-retry"]) {
      const retry = await publishServiceNowFeedback({
        preflight: effectivePreflight,
        gate: artifacts.gate,
        baseUrl: process.env.SERVICENOW_BASE_URL,
        user: process.env.SERVICENOW_FEEDBACK_USER || process.env.SERVICENOW_USER,
        password: process.env.SERVICENOW_FEEDBACK_PASSWORD || process.env.SERVICENOW_PASSWORD,
      });
      serviceNowRetryVerification = verifyServiceNowFeedbackRetry({ initial: result, retry });
      await writeFile(feedbackRetryPath, canonicalJson(buildFeedbackReceipt({
        plan: retry.plan,
        mode: "apply",
        publication: retry.publication,
      })));
    }
  }
  const feedbackReceipt = buildFeedbackReceipt({
    plan: artifacts.serviceNowPlan,
    mode: args["publish-servicenow"] ? "apply" : "dry-run",
    publication: serviceNowPublication,
  });
  await writeFile(feedbackPath, canonicalJson(feedbackReceipt));

  let dynatracePublication = { status: "planned", responseStatus: null };
  if (args["publish-dynatrace"]) {
    const environmentUrl = args["dynatrace-environment-url"] || process.env.DYNATRACE_ENVIRONMENT_URL;
    const apiBaseUrl = args["dynatrace-api-base-url"] || process.env.DYNATRACE_API_BASE_URL ||
      (environmentUrl ? toOpenPipelineApiBaseUrl(environmentUrl) : null);
    if (!apiBaseUrl) {
      throw new Error("Missing --dynatrace-environment-url or --dynatrace-api-base-url.");
    }
    const token = await readToken(args["dynatrace-token-file"]);
    const result = await publishChangeGateEvent({
      event: artifacts.dynatraceEvent,
      apiBaseUrl,
      token,
    });
    dynatracePublication = { status: "published", responseStatus: result.responseStatus };
  }

  const summary = {
    schemaVersion: SUMMARY_SCHEMA,
    generatedAt: artifacts.gate.generatedAt,
    runId: artifacts.runId,
    change: {
      number: effectivePreflight.change.number,
      deploymentId: effectivePreflight.change.deploymentId,
    },
    provenance,
    ...(scopeMapping ? { scopeMapping } : {}),
    decision: artifacts.gate.decision,
    reasonCodes: artifacts.gate.reasons.map((reason) => reason.code),
    publications: {
      serviceNow: serviceNowPublication,
      ...(serviceNowRetryVerification
        ? { serviceNowRetry: serviceNowRetryVerification }
        : {}),
      dynatrace: dynatracePublication,
      deploymentGate: { status: "artifact-ready", path: gatePath },
    },
    artifacts: {
      serviceNowPreflight: effectivePreflightPath,
      gate: gatePath,
      dynatraceEvent: eventPath,
      serviceNowEvidence: evidencePath,
      serviceNowFeedback: feedbackPath,
      ...(serviceNowRetryVerification
        ? { serviceNowRetryFeedback: feedbackRetryPath }
        : {}),
    },
  };
  await writeFile(summaryPath, canonicalJson(summary));
  process.stdout.write(canonicalJson({ summaryPath, preflightSource, ...summary }));
  return !args["report-only"] && artifacts.gate.decision !== "pass" ? 2 : 0;
};

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  run().then((code) => {
    process.exitCode = code;
  }).catch((error) => {
    process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
    process.exitCode = 1;
  });
}
