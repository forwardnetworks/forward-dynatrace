#!/usr/bin/env node

import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

import forwardSync from "../api/forward-sync.function.ts";

const examples = [
  "deploy/dynatrace-workflows/forward-sync-schedule.payload.example.json",
  "deploy/dynatrace-workflows/forward-sync-problem.payload.example.json",
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
}

process.stdout.write("Dynatrace workflow example validation passed.\n");
