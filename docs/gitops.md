# GitOps

GitOps checks are intentionally close to the local developer loop. The goal is for an agent or human to run the same
commands locally that GitHub Actions runs on pull requests.

## Required Checks

```bash
npm run repo:validate
npm run github-actions:validate
npm run github-actions:validate:test
npm run schemas:validate
npm run schemas:validate:test
npm run acceptance:bundle:test
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
- Require Code Owner review.
- Require the `gitops` GitHub Actions workflow.
- Require branches to be up to date before merge.
- Dismiss stale approvals when new commits are pushed.
- Restrict direct pushes to release/admin maintainers.
- Disable force pushes and branch deletion.
- Keep deployment separate from CI. CI builds; humans or release automation deploy.

Use `docs/governance.md` as the detailed branch-rule checklist.

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
- Third-party Actions must use full commit SHAs with an adjacent upstream release comment. The immutable pin is the
  execution identity; the comment lets reviewers and Dependabot explain which upstream release the SHA represents.
