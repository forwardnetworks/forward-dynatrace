# Application Change Assurance With ServiceNow

This is the product workflow for this integration. Demo fixtures, replay data, scenario conductors, and screenshots are
presentation aids only. They are not sources of approval, application truth, or network truth, and production behavior
must not depend on them.

## Product Outcome

For an approved ServiceNow change, correlate application health from Dynatrace with modeled network behavior from
Forward before and after deployment. Produce a deterministic `pass`, `warn`, or `fail` artifact that the customer's
deployment process can enforce and that operators can audit from the original change record.

The initial customer-facing question is:

> Is this ServiceNow change approved and inside its window, and do Dynatrace and Forward agree that the application
> and modeled network remained healthy after deployment?

## Systems Of Record

| System | Authoritative responsibility | Integration use |
| --- | --- | --- |
| ServiceNow | Change identity, approval, state, risk, assignment group, and planned window | Starts the assurance flow and receives the bounded result. |
| Dynatrace | Deployment state, affected services, observed dependencies, service health, and problems | Supplies application/runtime evidence. |
| Forward | Processed snapshots, endpoint resolution, modeled paths, intent inventory, and reconciliation | Supplies network evidence and remains the only system that owns persistent network intent. |
| Customer deployment system | Application deployment and rollback | Enforces the gate but is never replaced by this integration. |
| Forward-side conductor | Evidence orchestration, checksums, retry state, and publication lineage | Reads each source, builds the gate, and publishes bounded feedback. |

The Dynatrace app remains a read-only assurance and evidence surface. It does not hold ServiceNow or Forward
credentials and does not deploy applications.

## ServiceNow-First Workflow

1. An operator or ServiceNow Flow invokes the Forward-side conductor with a `change_request` number, deployment ID,
   affected Dynatrace service IDs, and Forward network ID.
2. The conductor reads the exact ServiceNow record and fails closed unless exactly one record exists.
3. The conductor verifies the authoritative approval value, executable state, and active `start_date` / `end_date`
   window. A copied JSON declaration is never treated as approval.
4. Before deployment, the conductor captures Dynatrace dependency scope and Forward endpoint/path evidence on the
   approved before snapshot.
5. The customer's deployment system performs the application change.
6. After deployment, the conductor waits for a new processed Forward snapshot and a bounded Dynatrace stabilization
   period. Missing or partial evidence cannot silently pass.
7. The conductor collects Dynatrace deployment/health/problem context, Forward post-change paths, and a read-only
   reconciliation result.
8. The existing deterministic change gate produces `pass`, `warn`, or `fail` with exact evidence hashes, network and
   snapshot IDs, reason codes, and reconciliation state.
9. The conductor publishes a bounded result to:
   - ServiceNow work notes and an attached checksummed evidence artifact;
   - Dynatrace Grail for the assurance portal, including the same publish-safe ServiceNow evidence checksum and
     idempotency marker;
   - the customer deployment gate or status API.
10. Forward check creation or mutation remains a separate, explicit Forward-side approval workflow. Change assurance
    never implies permission to alter Forward intent.

## ServiceNow Contract

The first executable slice is `npm run servicenow:change-preflight`. It performs one read-only Table API query against
`change_request` and writes `forward-dynatrace-servicenow-change-preflight/v1`.

Default ServiceNow values are based on the standard state model and were verified against a developer instance:

| Purpose | ServiceNow API field | Default accepted value |
| --- | --- | --- |
| Change identity | `number`, `sys_id` | Exact `CHG...` lookup with one result |
| Approval | `approval` | `approved` |
| Executable state | `state` | `-2` Scheduled or `-1` Implement |
| Planned window | `start_date`, `end_date` | Both present and evaluation time inside the interval |
| Risk and ownership | `risk`, `assignment_group` | Retained as bounded context, not authorization by themselves |

Customers with customized state models must configure explicit accepted raw values in the Forward-side runtime and
test them before enabling enforcement. Display labels are retained for operators, but decisions use raw values.

Example:

```bash
export SERVICENOW_BASE_URL=https://your-instance.service-now.com
export SERVICENOW_USER=<read-only-integration-user>
export SERVICENOW_PASSWORD=<runtime-secret>

npm run servicenow:change-preflight -- \
  --change-number CHG0042187 \
  --deployment-id checkout-api-2026.07.15.3 \
  --network-id network-production \
  --service-entity-id SERVICE-CHECKOUT-API \
  --service-entity-id SERVICE-PAYMENTS-API \
  --instance-alias production-itsm \
  --output /secure/evidence/servicenow-change-preflight.json \
  --fail-on-blocked
```

Required ServiceNow permissions should be limited to reading the required `change_request` fields. Writing work notes
or attachments is a separate role and credential path enabled only after the read-only flow is accepted.

Run this preflight before the change window, especially with a personal developer instance. If ServiceNow returns an
HTTP 200 hibernation or sign-in page instead of Table API JSON, the command now fails with an explicit wake/authentication
diagnosis and writes no acceptance artifact. Wake the instance in the ServiceNow Developer Portal or restore the API
credential, then retry; never treat a browser page as authoritative change evidence.

