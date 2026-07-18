# Optional NQE Artifacts

The base integration does not require NQE checks or NQE diffs. Use this path only when the customer has Forward-owned
NQE Library query IDs that should be parameterized from Dynatrace application metadata.

## Boundaries

- Forward owns and reviews NQE Library query content.
- Dynatrace supplies package metadata and parameters such as application and environment.
- The Dynatrace app does not commit NQE queries and does not write to Forward.
- Forward-side import validates every optional NQE artifact against an explicit query ID allowlist.

## Persistent NQE Checks

Generate optional persistent NQE checks:

```bash
npm run forward:package -- \
  --dependencies normalized-dependencies.json \
  --output-dir /tmp/forward-dynatrace-package \
  --nqe-query-id FQ_aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa
```

This adds:

- `forward-nqe-checks.json`
- `artifacts.nqeChecks`
- `integrity.nqeChecksSha256`
- `nqeChecks.queryIdPolicy = forward-owned-allowlist`

Import requires:

```bash
npm run forward:import -- \
  --checks forward-intent-checks.json \
  --manifest forward-dynatrace-manifest.json \
  --nqe-checks forward-nqe-checks.json \
  --nqe-query-id-allowlist FQ_aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa \
  --validate-only
```

With `--apply`, missing NQE checks are created through the same Forward checks bulk endpoint. Changed/stale NQE checks
follow the same report-only default and optional approval-gated mutation workflow as intent checks.

## NQE Diff Requests

Generate optional diff request metadata:

```bash
npm run forward:package -- \
  --dependencies normalized-dependencies.json \
  --output-dir /tmp/forward-dynatrace-package \
  --nqe-diff-query-id FQ_aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa \
  --nqe-diff-before-snapshot-id <before-snapshot-id> \
  --nqe-diff-after-snapshot-id <after-snapshot-id>
```

This adds:

- `forward-nqe-diff-requests.json`
- `artifacts.nqeDiffRequests`
- `integrity.nqeDiffRequestsSha256`
- `nqeDiffRequests.executionPolicy = read-only-forward-side-optional`

The importer validates and reports diff request metadata. It does not execute diffs. A Forward-side read-only workflow
can execute approved requests with:

```text
POST /api/nqe-diffs/{before}/{after}
```

## Signing

When optional NQE artifacts are present, include them in the detached package signature:

```bash
npm run forward:sign -- \
  --checks forward-intent-checks.json \
  --manifest forward-dynatrace-manifest.json \
  --nqe-checks forward-nqe-checks.json \
  --nqe-diff-requests forward-nqe-diff-requests.json \
  --private-key /secure/path/forward-dynatrace-private.pem \
  --signature forward-dynatrace-package.sig
```

Omit NQE flags when the manifest does not list NQE artifacts.
