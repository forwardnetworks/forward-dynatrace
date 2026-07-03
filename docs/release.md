# Release

This repository releases source, docs, a built Dynatrace app bundle, and Forward-side importer assets through GitHub
Actions. It is not published to PyPI.

## Release Flow

1. Update versions in `package.json`, `package-lock.json`, and `app.config.json`.
2. Run:

   ```bash
   npm run ci
   git diff --check
   ```

3. Tag the release:

   ```bash
   git tag v1.0.10
   git push origin v1.0.10
   ```

4. The `release` workflow builds with Node 24, runs `npm run ci`, runs `npm run release:package`, uploads workflow
   artifacts, and publishes a GitHub release for tag pushes.

For a local archive smoke test after `npm run build`:

```bash
npm run release:package:smoke
```

## Artifacts

- `forward-dynatrace-app-<tag>.tgz`: built Dynatrace app assets plus install, workflow trigger, workflow, and
  contract docs.
- `forward-dynatrace-importer-<tag>.tgz`: Forward-side importer, signer, container file, config examples, and
  runtime templates and operations docs.
- `SHA256SUMS`: SHA-256 digests for release archives.
- Optional `SHA256SUMS.sig`: detached Ed25519 signature over the checksum file. The release signing key must be
  separate from Forward intent-package signing keys.

## Verification

Before installing release artifacts, verify checksums:

```bash
sha256sum -c SHA256SUMS
```

If release checksum signing is used, verify the detached signature before trusting `SHA256SUMS`:

```bash
npm run release:sign -- \
  --verify \
  --checksums SHA256SUMS \
  --public-key /secure/path/release-ed25519-public.pem \
  --signature SHA256SUMS.sig
```

To sign a release checksum file:

```bash
npm run release:sign -- \
  --checksums SHA256SUMS \
  --private-key /secure/path/release-ed25519-private.pem \
  --signature SHA256SUMS.sig
```

Keep release signing keys outside the repo and separate from exported Forward intent-package signing keys.
