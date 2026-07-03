# Validation Matrix

This document tracks what is validated today and what still needs a live Forward/Dynatrace workflow exercise.

## Verified

| Area | Evidence |
| --- | --- |
| Dynatrace app build | `npm run build` passes locally and in GitHub Actions. |
| Forward importer reconciliation | `npm run forward:import:test` covers create, unchanged, changed, stale, fingerprints, keys, and validation failures. |
| Approved update/stale gates | `npm run forward:import:test` covers approval schema, package/window/expiry rejection, exact-key selection, and mutation budget enforcement. |
| Optional NQE artifacts | `npm run forward:nqe-artifacts:test` covers NQE check and diff artifact generation, query-ID validation, and allowlist rejection. |
| Read-only NQE preview | `npm run forward:nqe-preview:test` covers plan mode, missing runtime authorization blocking, query-ID allowlisting, and the read-only `POST /api/nqe` execution path. |
| Optional NQE package workflow | `npm run forward:package:test` builds optional `forward-nqe-checks.json` and `forward-nqe-diff-requests.json`, validates manifest metadata, and runs importer validate-only with a query-ID allowlist. |
| Read-only NQE live smoke harness | `npm run forward:nqe-live-smoke:test` validates approval-file rules and plan-mode report generation; `npm run forward:nqe-live-smoke -- --help` exposes a customer-approved live smoke command that calls only `POST /api/nqe` when `--execute` is supplied. |
| Package validation | Importer rejects malformed packages and checksum mismatches before Forward environment variables or API calls are required. |
| Package signature validation | Importer verifies valid detached Ed25519 signatures and rejects signatures for changed package bytes. |
| Schema versioning policy | `docs/schema-versioning.md` defines the current `forward-dynatrace/v1` contract and migration checklist. |
| Connector config validation | Importer supports `--config`, rejects secrets in config files, and accepts non-secret runtime settings. |
| Connector metrics | `npm run workflow:smoke` verifies Prometheus-style metrics output from config import. |
| Runtime SLO gate | `npm run runtime:slo:test` verifies report/metrics SLO checks for duration, unresolved drift, signature requirements, and metric/report mismatch. |
| Read-only status artifact | `npm run workflow:smoke` verifies `forward-dynatrace-status/v1` output and confirms it omits check-level topology strings. |
| Forward status display and URL fetch | `npm run forward:status:test` verifies supplied artifact display, read-only localhost URL fetch, and non-local HTTP rejection. |
| Forward status publication | `npm run forward:status:publish:test` verifies sanitized status publication, checksum output, unknown-field rejection, and credential-like content rejection. |
| Live demo runbook | `docs/live-demo-runbook.md` keeps customer-owned Dynatrace data as the primary path and marks saved fixture replay as a demo/trial sidecar only. `npm run repo:validate` requires the doc and release packaging includes it. |
| Forward API compatibility notes | `docs/forward-api-compatibility.md` documents required Forward endpoints, the no-fallback bulk create gate, and optional NQE/query-ID paths. `npm run repo:validate` requires the doc and release packaging includes it. |
| Synthetic Forward workflow | `npm run workflow:smoke` exercises validate-only, signed package validation, config import, metrics output, dry-run, 1001-check chunked apply, transient retry, unchanged, changed, stale, approved changed replacement, and approved stale deactivation flows against a fake Forward API. |
| Load and scale smoke | `npm run load:scale` generates 2500 synthetic Dynatrace dependency rows, normalizes them, builds a `data-connector` package, validates it, applies exportable checks to a fake Forward API in 400-check batches, and reruns the same package to confirm unchanged reconciliation. |
| Live Forward workflow | Real non-production Forward test network validated on 2026-06-30: dry-run create=3, apply create=3, rerun unchanged=3, changed drift=1, stale drift=1, and `--fail-on-drift` exit code 2. Validation checks were deleted after the run and confirmed remaining=0. |
| UI workflow screenshots | `npm run demo:capture` captures `docs/assets/screenshots/*.jpg` from the built app with local app-function shims and placeholder data. |
| Dynatrace app build package | Version `1.0.7` builds locally. |
| Dynatrace live query path | Live read-only DQL queries against a non-production Dynatrace Apps environment succeeded on 2026-07-03. The first tenant query validated auth/query plumbing with no useful topology; the saved demo fixture now provides 100 replayable dependency records for trial tenants. |
| Dynatrace app deploy | Version `1.0.6` deployed successfully to a non-production Dynatrace Apps environment on 2026-07-03. The previous `1.0.5` deploy attempt was correctly rejected because that version was already installed with a different checksum. |
| Dynatrace saved demo replay | `npm run dynatrace:replay-demo` dry-runs a checked 100-row Dynatrace Playground fixture. With `--apply`, it replays those rows into a trial tenant through OpenPipeline using a local Platform Token. |
| Legacy export path removal | `npm run repo:validate` blocks legacy secondary-artifact terms. |
| Secret hygiene | `npm run repo:validate` blocks committed Dynatrace token-shaped secrets, concrete tenant URLs, OAuth callbacks, private token filenames, personal references, and non-placeholder Forward credentials. |
| Connector pull workflow | Importer supports `--package-url`, validates the manifest, rejects stale packages, and still performs create-missing-only reconciliation. |
| Forward-side connector runtime templates | `deploy/systemd/` and `deploy/kubernetes/` provide scheduled import templates; `npm run runtime:validate` checks required safety controls and secret boundaries. Kubernetes YAML parsed locally on 2026-06-30. |
| Dynatrace workflow trigger payloads | `deploy/dynatrace-workflows/` includes schedule and problem-trigger payload examples; `npm run dynatrace:workflow:validate` checks they generate valid package artifacts without Forward writes. |
| Dynatrace live query command | `npm run dynatrace:query` exports DQL records from a tenant and can write normalized dependency candidates without contacting Forward. |
| Dynatrace dependency normalization | `npm run dynatrace:normalize:test` verifies DQL-shaped rows normalize into ready/review/needs-map dependency candidates. |
| Forward package builder | `npm run forward:package` builds manifest and `NewNetworkCheck[]` artifacts from normalized dependencies without contacting Forward. |
| Client rehearsal | `npm run demo:rehearsal` generates a package from DQL-shaped synthetic rows and validates it without Forward credentials. |
| Forward ingest status display | `api/forward-status.function.ts` and `shared/demo-forward-ingest-status.json` validate/display aggregate Forward-side ingest status only. |
| Dependency audit | `npm run security:audit` passes for production dependencies. |
| SBOM generation | `npm run sbom:check` generates a CycloneDX SBOM from production dependencies. |
| Importer container | `docker build -f Dockerfile.forward-importer -t forward-dynatrace-importer:local .` and `docker run --rm forward-dynatrace-importer:local --help` pass locally for version `1.0.6`. |
| Release checksums | `npm run release:checksums:test` verifies SHA-256 checksum file generation for release artifacts. |
| Release checksum signing | `npm run release:sign:test` verifies detached Ed25519 signing and tamper-detection for `SHA256SUMS`. |
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
| Optional NQE artifact tests | `npm run forward:nqe-artifacts:test` |
| Read-only NQE preview tests | `npm run forward:nqe-preview:test` |
| Read-only NQE live smoke shape | `npm run forward:nqe-live-smoke:test` |
| Optional NQE package workflow | `npm run forward:package:test` |
| Forward status display | `npm run forward:status:test` |
| Forward status publisher | `npm run forward:status:publish:test` |
| Dynatrace live query help/shape | `npm run dynatrace:query -- --help` |
| Dynatrace dependency normalization | `npm run dynatrace:normalize:test` |
| Forward package builder help/shape | `npm run forward:package -- --help` |
| Synthetic end-to-end workflow | `npm run workflow:smoke` |
| Load and scale smoke | `npm run load:scale` |
| Client rehearsal | `npm run demo:rehearsal` |
| Runtime manifest validation | `npm run runtime:validate` |
| Runtime SLO gate | `npm run runtime:slo:test` |
| Dynatrace workflow payload validation | `npm run dynatrace:workflow:validate` |
| Release checksum script | `npm run release:checksums:test` |
| Release checksum signing | `npm run release:sign:test` |
| Release archive packaging | `npm run release:package:smoke` |
| Dependency audit | `npm run security:audit` |
| SBOM generation | `npm run sbom:check` |
| Static lint | `npm run lint` |
| Dynatrace app build | `npm run build` |
| Whitespace sanity | `npm run whitespace:check` |