## Final Assurance Conductor

The production operator path is a resumable two-phase conductor. Start captures the exact authoritative ServiceNow
preflight, narrows normalized live Dynatrace dependency evidence to the requested affected services, resolves those
endpoints in Forward, and executes the before-snapshot baseline. It writes a checksummed state file, then stops for the
customer-owned deployment.

For Workflow Studio without IntegrationHub, the same conductor is available through the authenticated asynchronous
worker documented in [servicenow-flow-worker.md](servicenow-flow-worker.md). ServiceNow uses a core Script step and
Basic Auth Profile; the evidence, reconciliation, and gate logic remain in this runtime.

```bash
npm run servicenow:change-workflow -- \
  --phase start \
  --change-number CHG0042187 \
  --deployment-id checkout-api-2026.07.15.3 \
  --network-id network-production \
  --service-entity-id SERVICE-CHECKOUT-API \
  --service-entity-id SERVICE-PAYMENTS-API \
  --dependencies /secure/evidence/dynatrace-dependencies.json \
  --evidence-source live-customer-dependencies \
  --output-dir /secure/evidence/change-assurance
```

The start phase requires an explicit publish-safe evidence source. Add `--synthetic` whenever any dependency,
Dynatrace context, or other gate input is replay/demo evidence. The workflow persists that pair in its immutable state
and carries it into the Dynatrace event; known checked replay rows fail closed if `--synthetic` is omitted.
This is workflow-state schema `forward-dynatrace-servicenow-change-workflow/v2`; v1 resume states lack trustworthy
cross-domain provenance and must be restarted from the authoritative baseline rather than migrated by inference.
The final assurance summary is likewise `forward-dynatrace-servicenow-change-assurance/v2`.

After deployment and the bounded Dynatrace stabilization period, complete verifies every saved artifact hash, waits up
to 15 minutes for the latest processed Forward snapshot to differ from the baseline, executes the after evidence,
performs dry-run reconciliation, and finalizes the assurance result. Explicit snapshot IDs are intentionally rejected
on this production path so an older or unprocessed snapshot cannot bypass the wait. The Dynatrace context must be
written by the affected-service deployment/health/problem query after the configured stabilization cutoff; a stale
pre-deployment context is rejected.

```bash
npm run servicenow:change-workflow -- \
  --phase complete \
  --state /secure/evidence/change-assurance/servicenow-change-workflow.json \
  --context /secure/evidence/forward-change-context.json
```

The lower-level `npm run servicenow:change-assurance` command assembles already-collected inputs. Before it creates or
publishes a gate, it re-reads the exact ServiceNow record and recomputes approval, executable state, and active-window
eligibility. `--use-saved-preflight` exists only for offline tests, cannot publish externally, and must not be used as a
deployment authorization path. The assembler rejects mismatched change numbers, deployment IDs, affected-service
scope, or Forward network IDs.

```bash
npm run servicenow:change-assurance -- \
  --preflight /secure/evidence/servicenow-change-preflight.json \
  --context /secure/evidence/forward-change-context.json \
  --before-evidence /secure/evidence/forward-before-path-evidence.json \
  --after-evidence /secure/evidence/forward-after-path-evidence.json \
  --reconciliation-status /secure/evidence/forward-ingest-status.json \
  --evidence-source live-customer-dependencies \
  --output-dir /secure/evidence/change-assurance
```

Dry-run is the default. The output directory contains:

- the deterministic deployment-gate artifact;
- the sanitized Dynatrace event payload;
- a checksummed ServiceNow evidence attachment binding the authoritative preflight, aggregate gate, and every input
  evidence hash;
- the ServiceNow feedback receipt and final conductor summary.

Add `--publish-servicenow` only with the dedicated feedback credential, and `--publish-dynatrace` only with the
OpenPipeline credential. These flags do not mutate Forward or deploy/rollback the application. The deployment system
consumes the gate artifact. Both `warn` and `fail` exit `2` after all artifacts are written; `--report-only` is an
explicit non-enforcing override.

For one non-production idempotency acceptance run, add `--verify-servicenow-retry` with `--publish-servicenow`. The
conductor sends identical attachment bytes twice, requires the second response to mark both the work note and
attachment `existing` with the original sys_ids, and writes `servicenow-change-feedback-retry.json`. The flag is
opt-in because it intentionally performs a second ledger request; normal operation needs only the first idempotent
publication.

ServiceNow publication uses the authenticated companion endpoint
`POST /api/now/forward_change_assurance/changes/{change_sys_id}/evidence` by default. When ServiceNow assigns a
tenant-specific Scripted REST namespace, set `SERVICENOW_ASSURANCE_BASE_URI` to the API definition's authoritative
`base_uri`. The conductor sends the exact checksummed
evidence bytes with `X-Forward-Dynatrace-SHA256` and refuses a receipt whose idempotency key or decision does not match.
The ServiceNow endpoint verifies the header against the raw body before writing. Its contract recomputes the embedded
preflight and gate hashes from recursively key-sorted JSON, so ServiceNow object decoding cannot change lineage merely
by reordering keys. It also verifies every summarized reason, Forward reconciliation, Dynatrace state, and gate
evidence hash, and rejects topology- or credential-shaped content.

