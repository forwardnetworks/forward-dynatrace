# Execution Roadmap

> Status: long-range design history and capability record. The single active project plan is
> `docs/exec-plans/active/customer-production-readiness.md`; verified evidence lives in `docs/validation-matrix.md`.

This roadmap turns the Forward Integration for Dynatrace field integration into an execution plan. It preserves the core boundary:
Dynatrace can export evidence and run approved read-only Forward queries; Forward-owned workflows perform persistent
Forward writes.

Do not modify Forward source code for this project. Forward source is reference material for API shape, permissions,
NQE behavior, and product constraints only. All implementation belongs in this repository.

## Operating Model

| Lane | Owner | Direction | Writes Forward | Purpose |
| --- | --- | --- | --- | --- |
| Dynatrace export | Dynatrace app/workflow | Dynatrace to package | No | Convert app topology into dependency candidates and package artifacts. |
| Dynamic NQE preview | Dynatrace app/workflow with read-only Forward credentials | Dynatrace asks Forward | No | Enrich mapping confidence and validate dependency candidates without changing Forward. |
| Forward package ingest | Forward operator or Forward-side connector | Package to Forward | Yes | Validate, reconcile, and apply persistent Forward checks under Forward policy. |
| Forward status artifact | Forward-side connector | Forward to Dynatrace | No | Publish aggregate ingest status and drift summary for Dynatrace display. |
| Standard demo replay | Demo operator | Checked fixture to trial sandbox | No Forward writes | Replay standard demo dependency evidence into a trial sandbox only. Not production. |

## Data Each Side Supplies

Dynatrace supplies:

- Application/service dependency rows: app, environment, service ID, service name, source, destination, protocol, port.
- Ownership and business context: owner, criticality, environment, problem ID, affected service.
- Runtime signals: problem state, service health, dependency changes, topology refresh timing.
- Export package metadata: package ID, generated timestamp, schema version, checksum, rejected row count.

Forward supplies:

- Latest processed snapshot ID and target network metadata.
- Read-only NQE results for endpoint resolution, ownership correlation, blast radius, and confidence scoring.
- Existing persistent check inventory for reconciliation by `dynatrace-key:*` tag and generated check name.
- Import report counts: create, unchanged, changed, stale, failed.
- Sanitized status artifact for Dynatrace display, without check-level topology or credentials.

Shared package artifacts:

- `forward-dynatrace-manifest.json`
- `forward-intent-checks.json`
- Optional `forward-nqe-checks.json` for persistent NQE checks that reference approved Forward-owned query IDs.
- Optional NQE diff requests for approved Forward-owned query IDs. Query IDs are never required for the base
  intent-check workflow.
- Optional detached signature and public-key verification material.

## Phase 0: Boundary And Demo Readiness

Status: implemented and live-validated in non-production Forward and Dynatrace environments; customer-owned runtime
installation remains an acceptance activity.

Goal: show the workflow safely before customer trial work.

Deliverables:

- Dynatrace app exports Forward-ready artifacts and never stores Forward write credentials.
- Manual Forward-side importer validates packages before API calls.
- Standard demo replay is documented as non-production.
- OpenPipeline/DQL query path can pull live Dynatrace data into local package artifacts.
- Forward ingest status artifact is sanitized and displayable in Dynatrace.

Validation:

- `npm run ci`
- Local rehearsal: `npm run demo:rehearsal`
- Live Forward non-production test: dry-run, apply, rerun unchanged, cleanup.
- Dynatrace trial app deploy and DQL query smoke.

Exit criteria:

- Client demo can show app topology becoming Forward intent-check candidates.
- Saved demo replay paths are clearly marked demo-only.
- No tenant IDs, credentials, customer data, or private token filenames are committed.

## Phase 1: Production-Safe Manual Import

Status: implemented and live-validated for create, unchanged, changed, stale, and bounded failure behavior on a
non-production Forward network.

Goal: support real customer topology with Forward operator control.

Deliverables:

- Customer-owned Dynatrace DQL query produces dependency candidates.
- Package builder emits deterministic Forward `NewNetworkCheck[]` payloads.
- Forward operator runs validate-only, dry-run, review, then apply.
- Default apply policy remains create-missing-only.
- Changed and stale checks are report-only.

