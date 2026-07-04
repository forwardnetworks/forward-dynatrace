# Forward Dynatrace

Forward Dynatrace is a Forward Field Integration that turns Dynatrace application dependency evidence into
Forward-reviewed network intent-check packages.

The integration keeps the write boundary explicit: the Dynatrace app exports desired state, and Forward-side tooling
validates, reconciles, and applies approved changes. The Dynatrace app does not write to Forward and does not store
Forward credentials.

## Status

- Release: `v1.0.0`
- Runtime: Node.js 24.x
- Distribution: GitHub release artifacts and GHCR importer image
- Support model: field integration reference, not an officially supported Forward product integration
- License: ISC

## What It Does

- Reads Dynatrace service dependency evidence: application, environment, source, destination, protocol, port, owner,
  criticality, confidence, and mapping state.
- Builds deterministic Forward `NewNetworkCheck[]` intent-check packages with `dynatrace-key:*` reconciliation tags.
- Holds unresolved or ambiguous dependencies before Forward writes.
- Supports bulk create-missing-only imports through a Forward-side importer or scheduled connector.
- Optionally emits Forward NQE check and diff artifacts using Forward-controlled query IDs and allowlists.
- Publishes sanitized aggregate status back to Dynatrace for import state, counts, drift, signature state, and failures.

## What It Does Not Do

- The Dynatrace app does not mutate Forward.
- Dynatrace does not store Forward credentials.
- The importer does not auto-approve changed or stale Forward checks.
- Status events do not include Forward credentials, hostnames, check names, dependency rows, or Forward API response
  bodies.

## Architecture

```text
Dynatrace topology evidence
        |
        v
Dynatrace app export package
        |
        v
Forward-side validation and reconciliation
        |
        v
Forward intent checks, after operator approval
        |
        v
Sanitized status returned to Dynatrace
```

The production path is intentionally Forward-centric. Dynatrace provides dependency intent; Forward validates that the
dependencies match the target network snapshot before any persistent checks are created.

## Quick Start

```bash
git clone https://github.com/forwardnetworks/forward-dynatrace.git
cd forward-dynatrace
git checkout v1.0.0
npm ci
npm run ci
npm run acceptance:bundle -- \
  --dependencies shared/demo-dependencies.json \
  --output-dir out/acceptance \
  --sync-mode data-connector
```

The acceptance bundle is read-only. It builds a demo package, validates schemas and package integrity, writes
`ACCEPTANCE.md`, and does not contact Forward.

## Dynatrace App Install

For an unsigned trial or development install, use a `my.*` app ID:

```bash
npm run dynatrace:deploy -- \
  --environment-url https://your-environment-id.apps.dynatrace.com/ \
  --app-id my.forwardnetworks.dynatrace.field.integration \
  --no-open \
  --non-interactive
```

For an enterprise install with the default `com.forwardnetworks.dynatrace.field.integration` app ID, use
`--sign-archive` and provide Dynatrace App Toolkit signing OAuth credentials. Full install details are in
[docs/install.md](docs/install.md).

## Forward Import Workflow

Manual import is the first production-safe workflow because Forward writes happen only after a Forward operator reviews
the package.

1. Export or publish these artifacts from Dynatrace:
   - `forward-dynatrace-manifest.json`
   - `forward-intent-checks.json`
   - optional `forward-nqe-checks.json`
   - optional `forward-nqe-diff-requests.json`
2. Move or expose the package to a Forward-controlled runtime.
3. Validate without Forward credentials:

   ```bash
   npm run forward:import -- \
     --checks forward-intent-checks.json \
     --manifest forward-dynatrace-manifest.json \
     --validate-only
   ```

4. Dry-run against Forward:

   ```bash
   export FORWARD_BASE_URL=https://forward.example.com
   export FORWARD_USER=<user>
   export FORWARD_PASSWORD=<password-or-token>
   export FORWARD_NETWORK_ID=<network-id>

   npm run forward:import -- \
     --checks forward-intent-checks.json \
     --manifest forward-dynatrace-manifest.json \
     --report forward-import-report.json
   ```

5. Review create, unchanged, changed, stale, blocked, and failed rows.
6. Apply missing checks only after approval:

   ```bash
   npm run forward:import -- \
     --checks forward-intent-checks.json \
     --manifest forward-dynatrace-manifest.json \
     --apply
   ```

