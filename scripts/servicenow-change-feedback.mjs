#!/usr/bin/env node

import { createHash } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { pathToFileURL } from "node:url";

import { normalizeServiceNowBaseUrl } from "./servicenow-change-preflight.mjs";

const PREFLIGHT_SCHEMA = "forward-dynatrace-servicenow-change-preflight/v1";
const GATE_SCHEMA = "forward-dynatrace-change-validation/v1";
const EVIDENCE_SCHEMA = "forward-dynatrace-servicenow-change-assurance-evidence/v1";
const RECEIPT_SCHEMA = "forward-dynatrace-servicenow-change-feedback/v1";

const usage = `
Publish bounded change-assurance feedback to ServiceNow

Usage:
  npm run servicenow:change-feedback -- \\
    --preflight servicenow-change-preflight.json \\
    --gate forward-change-validation-gate.json \\
    --output-dir /secure/evidence/feedback

Options:
  --preflight path          Eligible authoritative ServiceNow preflight artifact.
  --gate path               Deterministic Forward and Dynatrace change gate.
  --output-dir path         Write evidence bundle and feedback receipt.
  --apply                   Submit evidence to the ServiceNow assurance ledger ingress.
  --verify-retry            With --apply, submit the exact bundle twice and require
                            the second receipt to reuse both publication sys_ids.
  --help                    Show help.

Required environment for --apply:
  SERVICENOW_BASE_URL, SERVICENOW_USER, SERVICENOW_PASSWORD

Dry-run is the default. Idempotency is derived from the exact evidence bytes. The
ServiceNow assurance service owns the unique ledger row, attachment, and work note.
`;

export const parseArgs = (argv) => {
  const args = {};
  for (let index = 0; index < argv.length; index += 1) {
    const value = argv[index];
    if (value === "--apply" || value === "--verify-retry" || value === "--help") {
      args[value.slice(2)] = true;
      continue;
    }
    if (!value.startsWith("--")) throw new Error(`Unexpected argument: ${value}`);
    const next = argv[index + 1];
    if (!next || next.startsWith("--")) throw new Error(`Missing value for ${value}.`);
    args[value.slice(2)] = next;
    index += 1;
  }
  return args;
};

const required = (value, label) => {
  if (typeof value !== "string" || !value.trim()) throw new Error(`Missing required ${label}.`);
  return value.trim();
};

const isRecord = (value) => Boolean(value) && typeof value === "object" && !Array.isArray(value);
const canonicalJson = (value) => `${JSON.stringify(value, null, 2)}\n`;
export const sha256 = (value) => createHash("sha256").update(value).digest("hex");

const sortedUnique = (values) => [...new Set(values)].sort();

export const validatePreflightGateAlignment = (preflight, gate) => {
  if (!isRecord(preflight) || preflight.schemaVersion !== PREFLIGHT_SCHEMA) {
    throw new Error(`ServiceNow preflight schemaVersion must be ${PREFLIGHT_SCHEMA}.`);
  }
  if (preflight.authorization?.status !== "eligible") {
    throw new Error("ServiceNow preflight authorization must be eligible before feedback publication.");
  }
  if (!isRecord(gate) || gate.schemaVersion !== GATE_SCHEMA) {
    throw new Error(`Change gate schemaVersion must be ${GATE_SCHEMA}.`);
  }
  if (!new Set(["pass", "warn", "fail"]).has(gate.decision)) {
    throw new Error("Change gate decision must be pass, warn, or fail.");
  }
  if (preflight.change?.number !== gate.change?.changeId) {
    throw new Error("ServiceNow change number must match the gate change ID.");
  }
  if (preflight.change?.deploymentId !== gate.change?.deploymentId) {
    throw new Error("ServiceNow deployment ID must match the gate deployment ID.");
  }
  if (
    JSON.stringify(sortedUnique(preflight.scope?.serviceEntityIds || [])) !==
    JSON.stringify(sortedUnique(gate.change?.serviceEntityIds || []))
  ) {
    throw new Error("ServiceNow affected services must exactly match the gate service scope.");
  }
  if (preflight.scope?.forwardNetworkId !== gate.forward?.networkId) {
    throw new Error("ServiceNow Forward network ID must match the gate network ID.");
  }
  if (!/^[0-9a-f]{32}$/.test(preflight.change?.sysId || "")) {
    throw new Error("ServiceNow preflight must contain a valid change sys_id.");
  }
  return { preflight, gate };
};