Required controls:

- Package checksum validation is mandatory.
- Manifest age limit is enforced.
- Duplicate names and duplicate `dynatrace-key:*` tags are rejected.
- `needs-map` rows are excluded from check creation.
- Forward credentials are supplied only in the Forward-side runtime shell or secret manager.

Execution flow:

```bash
npm run dynatrace:query -- \
  --environment-url https://<environment-id>.apps.dynatrace.com/ \
  --token-file /secure/path/platform-token \
  --query-file deploy/dynatrace-dql/service-dependency-candidates-openpipeline-events.dql \
  --output /tmp/forward-dynatrace-rows.json \
  --dependencies-output /tmp/forward-dynatrace-dependencies.json

npm run forward:package -- \
  --dependencies /tmp/forward-dynatrace-dependencies.json \
  --output-dir /tmp/forward-dynatrace-package

npm run forward:import -- \
  --checks /tmp/forward-dynatrace-package/forward-intent-checks.json \
  --manifest /tmp/forward-dynatrace-package/forward-dynatrace-manifest.json \
  --validate-only

npm run forward:import -- \
  --checks /tmp/forward-dynatrace-package/forward-intent-checks.json \
  --manifest /tmp/forward-dynatrace-package/forward-dynatrace-manifest.json \
  --report /tmp/forward-dynatrace-report.json

npm run forward:import -- \
  --checks /tmp/forward-dynatrace-package/forward-intent-checks.json \
  --manifest /tmp/forward-dynatrace-package/forward-dynatrace-manifest.json \
  --apply
```

Exit criteria:

- Same package rerun reports unchanged.
- Drift is visible before any optional update or stale policy is enabled.
- Operator runbook covers rollback by deactivating checks created in that run.

## Phase 2: Forward-Side Connector Automation

Status: implemented for signed package pull/import, metrics/status artifacts, sanitized status publication, and optional
approval-gated update/stale mutations. Production deployment still requires customer-owned runtime scheduling,
secrets, signing keys, and approval process ownership.

Goal: make the workflow iterative without letting Dynatrace push changes into Forward.

Deliverables:

- Forward-side connector pulls package from approved handoff location.
- Connector validates checksum/signature, schema, package age, and uniqueness.
- Connector reconciles every run against latest processed Forward snapshot.
- Connector emits metrics, report JSON, and sanitized status artifact.
- Connector publishes or hands off status so Dynatrace can show latest ingest state.

Recommended connector cadence:

- Schedule: hourly or daily for steady-state critical dependencies.
- Problem-triggered export: Dynatrace regenerates a package for impacted dependencies.
- Connector pull: every 5-15 minutes, or after package handoff event.

Apply policy stages:

| Stage | Behavior | Default |
| --- | --- | --- |
| Create missing | Create checks not present in Forward. | Enabled with `--apply`. |
| Changed drift | Report checks whose generated definition changed. | Report-only. |
| Stale drift | Report managed checks absent from latest package. | Report-only. |
| Replace changed | Deactivate old generated check and create replacement. | Optional with approval gates. |
| Retire stale | Deactivate stale generated checks. | Optional with approval gates. |

Optional importer flags:

```bash
--apply-updates
--deactivate-stale
--max-updates <count>
--max-deactivations <count>
--require-approval-file approval.json
--change-window-id <id>
```

Update/stale automation controls:

- Approval artifact names exact changed/stale keys allowed for mutation.
- Maximum update/deactivation budget is enforced.
- Connector refuses update/stale actions without package signature.
- Status artifact reports update/deactivation counts separately.
- Incident runbook includes partial update recovery.
- Defaults keep both update and stale automation disabled.

Exit criteria:

- Connector can run repeatedly with no duplicate checks.
- Forward remains the only writer.
- Dynatrace displays last run state and drift without exposing Forward credentials or topology details.

## Phase 3: Read-Only Dynamic NQE Preview

Status: implemented for plan mode, optional server-side execution, and a live smoke harness. Live customer execution
still requires the customer-approved read-only Forward credential model.

