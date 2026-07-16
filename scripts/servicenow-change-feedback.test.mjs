import assert from "node:assert/strict";
import { createServer } from "node:http";
import { test } from "node:test";

import {
  buildFeedbackReceipt,
  buildServiceNowFeedbackPlan,
  parseArgs,
  publishServiceNowFeedback,
  run as runFeedback,
  sha256,
  validatePreflightGateAlignment,
  verifyServiceNowFeedbackRetry,
} from "./servicenow-change-feedback.mjs";

const preflight = {
  schemaVersion: "forward-dynatrace-servicenow-change-preflight/v1",
  observedAt: "2026-07-15T18:30:00.000Z",
  mode: "read-only",
  source: { instanceAlias: "test-itsm", table: "change_request", authoritativeRead: true },
  change: {
    number: "CHG0042187",
    sysId: "0123456789abcdef0123456789abcdef",
    deploymentId: "checkout-api-2026.07.15.3",
    approval: { value: "approved", display: "Approved" },
    state: { value: "-2", display: "Scheduled" },
    risk: { value: "3", display: "Moderate" },
    assignmentGroup: { value: "89abcdef0123456789abcdef01234567", display: "Commerce" },
    window: { startsAt: "2026-07-15T18:00:00.000Z", endsAt: "2026-07-15T20:00:00.000Z" },
  },
  scope: {
    forwardNetworkId: "network-production",
    serviceEntityIds: ["SERVICE-CHECKOUT-API", "SERVICE-PAYMENTS-API"],
  },
  authorization: {
    status: "eligible",
    reasons: [],
    eligibleStateValues: ["-1", "-2"],
    approvedValues: ["approved"],
  },
  nextStages: ["combined-change-gate", "servicenow-evidence-feedback"],
};

const counts = { total: 2, queryable: 2, reachable: 2, blocked: 0, ambiguous: 0, unmapped: 0, failed: 0 };
const gate = {
  schemaVersion: "forward-dynatrace-change-validation/v1",
  generatedAt: "2026-07-15T19:00:00.000Z",
  change: {
    changeId: "CHG0042187",
    deploymentId: "checkout-api-2026.07.15.3",
    serviceEntityIds: ["SERVICE-PAYMENTS-API", "SERVICE-CHECKOUT-API"],
  },
  decision: "pass",
  reasons: [{ severity: "info", code: "ALL_VALIDATIONS_PASSED", message: "All evidence passed." }],
  dynatrace: { deploymentState: "SUCCEEDED", serviceHealth: "HEALTHY", openProblemCount: 0 },
  forward: {
    networkId: "network-production",
    before: { snapshotId: "snapshot-before", status: "completed", assessment: "no-modeled-policy-block", counts },
    after: { snapshotId: "snapshot-after", status: "completed", assessment: "no-modeled-policy-block", counts },
    delta: { reachable: 0, blocked: 0, ambiguous: 0, unmapped: 0, failed: 0 },
    reconciliation: {
      runId: "reconcile-1",
      packageId: "package-1",
      importState: "reconciled",
      target: { networkId: "network-production", snapshotId: "snapshot-after" },
      plannedChecks: 2,
      counts: { create: 0, unchanged: 2, changed: 0, stale: 0 },
      unresolvedCounts: { changed: 0, stale: 0 },
    },
  },
  evidence: {
    contextSha256: "a".repeat(64),
    beforePathEvidenceSha256: "b".repeat(64),
    afterPathEvidenceSha256: "c".repeat(64),
    reconciliationStatusSha256: "d".repeat(64),
  },
};

test("parses explicit live retry verification", () => {
  assert.deepEqual(
    parseArgs(["--preflight", "preflight.json", "--gate", "gate.json", "--apply", "--verify-retry"]),
    { preflight: "preflight.json", gate: "gate.json", apply: true, "verify-retry": true },
  );
});

test("requires apply mode for live retry verification", async () => {
  await assert.rejects(runFeedback(["--verify-retry"]), /requires --apply/);
});

