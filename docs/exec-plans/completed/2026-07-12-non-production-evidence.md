# Non-Production Evidence Tranche

Status: completed  
Completed: 2026-07-12

## Objective

Replace fixture-only demo claims with traceable non-production Dynatrace and Forward evidence while preserving explicit
synthetic provenance where real failure/recovery or security evidence was not available.

## Completed Work

- Live Dynatrace Trial query and normalization of 100 replay dependency rows.
- Curated mixed-state showcase with explicit replay `run_id` and provenance.
- Forward host resolution, read-only bulk path evidence, governed package generation, and dry-run reconciliation through
  the operator-owned conductor.
- Problem-triggered aggregate network evidence published to Dynatrace and queried back from Grail.
- Deterministic before/after change validation with one safe and one regression pair.
- Synthetic check-health transitions and security correlations published, queried back, rendered, and labeled
  `SYNTHETIC DEMO`.

## Evidence

- Forward network: `235937`.
- Primary demo snapshot: `1322821`.
- Safe change pair: `1322819 -> 1322820`.
- Regression pair: `1322820 -> 1322821`.
- Problem evidence run: `fd-problem-evidence-20260712T113700Z`.
- The live 100-row path run returned reachable `0`, blocked `100`, ambiguous `0`, unmapped `0`, failed `0`.
- The safe 24-path change pair passed; the regression pair changed reachable `24 -> 12` and blocked `0 -> 12` and
  failed with explicit Forward and Dynatrace reason codes.

## Decisions

- Live evidence and synthetic fallback must be visibly distinguishable in UI, artifacts, screenshots, and docs.
- A publish HTTP success is insufficient; acceptance requires Dynatrace/ServiceNow query-back or readback.
- Apply and publication remain separate explicit gates.
- Detailed Forward topology remains inside the Forward-controlled boundary.

## Follow-Up

Customer-owned ServiceNow, check-health, and security acceptance moved to
`../active/customer-production-readiness.md`.