Goal: let Dynatrace ask Forward for read-only network evidence before creating persistent package artifacts.

Allowed Dynatrace behavior:

- Execute dynamic NQE preview templates with raw `query` source against approved Forward networks/snapshots.
- Execute approved `queryId` queries only when the customer chooses the optional query-ID path for stable diffs or
  Forward-owned reusable checks.
- Read NQE result rows for endpoint mapping, app-to-network correlation, and blast radius preview.
- Use results to raise/lower mapping confidence and mark rows `ready`, `review`, or `needs-map`.

Disallowed Dynatrace behavior:

- Create, update, or delete Forward checks.
- Commit NQE Library queries.
- Store Forward write credentials.
- Store broad Forward credentials in browser state or Dynatrace settings.

Candidate NQE previews:

- Endpoint resolution: does `network.source` or `network.destination` resolve to a known host/device/subnet?
- Ambiguity detection: does one Dynatrace endpoint map to multiple Forward entities?
- Path context: which devices, VRFs, zones, or sites are implicated by this dependency?
- Ownership correlation: do Forward tags or inventory fields align with Dynatrace owner/application metadata?
- Blast radius: for an impacted Dynatrace service, what network locations might be involved?

Implementation requirements:

- Add a Dynatrace app function for read-only Forward NQE preview.
- Require a read-only Forward credential with NQE execution permission only.
- Add allowlisted raw-query NQE templates for the default preview path; reject arbitrary user-provided NQE in production
  mode unless explicitly enabled.
- Treat committed Forward `queryId` use as an opt-in enhancement, not as a prerequisite for preview or export.
- Return aggregate/sanitized evidence to UI; avoid leaking broad topology by default.
- Log query ID/template ID, run ID, network ID, snapshot ID, and row counts.

Exit criteria:

- Preview improves mapping quality without Forward mutations.
- Failed NQE preview does not block package export; it lowers confidence or marks rows for review.
- Permissions are documented separately from Forward-side write credentials.

## Phase 4: Optional Persistent NQE Checks And Diffs

Status: implemented for optional package generation, manifest/checksum metadata, importer validation, query-ID
allowlisting, and read-only diff request packaging. Live customer use still requires Forward-owned query IDs and an
approved decision to enable this optional path.

Goal: support Forward-owned NQE checks as an optional package path, without letting Dynatrace own Forward NQE Library
content.

Forward constraint:

- Persistent NQE checks use `definition.checkType = "NQE"` and require an existing committed Forward NQE Library
  `queryId`.
- Therefore Dynatrace should supply parameters and context, while Forward owns the NQE query library.

Why query IDs are useful:

- They point to committed, reviewable Forward NQE Library content.
- They support stable execution across snapshots and versions.
- They unlock Forward NQE diff workflows, where the same query can compare before/after snapshots or commits.
- They avoid asking Dynatrace to generate or own NQE source code.

Design rule:

- Query ID based NQE checks and NQE diffs are optional. The base integration must still work with intent-check packages
  only, with no committed Forward NQE query IDs.
- Do not block a production rollout, trial, or package export because the customer has not approved query IDs. Use query
  IDs only where they add value: stable reusable NQE checks, repeatable NQE diffs, or explicit customer-approved
  read-only preview templates.

Deliverables:

- Add optional `forward-nqe-checks.json` artifact.
- Manifest lists both intent and NQE check counts and checksums.
- Forward-side importer validates NQE checks separately.
- NQE check packages require approved `queryId` allowlist.
- Parameters can be filled from Dynatrace app/service/environment metadata.
- Add optional NQE diff package metadata for approved `queryId`, before snapshot, after snapshot, and parameters.

Example persistent NQE check shape:

```json
{
  "definition": {
    "checkType": "NQE",
    "queryId": "FQ_<forward-owned-query-id>",
    "params": {
      "application": "checkout",
      "environment": "prod"
    }
  },
  "enabled": true,
  "name": "[Dynatrace] checkout prod NQE policy",
  "priority": "MEDIUM",
  "tags": [
    "dynatrace",
    "dynatrace-key:dt:nqe:checkout:prod:<query-id>"
  ]
}
```

Exit criteria:

