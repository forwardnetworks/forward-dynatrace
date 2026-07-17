# Release

This repository releases source, docs, a built Dynatrace app bundle, and Forward-side importer assets through GitHub
Actions. It is not published to PyPI.

## Release Flow

1. Update versions in `package.json`, `package-lock.json`, and `app.config.json`.
2. Run:

   ```bash
   npm run ci
   npm run acceptance:bundle -- --dependencies shared/demo-dependencies.json --output-dir out/acceptance --source-instance-id dt-acceptance-rehearsal
   git diff --check
   ```

3. Validate and tag the release. The tag must exactly match the synchronized repository version:

   ```bash
   npm run release:ref:validate -- --release-name v<package-version>
   git tag v<package-version>
   git push origin v<package-version>
   ```

   The tag workflow repeats this validation and fails before packaging or publishing when `GITHUB_REF_NAME` differs
   from `package.json`, the root package-lock versions, or `app.config.json`.

   Before any release write, the workflow also runs `scripts/validate-release-immutability.mjs`. It fails closed when
   the tag has another release-workflow run, a GitHub release already uses the tag, the versioned GHCR tag already
   resolves, or registry absence cannot be proven. A failed or superseded release must use a new semantic version;
   never move or reuse its tag.

4. After the pre-publish immutability gate passes, the `release` workflow builds with Node 24, runs `npm run ci`, runs
   `npm run release:package`, optionally
   self-signs `SHA256SUMS`, uploads workflow artifacts, publishes the GHCR importer image, emits attestations, scans
   the image with Trivy SARIF output, fails on HIGH/CRITICAL findings, and publishes a GitHub release for tag pushes.
5. After a successful tag workflow, `verify-release` checks out the immutable release source and runs the checked
   published-release verifier. It uploads `published-release-verification.json` only after release asset membership,
   checksums, optional signature, SBOM identity, artifact and image attestations, GHCR digest, exact release workflow
   run, and zero-result Trivy SARIF all verify.

For a local archive smoke test after `npm run build`:

```bash
npm run release:package:smoke
```

## Artifacts

- `forward-dynatrace-app-<tag>.tgz`: built Dynatrace app assets plus install, workflow trigger, workflow, and
  contract docs.
- `forward-dynatrace-importer-<tag>.tgz`: Forward-side importer, signer, container file, config examples, and
  runtime templates and operations docs.
- `forward-dynatrace-sbom-<tag>.cdx.json`: CycloneDX SBOM for production dependencies.
- `SHA256SUMS`: SHA-256 digests for release archives.
- Optional `SHA256SUMS.sig` and `SHA256SUMS.pub`: detached Ed25519 signature over the checksum file and the matching
  public key for self-managed verification. The release signing key must be separate from Forward intent-package
  signing keys.
- `ghcr.io/forwardnetworks/forward-dynatrace-importer:<tag>`: Forward-side importer image for scheduled runtimes.
- Trivy SARIF workflow artifact: vulnerability scan evidence for the published importer image. HIGH/CRITICAL findings
  fail the release.

See [release-provenance.md](release-provenance.md) for the full verification path, GHCR digest pinning, and
self-managed signing key setup.

## Verification

Run the checked verifier from the matching release source before installing artifacts:

```bash
npm run release:published:verify -- \
  --release-name v<package-version> \
  --repository forwardnetworks/forward-dynatrace \
  --output-dir /secure/evidence/forward-dynatrace-v<package-version>
```

Add `--require-signature` when customer policy requires the optional self-managed checksum signature. The output
directory must be new or empty so stale files cannot satisfy the gate. The verifier performs no GitHub or registry
writes and emits a bounded JSON report with the exact release run ID, commit SHA, checksums, image digest, attestation
workflow invocations, SBOM component count, and Trivy result count. Attestations must bind the exact tag source,
`release.yml` signer, GitHub-hosted runner, workflow run, and subject digest. Any workflow history showing the same tag
on a different commit fails the immutable-release gate.

For an independent manual checksum check inside the downloaded directory:

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
  --signature SHA256SUMS.sig \
  --public-key-output SHA256SUMS.pub
```

Keep release signing keys outside the repo and separate from exported Forward intent-package signing keys.
