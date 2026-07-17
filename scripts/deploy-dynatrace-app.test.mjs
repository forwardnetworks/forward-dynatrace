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
      "1.0.1-demo.1",
    ]);
    assert.equal(valid.appVersion, "1.0.1-demo.1");
    assert.doesNotThrow(() => validateDeployArgs(valid, defaultAppId, {}));

    const invalid = { ...valid, appVersion: "latest" };
    assert.throws(
      () => validateDeployArgs(invalid, defaultAppId, {}),
      /Invalid Dynatrace app version/,
    );
  });
});
