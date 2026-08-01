import assert from "node:assert/strict";
import test from "node:test";

import { parseArgs, validateArgs } from "./build-dynatrace-archive.mjs";

test("parses the release archive arguments", () => {
  const args = parseArgs([
    "--app-id",
    "my.forward",
    "--app-version",
    "0.13.2",
    "--output",
    "out/my.forward.zip",
  ]);
  validateArgs(args);
  assert.deepEqual(args, {
    appId: "my.forward",
    appVersion: "0.13.2",
    output: "out/my.forward.zip",
  });
});

test("rejects invalid or incomplete archive arguments", () => {
  assert.throws(
    () => validateArgs(parseArgs(["--app-id", "forward", "--app-version", "latest"])),
    /app ID/u,
  );
  assert.throws(() => parseArgs(["--tenant-token", "secret"]), /Unknown option/u);
});
