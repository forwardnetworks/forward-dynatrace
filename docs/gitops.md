# GitOps

GitOps checks are intentionally close to the local developer loop. The goal is for an agent or human to run the same
commands locally that GitHub Actions runs on pull requests.

## Required Checks

```bash
npm run repo:validate
npm run forward:import:test
npm run workflow:smoke
npm run lint
npm run build
git diff --check
```

`npm run ci` runs the npm-based checks in order.

## Branch Protection

Recommended repository settings:

- Require pull requests before merging to `main`.
- Require the `gitops` GitHub Actions workflow.
- Require branches to be up to date before merge.
- Dismiss stale approvals when new commits are pushed.
- Restrict direct pushes to release/admin maintainers.
- Keep deployment separate from CI. CI builds; humans or release automation deploy.

## Release Discipline

- App version changes belong in `package.json`, `package-lock.json`, and `app.config.json`.
- Public releases must keep `app.config.json` on the placeholder environment URL.
- Release candidates must pass the public hygiene gate in `npm run repo:validate`.
- Runtime behavior changes should update `docs/validation-matrix.md`.
- Workflow or screenshot changes should update `docs/workflow.md` and `docs/assets/screenshots/`.
