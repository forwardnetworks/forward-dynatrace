# Cross-Repository Integration Completion

Status: active
Owner: repository maintainer plus ServiceNow, Dynatrace, Forward runtime, security, and network owners
Last updated: 2026-07-13

## Objective

Turn the merged ServiceNow → Forward → Dynatrace implementation into a reproducible, released, customer-operated
non-production integration. Finish the companion ServiceNow package, remove the remaining manual glue where repository
code can do so safely, install exact release artifacts, and capture one authoritative three-system acceptance run.

This is the single active execution plan for `forward-dynatrace` and its companion GitHub repository `forward-snow`
(local worktree `forward-servicenow-demo`). Detailed historical proof remains in `docs/validation-matrix.md`.

## Non-Goals

- Do not move Forward write credentials into Dynatrace or ServiceNow.
- Do not let change assurance deploy applications, perform rollback, or imply Forward mutation approval.
- Do not enable changed/stale mutation without a signed package, exact approval, change window, budget, audit, and
  rollback owned by the customer.
- Do not present replay or fixture evidence as live customer evidence.
- Do not make optional NQE or security-correlation lanes a dependency of the base workflow.
- Do not decide field-kit versus supported-product ownership on behalf of product leadership.

## Progress

- [x] Merge the cross-domain assurance tranche through PR `#11` as merge commit
  `d706357a05dbee8b15e613f11fc515c10246b4e2`; GitHub Actions run `29258140360` passed for the final head.
- [x] Validate the merged implementation on Node `v24.18.0`, including full CI, 2,500-row scale smoke,
  zero-vulnerability production audit, Dynatrace app build, exact release membership, checked screenshots, and a
  network-disabled two-act showcase.
- [x] Live-validate Forward base import create/unchanged/changed/stale/failure behavior and query the sanitized status
  event back from Dynatrace.
- [x] Live-validate read-only ServiceNow approval/state/window preflight for one eligible and one blocked change.
- [x] Verify the ServiceNow ledger contract, retry-verification client, Forward change gate, check-health poller, security
  correlator, and Dynatrace event builders with deterministic repository tests.
- [x] Audit the companion `forward-snow` worktree: its uncommitted assurance ledger, ingress, Flow client, installer,
  admin audit, and contract tranche passes 14 Node tests plus 11 Python tests, but is not committed or proposed for
  review.
- [x] Preserve that companion worktree on branch `codex/change-assurance-package`, disable direct Table API access to
  the assurance ledger, close the embedded evidence contracts, distinguish client and retryable server failures, and
  verify attachment-before-work-note plus stable retry identifiers. The hardened branch passes 19 Node tests and 15
  Python tests on Node `v24.18.0`.
