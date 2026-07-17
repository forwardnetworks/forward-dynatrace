# Forward Importer

Use `scripts/forward-import-package.mjs` when the package is imported manually from a Forward-controlled environment or
pulled by a Forward-side connector. The script is intentionally dry-run by default.

For production Dynatrace dependency exports, produce the package first with the Forward-side resolver and package
builder:

```bash
npm run forward:resolve-hosts -- \
  --dependencies dependencies.json \
  --forward-base-url https://forward.example.com \
  --forward-network-id <network-id> \
  --authorization-file /secure/path/read-only-forward-auth-header \
  --execute \
  --output resolved-dependencies.json

npm run forward:package -- \
  --dependencies resolved-dependencies.json \
  --source-instance-id <stable-opaque-dynatrace-source-id> \
  --output-dir out/forward-package
```

## Required Inputs

- `forward-intent-checks.json`: required `NewNetworkCheck[]` payload from the Forward-side package builder.
- `forward-dynatrace-manifest.json`: recommended for manual import and required for production automation.

Optional inputs:

- `forward-nqe-checks.json`: optional `NewNetworkCheck[]` payload for persistent NQE checks that reference
  Forward-owned query IDs.
- `forward-nqe-diff-requests.json`: optional read-only NQE diff request metadata. The importer validates and reports
  this artifact, but does not execute diffs.

## Required Environment

```bash
export FORWARD_BASE_URL=https://forward.example.com
export FORWARD_AUTHORIZATION_FILE=/secure/path/forward-authorization.header
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
   - every check must have exactly one tag for product ownership, contract version, source instance, and opaque source key
   - names and source keys must be unique within a package
   - check type must be `Existential`
   - optional NQE artifacts must reference query IDs in the Forward-side allowlist
2. Reads the latest processed snapshot:
   `GET /api/networks/{networkId}/snapshots/latestProcessed`
3. Reads existing Forward intent checks:
   `GET /api/snapshots/{snapshotId}/checks?type=Existential`
4. Matches planned checks only by the complete managed ownership tuple and opaque source key. A name match without the
   same complete tuple is a collision, never adoption.
5. Computes canonical SHA-256 fingerprints for the generated check fields.
6. Reports checks to create, unchanged checks, changed checks, and stale Dynatrace-managed checks.

When `forward-nqe-checks.json` is supplied, the dry run also reads existing Forward NQE checks with
`GET /api/snapshots/{snapshotId}/checks?type=NQE` and reconciles NQE check drift separately from intent-check drift.

Dry-run validates package shape and reconciliation only. Live apply also depends on Forward accepting every location
filter in the target snapshot. Unresolved `HostFilter`, `DeviceFilter`, or `SubnetLocationFilter` values are rejected
by Forward before any bulk create succeeds.

If apply fails with `No hosts matching the alias` or another unresolved-location error, do not retry the same package
unchanged. Run the Dynatrace app's read-only endpoint-resolution preflight for the affected dependencies, map the
Dynatrace source/destination values to Forward-resolvable locations, and keep unresolved rows as `needs-map` until the
mapping is corrected.

Validate package shape without Forward credentials:

```bash
npm run forward:import -- \
  --checks forward-intent-checks.json \
  --manifest forward-dynatrace-manifest.json \
  --validate-only
```

For a deployment-oriented gate report, use:

```bash
npm run forward:readiness -- \
  --checks forward-intent-checks.json \
  --manifest forward-dynatrace-manifest.json \
  --output forward-deployment-readiness.json
```

Use `--dry-run` on the readiness command after Forward credentials and network ID are configured.

## Stage, Approve, And Apply

```bash
npm run forward:import -- \
  --checks forward-intent-checks.json \
  --manifest forward-dynatrace-manifest.json \
  --require-signature \
  --signature forward-dynatrace-package.sig \
  --public-key /secure/path/forward-dynatrace-public.pem \
  --stage-plan /secure/approvals/import-plan.json
