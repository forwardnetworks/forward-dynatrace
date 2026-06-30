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
git checkout v1.0.3
npm ci
npm run ci
npm run deploy -- --environment-url https://your-environment-id.apps.dynatrace.com/
```

Keep tenant-specific values local. Do not commit a concrete `environmentUrl`, access token, OAuth callback URL, or
customer-specific reference. `npm run repo:validate` fails if those values are added to the public repo.

## Forward Manual Import

Manual import is the first production-safe workflow because Forward writes happen only after a Forward operator reviews
the package.

1. Generate or download these two artifacts from the Dynatrace app:
   - `forward-dynatrace-manifest.json`
   - `forward-intent-checks.json`
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
   export FORWARD_USER=<user>
   export FORWARD_PASSWORD=<password-or-token>
   export FORWARD_NETWORK_ID=<network-id>

   npm run forward:import -- \
     --checks forward-intent-checks.json \
     --manifest forward-dynatrace-manifest.json \
     --report forward-import-report.json
   ```

5. Review `create`, `unchanged`, `changed`, and `stale` results.
6. Apply only missing checks:

   ```bash
   npm run forward:import -- \
     --checks forward-intent-checks.json \
     --manifest forward-dynatrace-manifest.json \
     --apply
   ```

The apply policy is intentionally `create-missing-only`. Changed and stale Dynatrace-managed checks remain report-only
until a Forward-approved update or retirement policy is explicitly adopted.

## Forward Connector Pull

For automation, run the same importer from a scheduled Forward-side job or connector. The connector should have:

- read-only access to a package URL published by Dynatrace or by an approved package handoff workflow
  (`docs/package-handoff.md`)
- Forward credentials stored only in the Forward-side runtime
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

Non-local package URLs must use HTTPS. The importer validates schema version, package type, package age, count matching,
checksum matching, credential policy, dedupe policy, allowed check type, and reconciliation policy before contacting
Forward.

Connector config mode:

```bash
cp config/forward-connector.config.example.json /secure/path/forward-connector.config.json
npm run forward:import -- --config /secure/path/forward-connector.config.json
```

Do not store Forward user, password, or token values in the config file.
Use `config/forward-connector.signed.config.example.json` when the package handoff requires detached signature
verification.

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
- legacy secondary-artifact wording
