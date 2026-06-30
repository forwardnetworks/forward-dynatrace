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
| Live Forward workflow | Real non-production Forward test network validated dry-run create=2, apply create=2, rerun unchanged=2, drift changed=1/stale=1, and `--fail-on-drift` exit code 2. Validation checks were deleted after the run. |
| UI workflow screenshots | `docs/assets/screenshots/*.jpg` were captured from the running local app. |
| Dynatrace app build package | Version `1.0.2` builds locally. |
| Dynatrace app deploy | Version `1.0.2` deployed to a non-production Dynatrace Apps environment on 2026-06-26 using a CLI environment override. |
| Legacy export path removal | `npm run repo:validate` blocks legacy secondary-artifact terms. |
| Secret hygiene | `npm run repo:validate` blocks committed Dynatrace token-shaped secrets, concrete tenant URLs, OAuth callbacks, private token filenames, personal references, and non-placeholder Forward credentials. |
| Connector pull workflow | Importer supports `--package-url`, validates the manifest, rejects stale packages, and still performs create-missing-only reconciliation. |
| Dependency audit | `npm run security:audit` passes for production dependencies. |
| SBOM generation | `npm run sbom:check` generates a CycloneDX SBOM from production dependencies. |
| Importer container | `docker build -f Dockerfile.forward-importer -t forward-dynatrace-importer:local .` and `docker run --rm forward-dynatrace-importer:local --help` pass locally. |
| Release checksums | `npm run release:checksums:test` verifies SHA-256 checksum file generation for release artifacts. |
| GitHub release workflow | `.github/workflows/release.yml` runs CI, builds app/importer archives, uploads artifacts, and publishes tag releases with `SHA256SUMS`. |
| Data handling rules | `docs/data-handling.md` defines publish-safe artifact rules and `npm run repo:validate` blocks known tenant, token, local path, and personal-reference patterns. |
| RBAC model | `docs/rbac.md` defines least-privilege roles and separation rules for package publishing, review, apply, signing, and runtime administration. |
| Package handoff controls | `docs/package-handoff.md` defines retention, immutability, access logging, publish order, and storage requirements. |
| Observability plan | `docs/observability.md` defines report fields, metrics, suggested alerts, and evidence retention. |
| Admin operations | `docs/admin-operations.md` defines audit export, config restore, disaster recovery, and access review. |
| Dependency update workflow | `.github/dependabot.yml` opens weekly npm and GitHub Actions update PRs. |

## Automated In GitOps

| Check | Command |
| --- | --- |
| Repository invariants | `npm run repo:validate` |
| Importer tests | `npm run forward:import:test` |
| Synthetic end-to-end workflow | `npm run workflow:smoke` |
| Release checksum script | `npm run release:checksums:test` |
| Dependency audit | `npm run security:audit` |
| SBOM generation | `npm run sbom:check` |
| Static lint | `npm run lint` |
| Dynatrace app build | `npm run build` |
| Whitespace sanity | `git diff --check` |

## Not Yet Fully Live-Validated

| Gap | What is needed |
| --- | --- |
| Forward-side connector runtime | Target scheduler/service runtime and operational ownership. Current repo includes the connector command path and package URL pull behavior. |
| Dynatrace Workflow trigger | A real problem or schedule workflow wired to call the export function. |
| Dynatrace Business Events seed | Dry-run passed. Live seed was attempted on 2026-06-25 and returned `403 Permission denied`; the local token needs `bizevents.ingest`. |
| End-to-end drift loop | At least two package generations with an intentional dependency change, then dry-run/report/apply review. |

## Production Gate

Before promoting a field integration deployment beyond this reference implementation:

1. Run manual importer dry-run against a Forward test network.
2. Apply a small package to that test network.
3. Re-run the same package and confirm it reports unchanged.
4. Change one dependency and confirm it reports changed.
5. Remove one dependency and confirm it reports stale.
6. Document the approved update and stale-check policy, or keep both report-only.