```

Staging performs live reconciliation but no Forward write. The immutable plan binds the signed package digests,
source instance, target network and snapshot, policy, budgets, counts, and exact actions. An operator creates an
approval for that exact plan. Apply then re-runs reconciliation and fails closed if any input or Forward state changed:

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

Create-missing apply posts:

```text
POST /api/snapshots/{snapshotId}/checks?bulk
```

Body shape is `NewNetworkCheck[]`. The Forward API defaults `persistent` to `true`.

Changed and stale checks remain report-only unless the optional approval-gated update/stale path is enabled.

The importer retries transient Forward API responses (`408`, `409`, `425`, `429`, and `5xx`) with bounded backoff.
Use `--max-retries 0` to disable retries in test harnesses.

## Optional NQE Checks And Diffs

The base workflow does not require NQE artifacts. Add them only when the customer wants Forward-owned NQE Library
queries represented in the package.

Generate optional artifacts with the package builder:

```bash
npm run forward:package -- \
  --dependencies normalized-dependencies.json \
  --output-dir /tmp/forward-dynatrace-package \
  --nqe-query-id FQ_aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa \
  --nqe-diff-query-id FQ_aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa \
  --nqe-diff-before-snapshot-id <before-snapshot-id> \
  --nqe-diff-after-snapshot-id <after-snapshot-id>
```

Generate dependency eligibility evidence with:

```bash
npm run forward:package -- \
  --dependencies normalized-dependencies.json \
  --output-dir /tmp/forward-dynatrace-package \
  --eligibility-report /tmp/forward-dynatrace-package/forward-dependency-eligibility.json
```

Rows marked `review`, `needs-map`, or missing required endpoint fields are reported with reasons before any Forward
dry-run or apply.

Validate or import them with an explicit Forward-owned query ID allowlist:

```bash
npm run forward:import -- \
  --checks forward-intent-checks.json \
  --manifest forward-dynatrace-manifest.json \
  --nqe-checks forward-nqe-checks.json \
  --nqe-diff-requests forward-nqe-diff-requests.json \
  --nqe-query-id-allowlist FQ_aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa \
  --validate-only
