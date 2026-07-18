# Forward for Dynatrace

Forward for Dynatrace turns Dynatrace application dependency evidence into Forward-reviewed network intent-check
packages and publishes bounded Forward results back to Dynatrace.

Forward owns network intent, Dynatrace owns application evidence, and the customer's deployment system owns deployment
and rollback. The Dynatrace app does not write to Forward and does not store Forward credentials.

This repository installs and operates independently. Cross-product demonstrations and workflow-system orchestration
belong in a separate demo or customer automation project, not in this repository's installation path.

## Status

- Contract: sole production `v1`
- Application version: `1.0.2`
- Release: independently verified `v1.0.2`; install only its signed artifacts or digest-pinned importer
- Runtime: Node.js 24.x
- Distribution: GitHub release artifacts and GHCR importer image
- Product status: production candidate; signed release and support ownership are required before general availability
- License: ISC

This repository has one contract. Packages, plans, approvals, status artifacts, Workflow payloads, and managed Forward
checks all use their strict `v1` schema. Clean installation is required; there is no compatibility runtime.

## What It Does

- Reads Dynatrace service dependency evidence: application, environment, source, destination, protocol, port, owner,
  criticality, confidence, and mapping state.
- Builds deterministic Forward `NewNetworkCheck[]` intent-check packages with a complete product, contract,
  source-instance, and opaque source-key ownership tuple.
- Exposes package generation as a deployable Dynatrace custom Workflow action.
- Publishes validated package bytes to immutable filesystem handoff paths with an atomic `latest` pointer.
- Holds unresolved or ambiguous dependencies before Forward writes.
- Runs an optional Forward-side host-resolution preflight using Forward snapshot inventory so intent checks use
  resolved Forward host/subnet values.
- Optionally runs read-only Forward path evidence from the same resolved dependencies before import approval.
- Correlates sanitized aggregate Forward path evidence to a Dynatrace problem without asserting network root cause.
- Builds a deterministic read-only change-validation gate from Dynatrace health, Forward before/after path evidence,
  and sanitized reconciliation status.
- Emits bounded Forward-managed check-health transitions without publishing unchanged polling cycles.
- Includes systemd and Kubernetes schedules with durable state for continuous check-health feedback.
- Correlates explicit Dynatrace vulnerability and Forward exposure evidence into a read-only investigation queue.
- Supports explicit Read Only, Network Operator, and Network Admin Forward-side profiles. Only Network Admin can
  create missing or exact-approved changed intent checks.
- Optionally emits Forward NQE check and diff artifacts using Forward-controlled query IDs and allowlists.
- Publishes sanitized aggregate status back to Dynatrace for import state, counts, drift, signature state, and failures.

## What It Does Not Do

- The Dynatrace app does not mutate Forward.
- Dynatrace does not store Forward credentials.
- The importer does not auto-approve changed or stale Forward checks.
- Read Only and Network Operator never call Forward intent-check write APIs.
- Status events do not include Forward credentials, hostnames, check names, dependency rows, or Forward API response
  bodies.

## Architecture

```text
Dynatrace dependencies -> exported intent package -> Forward validates, reconciles, and applies
        ^                                                       |
        +---------------- sanitized aggregate status -----------+
```

The production path remains Forward-centric at the write boundary. Dynatrace supplies dependency and application
evidence; Forward validates the target network snapshot before persistent checks are created. The integration reports
bounded results but never deploys or rolls back.

## Quick Start

```bash
git clone https://github.com/forwardnetworks/forward-dynatrace.git
cd forward-dynatrace
# Use an exact reviewed commit or a verified immutable replacement release.
git checkout <reviewed-commit>
npm ci
npm run ci
npm run acceptance:bundle -- \
  --dependencies shared/demo-dependencies.json \
  --output-dir out/acceptance \
  --source-instance-id dt-acceptance-rehearsal \
  --forward-access-profile read-only \
  --sync-mode data-connector
```

The acceptance bundle is read-only. It builds a demo package, validates schemas and package integrity, writes
`ACCEPTANCE.md`, and does not contact Forward.

## Credential-Free Rehearsal

Build and validate a Dynatrace-shaped Forward package before a meeting:

```bash
npm run demo:rehearsal -- --output-dir /tmp/forward-dynatrace-demo
```

The rehearsal turns checked Dynatrace-shaped dependencies into a checksum-bound Forward `NewNetworkCheck[]` package
and validates it without a Forward call. It performs zero external reads or writes and labels its evidence synthetic.
Replace those records with customer-owned evidence before making a live claim.

## Live Demo

The live-demo conductor runs the complete operator-controlled story against a Dynatrace trial tenant and a Forward
test network. It queries live Grail rows, selects a 12-flow showcase, resolves endpoints against the latest Forward
snapshot, runs read-only Forward bulk path analysis, builds the governed intent package, performs Forward
reconciliation, and creates a sanitized status handoff for Dynatrace.

