# Install And Release Model

This project is not distributed through PyPI. It has two runtime pieces:

- a Dynatrace AppEngine app built and deployed with the Dynatrace App Toolkit (`dt-app`)
- a Forward-side Node.js importer that runs outside Dynatrace with Forward-scoped credentials

The GitHub release is the source and documentation release. A Dynatrace tenant operator installs the Dynatrace app from
the release source, and a Forward operator runs the importer or connector workflow from a Forward-controlled
environment.

## Dynatrace App Install

Prerequisites:

- Node.js 24.x. The Dynatrace App Toolkit currently warns outside the Node 24 line.
- access to a Dynatrace environment that supports AppEngine apps
- Dynatrace SSO permission to deploy apps into that environment

Steps:

```bash
git clone https://github.com/forwardnetworks/forward-dynatrace.git
cd forward-dynatrace
# Use an exact reviewed commit or verified immutable replacement release.
git checkout <reviewed-commit>
npm ci
npm run ci
npm run acceptance:bundle -- --dependencies shared/demo-dependencies.json --output-dir out/acceptance --source-instance-id dt-acceptance-rehearsal
```

The reset defines one production `v1` contract and no alternate-version compatibility path. Until a replacement immutable
release is published and verified, use an exact reviewed commit only for controlled non-production rehearsal.

For an unsigned trial or development install, use a `my.*` app ID:

```bash
npm run dynatrace:deploy -- \
  --environment-url https://your-environment-id.apps.dynatrace.com/ \
  --app-id my.forward \
  --no-open \
  --non-interactive
```

For an enterprise install with the default `com.forward.dynatrace` app ID, sign the archive:

```bash
export DT_APP_OAUTH_SIGN_CLIENT_ID=<signing-oauth-client-id>
export DT_APP_OAUTH_SIGN_CLIENT_SECRET=<signing-oauth-client-secret>

npm run dynatrace:deploy -- \
  --environment-url https://your-environment-id.apps.dynatrace.com/ \
  --sign-archive \
  --no-open \
  --non-interactive
```

Keep tenant-specific values local. Do not commit a concrete `environmentUrl`, access token, OAuth callback URL, or
customer-specific reference. `npm run repo:validate` fails if those values are added to the public repo.

Dynatrace AppEngine rejects unsigned app IDs outside the `my.*` namespace. The wrapper command makes that policy
explicit before invoking `dt-app`, so trial installs and signed enterprise installs are separate operator choices.

Use the same wrapper for a checked clean uninstall. Pass the exact identity that was installed:

```bash
npm run dynatrace:uninstall -- \
  --environment-url https://your-environment-id.apps.dynatrace.com/ \
  --app-id my.forward \
  --no-open \
  --non-interactive
```

Omit `--app-id my.forward` only when removing the production `com.forward.dynatrace` identity. Uninstall never needs
archive-signing credentials, but the deployment OAuth client or user still needs `app-engine:apps:delete` for the exact
app identity.

This reset is a clean installation rather than an in-place upgrade. Follow
[`app-identities.md`](app-identities.md) to remove an experimental install, regenerate Workflow templates,
and install either `my.forward` in a sandbox or the signed `com.forward.dynatrace` package.

## Forward Manual Import

Manual import is the first production-safe workflow because Forward writes happen only after a Forward operator reviews
the package.

1. Generate or download the required artifacts from the Dynatrace app:
   - `forward-dynatrace-manifest.json`
   - `forward-intent-checks.json`
   - optional `forward-nqe-checks.json`
   - optional `forward-nqe-diff-requests.json`
2. Move those artifacts into a Forward-controlled environment.
3. Validate the package without Forward credentials:

   ```bash
   npm run forward:import -- \
     --checks forward-intent-checks.json \
     --manifest forward-dynatrace-manifest.json \
     --validate-only
   ```

4. Run a Forward dry-run:

   ```bash
   export FORWARD_BASE_URL=https://forward.example.com
   export FORWARD_AUTHORIZATION_FILE=/secure/path/forward-authorization.header
   export FORWARD_NETWORK_ID=<network-id>

   npm run forward:import -- \
     --checks forward-intent-checks.json \
     --manifest forward-dynatrace-manifest.json \
     --report forward-import-report.json
   ```

5. Review `create`, `unchanged`, `changed`, `stale`, and `collision` results.
6. Verify the detached package signature and stage an immutable plan bound to the current processed snapshot:

   ```bash
   npm run forward:import -- \
     --checks forward-intent-checks.json \
     --manifest forward-dynatrace-manifest.json \
     --require-signature \
     --signature forward-dynatrace-package.sig \
     --public-key /secure/path/forward-dynatrace-public.pem \
     --stage-plan /secure/approvals/import-plan.json
   ```