- [x] Commit and publish the companion tranche as immutable commit `2c7291c` and open
  [`forward-snow` PR #1](https://github.com/forwardnetworks/forward-snow/pull/1). Review and merge remain required before
  the companion-package exit criterion is complete.
- [x] Align the `forward-dynatrace` assurance/preflight/gate/Flow schemas with the ServiceNow persisted-field bounds and
  run the focused schema, assurance-conductor, and Flow-server suite: 14 tests plus 16 artifact validations passed on
  Node `v24.18.0`.
- [x] Run the complete `npm run ci` gate for the integrated schema/plan tranche on Node `v24.18.0`; repository and
  whitespace checks, all tests, 2,500-row scale smoke, runtime validation, zero-vulnerability production audit,
  Dynatrace build, SBOM generation, and exact release-package smoke completed with exit `0`.
- [x] Re-run the full Node `v24.18.0` gate after the handoff/workflow/scope tranche, then run the actual
  `acceptance:bundle` command against 100 checked dependencies. Both completed with exit `0`; the acceptance bundle
  remained validate-only, made no Forward contact, and reported 100 selected dependencies and 100 intent checks.
- [x] Select `v2.0.0` for the post-merge release candidate and synchronize the package, lockfile, and Dynatrace app
  versions. Requiring a package-handoff connection changes the published Workflow action input contract, so a major
  version is required rather than a `v1.x` compatibility claim.
- [x] Close the checked handoff read path: the Forward importer loads a dedicated token from a protected file, scopes
  Bearer forwarding to the exact HTTPS package origin/path, rejects inline tokens, and the systemd/Compose/Kubernetes
  templates mount the read identity separately from Forward credentials.
- [x] Select direct Dynatrace OpenPipeline publication for primary systemd status feedback. The connector publishes a
  sanitized handoff sidecar and aggregate event with an `openpipeline:events:ingest` token, then operators query back
  the exact run ID with the checked status DQL.
- [ ] Publish a release newer than `v1.0.0`; the current tag and GHCR digest predate the assurance, handoff,
  check-health, security, Flow-worker, and presenter-showcase commands.
- [ ] Complete a current-window approved ServiceNow change with matching Forward and Dynatrace readback evidence.

## Plan

### 1. Land The Companion ServiceNow Package

1. Review the complete dirty `forward-snow` worktree and confirm every changed/untracked file belongs to the bounded
   assurance ledger, authenticated ingress, Flow client, installer, audit, schema, tests, and operator docs.
2. Add or repair executable checks for every installation and contract invariant discovered during review.
3. Validate the exact raw-body SHA-256 contract, unique idempotency key, attachment-before-work-note order, retry
   receipts, writer-role boundary, origin allowlist, auth-profile requirement, and production-mode credential policy.
4. Run the full Node/Python validation suite and credential-free installer/audit contract smoke, then run the
   read-only installer/audit against the target ServiceNow instance before proposing review.
5. Move the coherent work from dirty `main` to a review branch without losing or rewriting unrelated user changes.
6. Commit, push, open a PR, obtain review, and land the package.

Exit: a clean reviewed companion commit installs the exact endpoint expected by `forward-dynatrace`, passes all
contract/installer tests, and has an immutable commit or release identifier.

### 2. Cut Matching Release Artifacts

1. Choose the next semantic version after reviewing the persisted ServiceNow workflow/assurance v2 compatibility
   boundary.
2. Synchronize `package.json`, `package-lock.json`, and `app.config.json`.
3. Confirm the release archives contain every merged runtime command, schema, DQL query, Flow asset, example, plan,
   and validation script by exact member.
4. On Node 24, run `npm ci`, `npm run ci`, `git diff --check`, and the acceptance-bundle command.
5. Land the release commit, create the matching tag, and verify GitHub release archives, checksums, optional signature,
   SBOM, attestations, Trivy SARIF, and digest-pinned GHCR image.
6. Replace all release-candidate instructions and `v1.0.0` runtime placeholders with the new verified tag/digest.

Exit: both repositories reference reviewed immutable revisions and the new `forward-dynatrace` release can be
installed without building from a PR branch.

### 3. Make The Handoff And Install Path Reproducible

1. Choose one primary non-production topology: Kubernetes, systemd, or Docker Compose. Keep the other templates as
   alternatives, not simultaneous demo paths.
2. Provision a concrete customer-owned package handoff with immutable package paths, atomic `latest`, HTTPS/read
   identity, access logs, retention, backup, and optional signature verification.
3. Wire the Dynatrace package-export action to publish complete package bytes to that handoff; a successful action that
   leaves bytes only in task output is not scheduled integration acceptance.
4. Install the Forward-side connector, ServiceNow Flow worker behind private TLS ingress, and optional check-health
   poller from the digest-pinned release image.
5. Install or generate the actual Dynatrace on-demand/schedule/problem workflows, not only payload examples.
6. Install the companion ServiceNow package and assemble/import its Start, Status, Complete, and decision Flow actions.
7. Choose one status-feedback lane: sanitized handoff polling or direct OpenPipeline event publication. Record the
   token scope and query-back DQL.
8. Add a checked, secret-free demo profile or installer automation for any repeated manual step that remains within
   repository ownership.

Exit: a new operator can install the three-system non-production path from immutable artifacts and produce one
traceable package/status round trip without ad hoc file movement.

### 4. Govern Change Scope And Identity Mapping

1. Define the source of truth that maps ServiceNow affected CIs/services to Dynatrace service entity IDs, the Forward
   network, and Forward-resolvable endpoints.
2. Add a versioned, schema-validated mapping contract with mapping ID, source record IDs, confidence, owner, timestamps,
   and explicit ambiguity/expiry behavior.
3. Add a deterministic read-only resolver that emits the existing `serviceEntityIds`/network scope or fails closed.
4. Keep a reviewed fixed mapping for the showcase; do not present it as automatic CMDB correlation.
5. Test missing, duplicate, stale, ambiguous, low-confidence, and cross-environment mappings.
6. Feed the resolved scope into the ServiceNow Flow/worker without exposing credentials or detailed Forward topology.

Exit: the demo no longer depends on an unexplained operator-supplied `service_entity_ids_json`, and production scope
cannot silently drift across ServiceNow, Dynatrace, or Forward.

### 5. Complete Authoritative Live Acceptance

ServiceNow change assurance:

- [ ] Wake/verify the non-production ServiceNow instance and authoritative Table API authentication.
- [ ] Exercise one approved and one blocked change in their recorded states/windows.
- [ ] Capture the approved before snapshot, customer deployment identity, different processed after snapshot, Forward
  path/reconciliation evidence, and fresh Dynatrace deployment/health context.
- [ ] Read back the exact ServiceNow ledger row, work-note marker, attachment sys_id, attachment SHA-256, and decision.
- [ ] Retry the exact bundle and verify the original ledger, attachment, and work-note identifiers are reused.
- [ ] Query the matching checksum-bound event back from Dynatrace Grail.

Check-health feedback:

- [ ] Baseline managed checks from the installed customer-owned poller with durable protected state.
- [ ] Verify a fresh-process unchanged poll emits nothing and preserves identity.
- [ ] Capture one customer-approved real failure and recovery pair with stable transition IDs.
- [ ] Query both transition events back from Dynatrace.

Security correlation, only if owner-approved for this trial:

- [ ] Obtain approved findings, Forward exposure evidence, identity mappings, sharing/retention policy, and response
  ownership.
- [ ] Verify every ranked item traces to exact evidence IDs/timestamps and low-confidence mappings cannot become
  automatic high severity.

Exit: `docs/validation-matrix.md` records readback/query-back evidence for every enabled lane; a successful POST or
synthetic portal row alone is insufficient.

### 6. Resolve Ownership And Optional Product Decisions

- [ ] Replace CODEOWNERS placeholders with real teams before enforcing code-owner review.
- [ ] Assign runtime owner, on-call path, release approver, support boundary, secret-rotation owner, and handoff owner.
- [ ] Decide whether this remains a field integration kit or becomes an owned product integration.
- [ ] Approve or decline dynamic NQE preview and persistent Forward-owned query IDs.
- [ ] Keep changed/stale mutation disabled unless a customer operates the full approval and rollback control set.
- [ ] Add multi-version Forward API, Dynatrace toolkit, or schema migration coverage only when a second supported target
  triggers the corresponding technical-debt item.

## Verification

- Both repositories are clean at reviewed commits; CI/test run IDs are recorded.
- The new release passes Node 24 CI and exact archive-membership smoke.
- Release checksum, SBOM, attestation, Trivy result, and image digest are verified from downloaded artifacts.
- The package handoff proves immutable publication, atomic latest, importer read access, and denied unintended access.
- Installation uses secret stores/auth profiles; no Forward credential reaches Dynatrace or ServiceNow.
- Scope mapping is schema-valid, fresh, unambiguous, environment-bound, and fail-closed.
- Reconciliation proves create, unchanged, changed, stale, and bounded failure behavior.
- Each enabled live lane has authoritative readback or Dynatrace query-back, not only a successful request.
- Synthetic, live non-production, and live customer evidence remain explicitly distinguishable.

## Decision Log

| Date | Decision | Reason |
| --- | --- | --- |
| 2026-07-13 | Keep this file as the single active cross-repository plan. | Release, ServiceNow companion, runtime, mapping, and live acceptance are one integration outcome. |
| 2026-07-13 | Treat merged PR `#11` as implementation-complete but not release-complete. | `v1.0.0` and its importer image predate the merged commands and contracts. |
| 2026-07-13 | Make the companion ServiceNow package the first implementation tranche. | A clean customer install cannot reproduce the bounded ledger/writeback endpoint from committed code today. |
| 2026-07-13 | Treat explicit scope mapping as core integration glue. | The current Flow requires caller-supplied Dynatrace entity IDs and does not explain ServiceNow-to-Dynatrace identity. |
| 2026-07-13 | Keep security correlation and NQE out of the base demo gate. | They require broader evidence, credential, retention, and ownership decisions than change assurance. |
| 2026-07-13 | Keep create-missing-only as the default Forward policy. | The core value does not require update/stale mutation authority. |
| 2026-07-13 | Make ServiceNow persistence limits part of the public cross-repository schemas. | Evidence accepted by the producer schema must fit the ledger fields without truncation, and the ingress must reject partial or extended documents. |
| 2026-07-13 | Use `v2.0.0` for the next release. | The Workflow action now requires a customer handoff connection and returns the v2 receipt-bound result, which is intentionally breaking for `v1.0.0` workflows. |
| 2026-07-13 | Use direct OpenPipeline publication for primary systemd status feedback. | It reuses the bounded event builder and checked DQL, keeps Forward credentials out of Dynatrace, and makes query-back explicit. |

## Evidence To Capture

- repository, branch, commit, PR, review, CI run, and merge commit;
- release version/tag, archive checksums, signature status, SBOM, attestations, Trivy result, and image digest;
- ServiceNow package revision, installed application/scope, role, operation, ledger table, and admin-audit result;
- Dynatrace tenant alias, app/workflow versions, execution ID, event type, correlation/run ID, and query-back count;
- Forward network ID, before/after snapshot IDs, check IDs, reconciliation run ID, counts, and mutation counts;
- mapping ID, source record IDs, confidence, owner, observed/expiry timestamps, and resolved service/network scope;
- handoff package ID, immutable URL/path, manifest checksum, signature status, access-log reference, and retention class;
- ServiceNow change number/sys_id, deployment ID, ledger/idempotency key, attachment/work-note IDs, checksum, and retry
  receipt;
- exact command exit code and live acceptance provenance: live customer, live non-production, or synthetic demo.

## Completion Criteria

This plan is complete only when the companion package and `forward-dynatrace` release are reviewed and immutable, the
selected runtime/handoff/scope-mapping path is installed, one approved and one blocked ServiceNow change have
authoritative readback evidence, every enabled feedback lane has query-back proof, and the remaining optional decisions
are either owned with dates or explicitly declined.
