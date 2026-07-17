# Dynatrace Integration Production Readiness

Status: active
Owner: repository maintainer plus Dynatrace, Forward runtime, security, and network owners
Last updated: 2026-07-17

## Objective

Release and validate the standalone Dynatrace-to-Forward integration as a reproducible, customer-operated
non-production deployment. The acceptance boundary covers Dynatrace dependency evidence, deterministic package
generation, customer-approved handoff, Forward-side validation and reconciliation, and bounded Dynatrace readback.

Cross-product workflow orchestration and combined demonstrations are intentionally maintained outside this repository.

## Non-Goals

- Do not move Forward write credentials into Dynatrace.
- Do not deploy applications or perform rollback.
- Do not enable changed or stale mutation without a signed package, exact approval, change window, budget, and audit.
- Do not present replay or fixture evidence as live customer evidence.
- Do not make optional NQE or security-correlation lanes a dependency of the base workflow.

## Progress

- [x] Validate the implementation on Node `v24.18.0`, including full CI, a 2,500-row scale smoke, a zero-vulnerability
  production audit, Dynatrace app build, exact release membership, and checked screenshots.
- [x] Validate Forward import create, unchanged, changed, stale, and bounded failure behavior.
- [x] Query sanitized aggregate status back from Dynatrace.
- [x] Verify deterministic package checksums, authenticated handoff, host resolution, read-only path evidence,
  check-health polling, and security correlation with repository tests.
- [x] Add pre-publish tag immutability, release-provenance, SBOM, attestation, and image-scanning checks.
- [x] Validate the complete demonstration loop with six explicitly live containerlab service observations, six modeled paths,
  a verified signed package, idempotent reconciliation, Grail query-back, and a populated native Dynatrace app.
- [x] Replace the retired development identity with display name `Forward`, production ID `com.forward.dynatrace`, and
  sandbox ID `my.forward`.
- [x] Add a Monaco lifecycle Guardian and Workflow package, bounded execution-context schema, fail-closed SDLC trigger,
  result query, app display, and repository validation.

## Plan

1. Publish a signed `com.forward.dynatrace` release newer than `v1.0.0`; the current tag predates the handoff,
   check-health, security, identity, and current Dynatrace Workflow assets.
2. Install the exact release artifacts in a non-production Dynatrace tenant and Forward network.
3. Run one authoritative customer-owned dependency export through validate-only, reviewed apply, and status readback.
4. Capture the release tag, commit, checksums, image digest, network and snapshot IDs, package ID, reconciliation counts,
   Dynatrace event ID, and operator approvals in `docs/validation-matrix.md`.
5. Deploy the Guardian package in the sandbox and query back one pass, one deliberate objective failure, and one
   missing-evidence fail-closed result.
6. Confirm the installation and rollback runbooks with customer operators who did not author the integration.

## Verification

- Run `npm run ci` on Node 24.
- Run the credential-free acceptance bundle and confirm it makes no external calls.
- Verify the exact downloaded release checksum, SBOM, attestation, image scan, and container digest.
- Verify one live package through validate-only, reviewed apply, and Dynatrace status query-back.

## Decision Log

| Date | Decision | Reason |
| --- | --- | --- |
| 2026-07-16 | Keep this plan limited to the standalone Dynatrace integration. | Each integration must be installable, testable, and explainable without a sibling repository. |
| 2026-07-16 | Keep create-missing-only as the default Forward policy. | The core value does not require update or stale-check mutation authority. |
| 2026-07-17 | Render the integration as `Dynatrace ⇄ Forward`. | Dependency evidence flows to Forward; aggregate path and reconciliation evidence returns to Grail. |
| 2026-07-17 | Label active containerlab observations as live service probes, not AppMap. | Source fidelity is more important than implying an unavailable OneAgent discovery source. |
| 2026-07-17 | Use `Forward` as the display name, `com.forward.dynatrace` for signed installs, and `my.forward` only for unsigned sandbox installs. | Production identity must be stable, product-owned, and free of retired development branding. |

## Evidence To Capture

- repository commit, release tag, CI run, and downloaded artifact checksums;
- SBOM, attestations, image scan result, and container digest;
- Dynatrace environment alias and event ID without tenant secrets;
- Forward network, before/after snapshot, package, and reconciliation identifiers;
- selected dependency and check counts, mutation counts, and operator approval record;
- installation, rollback, and query-back results.

## Exit Criteria

- The release passes Node 24 CI and exact archive-membership validation.
- Release checksum, SBOM, attestation, image scan, and digest are verified from downloaded artifacts.
- Dynatrace stores no Forward credential and the Dynatrace app performs no Forward mutation.
- Forward reconciliation proves create, unchanged, changed, stale, and bounded failure behavior.
- The enabled live lanes have authoritative Dynatrace and Forward readback rather than request-success evidence only.
- The customer can install, operate, audit, and roll back the integration from this repository alone.
