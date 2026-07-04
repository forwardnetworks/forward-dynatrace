# Forward Importer Container

`Dockerfile.forward-importer` packages only the Forward-side importer and connector config example. It does not include
the Dynatrace app dev/build runtime.

The image removes `npm` and `npx` after copying runtime files. The importer uses Node built-ins and local scripts at
runtime, so package-manager tooling is not required in the shipped image.

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

For production or customer pilots, deploy the digest-pinned image rather than `latest`:

```text
ghcr.io/forwardnetworks/forward-dynatrace-importer@sha256:<digest>
```

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

For scheduled operation, use Docker Compose, systemd, or Kubernetes templates in
[connector-runtime.md](connector-runtime.md). Deployment gate details are in
[deployment-readiness.md](deployment-readiness.md).
