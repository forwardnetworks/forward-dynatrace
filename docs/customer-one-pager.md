# Forward Integration for Dynatrace

This Forward Field Integration turns Dynatrace-discovered application dependencies into Forward-reviewed network intent
checks. It is designed for a customer-controlled workflow: Dynatrace exports desired state, and Forward-side tooling
validates, reconciles, and applies approved changes.

## What It Does

- Reads Dynatrace service dependency evidence: application, environment, source, destination, protocol, port, owner,
  criticality, confidence, and mapping state.
- Builds deterministic Forward `NewNetworkCheck[]` intent-check packages with `dynatrace-key:*` reconciliation tags.
- Runs a Forward-side host-resolution preflight so unresolved or ambiguous Dynatrace endpoints are held before Forward writes.
- Optionally runs read-only Forward path evidence from the same resolved dependencies before import approval.
- Produces an eligibility report from the resolved dependency file.
- Supports bulk check creation through the Forward-side importer or scheduled connector.
- Runs create-missing-only by default; changed and stale generated checks are report-only unless an explicit approval
  artifact, package signature, and mutation budgets are supplied.
- Optionally emits Forward NQE check and diff artifacts with Forward-owned query IDs and allowlists.
- Publishes sanitized aggregate status back to Dynatrace so operators can see import state, planned counts, signature
  state, drift counts, and failures.

## What It Does Not Do

- The Dynatrace app does not write to Forward.
- Dynatrace does not store Forward credentials.
- The integration does not auto-approve changed or stale Forward checks.
- Status events do not include Forward credentials, hostnames, check names, dependency rows, or Forward API response
  bodies.
- Demo replay data is not a production source path; production uses the customer's own Dynatrace topology.

## Standard Customer Workflow

1. Dynatrace exports dependency candidates and package artifacts.
2. Forward-side tooling resolves dependency source/destination names through Forward host inventory.
3. Forward-side tooling optionally runs read-only path evidence against the resolved dependencies.
4. Forward-side tooling validates schemas, checksums, signatures, age, dedupe rules, and optional NQE allowlists.
5. The importer resolves the latest Forward snapshot and compares desired checks to existing generated checks.
6. The Forward operator reviews create, unchanged, changed, stale, unmapped, and evidence counts.
7. The importer applies missing checks only after approval.
8. The importer publishes sanitized status for Dynatrace dashboards and customer evidence retention.

## Acceptance Evidence

Run the acceptance bundle before a trial handoff or scheduled connector enablement:

```bash
npm run acceptance:bundle -- \
  --dependencies shared/demo-dependencies.json \
  --output-dir out/acceptance \
  --sync-mode data-connector
```

The bundle is read-only. It validates package shape, writes `ACCEPTANCE.md`, emits sanitized status telemetry, and
records schema-validation evidence without contacting Forward.

## Release Verification

Use `v1.0.0` or newer. Verify release artifacts before install:

```bash
gh release download v1.0.0 --repo forwardnetworks/forward-dynatrace
sha256sum -c SHA256SUMS
npm run release:sign -- --verify --checksums SHA256SUMS --public-key SHA256SUMS.pub --signature SHA256SUMS.sig
gh attestation verify forward-dynatrace-importer-v1.0.0.tgz --repo forwardnetworks/forward-dynatrace
gh attestation verify oci://ghcr.io/forwardnetworks/forward-dynatrace-importer:v1.0.0 --owner forwardnetworks
```

The verified importer image digest for `v1.0.0` is:

```text
ghcr.io/forwardnetworks/forward-dynatrace-importer@sha256:7f884e44a2b54303d7da708bc805f0e16c1d19b192f95a90e94a63aad66bb7c6
```
