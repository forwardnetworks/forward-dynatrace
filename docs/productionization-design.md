# Productionization design: approval and scalable apply

Status: implemented additive hardening. Engine approval and single-invocation update partitioning are available as
opt-in request fields; the legacy request shape and deterministic plan digest are unchanged. Durable nonce
consumption, typed human approver identity, and resumable cross-invocation execution remain deferred.

## Executive decision

- **Approval:** `approvalMode` defaults to `digest`, preserving the existing possession-based authorization contract.
  `engine-approval` additionally requires the engine-validated `APPROVED` outcome, the engine-carried original plan,
  an exact caller/engine nonce match, and a fixed 15-minute TTL based on the original plan's trusted result. The action
  returns bounded authorization evidence and never interprets the untyped approval event as identity. Workflow audit
  history remains the human approval record because the SDK still exposes no typed approver identity.
- **Apply scale:** Forward's checked-in Checks OpenAPI specification has no bulk or batch PATCH operation, so PATCHes
  remain sequential. An apply can now select `applySourceKeys`, an exact subset of the current plan's changed keys.
  The action verifies the whole plan digest and budgets before mutation, caps the selected partition at 500 updates,
  verifies that partition by readback, and reports current outstanding keys. Every later partition needs a fresh plan,
  digest, and approval because the prior partition changed Forward state.

The current `planDigest` algorithm and value must not change in this pass.

## Verified facts

### What the action receives

`@dynatrace-sdk/automation-action-utils` declares an action as `(input: T) => Promise<R>`; there is no caller or
execution-context argument. The repository action entry point only re-exports that function.

The installed SDK does expose two relevant facilities:

- `getTrustedActionContext()` returns an engine-validated context or `null`. Its typed data contains an optional
  approval result with `originalResult`, an untyped `approvalEvent`, and the engine-determined outcome `APPROVED`,
  `DECLINED`, or `TIMED_OUT`. It declares no human subject, user ID, email, or service principal.
- `getApprovalNonce()` extracts a nonce from engine metadata, but is valid only inside an approval action.

The runner internally checks `dtRuntime.callerServiceMetadata.workflowExecutionId` before accepting the reserved
trusted-context input. That ID establishes that the engine invoked the action; it is not a human identity, is not part
of the public action API, and is not exposed to the action by a typed SDK accessor.

`@dynatrace-sdk/app-environment.getCurrentUserDetails()` is not an answer. It is documented for the currently logged-in
web user. Outside the web runtime it returns `dt.missing.user.*` placeholders. A Workflow AppEngine invocation has no
logged-in browser user, and a scheduled or event-triggered Workflow may have no contemporaneous human caller at all.

**Finding:** this regular action has no trustworthy caller or human approver identity at runtime. The untyped
`approvalEvent` must not be parsed for authorization until Dynatrace documents and types an identity field with clear
engine-owned provenance. Available context can be emitted as telemetry, but cannot satisfy separation of duties.

### Forward update surface

The inspected source is `~/src/fwd/api/apis/checks.yaml` plus `~/src/fwd/api/schemas/checks/`. It defines only:

- `GET`, `POST`, and `DELETE` on `/snapshots/{snapshotId}/checks`; and
- `GET` and `DELETE` on `/snapshots/{snapshotId}/checks/{checkId}`.

There is no checks PATCH operation, no bulk-update path, and no bulk-update request schema. The checked-in specification
also does not describe the integration's existing `POST /checks?bulk` create extension. Other Forward APIs have bulk
or collection PATCH operations, but the Checks API does not. The live tenant accepts the integration's single-item
`PATCH /snapshots/{snapshotId}/checks/{checkId}` and bulk-create extensions; that live behavior does not create a
documented contract. **Forward does not currently provide a supported, documented bulk or batch PATCH for checks.**
Production acceptance should obtain Forward's written compatibility commitment for the item-PATCH and bulk-create
extensions already in use.

### Live PATCH measurement

On 2026-07-25, the dedicated harness `scripts/measure-forward-patch-throughput.mjs` was run against Forward network
`252606`, latest processed snapshot `1354916`. It selected one integration-managed Existential check, appended a
temporary marker to its note, issued one timed PATCH, restored the complete original patchable payload in a `finally`
block, and verified the restored payload by GET readback.

