# Forward Importer Container

`Dockerfile.forward-importer` packages the Forward-side importer, atomic handoff publisher and authenticated ingress,
read-only evidence tools, check-health poller, security correlator, and ServiceNow change-assurance worker. It does not
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

For production or customer pilots, deploy the digest-pinned image rather than `latest`:

```text
ghcr.io/forwardnetworks/forward-dynatrace-importer@sha256:7f884e44a2b54303d7da708bc805f0e16c1d19b192f95a90e94a63aad66bb7c6
```

The checked Docker Compose and Kubernetes examples default to this verified `v1.0.0` digest. Override it only after
verifying the replacement release checksums, attestations, SBOM, and Trivy SARIF.

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

## ServiceNow Change Assurance

The runtime dispatcher preserves importer arguments as the default and exposes named ServiceNow commands without
requiring `npm` in the image. Mount one protected evidence directory and invoke the two phases with
`servicenow-change-workflow`:

```bash
docker run --rm \
  -e SERVICENOW_BASE_URL=https://your-instance.service-now.com \
  -e SERVICENOW_USER=<read-only-integration-user> \
  -e SERVICENOW_PASSWORD=<runtime-secret> \
  -e FORWARD_BASE_URL=https://forward.example.com \
  -e FORWARD_READONLY_AUTHORIZATION=<runtime-secret> \
  -v "/secure/evidence:/evidence" \
  forward-dynatrace-importer:local \
  servicenow-change-workflow --phase start \
  --change-number CHG0042187 --deployment-id deployment-1 \
  --network-id network-production --service-entity-id SERVICE-CHECKOUT-API \
  --dependencies /evidence/dynatrace-dependencies.json \
  --evidence-source live-customer-dependencies --output-dir /evidence/change
```

The `complete` phase uses the same named command with `--state` and `--context` and also requires the existing
`FORWARD_USER`/`FORWARD_PASSWORD` credential path for read-only reconciliation. Use a secret-file or platform secret in
production rather than literal environment values shown as placeholders here. If `--publish-servicenow` is enabled,
use a separate feedback credential with only the companion package's `x_fwd_demo.assurance_writer` role; publication
targets its authenticated assurance-ledger endpoint rather than generic table APIs. Add
`--verify-servicenow-retry` only for a non-production acceptance run that must confirm the second request reuses the
same work-note and attachment sys_ids. Run only one active conductor for a given change/evidence directory.
Add `--synthetic` when any input is replay/demo evidence; the persisted state and final Dynatrace event retain the
explicit source and synthetic flag.

For scheduled operation, use Docker Compose, systemd, or Kubernetes templates in
[connector-runtime.md](connector-runtime.md). Deployment gate details are in
[deployment-readiness.md](deployment-readiness.md).

## Purchase-Free Flow Designer Worker

Run the named `servicenow-flow-server` command to expose asynchronous start/status/complete routes from this same
image. Bind port `8080` only to a private interface or TLS reverse proxy, mount a durable
`SERVICENOW_FLOW_RUN_DIR`, and configure dedicated Basic credentials. The ServiceNow client refuses HTTP and requires
an exact origin allowlist. Full configuration and API contracts are in
[servicenow-flow-worker.md](servicenow-flow-worker.md).
