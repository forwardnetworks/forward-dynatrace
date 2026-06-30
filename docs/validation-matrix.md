# Validation Matrix

This document tracks what is validated today and what still needs a live Forward/Dynatrace workflow exercise.

## Verified

| Area | Evidence |
| --- | --- |
| Dynatrace app build | `npm run build` passes locally and in GitHub Actions. |
| Forward importer reconciliation | `npm run forward:import:test` covers create, unchanged, changed, stale, fingerprints, keys, and validation failures. |
| Package validation | Importer rejects malformed packages and checksum mismatches before Forward environment variables or API calls are required. |
| Package signature validation | Importer verifies valid detached Ed25519 signatures and rejects signatures for changed package bytes. |
| Schema versioning policy | `docs/schema-versioning.md` defines the current `forward-dynatrace/v1` contract and migration checklist. |
| Connector config validation | Importer supports `--config`, rejects secrets in config files, and accepts non-secret runtime settings. |
| Connector metrics | `npm run workflow:smoke` verifies Prometheus-style metrics output from config import. |
| Read-only status artifact | `npm run workflow:smoke` verifies `forward-dynatrace-status/v1` output and confirms it omits check-level topology strings. |
| Synthetic Forward workflow | `npm run workflow:smoke` exercises validate-only, signed package validation, config import, metrics output, dry-run, 1001-check chunked apply, transient retry, unchanged, changed, and stale flows against a fake Forward API. |
| Live Forward workflow | Real non-production Forward test network validated on 2026-06-30: dry-run create=3, apply create=3, rerun unchanged=3, changed drift=1, stale drift=1, and `--fail-on-drift` exit code 2. Validation checks were deleted after the run and confirmed remaining=0. |
| UI workflow screenshots | `docs/assets/screenshots/*.jpg` were captured from the running local app. |
| Dynatrace app build package | Version `1.0.4` builds locally. |
| Dynatrace app deploy | Version `1.0.4` deployed to a non-production Dynatrace Apps environment on 2026-06-30 using a CLI environment override. |
| Legacy export path removal | `npm run repo:validate` blocks legacy secondary-artifact terms. |
| Secret hygiene | `npm run repo:validate` blocks committed Dynatrace token-shaped secrets, concrete tenant URLs, OAuth callbacks, private token filenames, personal references, and non-placeholder Forward credentials. |
| Connector pull workflow | Importer supports `--package-url`, validates the manifest, rejects stale packages, and still performs create-missing-only reconciliation. |
| Forward-side connector runtime templates | `deploy/systemd/` and `deploy/kubernetes/` provide scheduled import templates; `npm run runtime:validate` checks required safety controls and secret boundaries. Kubernetes YAML parsed locally on 2026-06-30. |
| Dynatrace workflow trigger payloads | `deploy/dynatrace-workflows/` includes schedule and problem-trigger payload examples; `npm run dynatrace:workflow:validate` checks they generate valid package artifacts without Forward writes. |
| Dependency audit | `npm run security:audit` passes for production dependencies. |
| SBOM generation | `npm run sbom:check` generates a CycloneDX SBOM from production dependencies. |
| Importer container | `docker build -f Dockerfile.forward-importer -t forward-dynatrace-importer:local .` and `docker run --rm forward-dynatrace-importer:local --help` pass locally for version `1.0.4`. |
| Release checksums | `npm run release:checksums:test` verifies SHA-256 checksum file generation for release artifacts. |
| Release archive packaging | `npm run release:package:smoke` builds the app/importer archives in a temporary directory and verifies required archive members plus `SHA256SUMS`. |
| GitHub release workflow | `.github/workflows/release.yml` runs CI, calls `npm run release:package`, uploads artifacts, and publishes tag releases with `SHA256SUMS`. |
| Data handling rules | `docs/data-handling.md` defines publish-safe artifact rules and `npm run repo:validate` blocks known tenant, token, local path, and personal-reference patterns. |
| RBAC model | `docs/rbac.md` defines least-privilege roles and separation rules for package publishing, review, apply, signing, and runtime administration. |
| Package handoff controls | `docs/package-handoff.md` defines retention, immutability, access logging, publish order, and storage requirements. |
| Observability plan | `docs/observability.md` defines report fields, metrics, suggested alerts, and evidence retention. |
| Admin operations | `docs/admin-operations.md` defines audit export, config restore, disaster recovery, and access review. |
| Dependency update workflow | `.github/dependabot.yml` opens weekly npm and GitHub Actions update PRs and suppresses semver-major updates for deliberate compatibility review. |

## Automated In GitOps

| Check | Command |
| --- | --- |
| Repository invariants | `npm run repo:validate` |
| Importer tests | `npm run forward:import:test` |
| Synthetic end-to-end workflow | `npm run workflow:smoke` |
| Runtime manifest validation | `npm run runtime:validate` |
| Dynatrace workflow payload validation | `npm run dynatrace:workflow:validate` |
| Release checksum script | `npm run release:checksums:test` |
| Release archive packaging | `npm run release:package:smoke` |
| Dependency audit | `npm run security:audit` |
| SBOM generation | `npm run sbom:check` |
| Static lint | `npm run lint` |
| Dynatrace app build | `npm run build` |
| Whitespace sanity | `git diff --check` |

## Not Yet Fully Live-Validated

| Gap | What is needed |
| --- | --- |
| Forward-side connector runtime installation | Target runtime selection and operational ownership. Current repo includes systemd and Kubernetes templates plus the connector command path and package URL pull behavior. |
| Dynatrace Workflow installation | A real problem or schedule workflow installed in the target tenant. Current repo includes checked schedule/problem payload examples for the export function. |
| Dynatrace Business Events seed | Dry-run passed on 2026-06-30 with 4 synthetic events. Live seed returned `403 Permission denied`; the local token still needs `bizevents.ingest`. |

## Production Gate

Before promoting a field integration deployment beyond this reference implementation:

1. Run manual importer dry-run against a Forward test network.
2. Apply a small package to that test network.
3. Re-run the same package and confirm it reports unchanged.
4. Change one dependency and confirm it reports changed.
5. Remove one dependency and confirm it reports stale.
6. Document the approved update and stale-check policy, or keep both report-only.
