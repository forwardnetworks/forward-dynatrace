# Productionization design: approval and scalable apply

Status: design basis for this additive hardening pass. Expiry, nonce enforcement, required approver identity, and
resumable apply remain deliberately out of scope until the mutation contract is explicitly versioned and approved.

## Executive decision

- **Approval:** the current action cannot obtain a trustworthy human caller or approver identity. Move the eventual
  approval boundary to an engine-owned Dynatrace Workflow approval action and treat its audit history as the approval
  record. A future v2 apply must require the engine-validated approval outcome and approval nonce, plus a short expiry,
  instead of treating possession of `planDigest` as approval. Do not accept a caller-supplied identity as authority.
  If the configured Workflow approval/audit system cannot prove the human actor, this requirement cannot be done well
  inside the current app; use an external signed approval service or wait for a typed Dynatrace identity capability.
- **Apply scale:** Forward's checked-in Checks OpenAPI specification has no bulk or batch PATCH operation. Keep PATCHes
  sequential until Forward documents stronger semantics. In this pass, reject more than 500 planned updates before the
  first mutation and report confirmed progress on an interrupted apply. For the eventual v2 contract, use Dynatrace's
  stateful action facility to persist a reconciliation-aware progress envelope between invocations, subject to a
  focused validation of state retention, size, retry, and at-least-once behavior.

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

## A. Replace possession-based approval

### Options

| Option | What it breaks | What it costs | What it buys |
| --- | --- | --- | --- |
| Keep `planDigest` as the only approval token | Nothing immediately. | Auditor exception, operating procedure, and acceptance of indefinite replay when state returns to the same shape. | No implementation work; deterministic plans remain easy to compare. It does not solve the blocker. |
| Add caller-supplied `approverId`, `issuedAt`, and nonce to the digest | Every existing apply caller must send the new fields; every old approved digest fails. Stable repeated plans disappear if time or randomness enters `planDigest`. | UI and Workflow changes, validation, versioning, and operator retraining. | Stateless expiry if time is bound, but no trustworthy identity. A supplied approver ID is forgeable, and a nonce is replayable unless consumption is stored. |
| Use a Dynatrace Workflow approval action and require its trusted outcome and nonce in v2 **(recommended)** | Direct v1 apply can no longer be the production mutation path. Existing apply Workflows must add the approval lifecycle and consume a new result shape. | Workflow migration, approval-action implementation, timeout/error UX, audit-retention policy, and validation of SDK approval semantics. | Engine-owned approval outcome, engine-issued nonce, Workflow execution audit, and a natural place for human approval. It removes the digest string from the role of bearer authorization. |
| Require an externally signed approval envelope | All applies must call or be fed by the approval service; old calls fail after enforcement. | External service/database, signing-key custody and rotation, availability, incident response, and integration scopes. | Strong explicit approver identity, expiry, one-time nonce, revocation, and durable audit with independently defined semantics. |
| Treat the Forward connection or Workflow executor as the approver | No request-schema break, but it invalidates the claimed separation of duties. | Mostly documentation, plus an auditor exception. | Attribution to an automation/service identity only. It does not identify the human who approved the plan. |

### Recommendation and v2 contract

Build a versioned approval lifecycle around a Dynatrace Workflow approval action:

1. The initial invocation produces the current plan plus an approval challenge containing the unchanged v1
   `planDigest`, an engine-generated nonce, `issuedAt`, and `expiresAt` (recommended initial TTL: 15 minutes).
2. The Workflow approval UI shows the network, snapshot, counts, budgets, digest, and complete changed-source-key set.
3. The post-approval invocation accepts only the engine-validated `APPROVED` outcome and the approval-action nonce. It
   applies the exact plan carried in or referenced by the engine-owned original result.
4. The Workflow execution/audit record is the durable approval record. If the product must return the human approver
   in its own action result, production must wait for a documented typed Dynatrace approver identity or integrate an
   approval service that supplies a verifiable signed subject. An untyped event field is not enough.
5. Enforce expiry before mutation. Enforce single use through the approval engine's one-shot lifecycle or a durable
   consumed-nonce store; a random value alone prevents guessing, not replay.

Do not put the time or nonce into the existing `planDigest`. Introduce a separate versioned `approvalChallengeDigest`
or signed envelope that includes `{ planDigest, nonce, issuedAt, expiresAt, workflow/approval execution reference }`.
This preserves deterministic plan comparison while correctly making v2 approval instances unique.

The break is quantifiable: plan-only callers can remain compatible, but **100% of existing apply callers and all
previously issued digest-only approvals become invalid once v2 enforcement is enabled**. A staged migration can emit
both v1 plan data and the v2 challenge first, update Workflow templates, then disable digest-only production apply.

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
| Narrow each plan/apply to at most 500 updates | Large desired sets require multiple separately selected dependency partitions and approvals. | Workflow partitioning, repeated path evidence/inventory reads, multiple approval records, and more operator time. | Works with today's stateless contract, preserves stop-and-restage semantics, and bounds each failure domain. |
| Enforce a 500-update fail-fast cap **(recommended now)** | Requests with 501–1,000 updates were syntactically allowed and will now be rejected. They were not supportable under the measured deadline; plan remains available for partitioning. | A documented limit and clear remediation. Capacity must be re-measured after material Forward/AppEngine changes. | No mid-apply timeout for the known oversized class, no mutation before rejection, and an honest operating envelope. |
| Parallelize individual PATCHes | Stop-on-first semantics cease to be literal because requests are already in flight; rate-limit and partial-failure exposure increase. | Concurrency tuning, Forward load testing, 429 behavior, idempotency analysis, and much more complex recovery. | Higher throughput without a new endpoint. Reject until Forward documents safe concurrency and update idempotency. |
| Keep the 1,000-update allowance and accept timeouts | Nothing immediately. | Indeterminate partial applies, repeated replans, incident handling, and a production blocker. | No engineering work. Reject. |

### Resume semantics without an app write scope

Today there is no resume. After a partial mutation the current-state reconciliation produces a different digest, so
the action intentionally requires a new plan. A caller-provided `updatedSoFar` counter would be forgeable and would not
prove which objects were updated.

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

1. This additive pass: preserve `planDigest`; expose only bounded trusted-context telemetry; enforce the 500-update
   pre-mutation cap; include confirmed created/updated progress in interruption and verification errors.
2. Contract v2: combine Workflow approval outcome/nonce/expiry with stateful chunked apply. Keep item PATCH sequential,
   leave time-based safety margin before yielding, and re-read/reconcile on every invocation.
3. Revisit only if Forward publishes a checks bulk-update endpoint with explicit validation, atomicity, per-item error,
   retry, and idempotency semantics.

## Deliberately deferred

- No expiry or TTL is added to `planDigest`.
- No nonce is generated or required.
- No caller or approver identity is required or inferred.
- No durable progress store or resumable/stateful apply is introduced.
- No parallel PATCH execution is introduced.
- No Forward network other than the single restored timing probe on `252606` is mutated.
