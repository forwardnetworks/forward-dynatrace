import { describe, it } from "node:test";
import assert from "node:assert/strict";

import { parseArgs, validateDeployArgs } from "./deploy-dynatrace-app.mjs";

const defaultAppId = "com.forwardnetworks.dynatrace.field.integration";

describe("deploy-dynatrace-app", () => {
  it("accepts an unsigned trial install in the my namespace", () => {
    const args = parseArgs([
      "--environment-url",
      "https://your-environment-id.apps.dynatrace.com/",
      "--app-id",
      "my.forwardnetworks.dynatrace.field.integration",
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
});
