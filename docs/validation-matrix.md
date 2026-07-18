# Validation Matrix

This matrix records executable coverage and current live evidence for the independent Dynatrace-to-Forward integration.

| Capability | Executable evidence | Remaining live gate |
| --- | --- | --- |
| Dynatrace dependency query and normalization | `npm run dynatrace:normalize:test` and `npm run dynatrace:workflow:generate:test` cover normalized application, service, endpoint, protocol, owner, confidence, mapping state, problem binding, and provenance. | Customer-owned Grail query over real application dependencies. |
| Forward intent package | `npm run forward:access-profile:test`, `npm run forward:package:test`, `npm run schemas:validate`, and `npm run acceptance:bundle:test` cover the exact three-profile vocabulary, package generation, eligibility, checksums, optional NQE artifacts, and validate-only evidence. | Customer review of the exported `NewNetworkCheck[]` package and selected access profile. |
| Forward handoff and reconciliation | `npm run dynatrace:action:test`, `npm run forward:handoff:test`, `npm run forward:handoff:server:test`, `npm run forward:import-plan:test`, `npm run forward:import:test`, `npm run forward:readiness:test`, and `npm run workflow:smoke` cover manifest-bound immutable package IDs, authenticated identities, exact package/runtime profile matching, Read Only and Network Operator write rejection, non-mutating readiness, Network Admin signed create-missing automation, exact-approved replacement/retirement, apply locking, idempotent reconciliation, post-apply readback, per-key outcomes, and sanitized partial-failure recovery. | Customer-approved profile and apply activation in a non-production network; exact plan/approval additionally required for update or retirement. |
| Host resolution and modeled paths | `npm run forward:resolve-hosts:test`, `npm run forward:path-evidence:test`, `npm run forward:nqe-preview:test`, and `npm run forward:nqe-live-smoke:test` cover protected-file authorization, exact resolution, ambiguous/unmapped handling, bounded `/paths-bulk` evidence, Read Only Library query-ID enforcement, Network Operator/Admin arbitrary-NQE eligibility, a plan-only Dynatrace function, the separate Forward-side executor, and sanitized aggregates. | Customer-approved execution under the selected Forward profile against the selected network. |
| Dynatrace status and network evidence | `npm run dynatrace:status:publish:test` and `npm run dynatrace:network-evidence:publish:test` cover publish-safe OpenPipeline events, exact snapshot identity, explicit provenance, and topology/credential exclusion. | Grail query-back in the customer tenant. |
| Check-health transitions | `npm run forward:check-health:test` covers quiet baselines, stable transition IDs, restart safety, bounded publication, and retry behavior. | One customer-approved real failure/recovery pair. |
| Security correlation | `npm run security:correlate:test` and `npm run dynatrace:security-correlation:publish:test` cover separate evidence facts, traceable identity mappings, bounded queues, and publication. | Customer-approved findings, exposure data, retention, and owner mapping. |
| Runtime and release | `npm run runtime:validate`, `npm run systemd:install:test`, `npm run github-actions:validate`, release signature/ref/immutability/published-verifier tests, `npm run security:audit`, and `npm run release:package:smoke` cover deployment templates, protected mounted authorization, immutable GitHub Action pins, exact release membership, normal tag immutability, the bounded pre-customer `v1.0.0` reset ledger, and release provenance. Signed customer kit `v1.0.2` and its independent evidence report are published and verified. | Provision the dedicated least-privilege runtime identity and customer platform ownership. |
| Dynatrace app | `npm run repo:validate`, `npm run dynatrace:deploy:test`, `npm run lint`, and `npm run build` guard the integration boundary, canonical `Forward` / `com.forward.dynatrace` identity, separate `my.forward` sandbox path, direct current-window instrumented-span discovery, explicit live/synthetic rendering, and production bundle. | Install `my.forward` in a sandbox with live instrumented traces, then verify the signed `com.forward.dynatrace` archive in non-production. |
| Site Reliability Guardian | `npm run dynatrace:guardian:validate`, `npm run dynatrace:guardian:readback:test`, `npm run schemas:validate`, and `npm run dynatrace:change-gate:publish:test` cover the lifecycle Guardian, Monaco Workflow, six DQL objectives, 30-second event-settling delay, bounded execution context, Automation execution/task join, exact gate correlation, non-Guardian compatibility, and the missing-evidence objectives. | Run one explicit no-event or no-span validation after the final Workflow package is deployed; the live pass and deliberate failure are complete. |
| High-cardinality evidence | `npm run load:scale` validates 2,500 dependency rows, 2,304 eligible Network Admin checks, and six bounded apply batches; it remains a mechanical load fixture and is never accepted as demo evidence. The separate change-demo gate renders and validates 49 live containers, 38 Linux endpoints, 11 modeled network devices, 23 instrumented services, four transaction generators, 50 real HTTP/DNS relationships, and 50 persistent Forward checks. | Repeat the full reset/regression/recovery cycle for timing and resource budgets; the first create, idempotent reconciliation, 50 Grail relationships, path failure/recovery, and zero unexplained drift are complete. |

