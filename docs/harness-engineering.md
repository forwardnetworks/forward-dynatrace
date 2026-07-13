# Harness Engineering

This repo follows the agent-first model described in OpenAI's
[Harness engineering](https://openai.com/index/harness-engineering/): make the system legible to agents, keep durable
knowledge in the repository, treat plans as versioned artifacts, and enforce important invariants mechanically.

## Principles

- `AGENTS.md` is a map, not a manual.
- `ARCHITECTURE.md` and `docs/index.md` provide progressive disclosure into detailed guidance.
- Active, completed, and deferred work are distinct repository artifacts under `docs/exec-plans/`.
- Validation rules are executable when practical.
- UI evidence should be captured from the running app, not hand-created.
- The Forward integration boundary is explicit: Dynatrace exports, Forward imports.

## Applied To This Repo

| Harness concept | Local implementation |
| --- | --- |
| Repo-local knowledge | `ARCHITECTURE.md`, `docs/index.md`, contracts, runbooks, plans, and evidence records |
| Agent legibility | Compact root `AGENTS.md` plus task-oriented progressive disclosure |
| First-class plans | `docs/exec-plans/active/`, `docs/exec-plans/completed/`, and `docs/exec-plans/tech-debt-tracker.md` |
| Mechanical invariants | `npm run repo:validate`, importer tests, security audit, SBOM generation, lint, build, GitHub Actions |
| Synthetic workflow validation | `npm run workflow:smoke` with a fake Forward API |
| Saved demo replay path | `npm run dynatrace:replay-demo` dry-run by default |
| Workflow evidence | `npm run demo:capture` writes real browser screenshots under `docs/assets/screenshots/` |
| Boundary enforcement | Importer validation, create-missing-only policy, no Forward credentials in Dynatrace |

## Feedback Loop

1. Change code, docs, or workflow.
2. Run `npm run ci`.
3. Update the active execution plan's progress, decisions, and evidence.
4. If a repeated review comment appears, promote it into `docs/` or `scripts/validate-repo.mjs`.
5. Keep `docs/validation-matrix.md` current so future work starts from known evidence.

## Knowledge Lifecycle

- New durable guidance must be linked from `docs/index.md`.
- Complex work starts in `docs/exec-plans/active/` with explicit non-goals and verification.
- Completed work moves to `docs/exec-plans/completed/` as an immutable evidence summary.
- Deferred structural work belongs in the technical-debt tracker with a trigger and exit condition.
- `npm run repo:validate` checks the map, plan shape, required cross-links, and compactness of `AGENTS.md`.

## GitOps Expectations

- Pull requests and pushes to `main` run GitHub Actions.
- CI must run `npm run ci`: repository validation, importer tests, release checksum tests, workflow smoke, runtime
  manifest validation, Dynatrace workflow payload validation, dependency audit, SBOM generation, lint, app build, and
  release archive smoke packaging.
- CI must also run `git diff --check`.
- Branch protection should require the `gitops` workflow before merge.
- Production deploys should remain explicit; CI builds the app but does not deploy it.