- Persistent NQE checks are created only from Forward-owned query IDs.
- Dynatrace can request/check parameterization, but cannot commit NQE Library content.
- NQE check drift follows the same create/changed/stale reconciliation model as intent checks.
- NQE diff support is available only when a Forward-owned query ID is supplied and approved.
- Customers can opt out of persistent NQE checks and NQE diffs without losing the base intent-check workflow.

## Phase 5: Bidirectional Evidence Loop

Status: implemented for live dependency, reconciliation, problem, change-gate, check-health, and security evidence
views. Non-production live proof exists for dependency/reconciliation/problem/change evidence; customer-owned live
acceptance remains for ServiceNow, check-health, and security evidence.

Goal: make both systems more useful without changing system-of-record boundaries.

Dynatrace improvements from Forward evidence:

- Show Forward ingest status beside application dependencies.
- Show whether dependency rows map to known Forward network entities.
- Show aggregate read-only path-analysis outcomes for observed service flows without returning check-level topology.
- Show Forward-reported drift: created, unchanged, changed, stale.
- Show read-only NQE preview summaries for impacted services.
- Raise Dynatrace workflow tasks when Forward reports changed/stale drift.

Forward improvements from Dynatrace evidence:

- Generate persistent intent checks from observed app dependencies.
- Populate check names, notes, tags, owners, app, environment, and criticality.
- Prioritize checks based on Dynatrace criticality/problem context.
- Identify stale intent candidates when Dynatrace no longer reports a dependency.
- Parameterize approved NQE checks from Dynatrace app/service metadata.
- Optionally run Forward NQE diffs for approved query IDs to show how application/network evidence changed across
  snapshots.

Status artifact fields to preserve:

- `schemaVersion`
- `runId`
- `packageId`
- `mode`
- `importState`
- `plannedChecks`
- `counts`
- `target.networkId`
- `target.snapshotId`
- `packageSignature.status`

Do not publish back to Dynatrace:

- Forward credentials.
- Check API request/response bodies.
- Full check names or endpoint hostnames unless the customer explicitly approves.
- Unredacted device inventory or topology rows.

Exit criteria:

- Dynatrace app can show enough Forward evidence to guide app/network teams.
- Forward remains the persistent source of network intent.
- Customers can audit every write from package ID to Forward import report.

## Phase 6: Enterprise Productization

Goal: decide whether this remains a field integration kit or graduates into an owned product integration.

Field integration kit path:

- Keep source delivery plus release archives.
- Keep support boundary explicit.
- Keep deployment operated by field/customer/Forward-side owner.
- Continue adding docs, examples, and validation scripts.

Product integration path:

- Owned connector/service package.
- Signed container/image distribution.
- Formal support and compatibility matrix.
- Managed package handoff/storage.
- UI for package history, import status, drift, and approvals.
- Formal API contracts for status return into Dynatrace.

Enterprise controls:

- Real CODEOWNERS and branch protection.
- Centralized logs and metrics.
- Secrets manager integration.
- Key rotation for package signing.
- Release artifact signing.
- Compatibility tests across Forward API versions.
- Compatibility tests across Dynatrace App Toolkit versions.
- Load tests for large dependency sets.
- Runtime SLOs for connector pull and import.

Exit criteria:

- Ownership, support, release, and incident processes are accepted by Forward stakeholders.
- Customer deployment model is repeatable without engineer handholding.
- Security review signs off on credentials, package handoff, logs, and data handling.

## Cross-Domain Product Roadmap

The earlier phases establish the package, credential, and system-of-record boundaries. The next product increments use
those controls to turn the integration from an intent-check generator into a cross-domain diagnosis and change-assurance
workflow.

### Foundation: Honest Live Demo And Operator Conductor

Status: implemented and live-validated in the non-production Trial and DemoFoundry environments.

Deliverables:

- Let the app load live Grail dependency evidence or an explicitly labeled synthetic fallback.
- Preserve source provenance and replay `run_id`; never present fixture data as live customer evidence.
- Use a curated 8-12 row mixed-state customer showcase while retaining the 100-row replay as separate scale evidence.
- Remove repeated flow tuples and misleading service/port combinations from the presentation path.
- Resolve endpoints, run read-only Forward path analysis, build the package, and reconcile through one operator-owned
  live-demo conductor.
