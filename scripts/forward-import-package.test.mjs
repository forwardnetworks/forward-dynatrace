import assert from "node:assert/strict";
import { createHash, generateKeyPairSync, sign } from "node:crypto";
import { test } from "node:test";

import {
  fingerprintCheck,
  planApprovedMutations,
  reconcileChecks,
  reconciliationKey,
  packageSigningPayload,
  toStatusArtifact,
  validateApprovalFile,
  validateConnectorConfig,
  validateManifest,
  validatePolicyArgs,
  validatePlannedChecks,
  verifyPackageSignature,
} from "./forward-import-package.mjs";

const baseCheck = {
  definition: {
    checkType: "Existential",
    filters: {
      from: {
        location: { type: "HostFilter", value: "checkout-vip" },
        headers: [
          { type: "PacketFilter", values: { ip_proto: ["6"] } },
          { type: "PacketFilter", values: { tp_dst: ["443"] } },
        ],
      },
      to: { location: { type: "HostFilter", value: "orders-db" } },
      flowTypes: ["VALID"],
    },
    headerFieldsWithDefaults: ["url"],
    noiseTypes: [],
    returnPath: "ANY",
  },
  enabled: true,
  name: "[Dynatrace] Checkout prod: checkout-vip -> orders-db tcp/443",
  note: "Generated from Dynatrace service checkout-api",
  priority: "HIGH",
  tags: [
    "dynatrace",
    "app:Checkout",
    "environment:prod",
    "owner:commerce-platform",
    "dynatrace-key:dt:checkout:prod:service-123:checkout-vip:orders-db:tcp:443",
  ],
};

const withResultFields = (check) => ({
  ...check,
  id: "check-1",
  createdAt: "2026-01-01T00:00:00Z",
  definedAt: "2026-01-01T00:00:00Z",
  executedAt: "2026-01-01T00:01:00Z",
  status: "PASS",
});

const baseManifest = (checks = [baseCheck]) => ({
  schemaVersion: "forward-dynatrace/v1",
  packageType: "forward-intent-import",
  packageId: "dynatrace-forward-test",
  generatedAt: new Date().toISOString(),
  requestedIngestPath: "manual-import",
  source: {
    platform: "dynatrace",
    app: "forward-dynatrace",
    writePolicy: "dynatrace-never-writes-forward",
  },
  artifacts: {
    manifest: "forward-dynatrace-manifest.json",
    intentChecks: "forward-intent-checks.json",
  },
  integrity: {
    algorithm: "sha256",
    intentChecksSha256: createHash("sha256")
      .update(JSON.stringify(checks, null, 2) + "\n", "utf8")
      .digest("hex"),
  },
  intentChecks: {
    count: checks.length,
    checkType: "Existential",
    payloadShape: "NewNetworkCheck[]",
    bulkEndpoint: "/api/snapshots/{snapshotId}/checks?bulk",
    dedupeRequiredBeforePost: true,
  },
  validation: {
    requiredTagPrefix: "dynatrace-key:",
    requiredTagsPerCheck: 1,
    credentialPolicy: "no-forward-credentials-in-dynatrace",
  },
  reconciliation: {
    defaultApplyPolicy: "create-missing-only",
    changedChecks: "report-only",
    staleChecks: "report-only",
  },
});

const baseNqeCheck = {
  definition: {
    checkType: "NQE",
    queryId: "FQ_aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
    params: {
      application: "Checkout",
      environment: "prod",
    },
  },
  enabled: true,
  name: "[Dynatrace] Checkout prod: NQE policy",
  note: "Generated from Dynatrace app metadata",
  priority: "MEDIUM",
  tags: [
    "dynatrace",
    "nqe",
    "app:checkout",
    "environment:prod",
    "dynatrace-key:dt:nqe:checkout:prod:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
  ],
};

const baseNqeDiffRequest = {
  name: "[Dynatrace] Checkout prod: NQE diff",
  queryId: "FQ_aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
  beforeSnapshotId: "snapshot-before",
  afterSnapshotId: "snapshot-after",
  parameters: {
    application: "Checkout",
    environment: "prod",
  },
  options: {
    itemFormat: "JSON",
    limit: 1000,
  },
  templateId: "app-environment-policy",
  dynatraceKey: "dynatrace-key:dt:nqe:checkout:prod:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa:diff",
  tags: [
    "dynatrace",
    "nqe-diff",
    "app:checkout",
    "environment:prod",
    "dynatrace-key:dt:nqe:checkout:prod:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa:diff",
  ],
};

