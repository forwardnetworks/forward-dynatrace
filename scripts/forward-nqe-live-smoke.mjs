#!/usr/bin/env node

import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { pathToFileURL } from "node:url";

const root = path.resolve(new URL("..", import.meta.url).pathname);

const usage = `
Forward read-only NQE live smoke

Usage:
  npm run forward:nqe-live-smoke -- \\
    --forward-base-url https://forward.example.com \\
    --forward-network-id <network-id> \\
    --approval-file /secure/path/nqe-preview-approval.json \\
    --authorization-file /secure/path/read-only-forward-auth-header \\
    --execute \\
    --output /tmp/forward-nqe-live-smoke.json

Options:
  --forward-base-url url       Forward base URL.
  --forward-network-id id      Forward network ID for NQE execution.
  --snapshot-id id             Optional snapshot ID.
  --approval-file path         Customer approval artifact required with --execute.
  --authorization-file path    File containing the full read-only Authorization header value.
  --query-id FQ_<id>           Optional Forward-owned query ID.
  --allow-query-id FQ_<id>     Allow one optional query ID. Repeatable.
  --template-id id             endpoint-inventory-smoke, approved-endpoint-resolution, approved-blast-radius.
  --max-rows count             Result limit for the preview request. Defaults to 1.
  --include-result-sample      Include up to five sanitized sample rows in the output.
  --execute                    Run the NQE request. Omit for plan-only validation.
  --output path                Write sanitized smoke report JSON.

Authorization can also be supplied by FORWARD_NQE_READONLY_AUTHORIZATION or
FORWARD_READONLY_AUTHORIZATION. This command never writes to Forward; it uses
the app preview function and calls only POST /api/nqe when --execute is set.
`;

const multiValueArgs = new Set(["allow-query-id"]);

const parseArgs = (argv) => {
  const args = {};
  for (let index = 0; index < argv.length; index += 1) {
    const value = argv[index];
    if (value === "--help") {
      args.help = true;
      continue;
    }
    if (value === "--execute" || value === "--include-result-sample") {
      args[value.slice(2)] = true;
      continue;
    }
    if (value.startsWith("--")) {
      const key = value.slice(2);
      const next = argv[index + 1];
      if (!next || next.startsWith("--")) {
        throw new Error(`Missing value for ${value}.`);
      }
      if (multiValueArgs.has(key)) {
        args[key] = [...(args[key] || []), next];
      } else {
        args[key] = next;
      }
      index += 1;
      continue;
    }
    throw new Error(`Unsupported positional argument: ${value}`);
  }
  return args;
};

const required = (args, key) => {
  if (!args[key]) {
    throw new Error(`Missing required option: --${key}`);
  }
  return args[key];
};

const forbiddenApprovalTextPatterns = [
  /Authorization/i,
  /Basic\s+[A-Za-z0-9+/=]+/i,
  /Bearer\s+[A-Za-z0-9._-]+/i,
  /FORWARD_PASSWORD/i,
  /dt0[a-z0-9]{2,}\.[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{20,}/i,
];

const readAuthorizationFile = async (filePath) => {
  const value = (await readFile(path.resolve(filePath), "utf8")).trim();
  if (!value) {
    throw new Error("Authorization file is empty.");
  }
  return value;
};

const normalizeBaseUrl = (value) => value.replace(/\/+$/, "");

const readJsonFile = async (filePath) =>
  JSON.parse(await readFile(path.resolve(filePath), "utf8"));

const requireArrayIncludes = (approval, key, expected) => {
  const values = approval[key];
  if (!Array.isArray(values) || !values.includes(expected)) {
    throw new Error(`Approval file ${key} must include ${expected}.`);
  }
};

export const validateLiveSmokeApproval = (approval, request) => {
  if (!approval || typeof approval !== "object" || Array.isArray(approval)) {
    throw new Error("Approval file must contain a JSON object.");
  }
  const approvalText = JSON.stringify(approval);
  for (const pattern of forbiddenApprovalTextPatterns) {
    if (pattern.test(approvalText)) {
      throw new Error("Approval file contains credential-like content.");
    }
  }
  if (approval.schemaVersion !== "forward-dynatrace-nqe-preview-approval/v1") {
    throw new Error(
      "Approval file schemaVersion must be forward-dynatrace-nqe-preview-approval/v1.",
    );
  }
  if (!approval.approvedBy || typeof approval.approvedBy !== "string") {
    throw new Error("Approval file must include approvedBy.");
  }
  if (!approval.credentialModel || typeof approval.credentialModel !== "string") {
    throw new Error("Approval file must include credentialModel.");
  }
  const expiresAtMs = Date.parse(approval.expiresAt || "");
  if (!Number.isFinite(expiresAtMs) || expiresAtMs <= Date.now()) {
    throw new Error("Approval file expiresAt must be a future ISO timestamp.");
  }
  if (
    approval.forwardBaseUrl &&
    normalizeBaseUrl(approval.forwardBaseUrl) !== normalizeBaseUrl(request.forwardBaseUrl)
  ) {
    throw new Error("Approval file forwardBaseUrl does not match the requested Forward URL.");
  }
  if (
    approval.forwardNetworkId &&
    approval.forwardNetworkId !== request.forwardNetworkId
  ) {
    throw new Error("Approval file forwardNetworkId does not match the requested network.");
  }
  requireArrayIncludes(approval, "allowedOperations", "POST /api/nqe");
  requireArrayIncludes(approval, "requiredForwardPermissions", "NetworkOperation.USE_NQE");
  requireArrayIncludes(approval, "forbiddenForwardPermissions", "NetworkOperation.EDIT_CHECKS");
  if (request.templateId) {
    requireArrayIncludes(approval, "allowedTemplates", request.templateId);
  }
  if (request.queryId) {
    requireArrayIncludes(approval, "allowedQueryIds", request.queryId);
  }
  return {
    status: "verified",
    approvedBy: approval.approvedBy,
    expiresAt: approval.expiresAt,
    credentialModel: approval.credentialModel,
  };
};

const parsePositiveInteger = (value, fallback) => {
  if (value === undefined) {
    return fallback;
  }
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed <= 0) {
    throw new Error("--max-rows must be a positive integer.");
  }
  return parsed;
};

