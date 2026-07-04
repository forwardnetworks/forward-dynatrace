# Enterprise Hardening Backlog

This tracks what is implemented now and what remains before positioning this Forward Field Integration reference for
broader enterprise use.
It remains a field-built reference, not an officially supported Forward product integration.

## P0 Before Wider Use

- Done in repo: package checksum generation and validation.
- Done in repo: optional detached Ed25519 package signing and verification.
- Done in repo: connector config schema for non-secret runtime settings.
- Done in repo: operations runbook, incident response runbook, and threat model.
- Done in repo: dependency audit, CI SBOM generation, and release SBOM publication.
- Done in repo: CODEOWNERS template for app, importer, docs, screenshots, and release workflow.
- Done in repo: structured importer report metadata with run ID, package ID, checksum, sources, timing, and counts.
- Done in repo: Prometheus-style metrics file output for connector runs.
- Done in repo: Forward importer container packaging.
- Done in repo: systemd and Kubernetes scheduler templates for the Forward-side connector runtime.
- Done in repo: checked Dynatrace Workflow schedule and problem-trigger payload examples for the export function.
- Done in repo: schema versioning and migration policy.
- Done in repo: data handling rules for screenshots, examples, package artifacts, and committed docs.
- Done in repo: RBAC model for package generation, review, apply, signing keys, and runtime administration.
- Done in repo: package handoff blueprint for retention, immutability, access logs, and publish order.
- Done in repo: admin operations guide for audit export, config restore, disaster recovery, and access review.
- Done in repo: observability guide with report fields, metrics, alert thresholds, and evidence retention.
- Done in repo: sanitized read-only Forward ingest status artifact for Dynatrace display.
- Done in repo: Dynatrace status dashboard DQL pack for aggregate Forward-side ingest status.
- Done in repo: Dynatrace deploy wrapper that separates unsigned `my.*` trial installs from signed enterprise namespace
  installs and tests the policy locally.
- Done in repo: release checksum generation for published artifacts.
- Done in repo: optional detached Ed25519 signing and verification for `SHA256SUMS`; external before signed releases:
  provision and protect the release signing key.
- Done in repo: release archive packager smoke-tested in CI.
- Done in repo: GitHub release workflow that builds app/importer archives, publishes release SBOM, optionally
  self-signs `SHA256SUMS`, emits artifact attestations, publishes the GHCR importer image, and publishes tag releases.
- Done in repo: weekly Dependabot checks for npm and GitHub Actions.
- Done in repo: synthetic 1001-check bulk import, chunk sizing, and transient retry coverage.
- Done in repo: load and scale smoke for 2500 synthetic Dynatrace dependency rows through normalization, package build,
  validate-only import, batched fake Forward apply, and unchanged rerun.
- Done in repo: runtime SLO gate for importer reports and metrics, including duration, unresolved drift, signature
  requirements, and metric/report consistency.
- External before wider use: assign an owner for the Forward-side runtime: team, on-call path, escalation path, release
  approver, and customer handoff owner.
- Done in repo: provide scheduled-job runtime templates for systemd and Kubernetes; external before wider use: choose
  which runtime the deployment will actually operate.
- External before wider use: store Forward credentials only in that Forward-side runtime, backed by a secrets manager
  with rotation and audit logs.
- External before wider use: assign actual identities or groups to the RBAC roles in `docs/rbac.md`.
- External before wider use: provision signing keys if checksum-only integrity is not sufficient for the deployment
  trust model.
- Done in repo: pin package schema contract and migration rules for future `schemaVersion` changes.
- Done in repo: default apply policy is `create-missing-only`; optional update/stale automation requires signed package
  verification, exact approval artifact, and mutation budgets.
- Done in repo: customer-safe runbook and acceptance checklist for release intake, install, generate package,
  validate-only, dry-run, apply, rollback, drift review, status feedback, and evidence collection.
- Done in repo: incident runbook for importer failure, partial bulk create, stale package, auth failure, rate limit, bad
  mapping, and Forward API 4xx/5xx.
- Done in repo: threat model for Dynatrace export, package storage, connector pull, Forward credentials, Forward write
  API, logs, and screenshots.

## P1 Enterprise Controls

- External before wider use: provision the durable package handoff location described in `docs/package-handoff.md`.
- Done in repo: release checksum signing utility and CI tamper-detection tests; external before signed releases:
  provision the actual release signing key outside GitHub source.
- Done in repo: generate a CycloneDX SBOM, publish it in release assets, and run production dependency audit in CI.
- Done in repo: branch protection requiring the `gitops` workflow, one approving review, linear history, conversation
  resolution, and no force-push/delete.
- External before release: replace CODEOWNERS placeholder with real owning teams before enforcing review rules.
- Done in repo: connector configuration example and schema validation for base URL, network ID, package URL, batch
  size, retry policy, package age, and drift policy.
- External after runtime selection: extend structured importer output to external log sinks if the runtime needs
  centralized observability.
- External after runtime selection: add runtime-specific metrics shipping.
- External before wider use: choose where the Forward-side runtime publishes the read-only status artifact for Dynatrace
  display.

## P2 Productization Path

- External product decision: decide whether this remains a field integration kit or graduates into an owned product
  integration.
- External product decision: if it graduates, replace the script runner with an owned service/connector package and
  formal support policy.
- Done in repo: publish the Forward-side importer image to GHCR on tag releases with image provenance enabled.
- Future schema work: add upgrade tests when a second schema version exists.
- Future compatibility work: add compatibility tests against multiple real Forward API versions and Dynatrace App
  Toolkit versions.
- Done in repo: synthetic end-to-end harness publishes a package, pulls it, imports it, verifies fake Forward checks,
  and reruns the same package to confirm idempotency.
- External after policy decision: operate the approval process for update/stale automation and decide whether it is
  enabled for each deployment.
- Future productization: add a UI view for package history, rejected rows, drift state, and last Forward-side ingest
  result.

## Exit Criteria

Call this enterprise-ready only when:

- Ownership and support boundary are written down.
- The Forward-side runtime is installed in a controlled environment.
- Credentials are stored outside Dynatrace and rotated.
- Package validation, signing/checksum, dry-run, and apply are mandatory.
- Create/changed/stale policies are explicit.
- CI includes security, schema, unit, workflow, and build checks.
- At least one non-production Forward network has validated create, unchanged, changed, stale, and failure paths.
- Runbooks exist for normal operation and incident response.