| Observation | Result |
| --- | ---: |
| Timed PATCH, including first-mutation CSRF bootstrap | 163 ms (rounded) |
| Restoration PATCH, reusing CSRF state | 113 ms (rounded) |
| Raw 120-second ceiling from the slower unrounded observation | 735 updates |
| Restored readback | exact patchable-payload match |

The raw value is not a safe action limit: 735 PATCHes consume essentially the entire deadline and reserve nothing for
snapshot lookup, host resolution, path preflight, package construction, two full check inventories, digest work, or
post-apply verification. One sample is also not a latency SLO. A limit of **500 updates per invocation** consumes about
81.5 seconds at the observed slower rounded rate and reserves about 38.5 seconds, or 32% of the deadline, for all other
work and variance. Therefore 735 is the measured arithmetic ceiling; 500 is the honest supportable limit today.

The harness is locked to network `252606`, requires a second explicit network confirmation before mutation, accepts
only an integration-managed check, performs no bulk mutation, and does not print credentials.

## A. Add opt-in engine approval

### Options

| Option | What it breaks | What it costs | What it buys |
| --- | --- | --- | --- |
| Keep `planDigest` as the only approval token | Nothing immediately. | Auditor exception, operating procedure, and acceptance of indefinite replay when state returns to the same shape. | No implementation work; deterministic plans remain easy to compare. It does not solve the blocker. |
| Add caller-supplied `approverId`, `issuedAt`, and nonce to the digest | Every existing apply caller must send the new fields; every old approved digest fails. Stable repeated plans disappear if time or randomness enters `planDigest`. | UI and Workflow changes, validation, versioning, and operator retraining. | Stateless expiry if time is bound, but no trustworthy identity. A supplied approver ID is forgeable, and a nonce is replayable unless consumption is stored. |
| Add an opt-in Dynatrace Workflow engine-approval mode **(implemented)** | No existing caller. Callers opt in per apply; changing the default later would be a breaking policy change. | Approval-enabled Workflow configuration, nonce wiring, timeout/error UX, and audit-retention policy. | Engine-owned outcome, engine-issued nonce, bounded freshness, and Workflow audit while preserving deterministic plans. |
| Require an externally signed approval envelope | All applies must call or be fed by the approval service; old calls fail after enforcement. | External service/database, signing-key custody and rotation, availability, incident response, and integration scopes. | Strong explicit approver identity, expiry, one-time nonce, revocation, and durable audit with independently defined semantics. |
| Treat the Forward connection or Workflow executor as the approver | No request-schema break, but it invalidates the claimed separation of duties. | Mostly documentation, plus an auditor exception. | Attribution to an automation/service identity only. It does not identify the human who approved the plan. |

### Implemented additive contract

`approvalMode` accepts `digest` or `engine-approval` and defaults to `digest`. The default is intentionally
byte-compatible at the request and digest-computation boundaries, but it remains **authorization by possession of the
digest and is not the production-grade mode**. A future default flip or removal of `digest` would invalidate existing
apply callers and therefore requires a separately announced migration.

For an `engine-approval` apply, before the first mutation the action requires all of the following:

1. `getTrustedActionContext()` contains an approval result with engine-determined outcome `APPROVED`.
2. The engine-carried `originalResult` is this action's `plan` result and its `planDigest` exactly equals both the
   submitted digest and the current full-plan digest.
3. The request's `approvalNonce` exactly matches `getApprovalNonce()` from engine runtime metadata. A caller-supplied
   nonce has no authority by itself.
4. The original plan's action-generated `generatedAt` is valid, is not in the future, and is no more than 15 minutes
   old. Caller-supplied issue or expiry timestamps are not accepted.

The nonce, time, approval event, and authorization mode stay out of `planDigest`. Successful apply evidence contains
the mode and, for engine approval, the outcome, TTL window, original plan time, and SHA-256 of the nonce. It never
returns the raw nonce or untyped approval event. The publish-safe status projection accepts `approval.mode` and emits
only `forward.dynatrace.authorization_mode`.

