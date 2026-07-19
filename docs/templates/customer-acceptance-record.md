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
| Integration release | `<immutable 0.x prerelease tag>` |
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
- [ ] App artifact attestations bind the expected source, workflow, runner, and digest.
- [ ] CycloneDX SBOM was retained with the protected record.
- [ ] The release security audit reported no accepted HIGH or CRITICAL findings.
- [ ] The installed Dynatrace app archive matches the verified release digest.
- [ ] Production app uses a Dynatrace-signed `com.forward.dynatrace` archive, or the record is explicitly sandbox-only.

Evidence references:

```text
Release verification report: <reference>
App archive checksum/signature: <reference>
SBOM and vulnerability report: <reference>
```

## Identity, Secret, And Direct-API Controls

- [ ] The Forward identity is stored only in an owner-controlled, secret-type `forward-api-connection` setting.
- [ ] The browser, Workflow request, action result, evidence, and logs cannot reveal the Forward credential or raw
      authenticated response.
- [ ] Only the exact approved HTTPS Forward API origin is allowlisted for outbound app-function requests.
- [ ] Read Only and Network Admin privileges use separate least-privilege identities when both are enabled.
- [ ] The declared access profile matches the Forward identity and the requested operation.
- [ ] API audit, evidence retention, settings ownership, backup, restore, and access-log ownership are recorded.
- [ ] Secret rotation and emergency revocation were exercised without editing repository files.

## Sandbox Installation

- [ ] Clean installation of `my.forward` completed.
- [ ] Requested scopes were reviewed by the tenant administrator.
- [ ] Every app view opened without a customer-facing dead end.
- [ ] An on-demand Read Only plan called Forward directly and returned bounded snapshot, path, and reconciliation
      evidence without making a mutation request.
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

- [ ] Read Only planning used the backend secret connection, called only approved Forward read APIs, and made no
      mutation request.
- [ ] Planning used the selected processed snapshot and produced a reviewable immutable plan.
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

- [ ] Tenant owner can inspect and safely rerun the bundled Workflow action.
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
