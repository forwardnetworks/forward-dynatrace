import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { test } from "node:test";

import {
  forwardReadOnlyAuthorization,
  parseArgs,
  selectShowcaseDependencies,
  shouldRunPathEvidence,
} from "./live-demo-conductor.mjs";

test("selects clean unique showcase flows while preserving governance states", async () => {
  const dependencies = JSON.parse(
    await readFile("shared/demo-dependencies.json", "utf8"),
  );
  const governed = dependencies.map((dependency) => {
    if (dependency.serviceName === "astroshop-shipping") {
      return { ...dependency, mappingState: "review" };
    }
    if (dependency.serviceName === "easytrade-accountservice (AccountControllerV2)") {
      return { ...dependency, mappingState: "needs-map" };
    }
    return dependency;
  });

  const selected = selectShowcaseDependencies(governed, 12);
  assert.equal(selected.length, 12);
  assert.equal(selected.some((dependency) => dependency.mappingState === "review"), true);
  assert.equal(selected.some((dependency) => dependency.mappingState === "needs-map"), true);
  assert.equal(selected.some((dependency) => /^[_:]|:\d/u.test(dependency.serviceName)), false);
  assert.equal(
    new Set(
      selected.map((dependency) =>
        [dependency.source, dependency.destination, dependency.protocol, dependency.port].join("|"),
      ),
    ).size,
    selected.length,
  );
});

test("runs read-only path evidence by default and supports an explicit skip", () => {
  assert.equal(shouldRunPathEvidence(parseArgs([])), true);
  assert.equal(shouldRunPathEvidence(parseArgs(["--with-path-evidence"])), true);
  assert.equal(shouldRunPathEvidence(parseArgs(["--skip-path-evidence"])), false);
});

test("parses explicit mutation and Dynatrace status publication gates", () => {
  assert.deepEqual(parseArgs(["--apply", "--publish-dynatrace-status"]), {
    apply: true,
    "publish-dynatrace-status": true,
  });
});

test("prefers dedicated read-only Forward authorization", () => {
  assert.equal(
    forwardReadOnlyAuthorization({
      FORWARD_USER: "write-user",
      FORWARD_PASSWORD: "write-password",
      FORWARD_READONLY_AUTHORIZATION: "Bearer readonly-token",
    }),
    "Bearer readonly-token",
  );
  assert.equal(
    forwardReadOnlyAuthorization({
      FORWARD_USER: "demo-user",
      FORWARD_PASSWORD: "demo-password",
    }),
    `Basic ${Buffer.from("demo-user:demo-password").toString("base64")}`,
  );
});
