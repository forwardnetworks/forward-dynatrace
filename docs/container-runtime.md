# Forward Importer Container

`Dockerfile.forward-importer` packages the Forward-side importer, atomic handoff publisher and authenticated ingress,
read-only evidence tools, check-health poller, and security correlator. It does not
include the Dynatrace app dev/build runtime.

The image removes `npm` and `npx` after copying runtime files. The importer uses Node built-ins and local scripts at
runtime, so package-manager tooling is not required in the shipped image.

For the authenticated handoff, mount the dedicated read token as a file and set connector key `packageTokenFile` to
that in-container path. The checked Docker Compose example uses `/run/secrets/handoff-read-token`; the Kubernetes
example projects only the `handoff-read-token` Secret key into `/etc/forward-dynatrace-secrets`.

## Build

```bash
docker build -f Dockerfile.forward-importer -t forward-dynatrace-importer:local .
```

## Release Image

Tag releases publish the importer image to GHCR:

```bash
docker pull ghcr.io/forwardnetworks/forward-dynatrace-importer:<tag>
docker image inspect ghcr.io/forwardnetworks/forward-dynatrace-importer:<tag> \
  --format '{{index .RepoDigests 0}}'
```

For production or customer pilots, deploy a digest-pinned image rather than `latest`. The following digest is retained
only as the reproducible legacy base-workflow image from release run `28696863169`:

```text
ghcr.io/forwardnetworks/forward-dynatrace-importer@sha256:7f884e44a2b54303d7da708bc805f0e16c1d19b192f95a90e94a63aad66bb7c6
```

The checked Docker Compose and Kubernetes examples default to this legacy digest until `v2.0.0` is published. The
historical `v1.0.0` tag was reused across three commits, so this digest does not constitute immutable release proof.
Override it only with the output of the checked verifier for a new immutable release after verifying checksums,
attestations, SBOM, and Trivy SARIF.

The new handoff/check-health/security/Flow commands require the next release image; the `v1.0.0` digest predates them.
Check-health templates therefore require an explicitly replaced digest placeholder until that release exists.

Release provenance, SBOM, and signature verification details are in
[release-provenance.md](release-provenance.md).

## Validate Package

Mount a package directory and run validation without Forward credentials:

```bash
docker run --rm \
  -v "$PWD/package:/package:ro" \
  forward-dynatrace-importer:local \
  --checks /package/forward-intent-checks.json \
  --manifest /package/forward-dynatrace-manifest.json \
  --validate-only
```

## Readiness Check

Run the deployment readiness wrapper before enabling scheduled import:

```bash
docker run --rm \
  --entrypoint node \
  -v "$PWD/package:/package:ro" \
  forward-dynatrace-importer:local \
  scripts/forward-deployment-readiness.mjs \
  --checks /package/forward-intent-checks.json \
  --manifest /package/forward-dynatrace-manifest.json
```

## Connector Mode

Mount a non-secret connector config and inject Forward credentials from the runtime secret store:

```bash
docker run --rm \
  -e FORWARD_USER=<user> \
  -e FORWARD_PASSWORD=<password-or-token> \
  -v "/secure/path/forward-connector.config.json:/config/forward-connector.config.json:ro" \
  forward-dynatrace-importer:local \
  --config /config/forward-connector.config.json
```

Do not bake Forward credentials into the image or config file.
For signed packages, mount the trusted public key and use a config based on
`config/forward-connector.signed.config.example.json`.

## Additional Runtime Commands

The dispatcher exposes:

- `forward-package-publish`: validate and atomically publish immutable package bytes;
- `forward-handoff-server`: accept exact package bytes from the Dynatrace action and serve allowlisted bytes to a
  separate read identity;
- `forward-check-health`: poll managed Forward checks and publish bounded transitions;
- `security-correlate`: build a ranked queue from approved evidence files;
- `dynatrace-security-publish`: publish the bounded correlation event batch.

Each command preserves the documented read/write boundary and is covered by `npm run runtime:entrypoint:test`.

For scheduled operation, use Docker Compose, systemd, or Kubernetes templates in
[connector-runtime.md](connector-runtime.md). Deployment gate details are in
[deployment-readiness.md](deployment-readiness.md).