- Rename or disable UI actions that only stage a plan; do not imply a live Forward result where none exists.
- Label synthetic status artifacts and screenshots as demo evidence.

Acceptance criteria:

- UI, exported package, Forward report, and status handoff share traceable provenance.
- `npm run demo:live:test`, app build, and a dry-run against the approved demo network pass.
- Apply and Dynatrace publication remain separate explicit gates.

### Increment 1: Problem-Triggered Network Evidence

Status: implemented and live-validated for the non-production demo environment.

Goal: attach safe, aggregate Forward evidence to an affected-service Dynatrace problem.

Deliverables:

- Consume the impacted dependency candidates from a Dynatrace problem workflow.
- Resolve endpoints and run Forward bulk path analysis in a Forward-controlled runtime.
- Publish only a sanitized `forward.dynatrace.network.evidence` event with the problem ID, service ID, run ID, target
  snapshot, assessment, and aggregate counts.
- Provide latest and attention DQL views.
- Keep detailed endpoint, device, path, and API response data inside the Forward-controlled boundary.

Acceptance criteria:

- Dry-run event generation and schema validation are automated.
- Live Forward execution proves the target network/snapshot and records exact aggregate counts.
- Live Dynatrace publication is separately gated and query-back proves the event is present.
- The assessment says `consistent-with-network-policy-block`, `no-modeled-policy-block`, or `inconclusive`; it never
  asserts network root cause.

Implementation references:

- `docs/problem-network-evidence.md`
- `scripts/publish-dynatrace-network-evidence.mjs`
- `schemas/forward-network-evidence-event.schema.json`

Live validation record (2026-07-12):

- Dynatrace Trial query returned and normalized 100 replay dependency rows.
- Forward network `235937`, snapshot `1322821` evaluated 100 queryable paths: reachable `0`, blocked `100`, ambiguous
  `0`, unmapped `0`, failed `0`.
- Host resolution classified 98 ready, 1 review, and 1 needs-map row with 100 source and 100 destination resolutions.
- Dynatrace OpenPipeline accepted run `fd-problem-evidence-20260712T113700Z` with HTTP `202`.
- Grail query-back returned exactly one matching `forward.dynatrace.network.evidence` event with assessment
  `consistent-with-network-policy-block` and the same network, snapshot, and aggregate counts.

### Increment 2: Forward And Dynatrace Change-Validation Gate

Status: implemented and live-validated with separate safe and regression snapshot pairs.

Goal: correlate an application deployment or change window with Dynatrace service health and Forward modeled-network
validation before promotion.

Deliverables:

- Accept a deployment/change correlation ID, affected services, and approved before/after Forward snapshot IDs.
- Reuse the resolved dependency set for pre-change and post-change path evidence.
- Combine Forward path results and governed intent-check reconciliation with Dynatrace deployment/problem/service-health
  context.
- Emit a signed or checksummed gate artifact with `pass`, `warn`, or `fail`, plus explicit reasons and evidence IDs.
- Keep the gate read-only by default; a failed gate blocks promotion through the customer's deployment system, not by
  mutating Forward or Dynatrace.

Acceptance criteria:

- The same inputs produce a deterministic gate artifact.
- Missing snapshots, unmapped endpoints, or partial evidence cannot silently pass.
- A demo demonstrates one safe change and one rejected/inconclusive change from both application and network perspectives.

Initial implementation slice:

- `scripts/forward-change-validation-gate.mjs` builds a deterministic aggregate gate artifact from checked input files.
- `schemas/forward-change-context.schema.json` defines the Dynatrace deployment/service-health input contract.
- `schemas/forward-change-validation-gate.schema.json` defines the `pass`, `warn`, or `fail` output contract.
- `--fail-on-non-pass` lets a customer-owned deployment job stop promotion after the evidence artifact is written.
- Unit and CLI tests cover pass, fail-closed, warning, deterministic output, and schema validation paths.

Live evidence exercise (2026-07-12):

