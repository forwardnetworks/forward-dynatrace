# Package Handoff

The package handoff is the storage boundary between Dynatrace package generation and Forward-side import. It must be
read-only from the importer perspective and must keep enough evidence to replay or audit an import.

## Required Controls

- HTTPS-only retrieval outside local tests.
- Immutable package path per package ID.
- Stable `latest/` pointer only after manifest, intent checks, and optional signature are fully written.
- Optional NQE artifacts are written before the manifest points to them.
- Object retention aligned with Forward change evidence retention.
- Access logs for reads and writes.
- Write access limited to the Dynatrace package publisher or approved CI job.
- Read access limited to the Forward-side importer runtime and reviewers.
- No Forward credentials, session tokens, or personal identifiers in stored package artifacts.

## Recommended Layout

```text
dynatrace-forward/
  packages/
    <package-id>/
      forward-dynatrace-manifest.json
      forward-intent-checks.json
      forward-nqe-checks.json
      forward-nqe-diff-requests.json
      forward-dynatrace-package.sig
      forward-ingest-status.json
  latest/
    forward-dynatrace-manifest.json
    forward-intent-checks.json
    forward-nqe-checks.json
    forward-nqe-diff-requests.json
    forward-dynatrace-package.sig
```

Use immutable package ID paths for audit. Use `latest/` only for scheduled connector convenience.

## Publish Order

1. Write intent checks to the immutable package ID path.
2. Write optional NQE checks and NQE diff requests to the immutable package ID path.
3. Write manifest to the immutable package ID path after all referenced artifacts exist.
4. Write detached signature when signing is enabled.
5. Verify checksum and signature from the handoff location.
6. Update `latest/` atomically or by pointer after verification.
7. Let the Forward-side importer pull from the immutable package URL or from `latest/`.
8. Publish sanitized `forward-ingest-status.json` only after Forward-side ingest finishes.

## Storage Options

Acceptable implementations include an internal object store, artifact repository, CI artifact with retention and access
logs, or customer-controlled storage with equivalent controls. Do not use a shared desktop folder, email attachment, or
chat upload as the production handoff.
