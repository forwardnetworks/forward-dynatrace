# Agent Map

This repository is an art-of-the-possible Dynatrace AppEngine demo for exporting
Forward intent-check packages from Dynatrace application dependency evidence.

Use this file as the table of contents. The source of truth lives in the linked
docs and executable checks.

## Start Here

- [README.md](README.md): project shape, commands, deployed app, and Forward ingest summary.
- [docs/workflow.md](docs/workflow.md): Forward-centric workflow and screenshots.
- [docs/forward-ingest-contract.md](docs/forward-ingest-contract.md): package and API contract.
- [docs/forward-importer.md](docs/forward-importer.md): manual Forward-side importer behavior.
- [docs/production-readiness.md](docs/production-readiness.md): production checklist.
- [docs/validation-matrix.md](docs/validation-matrix.md): tested, automated, and remaining validation.
- [docs/harness-engineering.md](docs/harness-engineering.md): agent-first operating model for this repo.
- [docs/agent-guides/dynatrace-app.md](docs/agent-guides/dynatrace-app.md): detailed Dynatrace AppEngine, Strato, and SDK guidance.

## Non-Negotiables

- The Dynatrace app never writes to Forward and never stores Forward credentials.
- Forward writes happen only through the manual importer or a Forward-owned connector.
- Intent packages are `NewNetworkCheck[]` JSON plus a manifest.
- Forward-side ingest validates packages, reads existing checks, reconciles, then creates missing checks only by default.
- Changed and stale Dynatrace-managed checks are report-only until an explicit Forward policy exists.

## Local Verification

Run this before committing meaningful changes:

```bash
npm run ci
```

For faster iteration:

```bash
npm run repo:validate
npm run forward:import:test
npm run lint
npm run build
```

## Editing Guidance

- Keep repo knowledge short at the root and detailed in `docs/`.
- Add or update executable checks when adding a new rule.
- Update `docs/validation-matrix.md` whenever validation coverage changes.
- Keep screenshots real: capture from the app, then update the files under `docs/assets/screenshots/`.