export const buildServiceNowEvidenceBundle = ({ preflight, gate }) => {
  validatePreflightGateAlignment(preflight, gate);
  const preflightText = canonicalJson(preflight);
  const gateText = canonicalJson(gate);
  return {
    schemaVersion: EVIDENCE_SCHEMA,
    generatedAt: gate.generatedAt,
    change: {
      number: preflight.change.number,
      sysId: preflight.change.sysId,
      deploymentId: preflight.change.deploymentId,
      serviceEntityIds: sortedUnique(preflight.scope.serviceEntityIds),
    },
    decision: gate.decision,
    reasonCodes: gate.reasons.map((reason) => reason.code),
    forward: {
      networkId: gate.forward.networkId,
      beforeSnapshotId: gate.forward.before.snapshotId,
      afterSnapshotId: gate.forward.after.snapshotId,
      reconciliationRunId: gate.forward.reconciliation.runId,
      reconciliationState: gate.forward.reconciliation.importState,
    },
    dynatrace: { ...gate.dynatrace },
    lineage: {
      preflightSha256: sha256(preflightText),
      gateSha256: sha256(gateText),
      gateEvidence: { ...gate.evidence },
    },
    preflight,
    gate,
  };
};

export const buildServiceNowFeedbackPlan = ({ preflight, gate }) => {
  const evidence = buildServiceNowEvidenceBundle({ preflight, gate });
  const attachmentText = canonicalJson(evidence);
  const evidenceSha256 = sha256(attachmentText);
  const idempotencyKey = `forward-dynatrace:${evidenceSha256}`;
  const attachmentFileName = `forward-dynatrace-change-assurance-${evidenceSha256}.json`;
  const reasonCodes = evidence.reasonCodes.join(",");
  const workNote = [
    `Forward/Dynatrace change assurance: ${evidence.decision.toUpperCase()}`,
    `Deployment: ${evidence.change.deploymentId}`,
    `Forward network/snapshots: ${evidence.forward.networkId} ${evidence.forward.beforeSnapshotId} -> ${evidence.forward.afterSnapshotId}`,
    `Dynatrace: deployment=${evidence.dynatrace.deploymentState} health=${evidence.dynatrace.serviceHealth} open_problems=${evidence.dynatrace.openProblemCount}`,
    `Reasons: ${reasonCodes}`,
    `Evidence SHA-256: ${evidenceSha256}`,
    `[${idempotencyKey}]`,
  ].join("\n");
  return {
    evidence,
    attachmentText,
    evidenceSha256,
    idempotencyKey,
    attachmentFileName,
    workNote,
  };
};

const basicAuthorization = (user, password) =>
  `Basic ${Buffer.from(`${user}:${password}`).toString("base64")}`;

const readResponse = async (response, label) => {
  const text = await response.text();
  let body = {};
  try {
    body = text ? JSON.parse(text) : {};
  } catch {
    body = text;
  }
  if (!response.ok) {
    const printable = typeof body === "string" ? body : JSON.stringify(body);
    throw new Error(`${label} failed with ${response.status}: ${printable.slice(0, 300)}`);
  }
  return body;
};

const normalizePublicationItem = (value, label) => {
  if (!isRecord(value) || !new Set(["created", "existing"]).has(value.status)) {
    throw new Error(`ServiceNow assurance ingress ${label} publication is invalid.`);
  }
  const sysId = required(value.sysId, `ServiceNow assurance ingress ${label} sys_id`);
  return { status: value.status, sysId };
};

export const publishServiceNowFeedback = async ({
  preflight,
  gate,
  baseUrl,
  user,
  password,
  fetchImpl = fetch,
}) => {
  const plan = buildServiceNowFeedbackPlan({ preflight, gate });
  const normalizedBaseUrl = normalizeServiceNowBaseUrl(baseUrl);
  const authorization = basicAuthorization(
    required(user, "environment: SERVICENOW_USER"),
    required(password, "environment: SERVICENOW_PASSWORD"),
  );
  const sysId = preflight.change.sysId;
  const response = await fetchImpl(
    `${normalizedBaseUrl}/api/now/forward_change_assurance/changes/${encodeURIComponent(sysId)}/evidence`,
    {
      method: "POST",
      headers: {
        Accept: "application/json",
        Authorization: authorization,
        "Content-Type": "application/json",
        "X-Forward-Dynatrace-SHA256": plan.evidenceSha256,
      },
      body: plan.attachmentText,
    },
  );
  const body = await readResponse(response, "ServiceNow assurance ingress");
  const assurance = body?.status === "ok" && isRecord(body.assurance) ? body.assurance : null;
  if (!assurance) throw new Error("ServiceNow assurance ingress response is invalid.");
  if (assurance.idempotencyKey !== plan.idempotencyKey) {
    throw new Error("ServiceNow assurance ingress idempotency key does not match the evidence bundle.");
  }
  if (assurance.decision !== plan.evidence.decision || assurance.publicationStatus !== "published") {
    throw new Error("ServiceNow assurance ingress did not publish the expected decision.");
  }
  const publication = {
    workNote: normalizePublicationItem(assurance.publication?.workNote, "work-note"),
    attachment: normalizePublicationItem(assurance.publication?.attachment, "attachment"),
  };

  return {
    plan,
    publication,
  };
};