The earlier claim that this necessarily required a breaking v2 was too broad: mandatory enforcement would break all
current apply callers, but a per-request opt-in does not. The remaining limit is narrower. The action cannot name the
human approver, independently prove audit retention, revoke an approval, or atomically consume a nonce. It trusts the
AutomationEngine's protected approval lifecycle and keeps the validity window short. Deployments that require an
action-owned one-time-use record or signed human subject still need a least-privileged external approval service or a
future typed Dynatrace capability.

### Durable record choices

The app currently has `app-settings:objects:read` and no storage write scope.

| Store | What it breaks | What it costs | What it buys / why it is insufficient |
| --- | --- | --- | --- |
| Dynatrace Workflow execution and approval history **(recommended for approval)** | Production apply becomes Workflow-only and retention-dependent. | Approval task, access policy, retention/export procedure, and proof that the tenant audit view records the human actor. | Engine-owned outcome, nonce, timestamps, and execution history without granting the app write access. The regular action still cannot read a typed human identity. |
| App settings object | Adds `app-settings:objects:write`, changing the app's privilege profile. | New schema, cleanup, optimistic-concurrency logic, permissions, and review of a scope that can also modify credential-bearing connection objects. | Convenient tenant persistence and revisions. The scope is too broad for this app because it reaches stored Forward credentials; not recommended. |
| Grail event | Adds `storage:events:write` or requires a separately credentialed ingestion path. | Schema, retention, ingest/query cost, latency handling, and audit access controls. | Append-oriented audit history and DQL reporting. Eventual query visibility and lack of compare-and-set make it a poor lock or consumed-nonce authority. |
| Dynatrace document | Adds `document:documents:read` and `document:documents:write`. | Document ownership/sharing, locking, cleanup, retention, content schema, and conflict handling. | Human-readable versioned state and an API with document locking. It is mutable, action ownership can be awkward, and it still expands app privilege; plausible only in a separate least-privileged state service. |
| Forward tags | Requires extra Forward mutations outside the approved plan and changes check fingerprints. | Tag lifecycle, snapshot propagation, cleanup, collisions, and recovery when a create target does not yet exist. | State near the object, but it identifies the Forward API service user rather than the human approver, cannot record approval before a create exists, and pollutes network intent. Reject. |
| External approval/state service | Existing self-contained deployment becomes dependent on another system. | Infrastructure, authentication, signing, availability, data handling, and support. | Best-defined identity, atomic nonce consumption, revocation, and retention when the tenant requires stronger audit semantics than Workflow exposes. |

## B. Make apply scale without lying about the deadline

### Options

| Option | What it breaks | What it costs | What it buys |
| --- | --- | --- | --- |
| Use a Forward bulk PATCH | Cannot be implemented against the inspected contract. | Forward product/API work and a documented atomicity/partial-failure contract. | Fewer round trips and the best eventual scale, if Forward adds it. There is no such checks endpoint today. |
| Convert to a Dynatrace stateful/resumable action **(recommended target)** | Action lifecycle and result shape change; callers can no longer assume one invocation is terminal. Current “fresh plan after any partial failure” semantics need a v2 definition. | Validation of AutomationEngine persistence, state limits, retention, retry/at-least-once behavior, and a reconciliation-aware state machine. | Durable progress without an app storage write scope, bounded chunks across invocations, and one Workflow execution/audit trail. |
| Persist progress in app settings, a document, Grail, or an external store | Adds scopes or infrastructure and changes failure/retry semantics. | Concurrency control, encryption/access, cleanup, retention, and recovery logic; Grail is not a compare-and-set store. | Cross-invocation resume independent of action-runner state. A document or external transactional service is more credible than Grail; app settings has the unacceptable credential-scope issue above. |
| Select an approved update subset per invocation **(implemented)** | No existing caller; `applySourceKeys` is optional. | Fresh plan/digest/approval and repeated reads for every later partition. | First-class bounded progress while preserving stateless stop-and-restage semantics. |
| Enforce a 500-update fail-fast cap | Legacy full applies above 500 still reject. Explicit partitions above 500 also reject. | A documented limit and clear remediation. Capacity must be re-measured after material Forward/AppEngine changes. | No mid-apply timeout for the known oversized class and no mutation before rejection. |
| Parallelize individual PATCHes | Stop-on-first semantics cease to be literal because requests are already in flight; rate-limit and partial-failure exposure increase. | Concurrency tuning, Forward load testing, 429 behavior, idempotency analysis, and much more complex recovery. | Higher throughput without a new endpoint. Reject until Forward documents safe concurrency and update idempotency. |
| Keep the 1,000-update allowance and accept timeouts | Nothing immediately. | Indeterminate partial applies, repeated replans, incident handling, and a production blocker. | No engineering work. Reject. |