- The live conductor queried 100 Trial rows and selected 12 flows: 10 ready, 1 review, and 1 needs-map.
- Forward network `235937`, snapshot `1322821` returned 12 blocked, 0 ambiguous, 0 unmapped, and 0 failed path rows.
- Dry-run reconciliation planned 10 creates with 0 changed and 0 stale managed checks.
- Reusing snapshot `1322821` as both before and after was intentionally rejected with
  `FORWARD_SNAPSHOT_UNCHANGED` and `FORWARD_BLOCKED_PATHS`; `--fail-on-non-pass` exited `2`.
- The schema-valid gate artifact SHA-256 was
  `c3691aea3a0d1a7fab1ba431ef0abedb29df81624b77f0ca7e0679c8ffacc34c`.
- A complete safe pair used snapshots `1322819 -> 1322820`: all 24 modeled paths remained reachable, no paths were
  blocked, Dynatrace service health was healthy with no open problems, and the gate passed.
- A complete regression pair used snapshots `1322820 -> 1322821`: reachable paths dropped `24 -> 12`, blocked paths
  rose `0 -> 12`, Dynatrace service health was unhealthy with one open problem, and the gate failed with
  `FORWARD_BLOCKED_PATHS`, `FORWARD_PATH_REGRESSION`, `DYNATRACE_SERVICE_UNHEALTHY`, and
  `DYNATRACE_OPEN_PROBLEMS`.
- Both sanitized change-gate events were published to Dynatrace, queried back from Grail, and rendered in the Trial
  portal with exact snapshot IDs, deltas, application health, reconciliation state, and reason codes.

#### ServiceNow Production Extension

Status: implemented and fake-server validated in the repository; non-production ServiceNow acceptance remains.

- `scripts/servicenow-change-preflight.mjs` performs the authoritative, exact read and fails closed on approval, state,
  and planned-window eligibility.
- `scripts/servicenow-change-assurance.mjs` binds that eligible preflight to the Dynatrace context and Forward
  before/after/reconciliation evidence, re-reads ServiceNow before finalization, produces the deployment gate, and
  prepares both feedback channels.
- `scripts/servicenow-change-workflow.mjs` persists the approved baseline across the customer deployment boundary,
  verifies artifact hashes on resume, waits within a fixed bound for a different processed Forward snapshot, captures
  post-change evidence, and runs dry-run reconciliation.
- `scripts/servicenow-change-feedback.mjs` sends the exact checksummed bundle to the companion ServiceNow assurance
  ingress, verifies the returned decision/idempotency receipt, and relies on the unique ServiceNow ledger key for
  cross-host retry safety.
- Cross-change correlation mismatches fail before gate or publication, and Forward check mutation remains outside the
  assurance workflow.
- Live acceptance still requires one approved and one blocked non-production change, readback of the exact marker and
  checksum, a duplicate-free retry, and matching Dynatrace query-back.

### Increment 3: Continuous Forward Check-Health Transition Feedback

Status: implemented and synthetic trial publication/portal rendering validated; customer-owned live runtime validation
remains.

Goal: correlate Forward-managed intent health with Dynatrace problems, deployments, service health, and ownership
without creating a high-cardinality metric stream.

Deliverables:

- Poll only checks managed by this integration from Forward's read-only snapshot check inventory.
- Persist the last observed state in the Forward-controlled runtime.
- Publish events only for `PASS -> FAIL`, `FAIL -> PASS`, `ERROR`, and newly missing/stale intent transitions.
- Include stable check identity hashes and aggregate ownership/service context; exclude credentials and detailed topology.
- Add overlap prevention, retry behavior, retention, and replay protection to the scheduled runtime.

Acceptance criteria:

- Unchanged polling cycles publish nothing.
- Transition events are idempotent across restart/retry.
- Cardinality and OpenPipeline ingestion volume are bounded and documented.
- No failed or stale check is auto-remediated without customer-owned approval, audit, and rollback controls.

Implementation references:

- `scripts/forward-check-health-transitions.mjs`
- `schemas/forward-check-health-transitions.schema.json`
- `docs/check-health-transition-feedback.md`

Trial validation record (2026-07-12):

