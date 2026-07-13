#!/usr/bin/env node

import { createHash } from "node:crypto";
import { mkdir, open, readFile, unlink, writeFile } from "node:fs/promises";
import path from "node:path";
import { pathToFileURL } from "node:url";

import { readToken, toOpenPipelineApiBaseUrl } from "./publish-dynatrace-status-event.mjs";

const STATE_SCHEMA = "forward-dynatrace-check-health-state/v1";
const BATCH_SCHEMA = "forward-dynatrace-check-health-transitions/v1";
const EVENT_TYPE = "forward.dynatrace.check.health.transition";
const VALID = new Set(["PASS", "FAIL", "ERROR"]);
export const MAX_TRANSITIONS_PER_POLL = 100;
const TRANSIENT_STATUS_CODES = new Set([429, 500, 502, 503, 504]);

const usage = `
Forward-managed check-health transition poller

  node scripts/forward-check-health-transitions.mjs --state state.json --output transitions.json

Options:
  --inventory path          Read a saved Forward check inventory instead of polling Forward.
  --state path              Durable Forward-side state file (required).
  --output path             Sanitized transition batch artifact (required).
  --apply                   Publish emitted transitions to Dynatrace OpenPipeline.
  --environment-url URL     Dynatrace Apps environment URL for --apply.
  --api-base-url URL        Override Dynatrace ingest origin.
  --token-file path         Platform Token file for --apply.
  --max-transitions n       Refuse to advance state above this bound (max/default 100).
  --evidence-source label   Publish-safe source label.
  --synthetic               Explicitly label saved demo inventory transitions.
  --help                    Show help.

Live polling uses FORWARD_BASE_URL, FORWARD_USER, FORWARD_PASSWORD, and
FORWARD_NETWORK_ID. Only checks tagged dynatrace plus exactly one dynatrace-key
are tracked. No Forward or Dynatrace object is modified.
`;

export const parseArgs = (argv) => {
  const args = {};
  for (let index = 0; index < argv.length; index += 1) {
    const value = argv[index];
    if (!value.startsWith("--")) throw new Error(`Unexpected argument: ${value}`);
    const key = value.slice(2);
    if (key === "apply" || key === "help" || key === "synthetic") {
      args[key] = true;
      continue;
    }
    const next = argv[index + 1];
    if (!next || next.startsWith("--")) throw new Error(`Missing value for --${key}`);
    args[key] = next;
    index += 1;
  }
  return args;
};

const required = (value, label) => {
  if (!value) throw new Error(`Missing required ${label}.`);
  return value;
};

const sleep = (milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds));
const positiveInteger = (value, fallback, label) => {
  if (value === undefined) return fallback;
  const parsed = Number.parseInt(value, 10);
  if (!Number.isInteger(parsed) || parsed <= 0) {
    throw new Error(`${label} must be a positive integer.`);
  }
  return parsed;
};
const evidenceSource = (value) => {
  if (
    typeof value !== "string" ||
    !/^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/u.test(value)
  ) {
    throw new Error("--evidence-source must be a publish-safe label up to 128 characters.");
  }
  return value;
};

const hash = (value) => createHash("sha256").update(value).digest("hex");
const tagValue = (tags, prefix) =>
  tags.find((tag) => tag.startsWith(prefix))?.slice(prefix.length) || null;

export const normalizeManagedInventory = (checks) => {
  if (!Array.isArray(checks)) throw new Error("Forward check inventory must be an array.");
  const normalized = [];
  const seenIdentities = new Set();
  for (const check of checks) {
    const tags = Array.isArray(check.tags) ? check.tags.filter((tag) => typeof tag === "string") : [];
    const keys = tags.filter((tag) => tag.startsWith("dynatrace-key:"));
    if (!tags.includes("dynatrace") || keys.length !== 1) continue;
    if (!keys[0].slice("dynatrace-key:".length)) {
      throw new Error("Managed Forward check has an empty dynatrace-key tag.");
    }
    const identityHash = hash(keys[0]);
    if (seenIdentities.has(identityHash)) {
      throw new Error("Managed Forward check inventory contains a duplicate dynatrace-key tag.");
    }
    seenIdentities.add(identityHash);
    const status = String(check.status || "ERROR").toUpperCase();
    normalized.push({
      identityHash,
      status: VALID.has(status) ? status : "ERROR",
      owner: tagValue(tags, "owner:"),
      service: tagValue(tags, "service:") || tagValue(tags, "app:"),
    });
  }
  return normalized.sort((left, right) => left.identityHash.localeCompare(right.identityHash));
};

const transitionType = (before, after) => {
  if (!before) return null;
  if (!after) return "MISSING";
  if (after === "ERROR" && before !== "ERROR") return "ERROR";
  if (before === "PASS" && after === "FAIL") return "PASS_TO_FAIL";
  if ((before === "FAIL" || before === "ERROR") && after === "PASS") return "FAIL_TO_PASS";
  return null;
};