const manifestWithNqeArtifacts = ({
  checks = [baseCheck],
  nqeChecks = [baseNqeCheck],
  nqeDiffRequests = [baseNqeDiffRequest],
  checksText = JSON.stringify([baseCheck], null, 2) + "\n",
  nqeChecksText = JSON.stringify([baseNqeCheck], null, 2) + "\n",
  nqeDiffRequestsText = JSON.stringify([baseNqeDiffRequest], null, 2) + "\n",
} = {}) => ({
  ...baseManifest(checks),
  artifacts: {
    manifest: "forward-dynatrace-manifest.json",
    intentChecks: "forward-intent-checks.json",
    nqeChecks: "forward-nqe-checks.json",
    nqeDiffRequests: "forward-nqe-diff-requests.json",
  },
  integrity: {
    algorithm: "sha256",
    intentChecksSha256: createHash("sha256").update(checksText, "utf8").digest("hex"),
    nqeChecksSha256: createHash("sha256").update(nqeChecksText, "utf8").digest("hex"),
    nqeDiffRequestsSha256: createHash("sha256")
      .update(nqeDiffRequestsText, "utf8")
      .digest("hex"),
  },
  nqeChecks: {
    count: nqeChecks.length,
    checkType: "NQE",
    payloadShape: "NewNetworkCheck[]",
    bulkEndpoint: "/api/snapshots/{snapshotId}/checks?bulk",
    dedupeRequiredBeforePost: true,
    dedupe: "name-or-dynatrace-key-tag",
    queryIdPolicy: "forward-owned-allowlist",
    parameterSource: "dynatrace-app-environment",
  },
  nqeDiffRequests: {
    count: nqeDiffRequests.length,
    payloadShape: "ForwardDynatraceNqeDiffRequest[]",
    endpoint: "/api/nqe-diffs/{before}/{after}",
    queryIdPolicy: "forward-owned-allowlist",
    executionPolicy: "read-only-forward-side-optional",
    parameterSource: "dynatrace-app-environment",
  },
});

test("uses the dynatrace-key tag as the reconciliation key", () => {
  assert.equal(
    reconciliationKey(baseCheck),
    "dynatrace-key:dt:checkout:prod:service-123:checkout-vip:orders-db:tcp:443",
  );
});

test("ignores Forward result-only fields when comparing fingerprints", () => {
  assert.equal(fingerprintCheck(baseCheck), fingerprintCheck(withResultFields(baseCheck)));
});

test("allows historical snapshot dry-run but forbids historical apply", () => {
  assert.doesNotThrow(() => validatePolicyArgs({ "snapshot-id": "snapshot-before" }));
  assert.throws(
    () => validatePolicyArgs({ "snapshot-id": "snapshot-before", apply: true }),
    /dry-run only/,
  );
});

test("treats Forward-normalized host subnets as unchanged", () => {
  const planned = structuredClone(baseCheck);
  planned.definition.filters.from.location = {
    type: "SubnetLocationFilter",
    value: "10.55.101.11/32",
  };
  planned.definition.filters.to.location = {
    type: "SubnetLocationFilter",
    value: "2001:db8::42/128",
  };
  const existing = withResultFields(structuredClone(planned));
  existing.definition.filters.from.location.value = "10.55.101.11";
  existing.definition.filters.to.location.value = "2001:db8::42";

  const plan = reconcileChecks([planned], [existing]);
  assert.equal(plan.unchanged.length, 1);
  assert.equal(plan.changed.length, 0);
});

test("classifies matching generated checks as unchanged", () => {
  const result = reconcileChecks([baseCheck], [withResultFields(baseCheck)]);

  assert.equal(result.create.length, 0);
  assert.equal(result.unchanged.length, 1);
  assert.equal(result.changed.length, 0);
  assert.equal(result.stale.length, 0);
});

test("classifies missing planned checks as create", () => {
  const result = reconcileChecks([baseCheck], []);

  assert.equal(result.create.length, 1);
  assert.equal(result.unchanged.length, 0);
  assert.equal(result.changed.length, 0);
  assert.equal(result.stale.length, 0);
});

test("classifies same-key definition drift as changed", () => {
  const existing = structuredClone(baseCheck);
  existing.definition.filters.from.headers[1].values.tp_dst = ["8443"];
  existing.id = "check-1";

  const result = reconcileChecks([baseCheck], [existing]);

  assert.equal(result.create.length, 0);
  assert.equal(result.changed.length, 1);
  assert.deepEqual(result.changed[0].fields, ["definition"]);
});

