import assert from "node:assert/strict";
import test from "node:test";

import AdmZip from "adm-zip";

import {
  addWorkflowWidgetCompatibilityEntries,
  parseArgs,
  validateArgs,
} from "./build-dynatrace-archive.mjs";

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

test("adds the hosted Workflows compatibility path without removing toolkit widgets", () => {
  const archive = new AdmZip();
  archive.addFile(
    "widgets/actions/sync-forward-intent-checks/index.html",
    Buffer.from("widget-html"),
  );
  archive.addFile(
    "widgets/actions/sync-forward-intent-checks/index.js",
    Buffer.from("widget-js"),
  );

  addWorkflowWidgetCompatibilityEntries(archive);

  assert.equal(
    archive.readAsText("widgets/actions/sync-forward-intent-checks/index.html"),
    "widget-html",
  );
  assert.equal(
    archive.readAsText("ui/widgets/actions/sync-forward-intent-checks/index.html"),
    "widget-html",
  );
  assert.equal(
    archive.readAsText("ui/widgets/actions/sync-forward-intent-checks/index.js"),
    "widget-js",
  );
});
