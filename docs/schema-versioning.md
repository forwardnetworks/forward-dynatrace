# Schema Versioning

The current package schema is `forward-dynatrace/v1`.

## Compatibility Rules

- `forward-dynatrace/v1` remains backward compatible for additive optional fields.
- Required field changes require a new schema version.
- Changed meaning for an existing field requires a new schema version.
- Removing a field requires a new schema version.
- The importer must reject unknown major schema versions before contacting Forward.
- Migration tests must cover every supported previous schema version before release.

## Current Required Contract

`forward-dynatrace/v1` requires:

- `schemaVersion = forward-dynatrace/v1`
- `packageType = forward-intent-import`
- `packageId`
- `generatedAt`
- `source.platform = dynatrace`
- `source.writePolicy = dynatrace-never-writes-forward`
- `artifacts.manifest = forward-dynatrace-manifest.json`
- `artifacts.intentChecks = forward-intent-checks.json`
- `integrity.algorithm = sha256`
- `integrity.intentChecksSha256`
- `intentChecks.count`
- `intentChecks.checkType = Existential`
- `intentChecks.payloadShape = NewNetworkCheck[]`
- `intentChecks.bulkEndpoint = /api/snapshots/{snapshotId}/checks?bulk`
- `intentChecks.dedupeRequiredBeforePost = true`
- `validation.requiredTagPrefix = dynatrace-key:`
- `validation.requiredTagsPerCheck = 1`
- `validation.credentialPolicy = no-forward-credentials-in-dynatrace`
- `reconciliation.defaultApplyPolicy = create-missing-only`
- `reconciliation.changedChecks = report-only`
- `reconciliation.staleChecks = report-only`

`forward-dynatrace/v1` also allows additive optional fields:

- `artifacts.nqeChecks = forward-nqe-checks.json`
- `integrity.nqeChecksSha256`
- `nqeChecks.count`
- `nqeChecks.checkType = NQE`
- `nqeChecks.payloadShape = NewNetworkCheck[]`
- `nqeChecks.bulkEndpoint = /api/snapshots/{snapshotId}/checks?bulk`
- `nqeChecks.queryIdPolicy = forward-owned-allowlist`
- `artifacts.nqeDiffRequests = forward-nqe-diff-requests.json`
- `integrity.nqeDiffRequestsSha256`
- `nqeDiffRequests.count`
- `nqeDiffRequests.payloadShape = ForwardDynatraceNqeDiffRequest[]`
- `nqeDiffRequests.endpoint = /api/nqe-diffs/{before}/{after}`
- `nqeDiffRequests.queryIdPolicy = forward-owned-allowlist`
- `nqeDiffRequests.executionPolicy = read-only-forward-side-optional`

## Migration Checklist

For any future schema version:

1. Add an example manifest.
2. Add importer validation for the new version.
3. Add rejection tests for unsupported versions.
4. Add migration tests from the previous version.
5. Update `docs/forward-ingest-contract.md`.
6. Update `docs/validation-matrix.md`.
7. Keep old versions readable until the release notes explicitly retire them.