test("classifies managed checks missing from the package as stale", () => {
  const result = reconcileChecks([], [withResultFields(baseCheck), { name: "user-owned" }]);

  assert.equal(result.stale.length, 1);
  assert.equal(result.stale[0].id, "check-1");
});

test("accepts valid exact-key approval for changed and stale mutations", () => {
  const approval = validateApprovalFile(
    {
      schemaVersion: "forward-dynatrace-approval/v1",
      packageId: "dynatrace-forward-test",
      changeWindowId: "CHG-123",
      expiresAt: "2026-01-02T00:00:00.000Z",
      approvedBy: "forward-operator@example.com",
      reason: "approved dependency refresh",
      approvedChangedKeys: [
        "dynatrace-key:dt:checkout:prod:service-123:checkout-vip:orders-db:tcp:443",
      ],
      approvedStaleKeys: ["dynatrace-key:dt:stale:demo"],
    },
    {
      packageId: "dynatrace-forward-test",
      changeWindowId: "CHG-123",
      now: new Date("2026-01-01T00:00:00.000Z"),
    },
  );

  assert.equal(approval.approvedChangedKeys.length, 1);
  assert.equal(approval.approvedStaleKeys.length, 1);
});

test("rejects stale or mismatched approval files", () => {
  const validApproval = {
    schemaVersion: "forward-dynatrace-approval/v1",
    packageId: "dynatrace-forward-test",
    changeWindowId: "CHG-123",
    expiresAt: "2026-01-02T00:00:00.000Z",
    approvedChangedKeys: [
      "dynatrace-key:dt:checkout:prod:service-123:checkout-vip:orders-db:tcp:443",
    ],
    approvedStaleKeys: [],
  };

  assert.throws(
    () =>
      validateApprovalFile(
        { ...validApproval, packageId: "wrong-package" },
        {
          packageId: "dynatrace-forward-test",
          changeWindowId: "CHG-123",
          now: new Date("2026-01-01T00:00:00.000Z"),
        },
      ),
    /packageId must match manifest packageId/,
  );
  assert.throws(
    () =>
      validateApprovalFile(validApproval, {
        packageId: "dynatrace-forward-test",
        changeWindowId: "CHG-999",
        now: new Date("2026-01-01T00:00:00.000Z"),
      }),
    /changeWindowId must match CHG-999/,
  );
  assert.throws(
    () =>
      validateApprovalFile(
        { ...validApproval, expiresAt: "2025-12-31T23:59:59.000Z" },
        {
          packageId: "dynatrace-forward-test",
          changeWindowId: "CHG-123",
          now: new Date("2026-01-01T00:00:00.000Z"),
        },
      ),
    /expiresAt must be in the future/,
  );
});

test("plans only approved update and stale deactivation mutations", () => {
  const existingChanged = structuredClone(baseCheck);
  existingChanged.id = "check-1";
  existingChanged.definition.filters.from.headers[1].values.tp_dst = ["8443"];
  const staleExisting = withResultFields(
    {
      ...structuredClone(baseCheck),
      name: "[Dynatrace] Stale demo check",
      tags: ["dynatrace", "dynatrace-key:dt:stale:demo"],
    },
    98,
  );
  const reconciliation = reconcileChecks([baseCheck], [existingChanged, staleExisting]);
  const approval = validateApprovalFile(
    {
      schemaVersion: "forward-dynatrace-approval/v1",
      packageId: "dynatrace-forward-test",
      expiresAt: "2026-01-02T00:00:00.000Z",
      approvedChangedKeys: [reconciliation.changed[0].key],
      approvedStaleKeys: [reconciliation.stale[0].key],
    },
    {
      packageId: "dynatrace-forward-test",
      now: new Date("2026-01-01T00:00:00.000Z"),
    },
  );

  const mutations = planApprovedMutations(reconciliation, approval, {
    applyUpdates: true,
    deactivateStale: true,
    maxUpdates: 1,
    maxDeactivations: 1,
  });

  assert.equal(mutations.update.length, 1);
  assert.equal(mutations.deactivate.length, 1);
  assert.throws(
    () =>
      planApprovedMutations(reconciliation, approval, {
        applyUpdates: true,
        deactivateStale: true,
        maxUpdates: 0,
        maxDeactivations: 1,
      }),
    /exceeds --max-updates 0/,
  );
  assert.throws(
    () =>
      planApprovedMutations(
        reconciliation,
        { ...approval, approvedChangedKeys: ["dynatrace-key:dt:not-current"] },
        {
          applyUpdates: true,
          maxUpdates: 1,
        },
      ),
    /not present in current reconciliation/,
  );
});

test("accepts a valid generated intent package", () => {
  assert.doesNotThrow(() => validatePlannedChecks([baseCheck]));
});

