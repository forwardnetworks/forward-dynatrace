import assert from "node:assert/strict";
import { readFile, readdir } from "node:fs/promises";
import test from "node:test";

import { collectPatterns, greedyQuantifierInGroup } from "./dynatrace-regex-rules.ts";

test("flags the v0.13.7 Forward URL pattern that Dynatrace rejected at install time", () => {
  const v0137 = String.raw`^https://(?:\[[0-9A-Fa-f:.]+\]|[^/?#:@]+)(?::[0-9]{1,5})?(?:/api)?/?$`;
  assert.equal(greedyQuantifierInGroup(v0137), "+");
});

test("flags each greedy quantifier form inside a group", () => {
  assert.equal(greedyQuantifierInGroup("^(a+)$"), "+");
  assert.equal(greedyQuantifierInGroup("^(?:a*)$"), "*");
  assert.equal(greedyQuantifierInGroup("^(?:[0-9]{1,5})$"), "{1,5}");
  assert.equal(greedyQuantifierInGroup("^(?:[0-9]{2,})$"), "{2,}");
});

test("accepts lazy quantifiers, exact counts, bare optionals, and anything outside a group", () => {
  assert.equal(greedyQuantifierInGroup("^(?:a+?)$"), undefined);
  assert.equal(greedyQuantifierInGroup("^(?:[0-9]{1,5}?)$"), undefined);
  assert.equal(greedyQuantifierInGroup("^(?:[1-9]|[1-9][0-9]{2}|1000)$"), undefined);
  assert.equal(greedyQuantifierInGroup("^(?:/api)?/?$"), undefined);
  assert.equal(greedyQuantifierInGroup("^https://[^/?#@]+?/api/?$|^https://[^/?#@]+?/?$"), undefined);
  assert.equal(greedyQuantifierInGroup("^[a-z]+$"), undefined);
});

test("ignores quantifier characters inside character classes and escapes", () => {
  assert.equal(greedyQuantifierInGroup("^(?:[+*]|\\+|\\*)$"), undefined);
});

test("every pattern in the shipped settings schemas is accepted by Dynatrace's rule", async () => {
  const directory = new URL("../settings/schemas/", import.meta.url);
  const files = (await readdir(directory)).filter((file) => file.endsWith(".schema.json"));
  assert.ok(files.length >= 2, "expected the settings schemas to be found");
  for (const file of files) {
    const schema = JSON.parse(await readFile(new URL(file, directory), "utf8"));
    for (const pattern of collectPatterns(schema)) {
      assert.equal(greedyQuantifierInGroup(pattern), undefined, `${file}: ${pattern}`);
    }
  }
});
