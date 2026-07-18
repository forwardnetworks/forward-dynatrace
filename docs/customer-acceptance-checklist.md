# Customer Acceptance Checklist

Use this checklist to promote Forward for Dynatrace from a sandbox install to a customer-operated non-production
deployment. Record evidence in the customer's change or validation system; do not commit tenant URLs, credentials,
hostnames, application names, network IDs, or raw dependency data to this repository.

## Acceptance Record

Record these values in the protected acceptance record before testing:

| Field | Required evidence |
| --- | --- |
| Release | Exact tag, commit SHA, release URL, and verification-report artifact ID |
| Artifacts | App/importer/SBOM SHA-256 values and checksum-signature result |
| Runtime image | Digest-pinned GHCR reference, never `latest` |
| Environments | Dynatrace and Forward non-production aliases; keep URLs and IDs private |
| Owners | Dynatrace admin, Forward reviewer, Forward applier, runtime owner, security reviewer, and support contact |
| Authorization | Change record, approved window, package ID, plan digest, and approval digest |

## 1. Verify The Release

- [ ] Download the exact release into a new or empty evidence directory.
- [ ] Run `npm run release:published:verify` from the matching immutable release source.
- [ ] Require and verify `SHA256SUMS.sig` and `SHA256SUMS.pub`.
- [ ] Confirm the app, importer, and SBOM checksums equal the published verification report.
- [ ] Confirm the importer image digest and attestation equal the report; pin that digest in the runtime manifest.
- [ ] Confirm the Trivy evidence contains zero HIGH/CRITICAL results under the release policy.

## 2. Approve Identities And Boundaries

- [ ] Install `my.forward` only in an isolated sandbox, or install a signed `com.forward.dynatrace` archive in the
  shared non-production tenant.
- [ ] Assign the roles in [rbac.md](rbac.md) to named groups or service principals.
- [ ] Confirm the Dynatrace app has no Forward credential and cannot call a Forward write endpoint.
- [ ] Select and record one Forward profile per connector: Read Only, Network Operator, or Network Admin. Provision
  separate handoff publisher and reader identities, and use separate Forward runtime identities where those lanes are
  enabled.
- [ ] Store authorization headers and signing keys in the customer secret manager; verify rotation and audit ownership.

## 3. Validate Real Dependency Evidence

- [ ] Run the customer-approved Grail query over real non-production service dependencies.
- [ ] Confirm required source, destination, protocol, port, service entity, application, environment, owner, confidence,
  mapping state, and provenance fields are present.
- [ ] Confirm replay, fixture, and synthetic rows are excluded from the acceptance package.
- [ ] Review every `needs-map` and `review` row; confirm neither can enter the default export.
- [ ] Generate the same scoped package twice and confirm identical intent bytes and checksum.

## 4. Validate Handoff And Readiness

- [ ] Publish the signed package to an immutable package-ID path through customer-owned HTTPS ingress.
- [ ] Confirm publisher and importer identities are different and access logs record allowed and denied requests.
- [ ] Run `npm run forward:readiness` with `--require-signature` and no Forward credentials first.
- [ ] Run the read-only Forward dry-run with the protected authorization file and selected non-production network.
- [ ] Confirm endpoint resolution has no unexplained ambiguous mappings and the target has a processed snapshot.
- [ ] Record create, unchanged, changed, stale, collision, and unresolved counts before approval.

## 5. Activate Create-Missing Or Approve Mutation

- [ ] Confirm the package and connector profiles match exactly; Read Only and Network Operator must reject apply.
- [ ] For Network Admin create-missing automation, verify the signed package, explicitly activate apply, and retain the
  source/network lock and bounded batch limits.
- [ ] Before changed-check replacement or stale retirement, stage an immutable import plan from the exact signed
  package and current reconciliation.
- [ ] Have an authorized reviewer approve the exact package, network, snapshot, source instance, plan digest, action
  set, policy, mutation budgets, and validity window.
- [ ] Confirm the importer stops on the first failed write and never adopts a check by display name.
- [ ] Confirm post-apply readback reconciles every approved action before the run reports success.
- [ ] Rerun the same package and confirm zero creates, zero unexplained drift, and all managed checks unchanged.

## 6. Exercise Failure And Recovery

- [ ] Present one same-name or partial-ownership collision and confirm the run fails before writes.
- [ ] Present controlled changed and stale managed checks and confirm the default policy reports them without mutation.
- [ ] Exercise one bounded write failure in an isolated test scope; confirm the private report records per-key outcomes,
  the public status is sanitized, and a fresh reconciliation/plan/approval is required.
- [ ] Rotate one non-production runtime credential and confirm the next run succeeds without package or config changes.
- [ ] Stop and restart the selected runtime; confirm locks, durable state, and idempotent reconciliation recover.

## 7. Verify Dynatrace Readback And Guardian

- [ ] Publish the sanitized Forward ingest-status event and query it back from Grail by exact run/package correlation.
- [ ] Confirm no Forward credential, endpoint, hostname, check name, path topology, or raw API body entered Dynatrace.
- [ ] Run the Site Reliability Guardian once for a healthy pass, once for a deliberate objective failure, and once with
  required evidence missing; missing evidence must fail closed.
- [ ] Confirm app/dashboard counts equal the protected Forward-side report for the same correlation ID.

## 8. Operational Handoff

- [ ] Select and document the supported runtime: systemd, Kubernetes, or another approved customer platform.
- [ ] Route JSON reports, metrics, and access logs to customer-owned observability with the alerts in
  [observability.md](observability.md).
- [ ] Test package-store backup/restore and runtime config restore without restoring credentials from source control.
- [ ] Walk through [operations-runbook.md](operations-runbook.md) and [incident-response.md](incident-response.md) with
  an operator who did not author the integration.
- [ ] Record support owner, on-call route, escalation route, release approver, credential rotation cadence, evidence
  retention, and decommission owner.

## Acceptance Exit

Acceptance passes only when every enabled lane above has authoritative readback, all failures have named owners, no
credential or customer topology crossed the documented boundary, the second import is idempotent, and the customer can
install, operate, audit, restore, and remove the integration from the published kit. Mark disabled optional lanes as
`not enabled` with an owner and decision date; do not mark them passed without evidence.
