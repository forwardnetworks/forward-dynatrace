# Forward for Dynatrace Design-Partner Pilot

Status: active
Owner: Forward product and engineering with Dynatrace tenant, observability, security, and network owners
Last updated: 2026-07-18

## Objective

Validate Forward for Dynatrace first in a low-impact sandbox and then against real non-production application and
network evidence. Establish a closed evidence loop without copying whole topology maps between platforms: Dynatrace owns
application dependencies and service health, Forward owns modeled network paths and intent, and the integration joins
bounded results through shared context and tags.

## Non-Goals

- Do not include any design-partner name, tenant URL, credentials, private topology, or application data in this repo.
- Do not write to Forward from the Dynatrace app or store Forward credentials in Dynatrace.
- Do not treat sandbox fixture data as non-production acceptance evidence.
- Do not make the first pilot a release-blocking CI/CD gate.
- Do not replicate complete Forward topology into Smartscape or complete Smartscape topology into Forward.

## Progress

- [x] Build and validate the native Dynatrace app, package export, Forward reconciliation, and sanitized readback.
- [x] Select production identity `com.forward.dynatrace` and sandbox identity `my.forward`.
- [x] Define clean installation under the production or sandbox identity; experimental installs are removed, not
  migrated.
- [x] Publish immutable `v1.0.2` release artifacts and verify checksums, release signature, SBOM, attestations, image
  digest, signer workflow, and zero-result vulnerability scan.
- [ ] Produce and install the Dynatrace-signed `com.forward.dynatrace` archive; release checksum signing alone does not
  satisfy the Dynatrace production identity gate.
- [ ] Install the unsigned sandbox identity and complete the smoke checklist.
- [ ] Agree on the minimum dependency and execution-context tagging contract.
- [ ] Validate a Site Reliability Guardian vertical slice.
- [x] Exercise a high-cardinality lab package with 240 observed dependencies and 240 persistent intent checks, including
  create, unchanged, regression, recovery, and live Forward/Grail readback.
- [ ] Promote the signed app into non-production and validate against authoritative service evidence.
- [x] Add explicit Read Only, Network Operator, and Network Admin package/runtime profiles with exact match enforcement,
  profile-aware NQE behavior, non-mutating readiness, and Network Admin-only check synchronization.

## Plan

### 1. Forward release package

Owner: Forward engineering and product

- Publish the exact signed `com.forward.dynatrace` release candidate.
- Provide `my.forward` sandbox clean-install instructions and signed `com.forward.dynatrace` production instructions.
- Publish required Dynatrace scopes, package-handoff requirements, checksums, SBOM, attestations, and rollback steps.
- Assign production support, release approval, and escalation ownership.

Acceptance: a tenant administrator can verify the archive and install it without repository-local credentials or
author assistance.

Implementation status: immutable `v1.0.2` source, app/importer archives, checksum signature, SBOM, attestations, GHCR
digest, and independent verification are published. A tenant-installable Dynatrace-signed production archive and named
support ownership remain open.

### 2. Sandbox installation

Owner: Dynatrace sandbox administrator with Forward engineering support

- Establish how the sandbox trusts the unsigned `my.forward` archive.
- Install the app, verify requested scopes, open every app view, and run an on-demand Workflow export.
- Confirm the app makes no Forward call and that the handoff receives the exact checksummed package bytes.
- Record defects and uninstall/rollback results before touching shared non-production.

Acceptance: install, smoke, on-demand export, and uninstall all pass in the sandbox; no production or non-production
data is required for this phase.

### 3. Ownership and tagging contract

Owner: Dynatrace observability owners, network owners, and Forward product

- Keep Dynatrace authoritative for service identity, dependency observations, telemetry, and historical service health.
- Keep Forward authoritative for resolved endpoints, possible network paths, intent checks, and snapshot comparisons.
- Define stable correlation fields for application, service entity, environment, location or failure domain, owner,
  criticality, protocol, port, change/run identity, and evidence timestamp.
- Define eligibility and review behavior for missing, ambiguous, low-confidence, or many-to-one endpoint mappings.

Acceptance: one reviewed mapping document can deterministically select both the Dynatrace health scope and the Forward
network scope without importing either platform's complete topology into the other.

Implementation status: `schemas/forward-guardian-execution-context.schema.json` now defines the proposed bounded
contract and the change-event publisher enforces exact change, service, network, snapshot, and run correlation. Design
partner approval of the field dictionary remains open.

### 4. Site Reliability Guardian vertical slice

Owner: Dynatrace automation owner with Forward integration engineering

- Use a lifecycle guardian for change validation and define DQL-backed objectives for availability, performance,
  capacity, log or trace health, and any required service-level guardrail.
- Trigger the guardian through a Dynatrace Workflow when the Forward-side runtime publishes a sanitized validation
  event. Include bounded execution context so results can be correlated to the same change, run, and evidence window.
- Query the finished guardian validation result and display its aggregate pass, warning, fail, or informational state
  beside Forward path and reconciliation evidence.
- Validate one passing run and one deliberately failing objective without allowing either platform to assert facts owned by
  the other.

