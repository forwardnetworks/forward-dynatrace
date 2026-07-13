# Forward Integration for Dynatrace

This Forward Field Integration turns Dynatrace-discovered application dependencies into Forward-reviewed network intent
checks, then uses ServiceNow change context to compare Dynatrace application health with Forward modeled-network
evidence before and after a deployment. The customer keeps every control boundary: ServiceNow owns approval, Forward
owns network intent, Dynatrace owns application evidence, and the deployment system owns deploy/rollback.

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
- Runs a two-phase ServiceNow-first assurance workflow that verifies the authoritative change window, captures exact
  Forward before/after snapshots, evaluates stabilized Dynatrace health, and returns a deterministic decision.
- Binds the ServiceNow evidence attachment and matching Dynatrace Grail event with the same SHA-256/idempotency marker.

## What It Does Not Do

- The Dynatrace app does not write to Forward.
- Dynatrace does not store Forward credentials.
- The integration does not auto-approve changed or stale Forward checks.
- Status events do not include Forward credentials, hostnames, check names, dependency rows, or Forward API response
  bodies.
- Demo replay data is not a production source path; production uses the customer's own Dynatrace topology.
- The integration does not approve changes, deploy applications, perform rollback, or replace ServiceNow CAB controls.

## Continuous Intent Workflow

1. Dynatrace exports dependency candidates and package artifacts.
2. Forward-side tooling resolves dependency source/destination names through Forward host inventory.
3. Forward-side tooling optionally runs read-only path evidence against the resolved dependencies.
4. Forward-side tooling validates schemas, checksums, signatures, age, dedupe rules, and optional NQE allowlists.
5. The importer resolves the latest Forward snapshot and compares desired checks to existing generated checks.
6. The Forward operator reviews create, unchanged, changed, stale, unmapped, and evidence counts.
7. The importer applies missing checks only after approval.
8. The importer publishes sanitized status for Dynatrace dashboards and customer evidence retention.

## ServiceNow Change-Assurance Workflow

1. ServiceNow supplies an approved change, active window, deployment ID, and affected Dynatrace services.
2. The Forward-side worker re-reads the exact change and fails closed on ambiguous, unapproved, or out-of-window input.
3. The worker captures the baseline Forward snapshot and modeled-path evidence for only the affected services.
4. The customer's existing deployment system performs the change.
5. The worker waits for a new processed Forward snapshot and fresh Dynatrace deployment/health/problem context.
6. The deterministic gate compares pre/post reachability, application health, and intent drift.
7. ServiceNow receives a checksummed evidence attachment and idempotent work-note marker; non-pass blocks by default.
8. Dynatrace shows the matching run, change, snapshots, reasons, and ServiceNow attachment checksum in Grail.

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

Live ServiceNow acceptance is intentionally separate: exercise one approved and one blocked non-production change,
read back the attachment/work-note marker, retry without duplicates, and query the matching Dynatrace event.

## Release Verification

`v1.0.0` is the legacy published base package/import line. The ServiceNow assurance worker, check-health poller,
security correlator, cross-domain portal, and their runtime commands are not included in `v1.0.0`; the complete
`v2.0.0` candidate is in PR #13. Historical Actions evidence shows `v1.0.0` on three commits, so it is not immutable
release proof. For a controlled demo, use an exact reviewed release-candidate commit. For customer installation, wait
for a newer matching tag and run the checked verifier instead of combining current templates with the legacy image.

The commands below inspect the legacy published artifacts; they do not resolve the tag-history violation:

```bash
gh release download v1.0.0 --repo forwardnetworks/forward-dynatrace
sha256sum -c SHA256SUMS
npm run release:sign -- --verify --checksums SHA256SUMS --public-key SHA256SUMS.pub --signature SHA256SUMS.sig
gh attestation verify forward-dynatrace-importer-v1.0.0.tgz --repo forwardnetworks/forward-dynatrace
gh attestation verify oci://ghcr.io/forwardnetworks/forward-dynatrace-importer:v1.0.0 --owner forwardnetworks
```

The legacy base-workflow importer image from release run `28696863169` is pinned as:

```text
ghcr.io/forwardnetworks/forward-dynatrace-importer@sha256:7f884e44a2b54303d7da708bc805f0e16c1d19b192f95a90e94a63aad66bb7c6
```

The historical `v1.0.0` tag was reused across three commits and therefore is not acceptable as immutable release
proof for a customer trial. Publish and verify the new `v2.0.0` release before installing the post-merge integration.
