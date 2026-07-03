# Agent Map

This repository is a Forward Field Integration reference for exporting Forward
intent-check packages from Dynatrace application dependency evidence.

Use this file as the table of contents. The source of truth lives in the linked
docs and executable checks.

## Start Here

- [README.md](README.md): project shape, commands, deployed app, and Forward ingest summary.
- [docs/install.md](docs/install.md): install model, release model, and public-release gate.
- [docs/workflow.md](docs/workflow.md): Forward-centric workflow and screenshots.
- [docs/dynatrace-workflow-trigger.md](docs/dynatrace-workflow-trigger.md): schedule/problem trigger payload contract.
- [docs/forward-ingest-contract.md](docs/forward-ingest-contract.md): package and API contract.
- [docs/forward-nqe-preview.md](docs/forward-nqe-preview.md): optional read-only Forward NQE preview workflow.
- [docs/forward-nqe-artifacts.md](docs/forward-nqe-artifacts.md): optional NQE check and diff artifact workflow.
- [docs/forward-api-compatibility.md](docs/forward-api-compatibility.md): Forward API version and optional NQE gates.
- [docs/forward-importer.md](docs/forward-importer.md): manual Forward-side importer behavior.
- [docs/production-readiness.md](docs/production-readiness.md): production checklist.
- [docs/enterprise-hardening.md](docs/enterprise-hardening.md): enterprise hardening backlog and exit criteria.
- [docs/operations-runbook.md](docs/operations-runbook.md): operator runbook for manual and connector import.
- [docs/incident-response.md](docs/incident-response.md): failure triage and recovery runbook.
- [docs/threat-model.md](docs/threat-model.md): trust boundary, threats, controls, and residual risk.
- [docs/container-runtime.md](docs/container-runtime.md): Forward importer container build and run workflow.
- [docs/connector-runtime.md](docs/connector-runtime.md): systemd and Kubernetes scheduler runtime templates.
- [docs/deployment-readiness.md](docs/deployment-readiness.md): package, dry-run, optional NQE, and deployment gate checks.
- [docs/schema-versioning.md](docs/schema-versioning.md): package schema compatibility and migration rules.
- [docs/data-handling.md](docs/data-handling.md): publish-safe data, screenshot, and artifact handling rules.
- [docs/rbac.md](docs/rbac.md): least-privilege roles and separation rules.
- [docs/package-handoff.md](docs/package-handoff.md): package storage, retention, immutability, and access-log controls.
- [docs/observability.md](docs/observability.md): reports, metrics, suggested alerts, and evidence retention.
- [docs/admin-operations.md](docs/admin-operations.md): audit export, config restore, disaster recovery, and access review.
- [docs/release.md](docs/release.md): release workflow, artifacts, and checksum verification.
- [docs/validation-matrix.md](docs/validation-matrix.md): tested, automated, and remaining validation.
- [docs/demo-data.md](docs/demo-data.md): standard demo fixtures and Dynatrace replay data.
- [docs/client-trial-plan.md](docs/client-trial-plan.md): meeting/demo rehearsal, trial tenant, and live Forward workflow.
- [docs/live-demo-runbook.md](docs/live-demo-runbook.md): customer-owned path and standard demo replay execution.
- [docs/execution-roadmap.md](docs/execution-roadmap.md): phased plan, optional NQE path, and ownership boundaries.
- [docs/harness-engineering.md](docs/harness-engineering.md): agent-first operating model for this repo.
- [docs/agent-guides/dynatrace-app.md](docs/agent-guides/dynatrace-app.md): detailed Dynatrace AppEngine, Strato, and SDK guidance.

## Non-Negotiables

- The Dynatrace app never writes to Forward and never stores Forward credentials.
- Forward writes happen only through the manual importer or a Forward-side connector.
- Intent packages are `NewNetworkCheck[]` JSON plus a manifest.
- Optional NQE artifacts require Forward-owned query IDs and Forward-side allowlists.
- Forward-side ingest validates packages, reads existing checks, reconciles, then creates missing checks only by default.
- Changed and stale Dynatrace-managed checks are report-only unless approval-gated mutation is enabled.

## Local Verification

Run this before committing meaningful changes:

```bash
npm run ci
```

For faster iteration:

```bash
npm run repo:validate
npm run forward:import:test
npm run forward:nqe-artifacts:test
npm run forward:nqe-live-smoke -- --help
npm run forward:nqe-live-smoke:test
npm run forward:nqe-preview:test
npm run forward:package:test
npm run forward:readiness:test
npm run dynatrace:query -- --help
npm run dynatrace:replay-demo -- --help
npm run dynatrace:normalize:test
npm run forward:package -- --help
npm run forward:status:test
npm run forward:status:publish -- --help
npm run forward:status:publish:test
npm run release:checksums:test
npm run demo:rehearsal
npm run workflow:smoke
npm run lint
npm run build
```

## Editing Guidance

- Keep repo knowledge short at the root and detailed in `docs/`.
- Add or update executable checks when adding a new rule.
- Update `docs/validation-matrix.md` whenever validation coverage changes.
- Keep screenshots real: capture from the app, then update the files under `docs/assets/screenshots/`.
