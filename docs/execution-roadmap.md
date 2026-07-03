# Execution Roadmap

This roadmap turns the Forward Dynatrace field integration into an execution plan. It preserves the core boundary:
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
| Demo copy sidecar | Demo operator | Demo tenant to trial sandbox | No Forward writes | Copy demo dependency evidence into a trial sandbox only. Not production. |

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
- Optional `forward-nqe-checks.json` for persistent NQE checks that reference Forward-owned query IDs.
- Optional NQE diff requests for approved Forward-owned query IDs.
- Optional detached signature and public-key verification material.

## Phase 0: Boundary And Demo Readiness

Status: mostly implemented.

Goal: show the workflow safely before customer trial work.

Deliverables:

- Dynatrace app exports Forward-ready artifacts and never stores Forward write credentials.
- Manual Forward-side importer validates packages before API calls.
- Demo-only sidecars are documented as non-production.
- OpenPipeline/DQL query path can pull live Dynatrace data into local package artifacts.
- Forward ingest status artifact is sanitized and displayable in Dynatrace.

Validation:

- `npm run ci`
- Local rehearsal: `npm run demo:rehearsal`
- Live Forward non-production test: dry-run, apply, rerun unchanged, cleanup.
- Dynatrace trial app deploy and DQL query smoke.

Exit criteria:

- Client demo can show app topology becoming Forward intent-check candidates.
- Demo copy/seed paths are clearly marked sidecar-only.
- No tenant IDs, credentials, customer data, or private token filenames are committed.

## Phase 1: Production-Safe Manual Import

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

Status: implemented for plan mode and optional server-side execution. Live customer execution still requires the
customer-approved read-only Forward credential model.

Goal: let Dynatrace ask Forward for read-only network evidence before creating persistent package artifacts.

Allowed Dynatrace behavior:

- Execute dynamic NQE queries with raw `query` source against approved Forward networks/snapshots.
- Execute approved `queryId` queries when the customer chooses the optional query-ID path.
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
- Add allowlisted NQE templates; reject arbitrary user-provided NQE in production mode unless explicitly enabled.
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

Goal: make both systems more useful without changing system-of-record boundaries.

Dynatrace improvements from Forward evidence:

- Show Forward ingest status beside application dependencies.
- Show whether dependency rows map to known Forward network entities.
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

## Open Decisions

1. Which Forward read-only credential model is acceptable for Dynatrace dynamic NQE preview?
2. Should dynamic NQE preview run from Dynatrace app functions, a Forward-side proxy, or both?
3. What exact NQE templates should be allowlisted for endpoint mapping and blast radius?
4. Where should the Forward-side connector publish the sanitized status artifact for Dynatrace to read?
5. When, if ever, should changed checks be auto-replaced?
6. When, if ever, should stale checks be auto-deactivated?
7. Which Forward-owned query IDs, if any, should be enabled for optional persistent NQE checks?
8. Which Forward-owned query IDs, if any, should be enabled for optional NQE diffs?
9. What customer approval artifact is required before update or stale automation?

## Near-Term Execution Backlog

1. Validate read-only dynamic NQE preview against a customer-approved Forward credential model.
2. Capture customer-approved query IDs only if the optional persistent NQE or NQE diff path is enabled.

Completed near-term execution docs:

- Live demo runbook uses customer-owned data first and keeps demo-copy as a sidecar: `docs/live-demo-runbook.md`.
- Workflow screenshots cover optional NQE preview and iterative Forward reconciliation: `docs/screenshots.md`.
- Forward checks, NQE, and NQE diff compatibility notes: `docs/forward-api-compatibility.md`.