The ServiceNow service upserts one `u_forward_change_assurance` row through a unique
`forward-dynatrace:<evidence-sha256>` key, creates the evidence attachment before the work note, and returns whether
each publication item was created or already present. The dedicated feedback user needs only authentication plus the
`x_fwd_demo.assurance_writer` role; the ServiceNow package owns its internal table/journal/attachment writes. This role
and credential remain separate from the read-only preflight role.

The complete phase takes an exclusive workflow-state lock, while the ServiceNow unique ledger key serializes
publication across retries and hosts. Duplicate ledger rows, attachments, or work notes fail closed.

The lock records hostname, PID, start time, and state path. A same-host lock whose PID no longer exists is reclaimed
automatically. For malformed or cross-host lock metadata, the conductor fails closed; an operator must verify that the
recorded owner is gone before removing the `.lock` file.

## Gate Semantics

| Condition | Result |
| --- | --- |
| ServiceNow record missing or ambiguous | Block |
| Approval not accepted | Block |
| State not executable | Block |
| Planned window missing, invalid, or inactive | Block |
| Forward before/after evidence missing or not executed | Fail or warn according to customer policy; never pass |
| Modeled reachability regresses | Fail |
| Dynatrace service becomes unhealthy or reports open problems | Fail |
| Forward reconciliation reports changed/stale managed intent | Fail pending review |
| All required signals are complete and healthy | Pass |

## Compelling Customer Experience

The best presentation is the real operational loop, not the demo machinery:

1. Open an approved ServiceNow change and show its window, owner, risk, deployment, and affected services.
2. Run the read-only preflight and show the authoritative ServiceNow evidence artifact.
3. Show the Forward before snapshot and Dynatrace application baseline.
4. Perform the customer-owned deployment.
5. Show the after snapshot, application health, modeled reachability delta, and intent reconciliation.
6. Return the decision and reason codes to the same ServiceNow change.
7. Open the Dynatrace assurance portal for cross-team diagnosis and historical evidence.

In the assurance portal, compare the ServiceNow attachment SHA-256 with the value on the matching change/deployment
row. That checksum is derived from the exact bounded evidence attachment and is carried into the Dynatrace event with
the same `forward-dynatrace:<sha256>` idempotency marker, proving both systems reference the same decision artifact.

The demo may replay a safe change and a regression when a real change is unavailable, but every replay must remain
visibly synthetic and must exercise the same production contracts. Use an explicit replay label plus `--synthetic`;
never infer live provenance from an authoritative ServiceNow read alone.

`npm run demo:servicenow` provides that checked rehearsal: it produces schema-valid safe and regression gates,
checksummed ServiceNow attachment/work-note previews, idempotency receipts, and Dynatrace events while explicitly
reporting zero external reads and writes.

## Test Strategy

Automated now:

- Exact ServiceNow Table API request shape and single-record requirement.
- Raw approval/state evaluation.
- Active-window enforcement using `start_date` and `end_date`.
- Fail-closed behavior for requested approval, non-executable state, missing dates, and out-of-window execution.
- Sanitized output with no ServiceNow credentials.
- JSON Schema validation of the committed example.
- Exact correlation of ServiceNow change number, deployment ID, affected services, and Forward network with the
  Dynatrace/Forward gate inputs.
- Deterministic final assurance output, evidence hashes, deployment-gate handoff, and non-pass exit `2` enforcement.
- Bounded ServiceNow work-note and checksummed JSON attachment construction with no check-level topology.
- Fake ServiceNow assurance-ingress coverage for the exact callback path and evidence bytes, created/existing
  receipts, receipt correlation, and retry-safe idempotency.
- Two-phase workflow coverage for exact dependency scoping, resumable state validation, bounded new-snapshot polling,
  timeout failure, and packaged runtime command dispatch.
- JSON Schema validation of the generated gate, Dynatrace event, ServiceNow evidence attachment, feedback receipt,
  and conductor summary.

Live acceptance tests:

1. Run the read-only preflight against one approved developer-instance change and one blocked change.
2. Capture the before/after Forward evidence and stabilized Dynatrace context for one customer-approved deployment.
3. Publish one result to a non-production ServiceNow change and read back the exact work-note marker and attachment
   checksum.
4. Complete with `--publish-servicenow --verify-servicenow-retry`, retain both receipts, and verify the second reports
   the same work-note and attachment sys_ids as `existing` rather than creating duplicates.
5. Publish and query back the matching aggregate event from Dynatrace Grail.

## Explicitly Out Of Scope

- Treating demo data or a checked JSON file as ServiceNow approval.
- Deploying or rolling back the customer application.
- Copying Forward topology into ServiceNow or Dynatrace.
- Storing ServiceNow or Forward credentials in the Dynatrace app.
- Automatically changing Forward checks because a ServiceNow change is approved.
- Replacing ServiceNow CAB, customer deployment controls, or Forward intent governance.
