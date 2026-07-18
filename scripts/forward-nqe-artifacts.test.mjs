import assert from "node:assert/strict";
import { test } from "node:test";

import {
  buildNqeChecksFromDependencies,
  buildNqeDiffRequestsFromDependencies,
  parseQueryIdAllowlist,
  validateNqeChecks,
  validateNqeDiffRequests,
} from "./forward-nqe-artifacts.mjs";

const queryId = "FQ_aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa";
const sourceInstanceId = "dt-test-environment";
const dependencies = [
  {
    id: "dep-1",
    appName: "Checkout",
    environment: "prod",
    serviceEntityId: "service-1",
    owner: "commerce-platform",
    criticality: "critical",
    mappingState: "ready",
  },
  {
    id: "dep-2",
    appName: "Checkout",
    environment: "prod",
    serviceEntityId: "service-2",
    owner: "commerce-platform",
    criticality: "high",
    mappingState: "review",
  },
  {
    id: "dep-3",
    appName: "Inventory",
    environment: "dev",
    serviceEntityId: "service-3",
    owner: "supply-chain",
    criticality: "medium",
    mappingState: "needs-map",
  },
];

test("builds one NQE check per app/environment from exportable dependencies", () => {
  const checks = buildNqeChecksFromDependencies(dependencies, { queryId, sourceInstanceId });

  assert.equal(checks.length, 1);
  assert.equal(checks[0].definition.checkType, "NQE");
  assert.equal(checks[0].definition.queryId, queryId);
  assert.deepEqual(checks[0].definition.params, {
    application: "Checkout",
    environment: "prod",
  });
  assert.equal(checks[0].priority, "HIGH");
  assert.equal(
    checks[0].tags.filter((tag) => tag.startsWith("source-key:sha256:")).length,
    1,
  );
});

test("validates NQE checks with an approved query ID allowlist", () => {
  const checks = buildNqeChecksFromDependencies(dependencies, { queryId, sourceInstanceId });

  assert.doesNotThrow(() =>
    validateNqeChecks(checks, {
      allowedQueryIds: parseQueryIdAllowlist(queryId),
    }),
  );
  assert.throws(
    () =>
      validateNqeChecks(checks, {
        allowedQueryIds: parseQueryIdAllowlist("FQ_bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb"),
      }),
    /not in the approved allowlist/,
  );
});

test("rejects malformed NQE checks", () => {
  const checks = buildNqeChecksFromDependencies(dependencies, { queryId, sourceInstanceId });
  checks[0].definition.queryId = "not-a-query-id";
  checks[0].tags.push(`source-key:sha256:${"f".repeat(64)}`);

  assert.throws(
    () =>
      validateNqeChecks(checks, {
        allowedQueryIds: parseQueryIdAllowlist(queryId),
      }),
    /Invalid Forward NQE check package/,
  );
});

test("builds and validates NQE diff requests", () => {
  const requests = buildNqeDiffRequestsFromDependencies(dependencies, {
    queryId,
    sourceInstanceId,
    beforeSnapshotId: "snapshot-before",
    afterSnapshotId: "snapshot-after",
  });

  assert.equal(requests.length, 1);
  assert.equal(requests[0].queryId, queryId);
  assert.equal(requests[0].beforeSnapshotId, "snapshot-before");
  assert.equal(requests[0].afterSnapshotId, "snapshot-after");
  assert.deepEqual(requests[0].parameters, {
    application: "Checkout",
    environment: "prod",
  });
  assert.doesNotThrow(() =>
    validateNqeDiffRequests(requests, {
      allowedQueryIds: parseQueryIdAllowlist(queryId),
    }),
  );
});

test("rejects NQE diff requests without approved query IDs", () => {
  const requests = buildNqeDiffRequestsFromDependencies(dependencies, {
    queryId,
    sourceInstanceId,
    beforeSnapshotId: "snapshot-before",
    afterSnapshotId: "snapshot-after",
  });

  assert.throws(
    () =>
      validateNqeDiffRequests(requests, {
        allowedQueryIds: parseQueryIdAllowlist("FQ_bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb"),
      }),
    /not in the approved allowlist/,
  );
});
