# Schema Versioning

The current package schema is `forward-dynatrace/v1`.

Formal JSON Schemas live in `schemas/` and are validated by `npm run schemas:validate`. They define the package-boundary
contract for manifests, generated checks, connector configs, approval artifacts, and status telemetry. The Forward-side
importer remains the enforcement point for runtime controls such as age limits, checksums, signatures, query ID
allowlists, and mutation budgets.

## Sole-Version Rules

- This release reads and writes only `forward-dynatrace/v1`.
- `v1` is strict: unknown fields and unsupported schema versions are rejected before any Forward call.
- There is no alternate reader, compatibility mode, conversion path, or migration code.
- Any future contract requires an explicit product decision and a new execution plan before code is added. It does not
  silently extend or reinterpret `v1`.

## Current Required Contract

`forward-dynatrace/v1` requires:

- `schemaVersion = forward-dynatrace/v1`
- `packageType = forward-intent-import`
- `packageId`
- `generatedAt`
- `requestedIngestPath`
- `requestedForwardAccessProfile`
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
- `validation.managedByTag = managed-by:com.forward.dynatrace`
- `validation.contractVersionTag = contract-version:1`
- `validation.sourceInstanceTagPrefix = source-instance:`
- `validation.sourceKeyTagPrefix = source-key:sha256:`
- `validation.ownershipTagsPerCheck = 4`
- `validation.identityPolicy = strict-ownership-tuple`
- `validation.credentialPolicy = no-forward-credentials-in-dynatrace`
- `reconciliation.defaultApplyPolicy = create-missing-only`
- `reconciliation.changedChecks = report-only`
- `reconciliation.staleChecks = report-only`

Generated `packageId` values use the full millisecond timestamp plus a digest of every variable manifest-identity
field, including the requested Forward access profile. Two manifests with different policy or target metadata cannot
claim the same immutable handoff path even when their `NewNetworkCheck[]` bytes are identical.

`forward-dynatrace/v1` includes these explicitly modeled optional artifacts:

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

## Future Version Gate

A second version is not part of this release. If product owners approve one later, first define its support window,
upgrade ownership, downgrade behavior, audit evidence, and removal criteria in a dedicated execution plan. Until that
decision is complete, the importer continues to reject every version other than `v1`.