export const computeTransitions = (priorState, inventory, context) => {
  if (priorState && priorState.schemaVersion !== STATE_SCHEMA) {
    throw new Error(`State schemaVersion must be ${STATE_SCHEMA}.`);
  }
  if (priorState && priorState.networkId !== context.networkId) {
    throw new Error(
      `State networkId ${priorState.networkId || "<missing>"} does not match ${context.networkId}.`,
    );
  }
  const previous = priorState?.checks || {};
  const current = Object.fromEntries(
    inventory.map((item) => [item.identityHash, { status: item.status, owner: item.owner, service: item.service }]),
  );
  const identities = [...new Set([...Object.keys(previous), ...Object.keys(current)])].sort();
  const transitions = identities.flatMap((identityHash) => {
    const before = previous[identityHash]?.status || null;
    const after = current[identityHash]?.status || null;
    const type = transitionType(before, after);
    if (!type) return [];
    const metadata = current[identityHash] || previous[identityHash];
    return [{
      transitionId: hash(`${context.networkId}:${context.snapshotId}:${identityHash}:${before}:${after || "MISSING"}`),
      identityHash,
      type,
      before,
      after: after || "MISSING",
      owner: metadata.owner || null,
      service: metadata.service || null,
    }];
  });
  return {
    batch: {
      schemaVersion: BATCH_SCHEMA,
      generatedAt: context.generatedAt,
      eventType: EVENT_TYPE,
      networkId: context.networkId,
      snapshotId: context.snapshotId,
      provenance: context.provenance || {
        source: "live-forward-poll",
        synthetic: false,
      },
      counts: {
        tracked: inventory.length,
        transitions: transitions.length,
        passToFail: transitions.filter((item) => item.type === "PASS_TO_FAIL").length,
        failToPass: transitions.filter((item) => item.type === "FAIL_TO_PASS").length,
        error: transitions.filter((item) => item.type === "ERROR").length,
        missing: transitions.filter((item) => item.type === "MISSING").length,
      },
      transitions,
    },
    nextState: {
      schemaVersion: STATE_SCHEMA,
      updatedAt: context.generatedAt,
      networkId: context.networkId,
      snapshotId: context.snapshotId,
      checks: current,
    },
  };
};

export const assertTransitionBound = (
  batch,
  maxTransitions = MAX_TRANSITIONS_PER_POLL,
) => {
  if (
    !Number.isInteger(maxTransitions) ||
    maxTransitions <= 0 ||
    maxTransitions > MAX_TRANSITIONS_PER_POLL
  ) {
    throw new Error(`maxTransitions must be between 1 and ${MAX_TRANSITIONS_PER_POLL}.`);
  }
  if (batch.transitions.length > maxTransitions) {
    throw new Error(
      `Transition batch contains ${batch.transitions.length} events, exceeding the approved bound ${maxTransitions}. Review the artifact; state was not advanced.`,
    );
  }
  return batch;
};

export const acquirePollLock = async (statePath) => {
  const lockPath = `${statePath}.lock`;
  await mkdir(path.dirname(lockPath), { recursive: true });
  let handle;
  try {
    handle = await open(lockPath, "wx", 0o600);
  } catch (error) {
    if (error.code === "EEXIST") {
      throw new Error(`Check-health poller lock already exists: ${lockPath}`);
    }
    throw error;
  }
  await handle.writeFile(
    `${JSON.stringify({ pid: process.pid, acquiredAt: new Date().toISOString() })}\n`,
  );
  let released = false;
  return async () => {
    if (released) return;
    released = true;
    await handle.close();
    await unlink(lockPath).catch((error) => {
      if (error.code !== "ENOENT") throw error;
    });
  };
};

const forwardClient = ({ baseUrl, user, password, fetchImpl = globalThis.fetch }) => async (pathname) => {
  const response = await fetchImpl(`${baseUrl.replace(/\/$/, "")}${pathname}`, {
    headers: { Accept: "application/json", Authorization: `Basic ${Buffer.from(`${user}:${password}`).toString("base64")}` },
  });
  const text = await response.text();
  if (!response.ok) throw new Error(`Forward read failed with ${response.status}: ${text.slice(0, 300)}`);
  return JSON.parse(text);
};

export const pollForwardInventory = async ({ baseUrl, user, password, networkId, fetchImpl }) => {
  const get = forwardClient({ baseUrl, user, password, fetchImpl });
  const snapshot = await get(`/api/networks/${networkId}/snapshots/latestProcessed`);
  const checks = await get(`/api/snapshots/${snapshot.id}/checks?type=Existential`);
  return { checks, snapshotId: String(snapshot.id) };
};

