import assert from "node:assert/strict";
import { test } from "node:test";

import {
  FORWARD_ACCESS_PROFILES,
  assertForwardAccessProfile,
  canExecuteArbitraryNqe,
  canWriteIntentChecks,
} from "./forward-access-profile.mjs";

test("models Forward Read Only, Network Operator, and Network Admin without invented roles", () => {
  assert.deepEqual(FORWARD_ACCESS_PROFILES, [
    "read-only",
    "network-operator",
    "network-admin",
  ]);
  assert.equal(canExecuteArbitraryNqe("read-only"), false);
  assert.equal(canExecuteArbitraryNqe("network-operator"), true);
  assert.equal(canExecuteArbitraryNqe("network-admin"), true);
  assert.equal(canWriteIntentChecks("read-only"), false);
  assert.equal(canWriteIntentChecks("network-operator"), false);
  assert.equal(canWriteIntentChecks("network-admin"), true);
  assert.throws(() => assertForwardAccessProfile("create-only"), /must be read-only/);
});
