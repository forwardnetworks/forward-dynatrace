#!/usr/bin/env node

import assert from "node:assert/strict";
import { test } from "node:test";
import path from "node:path";
import { fileURLToPath } from "node:url";

import {
  validateWorkflowActionPins,
  validateWorkflowDirectory,
} from "./validate-github-action-pins.mjs";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

test("repository workflows pin external actions to immutable revisions", async () => {
  assert.deepEqual(
    await validateWorkflowDirectory(path.join(root, ".github", "workflows")),
    [],
  );
});

test("mutable external action references fail", () => {
  const failures = validateWorkflowActionPins({
    workflowPath: ".github/workflows/example.yml",
    source: "      - uses: actions/checkout@v7\n",
  });
  assert.equal(failures.length, 2);
  assert.match(failures[0], /full 40-character commit SHA/u);
  assert.match(failures[1], /release comment/u);
});

test("a pinned action requires a reviewable release comment", () => {
  const failures = validateWorkflowActionPins({
    workflowPath: ".github/workflows/example.yml",
    source: "      - uses: actions/checkout@9c091bb21b7c1c1d1991bb908d89e4e9dddfe3e0\n",
  });
  assert.deepEqual(failures, [
    ".github/workflows/example.yml:1 must retain a release comment such as # v4 for update review.",
  ]);
});

test("local actions do not require a commit pin", () => {
  assert.deepEqual(
    validateWorkflowActionPins({
      workflowPath: ".github/workflows/example.yml",
      source: "      - uses: ./.github/actions/local\n",
    }),
    [],
  );
});