## Not Yet Fully Live-Validated

| Gap | What is needed |
| --- | --- |
| Forward-side connector runtime installation | Target runtime selection and operational ownership. Current repo includes systemd and Kubernetes templates plus the connector command path and package URL pull behavior. |
| Dynatrace Workflow installation | A real problem or schedule workflow installed in the target tenant. Current repo includes checked schedule/problem payload examples for the export function. |
| Live Dynatrace demo dependency data | Customer-owned topology remains the production source of intent. The repo now includes a saved 100-row Dynatrace Playground fixture for replay into isolated trial/demo sandboxes when live demo-tenant source tokens are unavailable. |
| Read-only dynamic NQE credential model | Needs customer approval and a live run of `npm run forward:nqe-live-smoke -- --execute --approval-file <approval.json>` for the exact Forward read-only credential model before enabling execute mode in Dynatrace. Base package export/import does not depend on this optional path. |
| Saved demo replay sidecar | `npm run dynatrace:replay-demo -- --help` documents replaying the checked demo fixture into a trial sandbox; not for production source-of-intent. |

## Production Gate

Before promoting a field integration deployment beyond this reference implementation:

1. Run manual importer dry-run against a Forward test network.
2. Apply a small package to that test network.
3. Re-run the same package and confirm it reports unchanged.
4. Change one dependency and confirm it reports changed.
5. Remove one dependency and confirm it reports stale.
6. If update/stale automation is enabled, require signed package verification, exact-key approval, change window, and
   mutation budgets. Otherwise keep both report-only.