export const buildTransitionEventRecords = (batch) => {
  assertTransitionBound(batch);
  return batch.transitions.map((transition) => ({
    "event.id": transition.transitionId,
    "event.provider": "forward-dynatrace",
    "event.type": EVENT_TYPE,
    "event.name": `Forward check ${transition.type}`,
    "event.category": "network-check-health",
    "event.status": transition.type === "FAIL_TO_PASS" ? "INFO" : "WARN",
    timestamp: batch.generatedAt,
    "forward.dynatrace.transition_id": transition.transitionId,
    "forward.dynatrace.evidence_source": batch.provenance.source,
    "forward.dynatrace.synthetic": batch.provenance.synthetic,
    "forward.dynatrace.check_identity_hash": transition.identityHash,
    "forward.dynatrace.transition": transition.type,
    "forward.dynatrace.previous_state": transition.before,
    "forward.dynatrace.current_state": transition.after,
    "forward.dynatrace.network_id": batch.networkId,
    "forward.dynatrace.snapshot_id": batch.snapshotId,
    ...(transition.owner ? { "forward.dynatrace.owner": transition.owner } : {}),
    ...(transition.service ? { "forward.dynatrace.service": transition.service } : {}),
  }));
};

export const publishTransitions = async ({
  batch,
  apiBaseUrl,
  token,
  fetchImpl = globalThis.fetch,
  maxAttempts = 3,
  sleepImpl = sleep,
}) => {
  if (batch.transitions.length === 0) return { published: 0, responseStatus: null };
  const records = buildTransitionEventRecords(batch);
  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    const response = await fetchImpl(`${apiBaseUrl}/platform/ingest/v1/events`, {
      method: "POST",
      headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
      body: JSON.stringify(records),
    });
    const text = await response.text();
    if (response.ok) return { published: records.length, responseStatus: response.status };
    if (TRANSIENT_STATUS_CODES.has(response.status) && attempt < maxAttempts) {
      const retryAfter = Number.parseInt(response.headers?.get?.("retry-after") || "", 10);
      await sleepImpl(
        Number.isInteger(retryAfter) ? retryAfter * 1000 : 250 * (2 ** (attempt - 1)),
      );
      continue;
    }
    throw new Error(
      `Dynatrace transition publish failed with ${response.status}: ${text.slice(0, 300)}`,
    );
  }
  throw new Error("Dynatrace transition publish exhausted its retry budget.");
};

export const run = async (argv = process.argv.slice(2)) => {
  const args = parseArgs(argv);
  if (args.help) return process.stdout.write(usage);
  const statePath = path.resolve(required(args.state, "option: --state"));
  const outputPath = path.resolve(required(args.output, "option: --output"));
  const releaseLock = await acquirePollLock(statePath);
  try {
    let checks;
    let snapshotId;
    const networkId = process.env.FORWARD_NETWORK_ID || "saved-inventory";
    if (args.inventory) {
      const input = JSON.parse(await readFile(args.inventory, "utf8"));
      checks = Array.isArray(input) ? input : input.checks;
      snapshotId = String(input.snapshotId || "saved-inventory");
    } else {
      ({ checks, snapshotId } = await pollForwardInventory({
        baseUrl: required(process.env.FORWARD_BASE_URL, "environment: FORWARD_BASE_URL"),
        user: required(process.env.FORWARD_USER, "environment: FORWARD_USER"),
        password: required(process.env.FORWARD_PASSWORD, "environment: FORWARD_PASSWORD"),
        networkId: required(process.env.FORWARD_NETWORK_ID, "environment: FORWARD_NETWORK_ID"),
      }));
    }
    const priorState = await readFile(statePath, "utf8").then(JSON.parse).catch((error) => {
      if (error.code === "ENOENT") return null;
      throw error;
    });
    const result = computeTransitions(priorState, normalizeManagedInventory(checks), {
      generatedAt: new Date().toISOString(),
      networkId,
      snapshotId,
      provenance: {
        source: evidenceSource(
          args["evidence-source"] || (args.inventory ? "saved-inventory" : "live-forward-poll"),
        ),
        synthetic: Boolean(args.synthetic),
      },
    });
    await mkdir(path.dirname(outputPath), { recursive: true });
    await writeFile(outputPath, `${JSON.stringify(result.batch, null, 2)}\n`);
    assertTransitionBound(
      result.batch,
      positiveInteger(
        args["max-transitions"],
        MAX_TRANSITIONS_PER_POLL,
        "--max-transitions",
      ),
    );
    let publication = { published: 0, responseStatus: null };
    if (args.apply) {
      const environmentUrl = args["environment-url"] || process.env.DYNATRACE_ENVIRONMENT_URL;
      const apiBaseUrl = args["api-base-url"] || process.env.DYNATRACE_API_BASE_URL || toOpenPipelineApiBaseUrl(required(environmentUrl, "Dynatrace environment URL"));
      const token = await readToken(args["token-file"]);
      publication = await publishTransitions({ batch: result.batch, apiBaseUrl, token });
    }
    await mkdir(path.dirname(statePath), { recursive: true });
    await writeFile(statePath, `${JSON.stringify(result.nextState, null, 2)}\n`, { mode: 0o600 });
    process.stdout.write(`${JSON.stringify({ ...result.batch.counts, publication }, null, 2)}\n`);
  } finally {
    await releaseLock();
  }
};

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  run().catch((error) => { process.stderr.write(`${error.message}\n`); process.exitCode = 1; });
}
