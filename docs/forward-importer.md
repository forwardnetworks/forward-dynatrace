# Forward Importer

Use `scripts/forward-import-package.mjs` when the package is imported manually from a Forward-controlled environment or
pulled by a Forward-side connector. The script is intentionally dry-run by default.

## Required Inputs

- `forward-intent-checks.json`: required `NewNetworkCheck[]` payload from the Dynatrace app.
- `forward-dynatrace-manifest.json`: recommended for manual import and required for production automation.

## Required Environment

```bash
export FORWARD_BASE_URL=https://forward.example.com
export FORWARD_USER=<user>
export FORWARD_PASSWORD=<password-or-token>
export FORWARD_NETWORK_ID=<network-id>
```

Keep these values out of Dynatrace and out of the exported package.

## Dry Run

```bash
npm run forward:import -- --checks forward-intent-checks.json
```

The dry run:

1. Validates the package before contacting Forward:
   - payload must be a JSON array
   - manifest checksum must match the exact `forward-intent-checks.json` bytes when a manifest is supplied
   - every check must have exactly one `dynatrace-key:*` tag
   - names and `dynatrace-key:*` tags must be unique
   - check type must be `Existential`
2. Reads the latest processed snapshot:
   `GET /api/networks/{networkId}/snapshots/latestProcessed`
3. Reads existing Forward intent checks:
   `GET /api/snapshots/{snapshotId}/checks?type=Existential`
4. Matches planned checks by exact `name` or `dynatrace-key:*` tag.
5. Computes canonical SHA-256 fingerprints for the generated check fields.
6. Reports checks to create, unchanged checks, changed checks, and stale Dynatrace-managed checks.

Dry-run validates package shape and reconciliation only. Live apply also depends on Forward accepting every location
filter in the target snapshot. Unresolved `HostFilter`, `DeviceFilter`, or `SubnetLocationFilter` values are rejected
by Forward before any bulk create succeeds.

Validate package shape without Forward credentials:

```bash
npm run forward:import -- \
  --checks forward-intent-checks.json \
  --manifest forward-dynatrace-manifest.json \
  --validate-only
```

## Apply Checks

```bash
npm run forward:import -- \
  --checks forward-intent-checks.json \
  --manifest forward-dynatrace-manifest.json \
  --apply
```

The default apply run posts only missing checks:

```text
POST /api/snapshots/{snapshotId}/checks?bulk
```

Body shape is `NewNetworkCheck[]`. The Forward API defaults `persistent` to `true`.

Changed and stale checks remain report-only unless the optional approval-gated update/stale path is enabled.

The importer retries transient Forward API responses (`408`, `409`, `425`, `429`, and `5xx`) with bounded backoff.
Use `--max-retries 0` to disable retries in test harnesses.

## Approved Update And Retirement

The importer can also replace changed generated checks and deactivate stale generated checks, but only from the
Forward-controlled runtime. This path is optional. The base production workflow works without it.

Required gates:

- `--apply`
- `--require-signature` with a verified detached package signature
- `--require-approval-file approval.json`
- explicit mutation budgets with `--max-updates` and `--max-deactivations`

Approval files name exact `dynatrace-key:*` values from the current dry-run report:

```json
{
  "schemaVersion": "forward-dynatrace-approval/v1",
  "packageId": "dynatrace-forward-20260703120000",
  "changeWindowId": "CHG-12345",
  "expiresAt": "2026-07-10T23:59:59.000Z",
  "approvedBy": "forward-operator@example.com",
  "reason": "Approved app dependency refresh",
  "approvedChangedKeys": [
    "dynatrace-key:dt:checkout:prod:service-123:checkout-vip:orders-db:tcp:443"
  ],
  "approvedStaleKeys": [
    "dynatrace-key:dt:checkout:prod:service-456:old-vip:orders-db:tcp:443"
  ]
}
```

Run the approved apply:

```bash
npm run forward:import -- \
  --checks forward-intent-checks.json \
  --manifest forward-dynatrace-manifest.json \
  --signature forward-dynatrace-package.sig \
  --public-key /secure/path/forward-dynatrace-public.pem \
  --require-signature \
  --require-approval-file approval.json \
  --change-window-id CHG-12345 \
  --apply \
  --apply-updates \
  --deactivate-stale \
  --max-updates 10 \
  --max-deactivations 10 \
  --report forward-import-report.json \
  --status-artifact forward-ingest-status.json
```