test("accepts a valid package manifest for the planned checks", () => {
  assert.doesNotThrow(() =>
    validateManifest(baseManifest(), [baseCheck], {
      checksText: JSON.stringify([baseCheck], null, 2) + "\n",
    }),
  );
});

test("rejects a manifest count that does not match the planned package", () => {
  const manifest = baseManifest();
  manifest.intentChecks.count = 2;

  assert.throws(
    () => validateManifest(manifest, [baseCheck]),
    /does not match package count 1/,
  );
});

test("rejects a manifest checksum that does not match the planned package", () => {
  const manifest = baseManifest();
  manifest.integrity.intentChecksSha256 = "0".repeat(64);

  assert.throws(
    () =>
      validateManifest(manifest, [baseCheck], {
        checksText: JSON.stringify([baseCheck], null, 2) + "\n",
      }),
    /intentChecksSha256 does not match/,
  );
});

test("accepts optional NQE check and diff artifacts in manifest validation", () => {
  const checksText = JSON.stringify([baseCheck], null, 2) + "\n";
  const nqeChecksText = JSON.stringify([baseNqeCheck], null, 2) + "\n";
  const nqeDiffRequestsText = JSON.stringify([baseNqeDiffRequest], null, 2) + "\n";

  assert.doesNotThrow(() =>
    validateManifest(manifestWithNqeArtifacts(), [baseCheck], {
      checksText,
      nqeChecks: [baseNqeCheck],
      nqeChecksText,
      nqeDiffRequests: [baseNqeDiffRequest],
      nqeDiffRequestsText,
    }),
  );
});

test("rejects optional NQE artifact checksum drift", () => {
  const checksText = JSON.stringify([baseCheck], null, 2) + "\n";
  const nqeChecksText = JSON.stringify([baseNqeCheck], null, 2) + "\n";
  const nqeDiffRequestsText = JSON.stringify([baseNqeDiffRequest], null, 2) + "\n";
  const manifest = manifestWithNqeArtifacts();
  manifest.integrity.nqeChecksSha256 = "0".repeat(64);

  assert.throws(
    () =>
      validateManifest(manifest, [baseCheck], {
        checksText,
        nqeChecks: [baseNqeCheck],
        nqeChecksText,
        nqeDiffRequests: [baseNqeDiffRequest],
        nqeDiffRequestsText,
      }),
    /nqeChecksSha256 does not match/,
  );
});

test("rejects connector config secrets", () => {
  assert.throws(
    () =>
      validateConnectorConfig({
        schemaVersion: "forward-dynatrace-connector/v1",
        packageUrl: "https://package.example.com/dynatrace-forward/latest/",
        forwardPassword: "do-not-store",
      }),
    /forwardPassword must not be stored/,
  );
});

test("status artifact omits check-level topology details", () => {
  const status = toStatusArtifact({
    mode: "apply",
    runId: "forward-dynatrace-20260101000000",
    finishedAt: "2026-01-01T00:00:02.000Z",
    durationMs: 2000,
    packageId: "dynatrace-forward-test",
    packageIntegrity: { algorithm: "sha256", intentChecksSha256: "a".repeat(64) },
    packageSignature: { status: "verified" },
    applyPolicy: "create-missing-only",
    networkId: "network-1",
    snapshotId: "snapshot-1",
    plannedChecks: 3,
    counts: {
      create: 1,
      unchanged: 2,
      changed: 0,
      stale: 0,
    },
    create: [{ name: "checkout-vip -> orders-db" }],
  });

  assert.equal(status.schemaVersion, "forward-dynatrace-status/v1");
  assert.equal(status.importState, "applied");
  assert.equal(status.counts.create, 1);
  assert.equal(JSON.stringify(status).includes("checkout-vip"), false);
  assert.equal(JSON.stringify(status).includes("orders-db"), false);
});

test("status artifact marks changed or stale drift for review", () => {
  assert.equal(
    toStatusArtifact({
      mode: "dry-run",
      runId: "forward-dynatrace-20260101000000",
      finishedAt: "2026-01-01T00:00:02.000Z",
      durationMs: 2000,
      plannedChecks: 3,
      counts: {
        create: 0,
        unchanged: 1,
        changed: 1,
        stale: 1,
      },
    }).importState,
    "needs-review",
  );
});

