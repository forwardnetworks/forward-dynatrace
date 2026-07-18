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
| Runtime and release | `npm run runtime:validate`, `npm run systemd:install:test`, `npm run github-actions:validate`, release signature/ref/immutability/published-verifier tests, `npm run security:audit`, and `npm run release:package:smoke` cover deployment templates, protected mounted authorization, immutable GitHub Action pins, exact release membership, tag immutability, the historical `v1.0.0` reset ledger, `0.x` prerelease enforcement, and release provenance. | Publish and independently verify the first immutable `0.10.x` prerelease after review; provision the dedicated least-privilege runtime identity and customer platform ownership. |
| Dynatrace app | `npm run repo:validate`, `npm run dynatrace:deploy:test`, `npm run lint`, and `npm run build` guard the integration boundary, canonical `Forward` / reserved `com.forward.dynatrace` identity, separate `my.forward` sandbox path, required `storage:spans:read` scope, direct current-window instrumented-span discovery, live-only provenance enforcement, and app bundle. | Install `my.forward` in a sandbox with live instrumented traces, then verify a signed `com.forward.dynatrace` preview archive in non-production. |
| Site Reliability Guardian | `npm run dynatrace:guardian:validate`, `npm run dynatrace:guardian:readback:test`, `npm run schemas:validate`, and `npm run dynatrace:change-gate:publish:test` cover the lifecycle Guardian, Monaco Workflow, six DQL objectives, 30-second event-settling delay, bounded execution context, Automation execution/task join, exact gate correlation, non-Guardian compatibility, and the missing-evidence objectives. | Run one explicit no-event or no-span validation after the final Workflow package is deployed; the live pass and deliberate failure are complete. |
| High-cardinality evidence | `npm run load:scale` validates 2,500 generated test rows, 2,304 eligible Network Admin checks, and six bounded apply batches; it is mechanical test coverage and never demo evidence. The separate change-demo gate renders and validates 49 live containers, 38 Linux endpoints, 11 modeled network devices, 23 instrumented services, ten transaction generators, and 240 actual HTTP/DNS relationships. The signed Network Admin run created 190 missing checks without updates or deactivations; post-apply verification and the next independent reconciliation both reported all 240 unchanged. | Repeat reset/regression/recovery cycles to record timing and resource budgets. |

## Current Live Evidence

The active product baseline is the unreleased `0.10.0` design-partner preview. The `v1.0.0` through `v1.0.2` records
below are preserved historical build/provenance evidence only; those artifacts are retired and must not be installed.

- Signed customer kit `v1.0.2` resolves to commit `de452adaf633c1c002db0d1a7bb23bd267e64f31`. Release run
  `29624454929` and independent verification run `29624548725` passed. The verifier confirmed the checksum signature,
  six asset attestations, a 531-component CycloneDX 1.5 SBOM, image attestation, and zero Trivy results. Its retired
  importer digest was `ghcr.io/forwardnetworks/forward-dynatrace-importer@sha256:2e56e18b02632564ce62d91983ae0017376e5d0485ef064e9998e445ee701b12`.
- Signed customer kit `v1.0.1` resolves to commit `a89ff21b83f0ee6bb7ffc587718a58232eeaf144`. Release run
  `29622910036` and independent verification run `29622995213` passed. The verifier confirmed the checksum signature,
  six asset attestations, a 531-component CycloneDX 1.5 SBOM, image attestation, and zero Trivy results. Its retired
  importer digest was `ghcr.io/forwardnetworks/forward-dynatrace-importer@sha256:0bdf9d8810d826c26830b7921ab04f575400859745db3fa38781bb045144e3e6`.
- Signed release `v1.0.0` resolves to commit `ce5a13f2e2122ddd4c5be5a8342a103259857b25`. Release run `29622283324`
  and independent verification run `29622381593` passed. The verifier confirmed six release-asset attestations, the
  checksum signature, a 531-component CycloneDX 1.5 SBOM, image attestation, and zero Trivy results. Its retired
  importer digest was `ghcr.io/forwardnetworks/forward-dynatrace-importer@sha256:9aec44d63602b43b1351602988232ce21b7a074dd4877f0482019002c8393050`.
- On 2026-07-17, the dedicated live containerlab network produced distinct processed Forward snapshots for baseline,
  regression, and recovery. Tenant-specific snapshot identifiers remain in the protected acceptance record only.
- On 2026-07-18, the lab contained 49 running containers: 11 modeled network devices and 38 Linux endpoints.
  Twenty-three instrumented HTTP services and ten independent transaction generators produced 240 actual HTTP/DNS
  relationships through the modeled network.
- Dynatrace queried exactly 240 current relationships from OpenTelemetry client/server spans; the app has no seeded,
  replay, fixture, or capture-data fallback.
- Forward evaluated the same 240 relationships against the current processed snapshot: `240/240` reachable, zero
  blocked, ambiguous, unmapped, or failed. Tenant-specific identifiers remain in protected acceptance state.
- Forward reconciliation found the previous 50 checks unchanged and planned 190 create-missing actions. The signed,
  immutable Network Admin plan created exactly those 190 checks with zero updates or deactivations; post-apply
  verification and an independent rerun both reported `240 unchanged`, zero drift, and zero collisions.
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
