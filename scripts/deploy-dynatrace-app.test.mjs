import { describe, it } from "node:test";
import assert from "node:assert/strict";

import { parseArgs, validateDeployArgs } from "./deploy-dynatrace-app.mjs";

const defaultAppId = "com.forward.dynatrace";

describe("deploy-dynatrace-app", () => {
  it("accepts an unsigned trial install in the my namespace", () => {
    const args = parseArgs([
      "--environment-url",
      "https://your-environment-id.apps.dynatrace.com/",
      "--app-id",
      "my.forward",
      "--no-open",
      "--non-interactive",
    ]);

    assert.doesNotThrow(() => validateDeployArgs(args, defaultAppId, {}));
  });

  it("rejects unsigned enterprise namespace deploys before dt-app runs", () => {
    const args = parseArgs([
      "--environment-url",
      "https://your-environment-id.apps.dynatrace.com/",
    ]);

    assert.throws(
      () => validateDeployArgs(args, defaultAppId, {}),
      /outside the my\.\* namespace/,
    );
  });

  it("requires signing OAuth credentials for signed enterprise installs", () => {
    const args = parseArgs([
      "--environment-url",
      "https://your-environment-id.apps.dynatrace.com/",
      "--sign-archive",
    ]);

    assert.throws(() => validateDeployArgs(args, defaultAppId, {}), /requires/);
    assert.doesNotThrow(() =>
      validateDeployArgs(args, defaultAppId, {
        DT_APP_OAUTH_SIGN_CLIENT_ID: "client-id",
        DT_APP_OAUTH_SIGN_CLIENT_SECRET: "client-secret",
      }),
    );
  });

  it("allows dry-run archives for the default app ID without signing credentials", () => {
    const args = parseArgs([
      "--environment-url",
      "https://your-environment-id.apps.dynatrace.com/",
      "--dry-run",
    ]);

    assert.doesNotThrow(() => validateDeployArgs(args, defaultAppId, {}));
  });

  it("requires archive output to be a deploy dry run", () => {
    const valid = parseArgs([
      "--environment-url",
      "https://your-environment-id.apps.dynatrace.com/",
      "--app-id",
      "my.forward",
      "--dry-run",
      "--archive-output",
      "out/my.forward.zip",
    ]);

    assert.equal(valid.archiveOutput, "out/my.forward.zip");
    assert.doesNotThrow(() => validateDeployArgs(valid, defaultAppId, {}));
    assert.throws(
      () => validateDeployArgs({ ...valid, dryRun: false }, defaultAppId, {}),
      /requires --dry-run/,
    );
    assert.throws(
      () => validateDeployArgs({ ...valid, uninstall: true }, defaultAppId, {}),
      /cannot be combined with --uninstall/,
    );
  });

  it("allows uninstall for either app identity without signing credentials", () => {
    const sandbox = parseArgs([
      "--environment-url",
      "https://your-environment-id.apps.dynatrace.com/",
      "--app-id",
      "my.forward",
      "--uninstall",
      "--no-open",
      "--non-interactive",
    ]);
    const production = parseArgs([
      "--environment-url",
      "https://your-environment-id.apps.dynatrace.com/",
      "--uninstall",
      "--no-open",
      "--non-interactive",
    ]);

    assert.doesNotThrow(() => validateDeployArgs(sandbox, defaultAppId, {}));
    assert.doesNotThrow(() => validateDeployArgs(production, defaultAppId, {}));
  });

  it("rejects signing and build-only options during uninstall", () => {
    const base = parseArgs([
      "--environment-url",
      "https://your-environment-id.apps.dynatrace.com/",
      "--app-id",
      "my.forward",
      "--uninstall",
    ]);

    assert.throws(
      () => validateDeployArgs({ ...base, signArchive: true }, defaultAppId, {}),
      /cannot be combined with --sign-archive/,
    );
    assert.throws(
      () => validateDeployArgs({ ...base, optimize: true }, defaultAppId, {}),
      /cannot be combined with build-only options/,
    );
  });

  it("rejects invalid app IDs", () => {
    const args = parseArgs([
      "--environment-url",
      "https://your-environment-id.apps.dynatrace.com/",
      "--app-id",
      "My Bad App",
    ]);

    assert.throws(() => validateDeployArgs(args, defaultAppId, {}), /Invalid Dynatrace app ID/);
  });

  it("accepts a temporary trial version and rejects invalid versions", () => {
    const valid = parseArgs([
      "--environment-url",
      "https://your-environment-id.apps.dynatrace.com/",
      "--app-id",
      "my.forward",
      "--app-version",
      "1.0.1-rc.1",
    ]);
    assert.equal(valid.appVersion, "1.0.1-rc.1");
    assert.doesNotThrow(() => validateDeployArgs(valid, defaultAppId, {}));

    const invalid = { ...valid, appVersion: "latest" };
    assert.throws(
      () => validateDeployArgs(invalid, defaultAppId, {}),
      /Invalid Dynatrace app version/,
    );
  });
});
