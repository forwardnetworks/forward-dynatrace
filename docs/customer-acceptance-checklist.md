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

## 8. Operations

- Store Forward credentials only in the Forward-side runtime secret store.
- Store Dynatrace status-publish tokens only in the runtime that publishes status events.
- Retain package, manifest, signature, report, metrics, and status artifacts with change evidence.
- Alert on validation failure, auth failure, package staleness, drift, partial write, repeated transient errors, and
  missing production signatures.
- Document rollback: disable the scheduler, preserve artifacts, run validate-only, and leave changed/stale paths
  report-only until reviewed.

## Exit Criteria

- Release artifacts and image digest are verified.
- Acceptance evidence bundle is generated and retained.
- Dependency eligibility is reviewed.
- Forward dry-run passes against the intended network.
- Optional Dynatrace status event is visible in Dynatrace.
- Apply run, if approved, is followed by an unchanged rerun.
- Evidence is retained in the customer-approved location.
