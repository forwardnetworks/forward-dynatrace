# Release Provenance

This project publishes release evidence that a customer security or platform team can verify before installing the
Dynatrace app or running the Forward-side importer.

## Release Artifacts

Every tag release publishes:

- `forward-dynatrace-app-<tag>.tgz`
- `forward-dynatrace-importer-<tag>.tgz`
- `forward-dynatrace-sbom-<tag>.cdx.json`
- `SHA256SUMS`

When the repository secret `RELEASE_SIGNING_PRIVATE_KEY_PEM` is configured, the release also publishes:

- `SHA256SUMS.sig`
- `SHA256SUMS.pub`

The signing key is a self-managed Ed25519 key. It is intentionally separate from any Forward intent-package signing
key. The private key must stay in the release secret manager and must not be committed to this repository.

## Generate A Self-Managed Key

Generate the keypair on a controlled workstation or build-secret host:

```bash
npm run release:signing-key:generate -- \
  --output-dir /secure/path/forward-dynatrace-release-signing
```

Store `release-ed25519-private.pem` as the GitHub Actions secret `RELEASE_SIGNING_PRIVATE_KEY_PEM`. Keep
`release-ed25519-public.pem` as the public verifier. The release workflow also emits `SHA256SUMS.pub` so a verifier can
match the release signature to the public key used for that release.

## Verify A Release

Verify checksums:

```bash
sha256sum -c SHA256SUMS
```

If signature files are present, verify the checksum signature before trusting `SHA256SUMS`:

```bash
npm run release:sign -- \
  --verify \
  --checksums SHA256SUMS \
  --public-key SHA256SUMS.pub \
  --signature SHA256SUMS.sig
```

## GHCR Importer Image

Tag releases publish the Forward-side importer image to:

```text
ghcr.io/forwardnetworks/forward-dynatrace-importer:<tag>
```

Pin production deployments by digest instead of `latest`:

```bash
docker pull ghcr.io/forwardnetworks/forward-dynatrace-importer:<tag>
docker image inspect ghcr.io/forwardnetworks/forward-dynatrace-importer:<tag> \
  --format '{{index .RepoDigests 0}}'
```

Use the digest form in Kubernetes or other scheduled runtimes after acceptance:

```text
ghcr.io/forwardnetworks/forward-dynatrace-importer@sha256:<digest>
```

## Attestations

The release workflow emits GitHub artifact attestations for release files and the GHCR importer image. These
attestations are release provenance signals; they do not replace customer change approval, package signature
verification, or the Forward-side dry-run gate.

## Verification Order

1. Confirm the GitHub release tag and workflow run.
2. Verify `SHA256SUMS`.
3. Verify `SHA256SUMS.sig` when present.
4. Review the SBOM.
5. Pull the GHCR image by tag, record its digest, and deploy by digest.
6. Run the Forward-side dry-run before enabling `--apply`.
