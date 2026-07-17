# Validation Matrix

This matrix records executable coverage and current live evidence for the independent Dynatrace-to-Forward integration.

| Capability | Executable evidence | Remaining live gate |
| --- | --- | --- |
| Dynatrace dependency query and normalization | `npm run dynatrace:normalize:test` and `npm run dynatrace:workflow:generate:test` cover normalized application, service, endpoint, protocol, owner, confidence, mapping state, problem binding, and provenance. | Customer-owned Grail query over real application dependencies. |
| Forward intent package | `npm run forward:package:test`, `npm run schemas:validate`, and `npm run acceptance:bundle:test` cover package generation, eligibility, checksums, optional NQE artifacts, and validate-only evidence. | Customer review of the exported `NewNetworkCheck[]` package. |
| Forward handoff and reconciliation | `npm run forward:handoff:test`, `npm run forward:handoff:server:test`, and `npm run forward:import:test` cover immutable publication, authenticated read/write identities, idempotent create-missing reconciliation, drift reporting, and approval-gated mutation. | Customer-approved dry-run and, if desired, apply in a non-production network. |
| Host resolution and modeled paths | `npm run forward:resolve-hosts:test`, `npm run forward:path-evidence:test`, and `npm run forward:nqe-preview:test` cover exact resolution, ambiguous/unmapped handling, bounded `/paths-bulk` evidence, and sanitized aggregates. | Customer-approved read-only execution against the selected Forward network. |
| Dynatrace status and network evidence | `npm run dynatrace:status:publish:test` and `npm run dynatrace:network-evidence:publish:test` cover publish-safe OpenPipeline events, exact snapshot identity, explicit provenance, and topology/credential exclusion. | Grail query-back in the customer tenant. |
| Check-health transitions | `npm run forward:check-health:test` covers quiet baselines, stable transition IDs, restart safety, bounded publication, and retry behavior. | One customer-approved real failure/recovery pair. |
| Security correlation | `npm run security:correlate:test` and `npm run dynatrace:security-correlation:publish:test` cover separate evidence facts, traceable identity mappings, bounded queues, and publication. | Customer-approved findings, exposure data, retention, and owner mapping. |
| Runtime and release | `npm run runtime:validate`, `npm run systemd:install:test`, release signature/ref/immutability tests, `npm run security:audit`, and `npm run release:package:smoke` cover deployment templates and release provenance. | Customer platform hardening and operational ownership. |
| Dynatrace app | `npm run repo:validate`, `npm run dynatrace:deploy:test`, `npm run lint`, and `npm run build` guard the integration boundary, canonical `Forward` / `com.forward.dynatrace` identity, separate `my.forward` sandbox path, explicit live/synthetic rendering, and production bundle. | Install `my.forward` in a sandbox, then verify the signed `com.forward.dynatrace` archive in non-production. |
| Site Reliability Guardian | `npm run dynatrace:guardian:validate`, `npm run schemas:validate`, and `npm run dynatrace:change-gate:publish:test` cover the lifecycle Guardian, Monaco Workflow, six DQL objectives, current SDLC event/action/result contracts, bounded execution context, exact gate correlation, non-Guardian compatibility, and the missing-evidence objectives. | Deploy the package and query back one pass, one deliberate objective failure, and one missing-evidence fail-closed run. |
| High-cardinality evidence | `npm run load:scale` covers 2,500 synthetic dependency rows. The separate change-demo `make scale-profile-validate` gate now renders 49 nodes, 38 Linux endpoints, 11 modeled network devices, 50 observed probe definitions, and 50 deterministic persistent-check previews while preserving the six-flow smoke profile. | Deploy the scale profile in a dedicated network; validate three reset/collect/reconcile cycles, first-create and second-unchanged behavior, 50 Grail rows, path failure/recovery, zero unexplained drift, and timing/resource budgets. |

## Current Live Evidence

- On 2026-07-17, Forward network `252414` produced processed snapshot `1347038` from the live containerlab network.
- Six successful containerlab service probes were published as explicit live (`demo.synthetic=false`) dependency events and queried back from Grail. Their source is visibly labeled `containerlab-live-service-probe`; they are not represented as OneAgent AppMap discovery.
- Six executed Forward path searches returned `6 reachable / 0 blocked / 0 ambiguous / 0 unmapped / 0 failed`.
- Dynatrace accepted live event `FWD-LIVE-SNAPSHOT-1347038` with `forward.dynatrace.synthetic=false` and queried it back from Grail.
- Signed package `dynatrace-forward-20260717143241` reconciled idempotently with `6 planned / 6 unchanged / 0 create / 0 changed / 0 stale`; the signature status queried back from Grail is `verified`.
- App revision `2.0.4-live.1347038` was deployed to the non-production Dynatrace tenant with the live dependency, path, target, package-integrity, and reconciliation sections populated from those three Grail streams.
- That deployment predates the canonical production app identity. It validates behavior, not installation or upgrade of
  `com.forward.dynatrace`; the identity migration and signed-install gates remain open.
- The deployed app queries only explicit live rows in its normal runtime; saved rehearsal data is available only to the checked capture harness.

This closes the local demonstration evidence gap. It does not replace the customer-owned live gates in the matrix above.

## Full Gate

Run on Node 24 before handoff:

```bash
npm run ci
```
