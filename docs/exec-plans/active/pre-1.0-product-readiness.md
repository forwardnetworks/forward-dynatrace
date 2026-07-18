# Forward for Dynatrace Pre-1.0 Product Readiness

Status: active
Owner: Forward product and engineering with Dynatrace, security, platform, and network design-partner owners
Last updated: 2026-07-18

## Objective

Validate the `0.10.x` design-partner preview as a reproducible, customer-operated non-production integration and use
that evidence to decide the scope, ownership, distribution, and support contract for a future `1.0.0`. The current
acceptance boundary covers live Dynatrace dependencies, deterministic package generation, customer-approved handoff,
Forward-side reconciliation, bounded writes under an explicit access profile, and sanitized Dynatrace readback.

## Non-Goals

- Do not describe any `0.x` build as generally available or supported production software.
- Do not move Forward write credentials or write calls into Dynatrace.
- Do not present generated load-test rows, fixtures, replay, or seeded events as live customer evidence.
- Do not put customer names, tenant URLs, private topology, credentials, or customer orchestration in this repository.
- Do not introduce a compatibility layer for the prematurely published `v1.0.x` artifacts.

## Progress

- [x] Establish the product boundary, three Forward access profiles, signed package, immutable plan, approval, write
  budgets, post-apply readback, and sanitized status contracts.
- [x] Validate 240 live instrumented HTTP and DNS relationships in the separate high-cardinality change-demo lab.
- [x] Validate Network Admin create-missing apply and an idempotent `240 unchanged` reconciliation.
- [x] Reset repository and application metadata to the `0.10.0` design-partner preview line.
- [x] Require every future `0.x` GitHub release to be a prerelease and prevent it from moving the GHCR `latest` tag.
- [ ] Complete three clean reset, collect, reconcile, and rollback cycles with resource and timing evidence.
- [ ] Install the preview in a design-partner sandbox and record operator-owned install/uninstall evidence.
- [ ] Agree on the tagging dictionary, Site Reliability Guardian thresholds, and non-production acceptance scope.
- [ ] Assign product ownership, signing authority, support, compatibility, release, and escalation policy for `1.0.0`.

## Plan

1. Keep the public product repository customer-neutral and independently installable.
2. Keep the runnable live network, traffic generators, reset automation, and meeting-specific dashboard in the private
   change-demo repository.
3. Keep customer decisions, sandbox steps, acceptance evidence, and exact product/demo commit pins in a private
   design-partner overlay.
4. Complete sandbox installation and the Guardian pass, failure, and missing-evidence cases with live telemetry.
5. Repeat the high-cardinality reset and idempotency cycle and record timing, CPU, memory, snapshot, query, and apply
   budgets.
6. Review the pilot evidence with product, Dynatrace, security, and operations owners and either define the `1.0.0`
   promotion contract or record the next preview gaps.

## Verification

- Run `npm run ci` on Node 24 for every reviewed commit.
- Verify all `0.x` releases are marked prerelease and do not publish the mutable `latest` image tag.
- Verify the Dynatrace app contains no Forward credential reader, Forward write client, seeded dependency source, or
  replay fallback.
- Verify the private customer overlay pins exact public-product and private-demo commits.
- Verify one live sandbox install/uninstall, one Guardian pass/failure/missing-evidence sequence, and three clean lab
  reset/reconcile cycles before proposing `1.0.0`.

## Decision Log

| Date | Decision | Reason |
| --- | --- | --- |
| 2026-07-18 | Reset product maturity to `0.10.0`. | The integration is still being shaped with a design partner and must not imply a supported 1.0 contract. |
| 2026-07-18 | Preserve published `v1.0.x` tags and evidence as retired history. | Reusing or deleting public artifacts would weaken provenance and disrupt collaborators. |
| 2026-07-18 | Keep schema identifiers ending in `/v1`. | Schema versions describe wire contracts, not product release maturity. |
| 2026-07-18 | Keep public product, private runnable demo, and private customer overlay separate. | Product code stays reusable while live lab automation and customer context remain appropriately scoped. |

## Evidence To Capture

- reviewed product commit and any immutable `0.x` prerelease tag, checksums, SBOM, attestations, and image digest;
- exact private demo commit and reset/traffic/snapshot/query/reconciliation results;
- sandbox app identity, install/uninstall result, Workflow and Guardian correlation IDs, and aggregate outcomes;
- customer-approved field dictionary, access profile, write policy, and non-production acceptance record;
- timing, CPU, memory, row, path, check, create, unchanged, changed, stale, collision, and rollback counts.

## Exit Criteria

- A non-author operator can install, exercise, reset, audit, and uninstall the preview from checked instructions.
- Live Dynatrace and Forward evidence agree on identity, scope, and time without seeded or replay data.
- The high-cardinality lab survives three clean reset/reconcile cycles with zero unexplained drift.
- Product ownership, signing, support, compatibility, distribution, and escalation decisions are written.
- The owners explicitly approve a `1.0.0` scope; until then all releases remain `0.x` prereleases.
