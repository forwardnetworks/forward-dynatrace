# Agent Map

This repository contains Forward for Dynatrace, a product integration for exporting Forward intent-check packages from
Dynatrace application dependency evidence. Keep this file as a map; durable knowledge belongs in the linked documents
and executable checks.

## Start Here

- [README.md](README.md): project purpose, supported commands, and release shape.
- [ARCHITECTURE.md](ARCHITECTURE.md): components, data flow, ownership, and dependency boundaries.
- [docs/index.md](docs/index.md): task-oriented knowledge map for all detailed documentation.
- [docs/exec-plans/README.md](docs/exec-plans/README.md): active plans, completed plans, and technical debt.
- [docs/exec-plans/active/customer-production-readiness.md](docs/exec-plans/active/customer-production-readiness.md): current execution plan.
- [docs/exec-plans/active/design-partner-pilot.md](docs/exec-plans/active/design-partner-pilot.md): sandbox, Guardian, scale, and non-production pilot plan.
- [docs/validation-matrix.md](docs/validation-matrix.md): verified evidence and remaining live-validation gaps.
- [docs/harness-engineering.md](docs/harness-engineering.md): agent-first working model and repository feedback loops.
- [docs/collaboration.md](docs/collaboration.md): collaborator setup, review loop, and evidence handoff.

## Non-Negotiable Boundaries

- The Dynatrace app never writes to Forward and never stores Forward credentials.
- Forward writes happen only through the manual importer or a Forward-side connector.
- Intent packages are `NewNetworkCheck[]` JSON plus a manifest.
- Optional NQE artifacts require Forward-owned query IDs and Forward-side allowlists.
- Forward-side ingest validates packages, reads existing checks, reconciles, then creates missing checks only by default.
- Changed and stale Dynatrace-managed checks are report-only unless approval-gated mutation is enabled.
- Synthetic/demo evidence must remain visibly distinguishable from live customer evidence.

## Working Loop

1. Read the active execution plan and the relevant route in `docs/index.md`.
2. Inspect the executable source of truth before changing behavior.
3. Make the smallest coherent change and add or update an executable check for every new invariant.
4. Update `docs/validation-matrix.md` when validation coverage or live evidence changes.
5. Run focused tests while iterating, then run `npm run ci` on Node 24 before handoff or commit.
6. Turn repeated review feedback into a documented rule or a mechanical repository check.

## Editing Guidance

- Keep root guidance short; put details in `docs/` and link them from `docs/index.md`.
- Keep active plans in `docs/exec-plans/active/`; move completed work to `docs/exec-plans/completed/`.
- Record deferred structural work in `docs/exec-plans/tech-debt-tracker.md` with a trigger and exit condition.
- Keep screenshots real: capture from the app and update `docs/assets/screenshots/`.
- Never commit tenant URLs, customer data, credentials, or private token paths.