7. Have a Forward operator review the plan and create an approval that exactly matches its action arrays. Set
   `approvedAt` to the issuance time and `expiresAt` no more than 24 hours later.
8. Apply the same signed package and staged plan:

   ```bash
   npm run forward:import -- \
     --checks forward-intent-checks.json \
     --manifest forward-dynatrace-manifest.json \
     --require-signature \
     --signature forward-dynatrace-package.sig \
     --public-key /secure/path/forward-dynatrace-public.pem \
     --apply-plan /secure/approvals/import-plan.json \
     --require-approval-file /secure/approvals/approval.json \
     --apply
   ```

The default Network Admin apply policy is intentionally automatic `create-missing-only` after signed-package and
runtime activation gates are configured. Changed and stale Dynatrace-managed checks remain
report-only unless the optional approval-gated update/stale workflow is enabled from the Forward-side runtime with a
verified signed package, exact approval file, and explicit mutation budgets.

## Forward Connector Pull

For automation, run the same importer from a scheduled Forward-side job or connector. The connector should have:

- read-only access to a package URL published by Dynatrace or by an approved package handoff workflow
  (`docs/package-handoff.md`)
- Forward credentials stored only in the Forward-side runtime
- a required `forwardAccessProfile` matching the package: `read-only`, `network-operator`, or `network-admin`
- a configured Forward network ID
- alerting on validation failure, drift, stale checks, and import failure

Example:

```bash
npm run forward:import -- \
  --package-url https://package.example.com/dynatrace-forward/latest/ \
  --report forward-import-report.json \
  --fail-on-drift
```

`--package-url` reads:

- `forward-dynatrace-manifest.json`
- `forward-intent-checks.json`
- optional `forward-nqe-checks.json` when listed by the manifest
- optional `forward-nqe-diff-requests.json` when listed by the manifest

Non-local package URLs must use HTTPS. The importer validates schema version, package type, package age, count matching,
checksum matching, credential policy, dedupe policy, allowed check type, NQE query ID allowlists when NQE artifacts are
present, and reconciliation policy before contacting Forward.

Connector config mode:

```bash
cp config/forward-connector.config.example.json /secure/path/forward-connector.config.json
npm run forward:import -- --config /secure/path/forward-connector.config.json
```

Start from the example matching the Forward credential:

- `config/forward-connector.config.example.json`: Read Only
- `config/forward-connector.network-operator.config.example.json`: Network Operator
- `config/forward-connector.network-admin.config.example.json`: Network Admin, shipped with apply disabled for the
  mandatory dry-run and approval setup

Do not store Forward user, password, or token values in the config file.
Read Only and Network Operator connector profiles never write intent checks. Network Admin may create missing checks;
changed-check replacement remains signed, exact-approval-gated, change-window-bound, and budgeted. Stale retirement is
a separate deletion policy.
Use `config/forward-connector.signed.config.example.json` when the package handoff requires detached signature
verification.

Before a scheduled connector is enabled, generate an acceptance evidence bundle with the same dependency input and
retain `ACCEPTANCE.md`, `acceptance-summary.json`, the eligibility report, and the sanitized status event with the
change record.

For scheduled operation, use the systemd or Kubernetes templates in `deploy/` and follow
`docs/connector-runtime.md`. Run `docs/deployment-readiness.md` checks before enabling a schedule or apply.

## Dynatrace Workflow Trigger

Use the checked payload examples in `deploy/dynatrace-workflows/` when wiring a schedule or problem workflow to the
export function. Validate local edits with:

```bash
npm run dynatrace:workflow:validate
```

The workflow must publish package artifacts only. Forward writes stay in the Forward-side importer or connector.

## Release Gate

Run this before any release tag:

```bash
npm run ci
git diff --check
```

For source, app bundle, container metadata, or other release artifacts, publish checksums with the release:

```bash
npm run release:checksums -- --output dist/SHA256SUMS artifact...
```

Tag pushes use `.github/workflows/release.yml` to run CI, package app/importer archives, generate `SHA256SUMS`, upload
workflow artifacts, and publish the GitHub release.

The repository validation blocks:

- Dynatrace token-shaped secrets
- concrete Dynatrace Apps tenant URLs
- OAuth callback/login URL fragments
- local private token filenames
- non-placeholder Forward credentials
- personal email or customer-specific references
- retired secondary-artifact wording
