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
   git tag v1.0.6
   git push origin v1.0.6
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

## Verification

Before installing release artifacts, verify checksums:

```bash
sha256sum -c SHA256SUMS
```

If detached package signing is used for exported Forward intent-check packages, keep those signing keys separate from
GitHub release signing or artifact checksum handling.