test("builds bounded deterministic ServiceNow feedback from aligned evidence", () => {
  const first = buildServiceNowFeedbackPlan({ preflight, gate });
  const second = buildServiceNowFeedbackPlan({ preflight, gate });
  assert.equal(first.evidenceSha256, second.evidenceSha256);
  assert.equal(first.attachmentFileName, second.attachmentFileName);
  assert.ok(first.attachmentFileName.length <= 100, "attachment name fits ServiceNow sys_attachment.file_name");
  assert.match(first.workNote, /PASS/);
  assert.match(first.workNote, /snapshot-before -> snapshot-after/);
  assert.match(first.workNote, new RegExp(first.evidenceSha256));
  assert.equal(first.workNote.includes("sourceResolvedValue"), false);
  const receipt = buildFeedbackReceipt({
    plan: first,
    mode: "dry-run",
    publication: {
      workNote: { status: "planned", sysId: null },
      attachment: { status: "planned", sysId: null },
    },
  });
  assert.equal(receipt.evidence.sha256, first.evidenceSha256);
  assert.equal(receipt.publication.workNote.status, "planned");
});

test("fails closed when ServiceNow approval or correlated scope does not align", () => {
  assert.throws(
    () => validatePreflightGateAlignment({ ...preflight, authorization: { ...preflight.authorization, status: "blocked" } }, gate),
    /must be eligible/,
  );
  assert.throws(
    () => validatePreflightGateAlignment(preflight, { ...gate, change: { ...gate.change, deploymentId: "other" } }),
    /deployment ID must match/,
  );
  assert.throws(
    () => validatePreflightGateAlignment(preflight, { ...gate, forward: { ...gate.forward, networkId: "other" } }),
    /network ID must match/,
  );
});

const readBody = async (request) => {
  const chunks = [];
  for await (const chunk of request) chunks.push(chunk);
  return Buffer.concat(chunks).toString("utf8");
};

const reverseObjectKeys = (value) => {
  if (Array.isArray(value)) return value.map(reverseObjectKeys);
  if (!value || typeof value !== "object") return value;
  return Object.fromEntries(
    Object.keys(value).reverse().map((key) => [key, reverseObjectKeys(value[key])]),
  );
};

const sortObjectKeys = (value) => {
  if (Array.isArray(value)) return value.map(sortObjectKeys);
  if (!value || typeof value !== "object") return value;
  return Object.fromEntries(
    Object.keys(value).sort().map((key) => [key, sortObjectKeys(value[key])]),
  );
};

test("canonicalizes embedded lineage independently of object insertion order", () => {
  const ordered = buildServiceNowFeedbackPlan({ preflight, gate });
  const reordered = buildServiceNowFeedbackPlan({
    preflight: reverseObjectKeys(preflight),
    gate: reverseObjectKeys(gate),
  });
  assert.equal(ordered.evidence.lineage.preflightSha256, reordered.evidence.lineage.preflightSha256);
  assert.equal(ordered.evidence.lineage.gateSha256, reordered.evidence.lineage.gateSha256);
  assert.equal(
    ordered.evidence.lineage.preflightSha256,
    sha256(JSON.stringify(sortObjectKeys(ordered.evidence.preflight))),
    "lineage uses a compact representation instead of runtime-specific pretty printing",
  );
});

