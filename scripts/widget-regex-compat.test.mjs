import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const widgetSource = new URL("../actions/sync-forward-intent-checks.widget.tsx", import.meta.url);

test("workflow widget Unicode regular expressions parse in browser JavaScript", async () => {
  const source = await readFile(widgetSource, "utf8");
  const unicodeRegexLiterals = [...source.matchAll(/\/((?:\\.|[^/\n])+)\/u/gdu)];

  assert.ok(unicodeRegexLiterals.length > 0, "expected Unicode regular-expression literals");
  for (const match of unicodeRegexLiterals) {
    assert.doesNotThrow(
      () => new RegExp(match[1], "u"),
      `invalid Unicode regular expression: /${match[1]}/u`,
    );
  }
});
