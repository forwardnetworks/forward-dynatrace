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
      forward-ingest-status.sha256
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
8. Publish sanitized `forward-ingest-status.json` and `forward-ingest-status.sha256` only after Forward-side ingest
   finishes:

   ```bash
   node scripts/publish-forward-status.mjs \
     --status forward-ingest-status.json \
     --output-dir /handoff/dynatrace-forward/latest
   ```

## Checked Filesystem Publisher

For a mounted customer-controlled handoff filesystem, use the checked publisher:

```bash
npm run forward:handoff:publish -- \
  --package-dir /secure/generated-package \
  --handoff-root /srv/forward-dynatrace-handoff \
  --require-signature
```

The publisher validates package shape, checksums, freshness, optional NQE artifacts, and signature presence before
writing. It creates `packages/<package-id>/` once, rejects same-ID byte changes, and atomically repoints `latest` with a
relative symlink only after all bytes are durable. Re-publishing identical bytes is idempotent. Known sanitized status
sidecars may be added after ingest; unknown extra files still make immutable-ID reuse fail closed.

`npm run forward:handoff:test` covers first publish, idempotent retry, immutable-ID conflict, atomic latest behavior,
and required-signature rejection. Signature cryptographic verification remains an importer gate using the configured
trusted public key.

## Storage Options

Acceptable implementations include an internal object store, artifact repository, CI artifact with retention and access
logs, or customer-controlled storage with equivalent controls. Do not use a shared desktop folder, email attachment, or
chat upload as the production handoff.

The checked publisher covers filesystem-backed handoff. Customer deployment still owns HTTPS/object-store exposure,
access logging, retention, backup, and identity policy.
