#!/usr/bin/env node

import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

import forwardSync from "../api/forward-sync.function.ts";
import { createExportForwardPackageAction } from "../actions/export-forward-package.logic.mjs";

const connection = {
  schemaId: "forward-package-handoff-connection",
  value: {
    name: "validation-handoff",
    url: "https://handoff.example.com/v1/packages",
    token: "validation-write-token-1234",
    retentionClass: "nonproduction-30d",
  },
};

const exportForwardPackage = createExportForwardPackageAction({
  loadConnection: async () => connection,
  fetchImpl: async (_url, options) => {
    const publication = JSON.parse(options.body);
    const manifest = publication.files.find(
      (file) => file.name === "forward-dynatrace-manifest.json",
    );
    return {
      ok: true,
      status: 201,
      text: async () => JSON.stringify({
        schemaVersion: "forward-dynatrace-handoff-receipt/v1",
        status: "published",
        packageId: publication.packageId,
        receivedAt: "2026-07-15T18:30:00.000Z",
        manifestSha256: manifest.sha256,
        files: publication.files.map((file) => file.name),
        immutableUrl: `https://handoff.example.com/v1/packages/${publication.packageId}/`,
        latestUrl: "https://handoff.example.com/v1/packages/latest/",
        retentionClass: publication.retentionClass,
        accessLogId: "workflow-validation-access-log",
      }),
    };
  },
});

const examples = [
  "deploy/dynatrace-workflows/forward-sync-schedule.payload.example.json",
  "deploy/dynatrace-workflows/forward-sync-problem.payload.example.json",
  "deploy/dynatrace-workflows/forward-sync-on-demand.payload.example.json",
];

for (const example of examples) {
  const payload = JSON.parse(await readFile(example, "utf8"));
  const result = forwardSync(payload);
  assert.equal(result.status, "ready", `${example} should produce a ready export package`);
  assert.ok(result.intentCheckCount > 0, `${example} should generate at least one intent check`);
  assert.ok(result.exportManifestPreview, `${example} should generate a manifest`);
  assert.ok(result.intentChecksPreview, `${example} should generate checks`);

  const manifest = JSON.parse(result.exportManifestPreview);
  const checks = JSON.parse(result.intentChecksPreview);
  assert.equal(manifest.schemaVersion, "forward-dynatrace/v1");
  assert.equal(manifest.source.writePolicy, "dynatrace-never-writes-forward");
  assert.equal(manifest.intentChecks.count, checks.length);
  for (const check of checks) {
    assert.equal(
      check.tags.filter((tag) => tag.startsWith("dynatrace-key:")).length,
      1,
      `${example} generated a check without exactly one dynatrace-key tag`,
    );
    for (const tag of check.tags) {
      assert.equal(/\s/.test(tag), false, `${example} generated whitespace tag ${tag}`);
    }
  }

  const actionResult = await exportForwardPackage({ connectionId: "validation-connection", request: payload });
  assert.equal(actionResult.status, "ready", `${example} should execute through the Workflow action`);
  assert.equal(actionResult.boundary, "dynatrace-never-writes-forward");
  assert.equal(actionResult.intentCheckCount, result.intentCheckCount);
}

const appConfig = JSON.parse(await readFile("app.config.json", "utf8"));
assert.ok(
  appConfig.app.actions.some((action) => action.name === "export-forward-package"),
  "app.config.json must register export-forward-package",
);
const sampleResult = JSON.parse(
  await readFile("assets/export-forward-package.sample-result.json", "utf8"),
);
assert.equal(sampleResult.schemaVersion, "forward-dynatrace-workflow-action/v2");
assert.equal(sampleResult.boundary, "dynatrace-never-writes-forward");
assert.equal(sampleResult.handoff.schemaVersion, "forward-dynatrace-handoff-receipt/v1");
assert.equal(sampleResult.handoff.manifestSha256.length, 64);

process.stdout.write("Dynatrace workflow example validation passed.\n");
