import assert from "node:assert/strict";
import { test } from "node:test";

import {
  validateLiveSmokeApproval,
  validateNqeAccessProfile,
} from "./forward-nqe-live-smoke.mjs";

const request = {
  forwardBaseUrl: "https://forward.example.com",
  forwardNetworkId: "network-1",
  forwardAccessProfile: "read-only",
  templateId: "endpoint-inventory-smoke",
};

const validApproval = {
  schemaVersion: "forward-dynatrace-nqe-preview-approval/v1",
  approvedBy: "change-123",
  expiresAt: "2999-01-01T00:00:00.000Z",
  credentialModel: "dedicated-read-only-nqe-principal",
  forwardBaseUrl: "https://forward.example.com/",
  forwardNetworkId: "network-1",
  allowedOperations: ["POST /api/nqe"],
  allowedTemplates: ["endpoint-inventory-smoke"],
  allowedQueryIds: [],
  requiredForwardPermissions: ["NetworkOperation.USE_NQE"],
  forbiddenForwardPermissions: ["NetworkOperation.EDIT_CHECKS"],
};

test("accepts approval for read-only NQE live smoke", () => {
  const result = validateLiveSmokeApproval(validApproval, request);
  assert.equal(result.status, "verified");
  assert.equal(result.credentialModel, "dedicated-read-only-nqe-principal");
});

test("enforces Library query IDs for Read Only and arbitrary NQE for operator/admin", () => {
  assert.equal(validateNqeAccessProfile("read-only", "FQ_approved"), "read-only");
  assert.throws(
    () => validateNqeAccessProfile("read-only"),
    /requires --query-id/,
  );
  assert.equal(
    validateNqeAccessProfile("network-operator"),
    "network-operator",
  );
  assert.equal(validateNqeAccessProfile("network-admin"), "network-admin");
});

test("rejects expired approval", () => {
  assert.throws(
    () =>
      validateLiveSmokeApproval(
        {
          ...validApproval,
          expiresAt: "2000-01-01T00:00:00.000Z",
        },
        request,
      ),
    /future ISO timestamp/,
  );
});

test("rejects approval without NQE permission and check-write denial", () => {
  assert.throws(
    () =>
      validateLiveSmokeApproval(
        {
          ...validApproval,
          forbiddenForwardPermissions: [],
        },
        request,
      ),
    /NetworkOperation\.EDIT_CHECKS/,
  );
});

test("rejects credential-like approval content", () => {
  assert.throws(
    () =>
      validateLiveSmokeApproval(
        {
          ...validApproval,
          notes: "Authorization: Bearer secret",
        },
        request,
      ),
    /credential-like content/,
  );
});