test("verifies a detached package signature", () => {
  const { privateKey, publicKey } = generateKeyPairSync("ed25519");
  const checksText = JSON.stringify([baseCheck], null, 2) + "\n";
  const manifestText = JSON.stringify(baseManifest(), null, 2) + "\n";
  const signatureText = sign(
    null,
    Buffer.from(packageSigningPayload({ checksText, manifestText }), "utf8"),
    privateKey,
  ).toString("base64");

  assert.doesNotThrow(() =>
    verifyPackageSignature({
      checksText,
      manifestText,
      publicKeyText: publicKey.export({ format: "pem", type: "spki" }),
      signatureText,
    }),
  );
});

test("rejects a detached package signature for changed package bytes", () => {
  const { privateKey, publicKey } = generateKeyPairSync("ed25519");
  const checksText = JSON.stringify([baseCheck], null, 2) + "\n";
  const manifestText = JSON.stringify(baseManifest(), null, 2) + "\n";
  const signatureText = sign(
    null,
    Buffer.from(packageSigningPayload({ checksText, manifestText }), "utf8"),
    privateKey,
  ).toString("base64");

  assert.throws(
    () =>
      verifyPackageSignature({
        checksText: checksText.replace("orders-db", "tampered-db"),
        manifestText,
        publicKeyText: publicKey.export({ format: "pem", type: "spki" }),
        signatureText,
      }),
    /signature verification failed/,
  );
});

test("verifies detached signatures over optional NQE artifacts", () => {
  const { privateKey, publicKey } = generateKeyPairSync("ed25519");
  const checksText = JSON.stringify([baseCheck], null, 2) + "\n";
  const manifestText = JSON.stringify(manifestWithNqeArtifacts(), null, 2) + "\n";
  const extraArtifacts = {
    "nqe-checks": JSON.stringify([baseNqeCheck], null, 2) + "\n",
    "nqe-diff-requests": JSON.stringify([baseNqeDiffRequest], null, 2) + "\n",
  };
  const signatureText = sign(
    null,
    Buffer.from(
      packageSigningPayload({ checksText, manifestText, extraArtifacts }),
      "utf8",
    ),
    privateKey,
  ).toString("base64");

  assert.doesNotThrow(() =>
    verifyPackageSignature({
      checksText,
      manifestText,
      publicKeyText: publicKey.export({ format: "pem", type: "spki" }),
      signatureText,
      extraArtifacts,
    }),
  );
  assert.throws(
    () =>
      verifyPackageSignature({
        checksText,
        manifestText,
        publicKeyText: publicKey.export({ format: "pem", type: "spki" }),
        signatureText,
        extraArtifacts: {
          ...extraArtifacts,
          "nqe-checks": extraArtifacts["nqe-checks"].replace("Checkout", "Tampered"),
        },
      }),
    /signature verification failed/,
  );
});

test("rejects stale manifests before contacting Forward", () => {
  const manifest = baseManifest();
  manifest.generatedAt = "2026-01-01T00:00:00.000Z";

  assert.throws(
    () => validateManifest(manifest, [baseCheck], { maxPackageAgeMinutes: 1 }),
    /older than 1 minutes/,
  );
});

test("rejects package entries without exactly one dynatrace reconciliation key", () => {
  const missingKey = { ...baseCheck, tags: ["dynatrace"] };
  const duplicateKey = {
    ...baseCheck,
    tags: [...baseCheck.tags, "dynatrace-key:duplicate"],
  };

  assert.throws(
    () => validatePlannedChecks([missingKey, duplicateKey]),
    /tags must contain exactly one dynatrace-key:\* tag/,
  );
});

test("rejects malformed or whitespace-containing tags before Forward apply", () => {
  const whitespaceTag = structuredClone(baseCheck);
  whitespaceTag.tags = [
    "dynatrace",
    "app:Forward Integration for Dynatrace Acceptance",
    "dynatrace-key:dt:acceptance",
  ];
  const nonArrayTags = structuredClone(baseCheck);
  nonArrayTags.tags = "dynatrace";

  assert.throws(
    () => validatePlannedChecks([whitespaceTag]),
    /tags\[1\] must not contain whitespace/,
  );
  assert.throws(
    () => validatePlannedChecks([nonArrayTags]),
    /tags must be an array/,
  );
});

test("rejects duplicate generated check names and dynatrace keys", () => {
  const duplicate = structuredClone(baseCheck);

  assert.throws(
    () => validatePlannedChecks([baseCheck, duplicate]),
    /duplicates check\[0\]/,
  );
});

test("rejects unsupported Forward check types", () => {
  const unsupported = structuredClone(baseCheck);
  unsupported.definition.checkType = "Path";

  assert.throws(
    () => validatePlannedChecks([unsupported]),
    /definition\.checkType must be one of Existential/,
  );
});