Scheduled automation uses the same importer from a Forward-side runtime with Forward credentials stored outside
Dynatrace. See [docs/forward-importer.md](docs/forward-importer.md) and
[docs/connector-runtime.md](docs/connector-runtime.md).

## Release Verification

Before installing or running release artifacts, verify the release:

```bash
gh release download v1.0.0 --repo forwardnetworks/forward-dynatrace
sha256sum -c SHA256SUMS
npm run release:sign -- \
  --verify \
  --checksums SHA256SUMS \
  --public-key SHA256SUMS.pub \
  --signature SHA256SUMS.sig
gh attestation verify forward-dynatrace-importer-v1.0.0.tgz \
  --repo forwardnetworks/forward-dynatrace
gh attestation verify oci://ghcr.io/forwardnetworks/forward-dynatrace-importer:v1.0.0 \
  --owner forwardnetworks
```

Verified importer image:

```text
ghcr.io/forwardnetworks/forward-dynatrace-importer@sha256:7f884e44a2b54303d7da708bc805f0e16c1d19b192f95a90e94a63aad66bb7c6
```

Release provenance, SBOM, Trivy scan evidence, and digest pinning guidance are in
[docs/release-provenance.md](docs/release-provenance.md) and [docs/container-runtime.md](docs/container-runtime.md).

## Screenshots

![Forward Dynatrace overview](docs/assets/screenshots/01-overview.jpg)

![Forward read-only NQE preview](docs/assets/screenshots/02-export-package-readiness.jpg)

![Forward-side API sequence](docs/assets/screenshots/03-forward-side-api.jpg)

![Forward intent check payload](docs/assets/screenshots/04-intent-check-payload.jpg)

## Development

Common commands:

```bash
npm run repo:validate
npm run schemas:validate
npm run forward:import:test
npm run forward:package:test
npm run runtime:validate
npm run demo:rehearsal
npm run security:audit
npm run lint
npm run build
npm run ci
```

`npm run ci` is the local equivalent of the GitHub Actions `gitops` workflow.

For Dynatrace API smoke checks, keep platform tokens outside the repository and pass them with `DYNATRACE_TOKEN`,
`DYNATRACE_TOKEN_FILE`, or `--token-file`. Do not commit tenant URLs, access tokens, OAuth callback URLs, Forward
credentials, customer hostnames, or customer-specific references.

## Documentation

Start here:

- [docs/customer-one-pager.md](docs/customer-one-pager.md): customer-facing summary and verification commands
- [docs/workflow.md](docs/workflow.md): end-to-end Dynatrace-to-Forward workflow
- [docs/install.md](docs/install.md): install and release model
- [docs/forward-ingest-contract.md](docs/forward-ingest-contract.md): package contract consumed by Forward-side tooling
- [docs/forward-importer.md](docs/forward-importer.md): importer behavior, reconciliation, and approval gates
- [docs/forward-nqe-preview.md](docs/forward-nqe-preview.md): optional read-only NQE preview path
- [docs/connector-runtime.md](docs/connector-runtime.md): scheduled connector deployment templates
- [docs/production-readiness.md](docs/production-readiness.md): production readiness checklist
- [docs/validation-matrix.md](docs/validation-matrix.md): tested evidence and remaining validation notes
- [docs/prospect-talk-track.md](docs/prospect-talk-track.md): prospect and customer talk track

Repository layout:

```text
api/       Dynatrace app functions
config/    importer and connector config examples
deploy/    Docker Compose, Kubernetes, systemd, DQL, dashboard, and workflow templates
docs/      implementation, operation, security, release, and customer-facing docs
schemas/   JSON Schema contracts
scripts/   package builder, importer, validators, release tools, and test helpers
shared/    demo dependencies and sanitized status fixtures
ui/        Dynatrace app UI
```

## Security

The repository includes guardrails for tenant/customer data hygiene, schema validation, package signatures, release
checksums, attestations, SBOM generation, Trivy image scanning, and Forward-side create-missing-only defaults.

Relevant documents:

- [docs/data-handling.md](docs/data-handling.md)
- [docs/rbac.md](docs/rbac.md)
- [docs/package-handoff.md](docs/package-handoff.md)
- [docs/threat-model.md](docs/threat-model.md)
- [docs/governance.md](docs/governance.md)

## License

This project is licensed under the ISC License. See [LICENSE](LICENSE).
