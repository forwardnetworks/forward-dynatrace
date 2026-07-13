#!/usr/bin/env node

import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { pathToFileURL } from "node:url";

const SCHEMA_VERSION = "forward-dynatrace-servicenow-change-preflight/v1";
const NEXT_STAGES = [
  "dynatrace-baseline",
  "forward-before-evidence",
  "customer-deployment",
  "dynatrace-post-change-health",
  "forward-after-evidence",
  "forward-reconciliation-dry-run",
  "combined-change-gate",
  "servicenow-evidence-feedback",
];
export const DEFAULT_ELIGIBLE_STATE_VALUES = ["-2", "-1"];
export const DEFAULT_APPROVED_VALUES = ["approved"];

const usage = `
ServiceNow change-assurance preflight

Usage:
  npm run servicenow:change-preflight -- \\
    --change-number CHG0042187 \\
    --deployment-id checkout-api-2026.07.15.3 \\
    --network-id network-production \\
    --service-entity-id SERVICE-CHECKOUT-API \\
    --output /tmp/servicenow-change-preflight.json

Options:
  --change-number value       Exact ServiceNow change_request number.
  --deployment-id value       Customer deployment correlation ID.
  --network-id value          Forward network ID used by later evidence stages.
  --service-entity-id value   Affected Dynatrace entity ID; repeat as needed.
  --instance-alias value      Publish-safe instance label; default: servicenow.
  --evaluation-time value     ISO time for window evaluation; default: current time.
  --eligible-state value      Allowed ServiceNow state value; repeat as needed.
  --approved-value value      Allowed ServiceNow approval value; repeat as needed.
  --output path               Sanitized preflight artifact.
  --fail-on-blocked           Exit 2 after writing when the change is not eligible.
  --help                      Show help.

Required environment:
  SERVICENOW_BASE_URL, SERVICENOW_USER, SERVICENOW_PASSWORD

This command performs one authoritative read of ServiceNow change_request.
It never changes ServiceNow, Dynatrace, Forward, or a deployment system.
`;

const repeatableArgs = new Set(["service-entity-id", "eligible-state", "approved-value"]);

export const parseArgs = (argv) => {
  const args = {};
  for (let index = 0; index < argv.length; index += 1) {
    const value = argv[index];
    if (value === "--help" || value === "--fail-on-blocked") {
      args[value.slice(2)] = true;
      continue;
    }
    if (!value.startsWith("--")) throw new Error(`Unexpected argument: ${value}`);
    const key = value.slice(2);
    const next = argv[index + 1];
    if (!next || next.startsWith("--")) throw new Error(`Missing value for ${value}.`);
    if (repeatableArgs.has(key)) {
      args[key] = [...(args[key] || []), next];
    } else {
      args[key] = next;
    }
    index += 1;
  }
  return args;
};

const required = (value, label) => {
  if (typeof value !== "string" || !value.trim()) throw new Error(`Missing required ${label}.`);
  return value.trim();
};

const uniqueNonEmpty = (values, label) => {
  if (!Array.isArray(values) || values.length === 0) {
    throw new Error(`${label} must contain at least one value.`);
  }
  if (values.some((value) => typeof value !== "string" || !value.trim())) {
    throw new Error(`${label} must contain non-empty strings.`);
  }
  return [...new Set(values.map((value) => value.trim()))];
};

const publishSafeAlias = (value) => {
  const alias = value || "servicenow";
  if (!/^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/.test(alias)) {
    throw new Error("--instance-alias must be a publish-safe label up to 128 characters.");
  }
  return alias;
};

const normalizeField = (field) => {
  if (field && typeof field === "object" && !Array.isArray(field)) {
    return {
      value: String(field.value ?? ""),
      display: String(field.display_value ?? field.display ?? field.value ?? ""),
    };
  }
  return { value: String(field ?? ""), display: String(field ?? "") };
};

const toIsoDateTime = (value) => {
  const raw = normalizeField(value).value.trim();
  if (!raw) return null;
  const normalized = /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/.test(raw)
    ? `${raw.replace(" ", "T")}Z`
    : raw;
  const timestamp = Date.parse(normalized);
  if (Number.isNaN(timestamp)) throw new Error(`ServiceNow returned invalid date-time: ${raw}`);
  return new Date(timestamp).toISOString();
};