```bash
export FORWARD_BASE_URL=https://forward.example.com
export FORWARD_AUTHORIZATION_FILE=/secure/path/forward-authorization.header
export FORWARD_NETWORK_ID=<network-id>
export FORWARD_DYNATRACE_SOURCE_INSTANCE_ID=<stable-opaque-dynatrace-source-id>

npm run demo:live -- \
  --dynatrace-environment-url https://<trial-sandbox-id>.apps.dynatrace.com/ \
  --dynatrace-token-file /secure/path/platform-token \
  --evidence-source approved-trial-replay \
  --synthetic \
  --output-dir /tmp/forward-dynatrace-live-demo
```

The checked default DQL reads replay events, so `--synthetic` is mandatory for this path. For customer-owned evidence,
supply `--dynatrace-query-file /secure/queries/customer-dependencies.dql`, set a truthful `--evidence-source`, and omit
`--synthetic`; replay markers fail closed before any Forward call. The default is a Forward dry-run; no checks are
created. Persistent writes use the separate signed stage/approve/apply importer workflow. Add
`--publish-dynatrace-status` to send the aggregate reconciliation event back to Dynatrace. Path analysis is read-only
and enabled by default for the demo; `--skip-path-evidence` is the explicit fallback when that permission is not
available. See [docs/live-demo-runbook.md](docs/live-demo-runbook.md) for rehearsal and meeting steps.

## Problem-Triggered Network Evidence

A Forward-controlled runtime can resolve the dependency candidates from a Dynatrace problem, run read-only bulk path
analysis, and create a sanitized `forward.dynatrace.network.evidence` event. The event contains problem/service/run and
network/snapshot identifiers plus aggregate outcomes; it excludes endpoints, devices, path rows, credentials, and API
response bodies. Generation is a dry-run by default, and Dynatrace publication requires a separate `--apply` gate.

See [docs/problem-network-evidence.md](docs/problem-network-evidence.md) for the exact commands, assessment semantics,
DQL views, and stop rules.

## Change-Validation Gate

`npm run forward:change-gate` combines Dynatrace deployment/service-health context, Forward before/after path evidence,
and Forward reconciliation status into a checksummed `pass`, `warn`, or `fail` artifact. It is read-only; enforcement
belongs to the customer's deployment system. See [docs/change-validation-gate.md](docs/change-validation-gate.md).

## Continuous Check-Health Feedback

`npm run forward:check-health` polls only integration-managed checks, stores hashed durable state in the Forward-side
runtime, and emits only failure, recovery, error, and missing transitions. Dynatrace publication is separately gated by
`--apply`. See [docs/check-health-transition-feedback.md](docs/check-health-transition-feedback.md).

## Security Exposure Correlation

`npm run security:correlate` joins explicit Dynatrace finding, Forward exposure, and approved identity-mapping evidence
into a ranked, read-only investigation queue. Low-confidence identity never produces high severity; facts remain
separate and no remediation occurs. See [docs/security-exposure-correlation.md](docs/security-exposure-correlation.md).

## Dynatrace App Install

For an unsigned trial or development install, use a `my.*` app ID:

```bash
npm run dynatrace:deploy -- \
  --environment-url https://your-environment-id.apps.dynatrace.com/ \
  --app-id my.forward \
  --no-open \
  --non-interactive
```

For an enterprise install with the default `com.forward.dynatrace` app ID, use
`--sign-archive` and provide Dynatrace App Toolkit signing OAuth credentials. Full install details are in
[docs/install.md](docs/install.md).

Use the same checked identity wrapper for sandbox rollback:

```bash
npm run dynatrace:uninstall -- \
  --environment-url https://your-environment-id.apps.dynatrace.com/ \
  --app-id my.forward \
  --no-open \
  --non-interactive
```

## Forward Import Workflow

Manual import is the first production-safe workflow because Forward writes happen only after a Forward operator reviews
the package.

1. Export dependency candidates from Dynatrace:
   - `dependencies.json`
   - optional NQE query metadata when the customer enables that path
2. Move or expose the dependency export to a Forward-controlled runtime.
3. Resolve Dynatrace host names against the target Forward snapshot:

   ```bash
   npm run forward:resolve-hosts -- \
     --dependencies dependencies.json \
     --forward-base-url https://forward.example.com \
     --forward-network-id <network-id> \
     --authorization-file /secure/path/read-only-forward-auth-header \
     --execute \
     --output resolved-dependencies.json \
     --report forward-host-resolution-report.json
   ```

4. Build the Forward package from the resolved dependency file:

   ```bash
   npm run forward:package -- \
     --dependencies resolved-dependencies.json \
     --output-dir out/forward-package
   ```

