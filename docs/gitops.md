# GitOps

GitOps checks are intentionally close to the local developer loop. The goal is for an agent or human to run the same
commands locally that GitHub Actions runs on pull requests.

## Required Checks

```bash
npm run repo:validate
npm run forward:import:test
npm run workflow:smoke
npm run runtime:validate
npm run dynatrace:workflow:validate
npm run release:checksums:test
npm run security:audit
npm run sbom:check
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
- Release artifacts should publish a `SHA256SUMS` file generated with `npm run release:checksums -- --output
  dist/SHA256SUMS artifact...`.
- Tag releases use `.github/workflows/release.yml`, which reruns `npm run ci`, calls `npm run release:package`, uploads
  workflow artifacts, and publishes the GitHub release.
- Runtime behavior changes should update `docs/validation-matrix.md`.
- Workflow or screenshot changes should update `docs/workflow.md` and `docs/assets/screenshots/`.
- Dependabot is configured for npm and GitHub Actions. Treat dependency PRs like code changes: run `npm run ci`,
  inspect lockfile changes, and publish only after the GitOps workflow passes.
