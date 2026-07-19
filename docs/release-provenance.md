# Release Provenance

The release boundary contains one tenant-validated Dynatrace app archive and its verification evidence.

## Evidence Chain

1. The tag resolves to one commit.
2. Exactly one successful release workflow run exists for that tag and commit.
3. `SHA256SUMS` names exactly the app archive and CycloneDX SBOM.
4. The optional Ed25519 signature authenticates the checksum file.
5. GitHub artifact attestations bind every published file to the exact tag, commit, hosted runner, workflow, run ID,
   subject name, and SHA-256 digest.
6. The repository verifier writes a bounded `published-release-verification.json` report.

## Independent Verification

```bash
mkdir forward-dynatrace-release && cd forward-dynatrace-release
gh release download <tag> --repo forwardnetworks/forward-dynatrace
sha256sum -c SHA256SUMS
gh attestation verify forward-dynatrace-app-<tag>.zip \
  --repo forwardnetworks/forward-dynatrace
gh attestation verify forward-dynatrace-sbom-<tag>.cdx.json \
  --repo forwardnetworks/forward-dynatrace
```

When signature files are present:

```bash
npm run release:sign -- \
  --verify \
  --checksums SHA256SUMS \
  --public-key SHA256SUMS.pub \
  --signature SHA256SUMS.sig
```

Published tags are immutable. If any release or workflow evidence already exists for a version, increment the version.