Changed-check replacement uses the Forward checks API as two explicit steps:

```text
DELETE /api/snapshots/{snapshotId}/checks/{checkId}
POST /api/snapshots/{snapshotId}/checks?bulk
```

Stale retirement uses:

```text
DELETE /api/snapshots/{snapshotId}/checks/{checkId}
```

Approval files are intentionally exact and short-lived. Unknown keys, package ID mismatches, change window mismatches,
expired approvals, missing signatures, or budget overages fail before mutation.

## Reconciliation Report

Write the report to disk with:

```bash
npm run forward:import -- \
  --checks forward-intent-checks.json \
  --manifest forward-dynatrace-manifest.json \
  --report forward-import-report.json \
  --metrics forward-import-metrics.prom \
  --status-artifact forward-ingest-status.json
```

The report includes:

- `runId`, timestamps, duration, package ID, package integrity, and source locations.
- `create`: package checks not found in Forward.
- `unchanged`: package checks already present with the same generated fingerprint.
- `changed`: same key/name exists, but generated fields differ.
- `stale`: Dynatrace-managed Forward checks no longer present in the package.

The metrics file includes planned-check count, reconciliation counts, duration, and signature verification state in
Prometheus text format.

The status artifact is a sanitized `forward-dynatrace-status/v1` JSON summary intended for read-only display in
Dynatrace after Forward-side ingest. It includes run ID, package ID, mode, import state, signature status, target IDs,
counts, planned-check count, and duration. It does not include check names, hostnames, dependency rows, credentials, or
Forward API response bodies.

Use `--fail-on-drift` in automation when changed or stale checks should block the run:

```bash
npm run forward:import -- \
  --checks forward-intent-checks.json \
  --manifest forward-dynatrace-manifest.json \
  --fail-on-drift
```

For iterative use, schedule package generation in Dynatrace and run the importer or connector on the same cadence.
Each run should be treated as desired-state reconciliation: create only missing checks by default, report changed
checks for review, and retire or replace generated checks only through the approval-gated optional path above.

## Connector Pull Mode

A Forward-side connector can run the same importer against a read-only package URL:

```bash
npm run forward:import -- \
  --package-url https://package.example.com/dynatrace-forward/latest/ \
  --report forward-import-report.json \
  --fail-on-drift
```

`--package-url` pulls:

- `forward-dynatrace-manifest.json`
- `forward-intent-checks.json`

Non-local package URLs must use HTTPS. The importer validates the manifest schema, package type, generated timestamp,
intent-check count, package checksum, credential policy, dedupe requirement, and create-missing-only reconciliation
policy before any Forward API call.

For scheduled automation, put non-secret runtime settings in a connector config:

```bash
cp config/forward-connector.config.example.json /secure/path/forward-connector.config.json
npm run forward:import -- --config /secure/path/forward-connector.config.json
```

The config may contain package URL, Forward base URL, network ID, batch size, retry count, package age, drift policy,
optional update/stale settings, report path, metrics path, and status artifact path. It must not contain Forward user,
password, token, or other secrets; the importer rejects those fields.

## Detached Signature Mode

Checksum validation detects accidental or unauthorized package-byte changes after manifest generation. For provenance,
add an Ed25519 detached signature:

```bash
npm run forward:sign -- \
  --checks forward-intent-checks.json \
  --manifest forward-dynatrace-manifest.json \
  --private-key /secure/path/forward-dynatrace-private.pem \
  --signature forward-dynatrace-package.sig
```

Verify during import:

```bash
npm run forward:import -- \
  --checks forward-intent-checks.json \
  --manifest forward-dynatrace-manifest.json \
  --signature forward-dynatrace-package.sig \
  --public-key /secure/path/forward-dynatrace-public.pem \
  --require-signature \
  --validate-only
```

For connector pull mode, use `config/forward-connector.signed.config.example.json`. Keep the private key outside the
runtime that imports packages.
