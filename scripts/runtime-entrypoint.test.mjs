import assert from "node:assert/strict";
import { test } from "node:test";

import { resolveRuntimeCommand } from "./runtime-entrypoint.mjs";

test("dispatches handoff, check-health, and security commands", () => {
  assert.deepEqual(
    resolveRuntimeCommand(["forward-package-publish", "--help"]),
    { script: "scripts/publish-forward-package.mjs", args: ["--help"] },
  );
  assert.deepEqual(
    resolveRuntimeCommand(["forward-handoff-server"]),
    { script: "scripts/forward-handoff-server.mjs", args: [] },
  );
  assert.deepEqual(
    resolveRuntimeCommand(["forward-check-health", "--help"]),
    { script: "scripts/forward-check-health-transitions.mjs", args: ["--help"] },
  );
  assert.deepEqual(
    resolveRuntimeCommand(["security-correlate", "--help"]),
    { script: "scripts/security-exposure-correlation.mjs", args: ["--help"] },
  );
});

test("preserves the importer as the default command", () => {
  assert.deepEqual(
    resolveRuntimeCommand(["--help"]),
    { script: "scripts/forward-import-package.mjs", args: ["--help"] },
  );
});