### Implemented partition semantics

Omitting `applySourceKeys` retains the legacy full-plan behavior: `approvedSourceKeys` must equal the complete changed
set and readback must find no remaining creates, changes, or collisions. Supplying `applySourceKeys` selects a
non-empty, duplicate-free subset of the current changed set. `approvedSourceKeys` must exactly equal that subset.

The action still computes and rechecks `approvedPlanDigest` over the **whole** current plan immediately before the
first write. Collisions, incomplete path evidence, a stale digest, or a full-plan create/update budget overrun block
the partition before mutation. Creates are not partitioned: every planned create is still applied under the existing
create budget. Only the selected changed rows are PATCHed, and their count must be at most 500.

Readback requires all creates and selected updates to have converged and requires zero collisions. It returns current
reconciliation counts plus `applyScope.appliedSourceKeys`, `outstandingSourceKeys`, and `outstandingCount`. Outstanding
keys are operator guidance, not a continuation token.

There is deliberately no fiction that one digest authorizes a mutation sequence. A successful partition changes
existing fingerprints, so the old whole-plan digest becomes stale. Before applying any outstanding key, the operator
must stage and approve a new plan against current Forward state. Drift in any part of the plan before a partition
causes the full digest recheck to fail, even if the selected subset itself did not drift. Drift during mutation can be
reported as outstanding, while failure of a selected key to converge stops the apply and requires replanning.

### Resume semantics without an app write scope

There is no automatic resume. After a partition or partial mutation the current-state reconciliation produces a
different digest, so the action intentionally requires a new plan. A caller-provided `updatedSoFar` counter would be
forgeable and would not prove which objects were updated.

The installed automation SDK supports stateful actions whose intermediate result is supplied by AutomationEngine on a
later invocation. A v2 resumable action can use that engine state instead of adding app write scope. Its durable
progress envelope must include the original approval challenge, snapshot/network, desired fingerprints, original
fingerprints and IDs, completed source keys, remaining source keys, counts, and a version. On every resume it must
re-read Forward and classify every target as exactly original (pending), exactly desired (completed), or neither
(conflict). Only the first two states are safe; any conflict stops and requires a new plan. An indeterminate PATCH must
be resolved by readback before another write.

This is not safe to retrofit as an invisible internal loop. Stateful action size, retention, cancellation, duplicate
delivery, and Workflow timeout behavior must first be tested on the deployed Dynatrace tenant. If those guarantees are
not adequate, resumable apply cannot be done well without a transactional external state service.

### Recommended sequence

1. Pilot `engine-approval` and explicit `applySourceKeys` partitions while retaining the compatibility default.
2. If tenant evidence proves the Workflow audit and lifecycle guarantees, migrate production callers and separately
   govern a future default flip. Add stateful chunking only after its retry and persistence semantics are validated.
3. Revisit the update transport only if Forward publishes a checks bulk-update endpoint with explicit validation, atomicity, per-item error,
   retry, and idempotency semantics.

## Deliberately deferred

- No expiry, nonce, authorization mode, or partition selection is added to `planDigest`.
- No typed caller or approver identity is required or inferred; the untyped approval event is never authorization.
- No action-owned consumed-nonce store, revocation record, or durable approval record is introduced.
- No durable progress store or resumable/stateful apply is introduced.
- No parallel PATCH execution is introduced.
- No Forward network other than the single restored timing probe on `252606` is mutated.