```

Connector pull mode also pulls optional artifacts when the manifest lists them. The runtime still needs
`--nqe-query-id-allowlist` or `nqeQueryIdAllowlist` in connector config.

Persistent NQE checks:

- must use `definition.checkType = "NQE"`
- must reference a committed Forward NQE Library `queryId`
- must have the same complete managed ownership tuple as intent checks
- are reconciled with the same create/unchanged/changed/stale model as intent checks
- are created only through the Forward-side importer or connector

NQE diff requests:

- are read-only metadata for `POST /api/nqe-diffs/{before}/{after}`
- require approved query IDs, before snapshot ID, after snapshot ID, parameters, and options
- are validated and reported by this importer
- are not executed by the persistent check importer

## Approved Update And Retirement

The importer can also replace changed generated checks and deactivate stale generated checks, but only from the
Forward-controlled runtime. This path is optional. The base production workflow works without it.

Required gates:

- `--apply`
- `--require-signature` with a verified detached package signature
- `--require-approval-file approval.json`
- explicit mutation budgets with `--max-updates` and `--max-deactivations`

Approval files bind the exact immutable plan and must repeat the complete update/retire source-key action sets already
present in that plan. `approvedAt` records issuance and `expiresAt` must be later, still in the future, and no more than
24 hours after issuance:

```json
{
  "schemaVersion": "forward-dynatrace-import-approval/v1",
  "planId": "forward-dynatrace-plan-0123456789abcdef01234567",
  "planSha256": "1111111111111111111111111111111111111111111111111111111111111111",
  "packageId": "dynatrace-forward-20260703120000",
  "networkId": "network-123",
  "snapshotId": "snapshot-456",
  "changeWindowId": "CHG-12345",
  "approvedAt": "2026-07-17T18:00:00.000Z",
  "expiresAt": "2026-07-17T19:00:00.000Z",
  "approvedBy": "forward-operator@example.com",
  "reason": "Approved app dependency refresh",
  "actions": {
    "createMissing": true,
    "updateSourceKeys": [
      "source-key:sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa"
    ],
    "retireSourceKeys": [
      "source-key:sha256:bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb"
    ]
  }
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
  --apply-plan /secure/approvals/import-plan.json \
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

Apply writes are recorded per source key. Changed-check replacement is serialized as delete then single-check create so
a failure has one exact recovery scope. If any write fails, the importer stops further mutations, writes the private
report and sanitized failed status when those paths are configured, exits non-zero, and requires reconciliation plus a
new staged plan before retry. The private report records the failed phase and whether an existing check had already
been deleted; the Dynatrace-safe status exposes only phase, HTTP status, affected count, and recovery-required state.
After every apply, the importer reads the checks again and fails unless missing, changed, collision, and approved stale
retirement counts reconcile to the plan.

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

- `runId`, timestamps, duration, package ID, package integrity, artifact counts, and source locations.
- `create`: package checks not found in Forward.
- `unchanged`: package checks already present with the same generated fingerprint.
- `changed`: same key/name exists, but generated fields differ.
- `stale`: Dynatrace-managed Forward checks no longer present in the package.
- `collision`: a name or source key conflicts with a check outside the exact ownership tuple.
- `mutationOutcomes` and `mutationFailure`: per-key completed writes and the bounded recovery scope for a stopped
  apply. These remain in the private Forward-side report.
- `postApplyVerification`: the aggregate readback reconciliation proving whether the apply reached its approved state.

The metrics file includes planned-check count, reconciliation counts, mutation counts, duration, and signature
verification state in Prometheus text format.

The status artifact is a sanitized `forward-dynatrace-status/v1` JSON summary intended for read-only display in
Dynatrace after Forward-side ingest. It includes run ID, package ID, mode, import state, signature status, target IDs,
counts, planned-check count, optional NQE counts, duration, post-apply verification state, and a sanitized
mutation-failure summary. It does not
include source keys, check IDs, check names, hostnames, dependency rows, credentials, or Forward API response bodies.

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
  --package-token-file /etc/forward-dynatrace/handoff-read-token \
  --report forward-import-report.json \
  --fail-on-drift
```

`--package-url` pulls:

- `forward-dynatrace-manifest.json`
- `forward-intent-checks.json`
- `forward-nqe-checks.json` when listed by the manifest
- `forward-nqe-diff-requests.json` when listed by the manifest

The checked handoff requires a distinct read identity. `--package-token-file` reads that dedicated Bearer token from a
protected file and sends it only to HTTPS artifact URLs under the exact `--package-url` origin and path. It is never
sent to an override on another origin or sibling path. Inline `packageToken` connector fields, URL credentials, query
tokens, and fragments are rejected. The non-secret connector key is `packageTokenFile`.

Non-local package URLs must use HTTPS. The importer validates the manifest schema, package type, generated timestamp,
intent-check count, optional NQE counts, package checksum, credential policy, dedupe requirement, query ID allowlists,
and create-missing-only reconciliation policy before any Forward API call.

For scheduled automation, put non-secret runtime settings in a connector config:

```bash
cp config/forward-connector.config.example.json /secure/path/forward-connector.config.json
npm run forward:import -- --config /secure/path/forward-connector.config.json
```

The config may contain package URL, protected package-token file path, Forward base URL, network ID, batch size, retry
count, package age, drift policy, optional update/stale settings, report path, metrics path, and status artifact path.
It must not contain Forward user, password, token, a package token value, or other secrets; the importer rejects those
fields.

## Detached Signature Mode

Checksum validation detects accidental or unauthorized package-byte changes after manifest generation. For provenance,
add an Ed25519 detached signature:

```bash
npm run forward:sign -- \
  --checks forward-intent-checks.json \
  --manifest forward-dynatrace-manifest.json \
  --nqe-checks forward-nqe-checks.json \
  --nqe-diff-requests forward-nqe-diff-requests.json \
  --private-key /secure/path/forward-dynatrace-private.pem \
  --signature forward-dynatrace-package.sig
```

Omit the NQE flags when the manifest does not list NQE artifacts.

Verify during import:

```bash
npm run forward:import -- \
  --checks forward-intent-checks.json \
  --manifest forward-dynatrace-manifest.json \
  --nqe-checks forward-nqe-checks.json \
  --nqe-diff-requests forward-nqe-diff-requests.json \
  --nqe-query-id-allowlist FQ_aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa \
  --signature forward-dynatrace-package.sig \
  --public-key /secure/path/forward-dynatrace-public.pem \
  --require-signature \
  --validate-only
```

For connector pull mode, use `config/forward-connector.signed.config.example.json`. Keep the private key outside the
runtime that imports packages.