export const buildFeedbackReceipt = ({ plan, mode, publication }) => ({
  schemaVersion: RECEIPT_SCHEMA,
  generatedAt: plan.evidence.generatedAt,
  mode,
  change: {
    number: plan.evidence.change.number,
    sysId: plan.evidence.change.sysId,
  },
  decision: plan.evidence.decision,
  reasonCodes: [...plan.evidence.reasonCodes],
  idempotencyKey: plan.idempotencyKey,
  evidence: {
    sha256: plan.evidenceSha256,
    attachmentFileName: plan.attachmentFileName,
    contentType: "application/json",
    bytes: Buffer.byteLength(plan.attachmentText),
  },
  publication,
});

export const verifyServiceNowFeedbackRetry = ({ initial, retry }) => {
  if (initial.plan.idempotencyKey !== retry.plan.idempotencyKey) {
    throw new Error("ServiceNow retry changed the evidence idempotency key.");
  }
  if (initial.plan.attachmentText !== retry.plan.attachmentText) {
    throw new Error("ServiceNow retry changed the exact evidence attachment bytes.");
  }
  for (const key of ["workNote", "attachment"]) {
    const first = initial.publication[key];
    const second = retry.publication[key];
    if (second.status !== "existing") {
      throw new Error(`ServiceNow retry ${key} must report existing, received ${second.status}.`);
    }
    if (first.sysId !== second.sysId) {
      throw new Error(`ServiceNow retry ${key} sys_id does not match the first publication.`);
    }
  }
  return {
    status: "verified",
    attempts: 2,
    idempotencyKey: initial.plan.idempotencyKey,
    publication: retry.publication,
  };
};

export const run = async (argv = process.argv.slice(2)) => {
  const args = parseArgs(argv);
  if (args.help) {
    process.stdout.write(usage);
    return 0;
  }
  if (args["verify-retry"] && !args.apply) {
    throw new Error("--verify-retry requires --apply.");
  }
  const preflight = JSON.parse(await readFile(path.resolve(required(args.preflight, "option: --preflight")), "utf8"));
  const gate = JSON.parse(await readFile(path.resolve(required(args.gate, "option: --gate")), "utf8"));
  const outputDir = path.resolve(required(args["output-dir"], "option: --output-dir"));
  await mkdir(outputDir, { recursive: true });

  let result;
  let retryResult = null;
  let retryVerification = null;
  if (args.apply) {
    result = await publishServiceNowFeedback({
      preflight,
      gate,
      baseUrl: process.env.SERVICENOW_BASE_URL,
      user: process.env.SERVICENOW_USER,
      password: process.env.SERVICENOW_PASSWORD,
    });
    if (args["verify-retry"]) {
      retryResult = await publishServiceNowFeedback({
        preflight,
        gate,
        baseUrl: process.env.SERVICENOW_BASE_URL,
        user: process.env.SERVICENOW_USER,
        password: process.env.SERVICENOW_PASSWORD,
      });
      retryVerification = verifyServiceNowFeedbackRetry({ initial: result, retry: retryResult });
    }
  } else {
    const plan = buildServiceNowFeedbackPlan({ preflight, gate });
    result = {
      plan,
      publication: {
        workNote: { status: "planned", sysId: null },
        attachment: { status: "planned", sysId: null },
      },
    };
  }

  const evidencePath = path.join(outputDir, result.plan.attachmentFileName);
  const receiptPath = path.join(outputDir, "servicenow-change-feedback.json");
  const retryReceiptPath = retryResult
    ? path.join(outputDir, "servicenow-change-feedback-retry.json")
    : null;
  const receipt = buildFeedbackReceipt({
    plan: result.plan,
    mode: args.apply ? "apply" : "dry-run",
    publication: result.publication,
  });
  await writeFile(evidencePath, result.plan.attachmentText);
  await writeFile(receiptPath, canonicalJson(receipt));
  if (retryResult && retryReceiptPath) {
    await writeFile(retryReceiptPath, canonicalJson(buildFeedbackReceipt({
      plan: retryResult.plan,
      mode: "apply",
      publication: retryResult.publication,
    })));
  }
  process.stdout.write(canonicalJson({
    receiptPath,
    retryReceiptPath,
    retryVerification,
    evidencePath,
    ...receipt,
  }));
  return 0;
};

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  run().then((code) => {
    process.exitCode = code;
  }).catch((error) => {
    process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
    process.exitCode = 1;
  });
}
