# Customer Acceptance Checklist

Use this checklist before a customer trial, production pilot, or scheduled connector enablement. It is intentionally
Forward-centric: Dynatrace exports desired state, while Forward-controlled tooling validates and applies it.

## 1. Scope And Ownership

- Confirm this is a Forward Field Integration reference, not an officially supported product integration.
- Identify the Dynatrace owner, Forward owner, change approver, and runtime operator.
- Select the target Forward network and non-production rehearsal network.
- Confirm whether optional NQE preview or NQE artifacts are in scope.
- Confirm the customer accepts that Dynatrace never stores Forward credentials and never writes to Forward.

## 2. Release Intake

- Download the GitHub release artifacts.
- Verify `SHA256SUMS`.
- Verify `SHA256SUMS.sig` when present.
- Review `forward-dynatrace-sbom-<tag>.cdx.json`.
- Pull the GHCR importer image and record the image digest.
- Use the digest-pinned image in the runtime manifest.
- Run `npm run acceptance:bundle -- --dependencies shared/demo-dependencies.json --output-dir out/acceptance` for a
  local evidence bundle, or replace the dependency input with the customer-approved export.

## 3. Dynatrace App

- Install the app in a trial or non-production tenant first.
- Confirm the app ID and tenant URL are not committed to source control.
- Validate the dependency query returns source, destination, protocol, port, service, app, environment, owner,
  criticality, confidence, and mapping state.
- Confirm demo replay is used only for sandbox demonstration, not as production source data.

## 4. Endpoint Eligibility

- Run the dependency normalization and package build.
- Review the eligibility report.
- Confirm only `mappingState=ready` rows are eligible by default.
- Hold `review` and `needs-map` rows until Forward endpoint resolution is corrected.
- Use any review-row override only as an explicit customer-approved exception.

## 5. Forward Dry-Run

- Run `forward:readiness` with `--dry-run`.
- Confirm package validation passes before Forward API calls.
- Confirm Forward connectivity and reconciliation pass.
- Review create, unchanged, changed, and stale counts.
- Confirm changed or stale Dynatrace-managed checks remain report-only unless an approval workflow is enabled.
- Archive the acceptance bundle, import report, status artifact, checksum evidence, and runtime logs with the change
  ticket.

## 6. Apply Gate

- Apply only after the Forward owner approves the target network and counts.
- Keep default apply policy as create-missing-only.
- Require signed package verification for production connector runs.
- Require exact-key approval, change window, and mutation budgets before enabling update or stale deactivation paths.
- Re-run the same package after apply and confirm it reports unchanged.

## 7. Status Feedback

- Publish sanitized `forward-ingest-status.json` to the approved handoff location.
- Optionally publish `forward-ingest-status-event.json` to Dynatrace OpenPipeline.
- Confirm the Dynatrace status query shows the latest run state and planned counts.
- Confirm status telemetry contains no Forward credentials, hostnames, check names, dependency rows, or API response
  bodies.

## 8. ServiceNow Change Assurance

- Install the checked Flow Designer Script-step assets or the authenticated asynchronous worker in a non-production
  ServiceNow instance.
- Run the read-only preflight before the change window. If it reports a hibernating instance or HTML sign-in redirect,
  wake the instance or restore API authentication and retry; do not proceed without authoritative Table API JSON.
- Read one approved/scheduled change and one blocked change through `servicenow:change-preflight`; retain both
  sanitized artifacts and confirm the blocked case exits `2` without writes.
- For the approved change, run `servicenow:change-workflow -- --phase start` inside its authoritative window before
  the customer-owned deployment. Record the change number/sys_id, deployment ID, affected service IDs, Forward
  network ID, and before snapshot ID.
- After deployment and Dynatrace stabilization, run the complete phase against a newly processed Forward snapshot.
- Publish feedback only after the customer approves the non-production write. Use `--verify-servicenow-retry` once and
  require the retry receipt to reuse the original work-note and attachment sys_ids.
- Read back the exact ServiceNow attachment SHA-256 and idempotency marker, then query the matching aggregate event
  from Dynatrace Grail. A successful POST without both readbacks is not acceptance.
- Keep application deployment/rollback and all Forward check mutation outside this assurance workflow.

## 9. Check-Health Feedback

- Install one checked systemd or Kubernetes poller with a customer-owned runtime identity and durable mode-`0600`
  state.
- Baseline the managed `dynatrace` checks and confirm the first run publishes no transition.
- Re-run from a fresh process and confirm an unchanged inventory publishes nothing and preserves the same state.
- During a customer-approved non-production exercise, capture one real failure and recovery transition with stable
  transition IDs.
- Query both transition events back from Dynatrace and retain the protected state metadata plus sanitized batches.

## 10. Security Correlation

- Obtain security- and network-owner approval for the exact Dynatrace findings, Forward exposure evidence, identity
  mappings, sharing boundary, retention, and response process.
- Run the correlator read-only and confirm each ranked result traces to exact evidence IDs and timestamps.
- Confirm observed execution, modeled reachability, and internet addressability remain separate facts.
- Confirm low-confidence identity mappings cannot create automatic high severity or remediation.

## 11. Operations

- Store Forward credentials only in the Forward-side runtime secret store.
- Store Dynatrace status-publish tokens only in the runtime that publishes status events.
- Retain package, manifest, signature, report, metrics, and status artifacts with change evidence.
- Alert on validation failure, auth failure, package staleness, drift, partial write, repeated transient errors, and
  missing production signatures.
- Document rollback: disable the scheduler, preserve artifacts, run validate-only, and leave changed/stale paths
  report-only until reviewed.

## Exit Criteria

- The pre-publish guard proves the release tag, release record, and versioned GHCR tag had no prior publication state.
- `published-release-verification.json` records the exact successful release run, commit, artifacts, checksums,
  signature status, attestations, SBOM identity, zero-result Trivy SARIF, and digest-pinned image reference.
- Acceptance evidence bundle is generated and retained.
- Dependency eligibility is reviewed.
- Forward dry-run passes against the intended network.
- Optional Dynatrace status event is visible in Dynatrace.
- Apply run, if approved, is followed by an unchanged rerun.
- One approved and one blocked ServiceNow change are evaluated from authoritative records; an approved current-window
  run has matching ServiceNow and Dynatrace query-back evidence.
- A customer-owned check-health poller proves quiet restart behavior plus one approved failure/recovery pair.
- Every enabled security-correlation lane has owner-approved evidence, retention, and response boundaries.
- Evidence is retained in the customer-approved location.
