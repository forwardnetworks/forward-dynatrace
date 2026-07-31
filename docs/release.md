# Release Process

Every tag publishes one installable product: the Forward for Dynatrace app archive.

## Release Contents

- `forward-dynatrace-app-<tag>.zip` — Dynatrace AppEngine upload archive
- `forward-dynatrace-sbom-<tag>.cdx.json` — CycloneDX software bill of materials
- `SHA256SUMS` — exact app and SBOM digests
- `SHA256SUMS.sig` and `SHA256SUMS.pub` — optional detached checksum signature
- GitHub artifact attestations — workflow, commit, runner, subject name, and digest provenance

The project does not publish a Forward runtime, container image, operating-system package, or Python package.

## Create A Prerelease

1. Update `package.json`, `package-lock.json`, and `app.config.json` to the same semantic version.
2. Add `docs/releases/v<version>.md` with operator-facing release notes.
3. Run the complete local gate.
4. Create and push an annotated tag only after `main` passes CI.

```bash
npm ci
npm run ci
git tag -a v0.13.1 -m "Forward for Dynatrace v0.13.1"
git push origin v0.13.1
```

Tags beginning with `v0.` are GitHub prereleases. The tag workflow validates that no prior workflow or release state
exists for the version, runs every release gate, builds the app archive with the repository's exact pinned Dynatrace
toolkit, generates the SBOM and checksums, optionally signs the checksum file, attests every file, and publishes the
release. Archive publication is tenant-independent; installation remains an authenticated tenant operation.

Optional Actions secret:

- `RELEASE_SIGNING_PRIVATE_KEY_PEM` for the detached `SHA256SUMS` signature

## Independent Verification

```bash
npm run release:published:verify -- \
  --release-name v0.13.1 \
  --repository forwardnetworks/forward-dynatrace \
  --output-dir /secure/evidence/forward-dynatrace-v0.13.1
```

The output directory must be new or empty. The verifier checks exact asset membership, checksums, optional signature,
SBOM identity, tag source, release workflow run, and per-artifact GitHub attestation.

## Immutability Policy

Published tags, releases, and release workflow evidence are immutable. Never move, delete, or recreate a published
version as part of normal release engineering. Any source, metadata, or artifact change requires a new semantic version.