test("publishes through the ServiceNow assurance ingress and preserves exact evidence bytes", async (t) => {
  const state = { posts: 0, authorization: [], bodies: [], paths: [] };
  const server = createServer(async (request, response) => {
    const url = new URL(request.url, "http://localhost");
    state.paths.push(url.pathname);
    state.authorization.push(request.headers.authorization);
    response.setHeader("Content-Type", "application/json");
    if (request.method === "POST" && url.pathname.endsWith(`/changes/${preflight.change.sysId}/evidence`)) {
      const body = await readBody(request);
      assert.equal(JSON.parse(body).schemaVersion, "forward-dynatrace-servicenow-change-assurance-evidence/v1");
      state.bodies.push(body);
      state.posts += 1;
      const plan = buildServiceNowFeedbackPlan({ preflight, gate });
      const status = state.posts === 1 ? "created" : "existing";
      response.end(JSON.stringify({
        result: {
          status: "ok",
          assurance: {
          idempotencyKey: plan.idempotencyKey,
          decision: "pass",
          publicationStatus: "published",
          publication: {
            workNote: { status, sysId: "journal-1" },
            attachment: { status, sysId: "attachment-1" },
          },
          },
        },
      }));
      return;
    }
    response.statusCode = 404;
    response.end(JSON.stringify({ error: "unexpected request" }));
  });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  t.after(() => server.close());
  const baseUrl = `http://127.0.0.1:${server.address().port}`;

  const first = await publishServiceNowFeedback({
    preflight,
    gate,
    baseUrl,
    user: "writer",
    password: "runtime-only",
  });
  const second = await publishServiceNowFeedback({
    preflight,
    gate,
    baseUrl,
    user: "writer",
    password: "runtime-only",
  });

  await publishServiceNowFeedback({
    preflight,
    gate,
    baseUrl,
    user: "writer",
    password: "runtime-only",
    assuranceBaseUri: "/api/customer_namespace/forward_change_assurance/",
  });

  assert.deepEqual(first.publication, {
    workNote: { status: "created", sysId: "journal-1" },
    attachment: { status: "created", sysId: "attachment-1" },
  });
  assert.deepEqual(second.publication, {
    workNote: { status: "existing", sysId: "journal-1" },
    attachment: { status: "existing", sysId: "attachment-1" },
  });
  assert.equal(state.posts, 3);
  assert.equal(state.bodies[0], first.plan.attachmentText);
  assert.equal(state.bodies[1], second.plan.attachmentText);
  assert.equal(
    state.paths[2],
    `/api/customer_namespace/forward_change_assurance/changes/${preflight.change.sysId}/evidence`,
  );
  assert.equal(state.authorization.every((value) => value?.startsWith("Basic ")), true);
  assert.equal(JSON.stringify(first).includes("runtime-only"), false);
  assert.deepEqual(verifyServiceNowFeedbackRetry({ initial: first, retry: second }), {
    status: "verified",
    attempts: 2,
    idempotencyKey: first.plan.idempotencyKey,
    publication: second.publication,
  });
  assert.throws(
    () => verifyServiceNowFeedbackRetry({
      initial: first,
      retry: {
        ...second,
        publication: {
          ...second.publication,
          attachment: { status: "created", sysId: "attachment-1" },
        },
      },
    }),
    /attachment must report existing/,
  );
  assert.throws(
    () => verifyServiceNowFeedbackRetry({
      initial: first,
      retry: {
        ...second,
        publication: {
          ...second.publication,
          workNote: { status: "existing", sysId: "journal-2" },
        },
      },
    }),
    /workNote sys_id does not match/,
  );
});

test("fails closed when the ServiceNow assurance receipt does not match the evidence", async () => {
  const fetchImpl = async (input, options = {}) => {
    const url = new URL(input);
    if (options.method === "POST" && url.pathname.endsWith("/evidence")) {
      return new Response(JSON.stringify({
        status: "ok",
        assurance: {
          idempotencyKey: `forward-dynatrace:${"0".repeat(64)}`,
          decision: "pass",
          publicationStatus: "published",
          publication: {
            workNote: { status: "created", sysId: "journal-1" },
            attachment: { status: "created", sysId: "attachment-1" },
          },
        },
      }), { status: 200 });
    }
    return new Response("unexpected", { status: 404 });
  };
  const options = {
    preflight,
    gate,
    baseUrl: "http://127.0.0.1:9999",
    user: "writer",
    password: "runtime-only",
    fetchImpl,
  };
  await assert.rejects(publishServiceNowFeedback(options), /idempotency key does not match/);
});