const basicAuthorization = (user, password) =>
  `Basic ${Buffer.from(`${user}:${password}`).toString("base64")}`;

export const normalizeServiceNowBaseUrl = (value) => {
  const parsed = new URL(required(value, "environment: SERVICENOW_BASE_URL"));
  const loopback = new Set(["localhost", "127.0.0.1", "::1"]).has(parsed.hostname);
  if (parsed.protocol !== "https:" && !(parsed.protocol === "http:" && loopback)) {
    throw new Error("SERVICENOW_BASE_URL must use HTTPS; HTTP is allowed only for loopback tests.");
  }
  parsed.pathname = parsed.pathname.replace(/\/$/, "");
  parsed.search = "";
  parsed.hash = "";
  return parsed.toString().replace(/\/$/, "");
};

export const fetchServiceNowChange = async ({
  baseUrl,
  user,
  password,
  changeNumber,
  fetchImpl = globalThis.fetch,
}) => {
  const normalizedBaseUrl = normalizeServiceNowBaseUrl(baseUrl);
  const number = required(changeNumber, "option: --change-number");
  if (!/^CHG[0-9]+$/.test(number)) throw new Error("--change-number must use the CHG<number> format.");
  const url = new URL(`${normalizedBaseUrl}/api/now/table/change_request`);
  url.searchParams.set("sysparm_query", `number=${number}`);
  url.searchParams.set("sysparm_limit", "2");
  url.searchParams.set(
    "sysparm_fields",
    "sys_id,number,state,approval,risk,start_date,end_date,assignment_group",
  );
  url.searchParams.set("sysparm_display_value", "all");
  const response = await fetchImpl(url, {
    headers: {
      Accept: "application/json",
      Authorization: basicAuthorization(
        required(user, "environment: SERVICENOW_USER"),
        required(password, "environment: SERVICENOW_PASSWORD"),
      ),
    },
  });
  const text = await response.text();
  if (!response.ok) {
    throw new Error(`ServiceNow change read failed with ${response.status}: ${text.slice(0, 300)}`);
  }
  let payload;
  try {
    payload = JSON.parse(text);
  } catch {
    const mediaType = response.headers.get("content-type")
      ?.split(";", 1)[0]
      .trim()
      .toLowerCase() || "unknown";
    const looksLikeHtml = /^\s*(?:<!doctype html|<html\b)/iu.test(text);
    if (looksLikeHtml && /hibernat|developer instance/iu.test(text)) {
      throw new Error(
        `ServiceNow change read returned HTML instead of API JSON (${mediaType}). ` +
        "The developer instance appears to be hibernating; wake it in the ServiceNow Developer Portal, then retry.",
      );
    }
    if (looksLikeHtml) {
      throw new Error(
        `ServiceNow change read returned HTML instead of API JSON (${mediaType}). ` +
        "Verify the instance is awake and that API authentication was not redirected to a sign-in page.",
      );
    }
    throw new Error(
      `ServiceNow change read returned invalid API JSON (${mediaType}); verify the Table API endpoint and response policy.`,
    );
  }
  const rows = payload.result;
  if (!Array.isArray(rows)) throw new Error("ServiceNow change response must contain result array.");
  if (rows.length !== 1) {
    throw new Error(`ServiceNow change lookup returned ${rows.length} records for ${number}; expected exactly one.`);
  }
  return rows[0];
};

