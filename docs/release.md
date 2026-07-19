# Release Process

Every tag publishes one installable product: the tenant-validated Forward for Dynatrace app archive.

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
git tag -a v0.12.0 -m "Forward for Dynatrace v0.12.0"
git push origin v0.12.0
```

Tags beginning with `v0.` are GitHub prereleases. The tag workflow validates that no prior workflow or release state
exists for the version, runs every release gate, builds a tenant-validated app archive, generates the SBOM and
checksums, optionally signs the checksum file, attests every file, and publishes the release.

Required Actions secrets:

- `DT_APP_ENVIRONMENT_URL`
- `DT_APP_OAUTH_CLIENT_ID`
- `DT_APP_OAUTH_CLIENT_SECRET`
- optional `RELEASE_SIGNING_PRIVATE_KEY_PEM`

## Independent Verification

```bash
npm run release:published:verify -- \
  --release-name v0.12.0 \
  --repository forwardnetworks/forward-dynatrace \
  --output-dir /secure/evidence/forward-dynatrace-v0.12.0
```

The output directory must be new or empty. The verifier checks exact asset membership, checksums, optional signature,
SBOM identity, tag source, release workflow run, and per-artifact GitHub attestation.

## Immutability Policy

Published tags, releases, and release workflow evidence are immutable. Never move, delete, or recreate a published
version as part of normal release engineering. Any source, metadata, or artifact change requires a new semantic version.
