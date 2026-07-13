# Customer Production Readiness

Status: active  
Owner: repository maintainer plus customer runtime, Dynatrace, ServiceNow, security, and network owners  
Last updated: 2026-07-13

## Objective

Move the validated field-integration implementation to a reviewed release and a customer-operated non-production
acceptance deployment without changing the system-of-record or credential boundaries.

## Non-Goals

- Do not turn optional NQE paths into base-workflow requirements.
- Do not enable changed/stale mutation without customer-owned approval, audit, and rollback.
- Do not present synthetic demo evidence as live customer proof.
- Do not decide field-kit versus owned-product scope on behalf of product leadership.

## Progress

- [x] Live-validate honest provenance, problem-triggered network evidence, and safe/regression change-gate pairs in the
  Trial and DemoFoundry environments.
- [x] Implement and repository-test ServiceNow change assurance, check-health transition polling, and security
  correlation.
- [x] Add validated ServiceNow Flow Designer Script-step assets and a deployable Dynatrace package-export Workflow
  action.
- [x] Add atomic immutable package handoff publication plus checked systemd/Kubernetes check-health schedules.
- [x] Pass the full local CI suite on the current working tree on 2026-07-13.
- [x] Repeat the release-candidate CI and packaging run on supported Node `24.x`; full CI passed in clean
  `node:24-alpine` (`v24.18.0`) on 2026-07-13.
- [x] Bind the ServiceNow attachment SHA-256/idempotency marker into the matching Dynatrace change event and assurance
  portal row, with schema and deterministic tests.
- [x] Require the new ServiceNow worker, cross-domain DQL, schemas, examples, and runtime commands by exact release
  archive member.
- [x] Add a one-command, schema-validated ServiceNow safe/regression rehearsal using the production gate, evidence,
  receipt, and Dynatrace event builders with explicit synthetic provenance and zero external I/O.
- [x] Render that rehearsal in the Dynatrace assurance portal as a checked, unclipped safe/regression comparison with
  readable decision reasons and exact ServiceNow checksum, Forward snapshot, and Dynatrace health evidence.
- [x] Review and commit the coherent implementation tranche as `2f1ce92` on
  `codex/servicenow-forward-dynatrace-demo` after the supported Node 24 gate passed.
- [ ] Obtain external review and land the current implementation tranche.
- [ ] Install customer-owned Forward-side and Dynatrace runtimes.
- [ ] Complete base import, ServiceNow, check-health, and security live acceptance.
- [ ] Resolve optional NQE and productization decisions.

## Plan

### 1. Land The Current Implementation Tranche

1. Review the complete working-tree diff as one release scope. Confirm that change assurance, ServiceNow, check-health,
   security correlation, runtime packaging, schemas, UI, docs, and screenshots belong in the release.
2. On Node `24.x`, run:

   ```bash
   node --version
   npm ci
   npm run ci
   git diff --check
   ```

3. Confirm release archives contain the new runtime commands, schemas, examples, worker assets, and knowledge map.
4. Create a release branch/PR, obtain review, and land without unrelated changes.
5. Record commit ID, CI run ID, version, checksums, and image digest.

Exit: a reviewed clean commit has green Node 24 CI and release packaging.

### 2. Install Customer-Owned Runtime Paths

1. Select Kubernetes, systemd, or cron for the Forward-side runtime.
2. Assign ownership for schedules, package handoff, protected state, logs, alerts, signing keys, and secret rotation.
3. Install the connector and, if enabled, the check-health poller.
4. Install real Dynatrace schedule/problem workflows in the target tenant.
5. Keep Forward credentials outside the Dynatrace app and preserve create-missing-only defaults.

Exit: installed and monitored runtimes produce traceable reports and sanitized Dynatrace status events.

### 3. Complete Live Acceptance

Base import:

- [ ] Dry-run and apply a small package to a Forward test network; record created check IDs.
- [ ] Re-run it and verify unchanged/no duplicates.
- [ ] Change one dependency and verify changed is report-only.
- [ ] Remove one dependency and verify stale is report-only.
- [ ] Exercise a bounded failure and recovery.

ServiceNow:

- [ ] Exercise one approved and one blocked non-production change.
- [ ] Capture customer-approved before/after Forward and matching Dynatrace evidence.
- [ ] Read back the exact ServiceNow marker, attachment checksum, and decision.
- [ ] Retry the bundle and verify no duplicate ledger entry, attachment, or work note.
- [ ] Query back the matching Dynatrace Grail event.

Check-health feedback:

- [ ] Baseline managed checks from a customer-owned poller with durable protected state.
- [ ] Capture one real approved failure and recovery transition.
- [ ] Verify unchanged polls publish nothing and retry/restart preserves identity.
- [ ] Query both events back from Dynatrace.

Security correlation:

- [ ] Obtain approved Dynatrace findings, Forward exposure evidence, and identity mappings.
- [ ] Obtain security/network-owner approval for sharing, retention, response, and remediation boundaries.
- [ ] Verify every ranked item traces to exact evidence IDs/timestamps.
- [ ] Confirm low-confidence mappings cannot create automatic high severity.

Exit: `docs/validation-matrix.md` records the live evidence and provenance.

### 4. Resolve Optional Decisions

- [ ] Approve or decline dynamic NQE preview and its exact read-only credential model.
- [ ] Approve Forward-owned query IDs only if persistent NQE checks/diffs are enabled.
- [ ] Decide where sanitized Forward status is published for Dynatrace.
- [ ] Keep changed/stale mutation disabled unless the customer owns approval, budget, audit, and rollback.
- [ ] Decide whether the outcome remains a field integration kit or becomes an owned product integration.

## Verification

- `npm run ci` passes on Node 24.
- Release archives pass their membership smoke checks.
- Each live gate has a query-back or readback result, not only a successful publish response.
- Reconciliation proves create, unchanged, changed, stale, and bounded failure behavior.
- Synthetic, live non-production, and live customer evidence remain explicitly distinguishable.

## Decision Log

| Date | Decision | Reason |
| --- | --- | --- |
| 2026-07-13 | Use this file as the single active project plan. | The long roadmap mixes design history, completed evidence, and future product choices. |
| 2026-07-13 | Node 26 CI is useful diagnostics but not release evidence. | The project engine range and GitHub workflows require Node 24. |
| 2026-07-13 | Treat NQE and update/stale mutation as optional decisions. | The base intent-package workflow must not depend on broader credentials or mutation authority. |

## Evidence To Capture

- environment and owner;
- Forward network ID and before/after snapshot IDs;
- Dynatrace environment, event type, correlation/run ID, and query-back count;
- ServiceNow change number/sys_id and idempotency receipt where applicable;
- package ID, manifest checksum, signature status, and import report counts;
- exact command exit code and CI/runtime run ID;
- provenance: live customer, live non-production, or synthetic demo.