export const buildServiceNowChangePreflight = ({
  record,
  observedAt,
  instanceAlias,
  deploymentId,
  networkId,
  serviceEntityIds,
  eligibleStateValues = DEFAULT_ELIGIBLE_STATE_VALUES,
  approvedValues = DEFAULT_APPROVED_VALUES,
}) => {
  const evaluationMs = Date.parse(observedAt);
  if (Number.isNaN(evaluationMs)) throw new Error("Evaluation time must be an ISO date-time.");
  const number = normalizeField(record.number);
  const sysId = normalizeField(record.sys_id);
  if (!/^CHG[0-9]+$/.test(number.value)) throw new Error("ServiceNow change number is invalid.");
  if (!/^[0-9a-f]{32}$/.test(sysId.value)) throw new Error("ServiceNow change sys_id is invalid.");
  const approval = normalizeField(record.approval);
  const state = normalizeField(record.state);
  const risk = normalizeField(record.risk);
  const assignmentGroup = normalizeField(record.assignment_group);
  const startsAt = toIsoDateTime(record.start_date);
  const endsAt = toIsoDateTime(record.end_date);
  const eligibleStates = uniqueNonEmpty(eligibleStateValues, "Eligible ServiceNow states");
  const approvals = uniqueNonEmpty(approvedValues, "Approved ServiceNow values");
  const reasons = [];

  if (!approvals.includes(approval.value)) {
    reasons.push({
      code: "SERVICENOW_NOT_APPROVED",
      message: `ServiceNow approval value ${approval.value || "<empty>"} is not approved.`,
    });
  }
  if (!eligibleStates.includes(state.value)) {
    reasons.push({
      code: "SERVICENOW_STATE_NOT_EXECUTABLE",
      message: `ServiceNow state value ${state.value || "<empty>"} is not eligible for execution.`,
    });
  }
  if (!startsAt || !endsAt) {
    reasons.push({
      code: "SERVICENOW_WINDOW_MISSING",
      message: "ServiceNow planned start and end dates are required.",
    });
  } else if (Date.parse(endsAt) <= Date.parse(startsAt)) {
    reasons.push({
      code: "SERVICENOW_WINDOW_INVALID",
      message: "ServiceNow planned end must be later than planned start.",
    });
  } else if (evaluationMs < Date.parse(startsAt) || evaluationMs > Date.parse(endsAt)) {
    reasons.push({
      code: "OUTSIDE_CHANGE_WINDOW",
      message: "Evaluation time is outside the authoritative ServiceNow change window.",
    });
  }

  return {
    schemaVersion: SCHEMA_VERSION,
    observedAt: new Date(evaluationMs).toISOString(),
    mode: "read-only",
    source: {
      instanceAlias: publishSafeAlias(instanceAlias),
      table: "change_request",
      authoritativeRead: true,
    },
    change: {
      number: number.value,
      sysId: sysId.value,
      deploymentId: required(deploymentId, "option: --deployment-id"),
      approval,
      state,
      risk,
      assignmentGroup,
      window: { startsAt, endsAt },
    },
    scope: {
      forwardNetworkId: required(networkId, "option: --network-id"),
      serviceEntityIds: uniqueNonEmpty(serviceEntityIds, "Affected service entity IDs").sort(),
    },
    authorization: {
      status: reasons.length === 0 ? "eligible" : "blocked",
      reasons,
      eligibleStateValues: [...eligibleStates].sort(),
      approvedValues: [...approvals].sort(),
    },
    nextStages: [...NEXT_STAGES],
  };
};

export const run = async (argv = process.argv.slice(2)) => {
  const args = parseArgs(argv);
  if (args.help) {
    process.stdout.write(usage);
    return 0;
  }
  const observedAt = args["evaluation-time"] || new Date().toISOString();
  const record = await fetchServiceNowChange({
    baseUrl: process.env.SERVICENOW_BASE_URL,
    user: process.env.SERVICENOW_USER,
    password: process.env.SERVICENOW_PASSWORD,
    changeNumber: args["change-number"],
  });
  const artifact = buildServiceNowChangePreflight({
    record,
    observedAt,
    instanceAlias: args["instance-alias"],
    deploymentId: args["deployment-id"],
    networkId: args["network-id"],
    serviceEntityIds: args["service-entity-id"],
    eligibleStateValues: args["eligible-state"] || DEFAULT_ELIGIBLE_STATE_VALUES,
    approvedValues: args["approved-value"] || DEFAULT_APPROVED_VALUES,
  });
  const outputPath = path.resolve(required(args.output, "option: --output"));
  await mkdir(path.dirname(outputPath), { recursive: true });
  await writeFile(outputPath, `${JSON.stringify(artifact, null, 2)}\n`);
  process.stdout.write(`${JSON.stringify(artifact, null, 2)}\n`);
  if (args["fail-on-blocked"] && artifact.authorization.status === "blocked") return 2;
  return 0;
};

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  run().then((code) => {
    process.exitCode = code;
  }).catch((error) => {
    process.stderr.write(`${error.message}\n`);
    process.exitCode = 1;
  });
}