## Current Live Evidence

- Signed customer kit `v1.0.2` resolves to commit `de452adaf633c1c002db0d1a7bb23bd267e64f31`. Release run
  `29624454929` and independent verification run `29624548725` passed. The verifier confirmed the checksum signature,
  six asset attestations, a 531-component CycloneDX 1.5 SBOM, image attestation, and zero Trivy results. The production
  importer reference is `ghcr.io/forwardnetworks/forward-dynatrace-importer@sha256:2e56e18b02632564ce62d91983ae0017376e5d0485ef064e9998e445ee701b12`.
- Signed customer kit `v1.0.1` resolves to commit `a89ff21b83f0ee6bb7ffc587718a58232eeaf144`. Release run
  `29622910036` and independent verification run `29622995213` passed. The verifier confirmed the checksum signature,
  six asset attestations, a 531-component CycloneDX 1.5 SBOM, image attestation, and zero Trivy results. The production
  importer reference is `ghcr.io/forwardnetworks/forward-dynatrace-importer@sha256:0bdf9d8810d826c26830b7921ab04f575400859745db3fa38781bb045144e3e6`.
- Signed release `v1.0.0` resolves to commit `ce5a13f2e2122ddd4c5be5a8342a103259857b25`. Release run `29622283324`
  and independent verification run `29622381593` passed. The verifier confirmed six release-asset attestations, the
  checksum signature, a 531-component CycloneDX 1.5 SBOM, image attestation, and zero Trivy results. The production
  importer reference is `ghcr.io/forwardnetworks/forward-dynatrace-importer@sha256:9aec44d63602b43b1351602988232ce21b7a074dd4877f0482019002c8393050`.
- On 2026-07-17, the dedicated live containerlab network produced distinct processed Forward snapshots for baseline,
  regression, and recovery. Tenant-specific snapshot identifiers remain in the protected acceptance record only.
- The lab contains 49 running containers: 11 modeled network devices and 38 Linux endpoints. Twenty-three instrumented
  HTTP services and four transaction generators produced 50 actual HTTP/DNS relationships through the modeled network.
- Dynatrace queried those relationships from OpenTelemetry client and server spans. The recovered Guardian window
  contained 119 scoped instrumented server spans; no dashboard rows or replay events supplied the relationship data.
- Forward evaluated the same 50 relationships: `50/50` reachable at baseline, `4/50` reachable with 46 blocked after
  the netlab-generated Ansible regression, and `50/50` reachable after the Ansible rollback.
- Fifty persistent checks were created once, reconciled idempotently, and aligned with the current relationship
  metadata with zero changed or stale checks.
- The lifecycle Guardian returned FAIL for the regression and PASS for the recovery. The recovered validation reported
  four pass, zero warning/fail/error, and two informational objectives. Its single-event Workflow execution waited 31
  seconds before validation, proving the configured 30-second event-settling behavior.
- The sanitized Automation readback joins the recovery correlation to the exact Workflow execution,
  Guardian validation, network, and before/after snapshots without storing the tenant URL or token.

This closes the live high-cardinality demo and Guardian pass/failure gates. It does not replace customer-owned sandbox,
non-production, signing, threshold, or operational-ownership acceptance.

## Full Gate

Run on Node 24 before handoff:

```bash
npm run ci
```
