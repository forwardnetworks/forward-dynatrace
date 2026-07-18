# Forward For Dynatrace Customer Acceptance Record

Store the completed record in the customer's approved evidence system. Do not commit tenant URLs, credentials, private
topology, customer names, raw application dependencies, or token paths to this repository. Public summaries should use
aliases, aggregate counts, immutable hashes, and protected-record references.

## Review Metadata

| Field | Value |
| --- | --- |
| Protected evidence record | `<record-reference>` |
| Environment alias | `<non-sensitive-alias>` |
| Review window | `<start/end in UTC>` |
| Integration release | `<immutable v1.x tag>` |
| Release commit | `<40-character commit>` |
| App identity | `<my.forward or com.forward.dynatrace>` |
| Forward network alias | `<non-sensitive-alias>` |
| Change or run identity | `<bounded correlation ID>` |
| Dynatrace administrator | `<protected identity reference>` |
| Forward operator | `<protected identity reference>` |
| Security approver | `<protected identity reference>` |
| Application owner | `<protected identity reference>` |

## Artifact And Supply-Chain Verification

- [ ] Published-release verifier passed against a new, empty evidence directory.
- [ ] Release tag and commit match the reviewed values above.
- [ ] `SHA256SUMS` passed and its detached signature was verified.
- [ ] Artifact and image attestations bind the expected source, workflow, runner, and digest.
- [ ] CycloneDX SBOM was retained with the protected record.
- [ ] Trivy reported zero accepted HIGH or CRITICAL findings.
- [ ] Importer deployment uses the verified immutable image digest.
- [ ] Production app uses a Dynatrace-signed `com.forward.dynatrace` archive, or the record is explicitly sandbox-only.

Evidence references:

```text
Release verification report: <reference>
App archive checksum/signature: <reference>
Importer image digest: <reference>
SBOM and vulnerability report: <reference>
```

## Identity, Secret, And Handoff Controls

- [ ] Dynatrace contains no Forward credential and performs no Forward network call.
- [ ] Forward read and write privileges use separate least-privilege identities where both are enabled.
- [ ] Forward authorization is supplied only through a protected mounted header file.
- [ ] Package writer and reader identities are separate and handoff access is audited.
- [ ] TLS, retention, immutability, backup, restore, and access-log ownership are recorded.
- [ ] Secret rotation and emergency revocation were exercised without editing repository files.

## Sandbox Installation

- [ ] Clean installation of `my.forward` completed.
- [ ] Requested scopes were reviewed by the tenant administrator.
- [ ] Every app view opened without a customer-facing dead end.
- [ ] On-demand export delivered the exact checksummed package bytes to the approved handoff.
- [ ] Uninstall removed the app and schedules without deleting customer-owned evidence.

## Non-Production Evidence Loop

| Evidence | Recorded result |
| --- | --- |
| Dynatrace dependency rows selected | `<count and protected query reference>` |
| Eligible Forward candidates | `<count>` |
| Review/unmapped candidates | `<count>` |
| Target Forward snapshot | `<protected snapshot reference>` |
| Package ID and checksum | `<ID and SHA-256>` |
| Staged plan checksum | `<SHA-256>` |
| Approval issue/expiry | `<UTC timestamps>` |
| Create/unchanged/changed/stale/collision | `<aggregate counts>` |
| Post-apply readback | `<pass/fail and reference>` |
| Idempotent rerun | `<pass/fail and unchanged count>` |
| Dynatrace status query-back | `<event/execution reference>` |

- [ ] Validate-only completed without credentials or external calls.
- [ ] Dry-run used the selected processed snapshot and produced a reviewable immutable plan.
- [ ] Approval matched the exact package, plan, snapshot, network, policy, and action arrays.
- [ ] Apply stayed within the approved time window and mutation budget.
- [ ] Post-apply readback matched every approved action.
- [ ] A second run created nothing and reported the expected unchanged set.
- [ ] Collision, changed, and stale results remained fail-closed or report-only under the selected policy.

## Guardian And Failure Evidence

- [ ] One Guardian execution passed with the exact correlation and evidence window.
- [ ] One deliberate objective failure returned the expected aggregate failure.
- [ ] One missing-event or missing-span run failed closed.
- [ ] One Forward write failure stopped remaining writes and produced sanitized recovery state.
- [ ] One network regression and recovery produced matching Forward and Dynatrace evidence.
- [ ] Restart, overlap lock, stale approval, expired package, and credential-revocation behavior were exercised.

## Operations And Rollback

- [ ] Runtime owner can start, stop, inspect, and safely rerun the connector.
- [ ] Metrics, logs, alerts, retention, and escalation routing were observed in the customer platform.
- [ ] State and evidence backup/restore completed.
- [ ] Previous verified release rollback completed without orphaned schedules, connections, or managed checks.
- [ ] Operators who did not author the integration completed the installation and rollback runbooks.

## Decision

| Decision | Selection |
| --- | --- |
| Sandbox accepted | `<yes/no>` |
| Non-production accepted | `<yes/no>` |
| Production promotion approved | `<yes/no/not requested>` |
| Exceptions | `<none or protected exception references with owner and expiry>` |

Sign-off references:

```text
Dynatrace owner: <reference/date>
Forward/network owner: <reference/date>
Security owner: <reference/date>
Application owner: <reference/date>
Product/support owner: <reference/date>
```