const setQueryIdAllowlist = (args) => {
  const allowed = new Set([
    ...(process.env.FORWARD_NQE_ALLOWED_QUERY_IDS || "")
      .split(",")
      .map((value) => value.trim())
      .filter(Boolean),
    ...((args["allow-query-id"] || []).map((value) => value.trim()).filter(Boolean)),
  ]);
  if (args["query-id"]) {
    allowed.add(args["query-id"].trim());
  }
  if (allowed.size > 0) {
    process.env.FORWARD_NQE_ALLOWED_QUERY_IDS = [...allowed].join(",");
  }
};

const writeJson = async (filePath, value) => {
  const outputPath = path.resolve(filePath);
  await mkdir(path.dirname(outputPath), { recursive: true });
  await writeFile(outputPath, `${JSON.stringify(value, null, 2)}\n`);
};

const main = async () => {
  const args = parseArgs(process.argv.slice(2));
  if (args.help) {
    process.stdout.write(usage);
    return;
  }

  const forwardBaseUrl = required(args, "forward-base-url");
  const forwardNetworkId = required(args, "forward-network-id");
  const request = {
    forwardBaseUrl,
    forwardNetworkId,
    ...(args["snapshot-id"] ? { snapshotId: args["snapshot-id"] } : {}),
    templateId: args["template-id"] || "endpoint-inventory-smoke",
    ...(args["query-id"] ? { queryId: args["query-id"] } : {}),
    maxRows: parsePositiveInteger(args["max-rows"], 1),
    execute: Boolean(args.execute),
    includeResultSample: Boolean(args["include-result-sample"]),
  };
  const approval = args["approval-file"]
    ? validateLiveSmokeApproval(await readJsonFile(args["approval-file"]), request)
    : null;
  if (args.execute && !approval) {
    throw new Error("--approval-file is required when --execute is supplied.");
  }
  if (args["authorization-file"] && !process.env.FORWARD_NQE_READONLY_AUTHORIZATION) {
    process.env.FORWARD_NQE_READONLY_AUTHORIZATION = await readAuthorizationFile(
      args["authorization-file"],
    );
  }
  setQueryIdAllowlist(args);

  const moduleUrl = pathToFileURL(path.join(root, "api/forward-nqe-preview.function.ts")).href;
  const { buildForwardNqePreview } = await import(moduleUrl);

  const result = await buildForwardNqePreview(request);

  const report = {
    schemaVersion: "forward-dynatrace-nqe-live-smoke/v1",
    generatedAt: new Date().toISOString(),
    mode: args.execute ? "execute" : "plan",
    status: result.status,
    summary: result.summary,
    requestPreview: result.requestPreview,
    approval,
    evidence: result.evidence,
    result: result.result || null,
    nextSteps: result.nextSteps,
  };

  if (args.output) {
    await writeJson(args.output, report);
  }
  process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);

  if (args.execute && result.status !== "ready") {
    process.exitCode = 2;
  }
};

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((error) => {
    process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
    process.exitCode = 1;
  });
}
