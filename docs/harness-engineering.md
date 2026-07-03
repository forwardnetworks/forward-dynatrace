# Harness Engineering

This repo follows a lightweight harness-engineering model: make the workflow legible to agents, keep knowledge in the
repo, and enforce important invariants mechanically.

## Principles

- `AGENTS.md` is a map, not a manual.
- Detailed guidance lives in `docs/` where it can be reviewed, linked, and updated.
- Validation rules are executable when practical.
- UI evidence should be captured from the running app, not hand-created.
- The Forward integration boundary is explicit: Dynatrace exports, Forward imports.

## Applied To This Repo

| Harness concept | Local implementation |
| --- | --- |
| Repo-local knowledge | `README.md`, `docs/workflow.md`, `docs/forward-ingest-contract.md`, `docs/validation-matrix.md` |
| Agent legibility | Compact root `AGENTS.md` with links to deeper docs |
| Mechanical invariants | `npm run repo:validate`, importer tests, security audit, SBOM generation, lint, build, GitHub Actions |
| Synthetic workflow validation | `npm run workflow:smoke` with a fake Forward API |
| Saved demo replay path | `npm run dynatrace:replay-demo` dry-run by default |
| Workflow evidence | Real browser screenshots under `docs/assets/screenshots/` |
| Boundary enforcement | Importer validation, create-missing-only policy, no Forward credentials in Dynatrace |

## Feedback Loop

1. Change code, docs, or workflow.
2. Run `npm run ci`.
3. If a repeated review comment appears, promote it into `docs/` or `scripts/validate-repo.mjs`.
4. Keep `docs/validation-matrix.md` current so future work starts from known evidence.

## GitOps Expectations

- Pull requests and pushes to `main` run GitHub Actions.
- CI must run `npm run ci`: repository validation, importer tests, release checksum tests, workflow smoke, runtime
  manifest validation, Dynatrace workflow payload validation, dependency audit, SBOM generation, lint, app build, and
  release archive smoke packaging.
- CI must also run `git diff --check`.
- Branch protection should require the `gitops` workflow before merge.
- Production deploys should remain explicit; CI builds the app but does not deploy it.