- A real 24-check Forward baseline contained 12 PASS and 12 FAIL results on snapshot `1322821`.
- Saved, explicitly synthetic inventory edits produced exactly one `PASS_TO_FAIL` and one `FAIL_TO_PASS` event with
  deterministic transition IDs.
- Both events were accepted by Dynatrace OpenPipeline, queried back from Grail, and rendered in the portal with
  `SYNTHETIC DEMO` provenance. This validates the feedback path without claiming the saved edits were live network
  changes.

### Increment 4: Security Exposure Correlation

Status: implemented and synthetic trial publication/portal rendering validated; customer evidence validation remains.

Goal: prioritize security exposure using both runtime/application context and modeled network reachability.

Deliverables:

- Correlate Dynatrace runtime vulnerability relevance and active execution context with Forward device CVEs,
  internet-addressability, network location, and modeled paths.
- Produce an evidence bundle and ranked investigation queue; keep raw vendor findings in their source systems.
- Distinguish observed execution, modeled reachability, vulnerable infrastructure, and policy findings as separate facts.
- Require customer-owned approval before any remediation workflow.

Acceptance criteria:

- Every correlation is traceable to exact Dynatrace and Forward evidence IDs and timestamps.
- Reachability is never described as proof that traffic should be permitted or prohibited.
- Low-confidence identity mappings cannot produce an automatic high-severity conclusion.
- Security and network owners approve the data-sharing, retention, and remediation boundaries.

Implementation references:

- `scripts/security-exposure-correlation.mjs`
- `schemas/forward-security-correlation.schema.json`
- `docs/security-exposure-correlation.md`

Trial validation record (2026-07-12):

- Two explicitly synthetic correlations were published and queried back: one high-confidence critical investigation
  and one low-confidence medium identity-review item.
- The portal preserved separate execution, vulnerable-runtime, modeled-reachability, internet-addressability, and
  policy facts, and labeled the evidence `SYNTHETIC DEMO`.

Implementation order completed in the repository:

1. Problem-triggered network evidence.
2. Forward + Dynatrace change-validation gate and ServiceNow extension.
3. Check-health transition feedback.
4. Security exposure correlation.

## Open Decisions

1. Dynamic NQE preview credential model: dedicated Forward principal with `NetworkOperation.USE_NQE`, no
   `NetworkOperation.EDIT_CHECKS`, and a live-smoke approval artifact. Use a Forward-side proxy instead when a built-in
   role would grant broader NQE Library authority than the customer accepts.
2. Dynamic NQE preview runtime: Dynatrace app function by default after approval; Forward-side proxy when customer
   policy requires Forward credentials to stay entirely outside Dynatrace.
3. What exact NQE templates should be allowlisted for endpoint mapping and blast radius?
4. Where should the Forward-side connector publish the sanitized status artifact for Dynatrace to read?
5. When, if ever, should changed checks be auto-replaced?
6. When, if ever, should stale checks be auto-deactivated?
7. Which Forward-owned query IDs, if any, should be enabled for optional persistent NQE checks?
8. Which Forward-owned query IDs, if any, should be enabled for optional NQE diffs?
9. What customer approval artifact is required before update or stale automation? Current implementation uses a
   separate exact-key approval file for update/stale mutations.

## Near-Term Execution Backlog

1. Live-validate check-health polling and one failure/recovery transition pair in the customer-owned runtime.
2. Validate security correlation against customer-approved evidence and identity mappings.
3. Run `npm run forward:nqe-live-smoke -- --execute --approval-file <approval.json>` once the customer approves the
   exact Forward read-only credential model.
4. Capture customer-approved query IDs only if the optional persistent NQE or NQE diff path is enabled.

Completed near-term execution docs:

- Live demo runbook uses customer-owned data for production and standard demo replay for trial sandboxes: `docs/live-demo-runbook.md`.
- The live-demo conductor now joins Grail query, Forward host resolution, read-only path analysis, governed package
  generation, dry-run/apply reconciliation, and sanitized Dynatrace status handoff behind separate write gates.
- Workflow screenshots cover optional NQE preview and iterative Forward reconciliation: `docs/screenshots.md`.
- Forward checks, NQE, and NQE diff compatibility notes: `docs/forward-api-compatibility.md`.