Dynatrace documents that a guardian groups objectives, executes through Workflows, uses DQL-backed indicators, and can
be triggered manually or automatically. Auto-adaptive thresholds need at least five validation runs before they become
active, so the first pilot should start with reviewed static thresholds and collect learning history before evaluating
adaptive thresholds. See [Site Reliability Guardian](https://docs.dynatrace.com/docs/shortlink/srg-landing).

Acceptance: a single correlation identity connects the Forward before/after evidence, the guardian execution, every
objective result, and the app's aggregate display; missing or stale evidence fails closed.

Implementation status: the Monaco lifecycle Guardian and Workflow package, six starter objectives, SDLC trigger mode,
result DQL, and mechanical validation are checked in. Tenant deployment and the pass/fail/missing-evidence query-back
remain open.

### 5. High-cardinality integration evidence

Owner: Forward demo engineering in the separate change-demo repository

- Add an upstream-native containerlab profile with 40–50 total nodes and at least 24 lightweight Linux client, API,
  application, database, queue, DNS, and shared-service endpoints.
- Emit at least 200 distinct, source-labeled dependency candidates and resolve them into persistent Forward intent
  checks; every demonstration relationship must come from a real instrumented container transaction.
- Validate first-run create, second-run unchanged reconciliation, read-only path evidence, one bounded failure set, and
  a clean reset to baseline.
- Add filtering, aggregation, and pagination so the app demonstrates scale without rendering an unreadable table.
- Record CPU, memory, collection duration, snapshot processing time, query duration, and package reconciliation time.

Acceptance: the profile survives three reset/collect/reconcile cycles, produces zero unexplained drift, and the app
remains usable with the full evidence set. The active six-flow profile remains the fast smoke path.

Implementation status: the separate change-demo repository deployed the isolated 49-node profile with 38 Linux
endpoints, 11 modeled network devices, 23 instrumented services, ten transaction generators, and 240 current HTTP/DNS
relationships. Grail returned exactly 240 live client-span relationships and Forward evaluated all 240 as reachable.
The signed Network Admin plan created the 190 missing checks without updating or deactivating existing checks; both
post-apply verification and a new independent reconciliation reported all 240 unchanged. Two additional clean reset
cycles and final timing/resource budgets remain open.

### 6. Non-production promotion

Owner: Dynatrace non-production administrator, network owner, and Forward product

- Install only the signed `com.forward.dynatrace` release verified in task 1.
- Select a bounded real non-production service scope with matching Forward coverage.
- Run validate-only, reviewed apply, unchanged rerun, guardian pass/fail, status readback, and rollback.
- Review telemetry cost, query cost, permissions, data retention, failure handling, and operator workload.

Acceptance: authoritative Dynatrace and Forward evidence agree on identity and time window, operators can explain every
decision, and rollback leaves no orphaned schedules, connections, or managed checks.

### 7. Product and partner alignment

Owner: Forward and Dynatrace product management

- Assign the owning integration and extension teams.
- Decide distribution, signing authority, support boundary, compatibility policy, release cadence, and escalation path.
- Define the later maturity gate for advisory dashboard use versus automated release/change enforcement.

Acceptance: ownership and support decisions are written before general availability.

## Verification

- Run `npm run ci` on Node 24 for every release candidate.
- Verify app identity and Workflow action references mechanically.
- Verify the exact signed archive, checksum, SBOM, attestation, and rollback path.
- Verify the sandbox and non-production phases use different evidence labels and app IDs.
- Verify one guardian pass, one guardian failure, and one missing-evidence fail-closed outcome.
- Verify the high-cardinality profile meets its count, idempotency, reset, and resource-budget criteria.

## Decision Log

| Date | Decision | Reason |
| --- | --- | --- |
| 2026-07-17 | Keep the plan customer-neutral. | The same pilot sequence must be reusable with multiple design partners. |
| 2026-07-17 | Use `my.forward` only for unsigned sandbox work and `com.forward.dynatrace` for signed installs. | Sandbox convenience must not become the production identity. |
| 2026-07-17 | Join evidence through context and tags rather than duplicating full topology maps. | Each product remains authoritative for its own model and avoids stale copies. |
| 2026-07-17 | Start Site Reliability Guardian with static thresholds. | Auto-adaptive thresholds require validation history before they provide a decision. |
| 2026-07-17 | Keep the 40–50-node scale profile in the change-demo repository. | This repository stays independently installable and contains no demo-lab orchestration. |
| 2026-07-17 | Use an opt-in SDLC event publisher mode for Guardian automation. | Lifecycle Guardians require the SDLC stream, while existing batch event consumers remain unchanged. |
| 2026-07-18 | Offer one workflow with three explicit Forward access profiles. | Design partners can start read-only, add arbitrary NQE under Network Operator, or enable managed check synchronization under Network Admin without changing the Dynatrace trust boundary. |

## Evidence To Capture

- release commit, tag, archive ID, checksums, signer, SBOM, attestations, and image digest;
- sandbox install, smoke, Workflow run, handoff receipt, and uninstall evidence;
- approved field dictionary and mapping decision counts without private values;
- guardian ID, execution context hash, objective counts, aggregate result, and run timestamps;
- Forward network/snapshot/package/run IDs and aggregate reconciliation counts;
- scale-lab node, endpoint, dependency, check, path, drift, reset, timing, CPU, and memory counts;
- non-production install, validation, rollback, and operator approval records.

## Exit Criteria

- A signed production identity is published with named support ownership.
- The sandbox phase is repeatable by an operator who did not author the integration.
- The tagging contract resolves a bounded real non-production scope in both platforms.
- Site Reliability Guardian and Forward evidence are correlated and fail closed on missing evidence.
- The high-cardinality lab proves more than six checks without sacrificing idempotency or reset reliability.
- The signed non-production run and rollback complete with authoritative evidence from both platforms.
