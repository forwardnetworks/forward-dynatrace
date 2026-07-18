# Enterprise Hardening Backlog

> This is a control and productization catalog, not the active execution queue. Current work is tracked in
> `docs/exec-plans/active/customer-production-readiness.md`; structural debt is tracked in
> `docs/exec-plans/tech-debt-tracker.md`.

This tracks what is implemented now and what remains before Forward for Dynatrace is generally available for
enterprise use. It is a product integration in production-candidate status; support ownership and a signed release
remain explicit release gates.

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
- Done in repo: one strict production `v1` schema with no alternate-version or migration runtime.
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
- Done in repo: exact, expiring, one-successful-replacement authorization for retiring the pre-customer `v1.0.0`
  development release without weakening normal immutable-tag enforcement; the published verifier retains its lineage.
- Done in repo: weekly Dependabot checks for npm and GitHub Actions.
- Done in repo: deterministic 1001-check test coverage for bulk import, chunk sizing, and transient retries.
- Done in repo: load and scale smoke for 2500 generated dependency rows through normalization, package build,
  validate-only import, batched fake Forward apply, and unchanged rerun.
- Done in repo: runtime SLO gate for importer reports and metrics, including duration, unresolved drift, signature
  requirements, and metric/report consistency.
- External before wider use: assign an owner for the Forward-side runtime: team, on-call path, escalation path, release
  approver, and customer handoff owner.
- Done in repo: provide scheduled-job runtime templates for systemd and Kubernetes; external before wider use: choose
  which runtime the deployment will actually operate.
- Done in repo: reject username/password environment variables and load one Basic or Bearer Authorization header only
  from a protected regular file mounted into the Forward-side runtime.
- External before wider use: provision a dedicated least-privilege Forward runtime identity, render its Authorization
  header from a secrets manager, and operate rotation and access auditing.
- External before wider use: assign actual identities or groups to the RBAC roles in `docs/rbac.md`.
- External before wider use: provision signing keys if checksum-only integrity is not sufficient for the deployment
  trust model.
- Done operationally: published and independently verified signed `v1.0.0` from commit `ce5a13f`; deployment
  manifests must pin the verified importer digest recorded in `docs/validation-matrix.md`.
- Done operationally: published and independently verified signed `v1.0.1` from commit `a89ff21` as the self-contained
  customer kit with the acceptance checklist, one-pager, live-demo runbook, and checked local documentation links.
- Done operationally: published and independently verified signed `v1.0.2` from commit `de452ad` with immutable
  GitHub Action pins, accountable interim ownership, the single-version support matrix, and protected acceptance record.
- Done in repo: pin the package, ownership, import-plan, approval, and status contracts to the sole `v1` release.
- Done in repo: default apply policy is `create-missing-only`; every write requires signed-package verification, a fresh
  reconciliation, an immutable staged plan, an exact approval no more than 24 hours long, and mutation budgets.
- Done in repo: serialize apply by source instance and Forward network, reject every identity/name collision, and never
  adopt or mutate an existing check by display name.
- Done in repo: stop on the first failed write, preserve per-source-key mutation outcomes in the private report,
  publish only a bounded failure summary, and require fresh reconciliation plus a new plan after partial apply.
- Done in repo: re-read the target snapshot after every apply and fail unless the observed check state reconciles to
  the approved plan.
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

- Product decision complete: Forward for Dynatrace is an owned product integration, not a field kit.
- External before general availability: replace or formally own the script runner as a supported connector package and
  publish its support policy.
- Done in repo: publish the Forward-side importer image to GHCR on tag releases with image provenance enabled.
- Future version work begins only after product owners intentionally introduce a second supported contract; this
  release contains no dormant multi-version or migration behavior.
- Done in repo: synthetic end-to-end harness publishes a package, pulls it, imports it, verifies fake Forward checks,
  and reruns the same package to confirm idempotency.
- External after policy decision: operate the approval process for update/stale automation and decide whether it is
  enabled for each deployment.
- Done in repo: the Dynatrace app shows dependency eligibility/rejected rows plus sanitized Forward package history,
  drift state, and the latest Forward-side ingest result. An owned-product decision would still determine long-term
  support and UX ownership.

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