5. Validate the generated package without Forward credentials:

   ```bash
   npm run forward:import -- \
     --checks out/forward-package/forward-intent-checks.json \
     --manifest out/forward-package/forward-dynatrace-manifest.json \
     --validate-only
   ```

6. Optionally run read-only Forward path evidence before approval:

   ```bash
   npm run forward:path-evidence -- \
     --dependencies resolved-dependencies.json \
     --forward-base-url https://forward.example.com \
     --forward-network-id <network-id> \
     --authorization-file /secure/path/read-only-forward-auth-header \
     --execute \
     --output forward-path-evidence.json
   ```

7. Dry-run the resolved package against Forward:

   ```bash
   export FORWARD_BASE_URL=https://forward.example.com
   export FORWARD_AUTHORIZATION_FILE=/secure/path/forward-authorization.header
   export FORWARD_NETWORK_ID=<network-id>

   npm run forward:import -- \
     --checks out/forward-package/forward-intent-checks.json \
     --manifest out/forward-package/forward-dynatrace-manifest.json \
     --report forward-import-report.json
   ```

8. Review create, unchanged, changed, stale, collision, blocked, and failed rows.
9. Stage a signed, snapshot-bound import plan. Have a Forward operator approve that exact plan, then apply it:

   ```bash
   npm run forward:import -- \
     --checks out/forward-package/forward-intent-checks.json \
     --manifest out/forward-package/forward-dynatrace-manifest.json \
     --require-signature \
     --signature out/forward-package/forward-dynatrace-package.sig \
     --public-key /secure/path/forward-dynatrace-public.pem \
     --stage-plan /secure/approvals/import-plan.json

   # After an operator creates approval.json for that exact plan:
   npm run forward:import -- \
     --checks out/forward-package/forward-intent-checks.json \
     --manifest out/forward-package/forward-dynatrace-manifest.json \
     --require-signature \
     --signature out/forward-package/forward-dynatrace-package.sig \
     --public-key /secure/path/forward-dynatrace-public.pem \
     --apply-plan /secure/approvals/import-plan.json \
     --require-approval-file /secure/approvals/approval.json \
     --apply
   ```

Scheduled automation uses the same importer from a Forward-side runtime with Forward credentials stored outside
Dynatrace. See [docs/forward-importer.md](docs/forward-importer.md) and
[docs/connector-runtime.md](docs/connector-runtime.md).

## Release Verification

Do not install an artifact solely because its tag starts with `v1`. Use only the replacement immutable release named by
the release owner, and verify its checksums, signature, attestations, source commit, and image digest.

Before installing or running any tagged release artifacts, verify the release:

```bash
export RELEASE_TAG=<verified-replacement-v1-tag>
gh release download "${RELEASE_TAG}" --repo forwardnetworks/forward-dynatrace
sha256sum -c SHA256SUMS
npm run release:sign -- \
  --verify \
  --checksums SHA256SUMS \
  --public-key SHA256SUMS.pub \
  --signature SHA256SUMS.sig
gh attestation verify "forward-dynatrace-importer-${RELEASE_TAG}.tgz" \
  --repo forwardnetworks/forward-dynatrace
gh attestation verify "oci://ghcr.io/forwardnetworks/forward-dynatrace-importer:${RELEASE_TAG}" \
  --owner forwardnetworks
```

Release provenance, SBOM, Trivy scan evidence, and digest pinning guidance are in
[docs/release-provenance.md](docs/release-provenance.md) and [docs/container-runtime.md](docs/container-runtime.md).

## Screenshots

These checked, credential-free captures use synthetic rehearsal records and placeholder target metadata. Each
standalone evidence view labels that provenance; live Grail and customer-owned Forward readback remain the production
proof sources.

![Forward for Dynatrace overview](docs/assets/screenshots/01-overview.jpg)

![Forward read-only NQE preview](docs/assets/screenshots/02-export-package-readiness.jpg)

![Forward-side API sequence](docs/assets/screenshots/03-forward-side-api.jpg)

![Forward intent check payload](docs/assets/screenshots/04-intent-check-payload.jpg)

![Forward access profiles](docs/assets/screenshots/05-forward-access-profiles.jpg)

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

Start with the smallest useful map:

- [ARCHITECTURE.md](ARCHITECTURE.md): system boundaries, components, and primary data paths
- [docs/index.md](docs/index.md): task-oriented index of all detailed documentation
- [docs/exec-plans/active/customer-production-readiness.md](docs/exec-plans/active/customer-production-readiness.md): current execution plan
- [docs/validation-matrix.md](docs/validation-matrix.md): verified evidence and remaining live-validation gaps
- [docs/customer-one-pager.md](docs/customer-one-pager.md): customer-facing scope and verification

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
