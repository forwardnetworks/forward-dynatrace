# Validation Matrix

This document tracks what is validated today and what still needs a live Forward/Dynatrace workflow exercise.

## Verified

| Area | Evidence |
| --- | --- |
| Dynatrace app build | `npm run build` passes locally and in GitHub Actions. |
| Supported Node 24 release-candidate run | Full `npm ci && npm run ci` passed in a clean Linux/arm64 `node:24-alpine` container using Node `v24.18.0` on 2026-07-13, including production dependency audit, app/action build, and release archive smoke. |
| Forward importer reconciliation | `npm run forward:import:test` covers create, unchanged, changed, stale, fingerprints, keys, Forward-normalized host-subnet values, and validation failures. |
| Approved update/stale gates | `npm run forward:import:test` covers approval schema, package/window/expiry rejection, exact-key selection, and mutation budget enforcement. |
| Optional NQE artifacts | `npm run forward:nqe-artifacts:test` covers NQE check and diff artifact generation, query-ID validation, and allowlist rejection. |
| Read-only NQE preview | `npm run forward:nqe-preview:test` covers plan mode, missing runtime authorization blocking, query-ID allowlisting, and the read-only `POST /api/nqe` execution path. |
| Optional NQE package workflow | `npm run forward:package:test` builds optional `forward-nqe-checks.json` and `forward-nqe-diff-requests.json`, validates manifest metadata, and runs importer validate-only with a query-ID allowlist. |
| Dependency eligibility report | `npm run forward:package:test` verifies `--eligibility-report` output for ready, review, needs-map, and missing-field rows. |
| Read-only NQE live smoke harness | `npm run forward:nqe-live-smoke:test` validates approval-file rules and plan-mode report generation; `npm run forward:nqe-live-smoke -- --help` exposes a customer-approved live smoke command that calls only `POST /api/nqe` when `--execute` is supplied. |
| Forward host-resolution preflight | `npm run forward:resolve-hosts:test` verifies IP/subnet classification, Forward `GET /api/networks/{networkId}/hosts/{hostSpecifier}` resolution, ambiguous and missing-host handling, latest processed snapshot lookup, and resolved dependency output. |
| Host-resolved intent package generation | `npm run forward:resolve-hosts:test` feeds resolved dependencies into `npm run forward:package` and verifies generated intent checks use `sourceResolvedValue` and `destinationResolvedValue` in Forward filters while preserving original Dynatrace names in the `dynatrace-key:*` tag. |
| Read-only Forward path evidence | `npm run forward:path-evidence:test` verifies query construction from resolved endpoints, explicit device-source handling, unmapped name rejection, path-result classification, latest processed snapshot lookup, JSON POST body handling, and `POST /api/networks/{networkId}/paths-bulk` execution against a fake Forward API. |
| Live demo conductor | `npm run demo:live:test` verifies concise unique-flow selection, default read-only path analysis, explicit path-analysis opt-out, and separate Forward-apply and Dynatrace-status publication gates. The conductor always resolves endpoints before building the package and emits host-resolution, path, reconciliation, and sanitized status-handoff artifacts. |
| Deployment readiness gate | `npm run forward:readiness:test` verifies validate-only readiness, dry-run failure reporting, mutation-policy refusal, and report output. |
| Package validation | Importer rejects malformed packages and checksum mismatches before Forward environment variables or API calls are required. |
| Atomic package handoff | `npm run forward:handoff:test` covers validated immutable publication, idempotent retry, same-ID byte-conflict rejection, atomic `latest` pointer updates, and required-signature rejection. |
| Package signature validation | Importer verifies valid detached Ed25519 signatures and rejects signatures for changed package bytes. |
| Schema versioning policy | `docs/schema-versioning.md` defines the current `forward-dynatrace/v1` contract and migration checklist. |
| Formal artifact schemas | `npm run schemas:validate` compiles the JSON Schemas in `schemas/`, validates connector and approval examples, builds a demo package, and validates generated manifest, intent checks, status artifact, and status event. `npm run schemas:validate:test` covers success and rejection paths. |
| Connector config validation | Importer supports `--config`, rejects secrets in config files, and accepts non-secret runtime settings. |
| Connector metrics | `npm run workflow:smoke` verifies Prometheus-style metrics output from config import. |
| Runtime SLO gate | `npm run runtime:slo:test` verifies report/metrics SLO checks for duration, unresolved drift, signature requirements, and metric/report mismatch. |
| Read-only status artifact | `npm run workflow:smoke` verifies `forward-dynatrace-status/v1` output and confirms it omits check-level topology strings. |
| Forward status display and URL fetch | `npm run forward:status:test` verifies supplied artifact display, read-only localhost URL fetch, and non-local HTTP rejection. |
| Forward status publication | `npm run forward:status:publish:test` verifies sanitized status publication, checksum output, publish-safe Dynatrace status event output, unknown-field rejection, and credential-like content rejection. |
| Dynatrace status event publication | `npm run dynatrace:status:publish:test` verifies Apps-to-live ingest URL mapping, event schema validation, credential-like content rejection, OpenPipeline record shaping, and dry-run behavior without requiring a token. |
| Problem-triggered network evidence | `npm run dynatrace:network-evidence:publish:test` verifies aggregate assessment/severity mapping, removal of dependency IDs and query URLs, OpenPipeline record shaping, and dry-run artifact generation. `npm run schemas:validate -- --network-evidence-event <path>` validates the public event contract. |
| Problem-triggered network evidence live workflow | On 2026-07-12, the Trial DQL query returned 100 normalized rows. Forward network `235937`, snapshot `1322821` evaluated 100 queryable paths with reachable=0, blocked=100, ambiguous=0, unmapped=0, failed=0. OpenPipeline accepted run `fd-problem-evidence-20260712T113700Z` with HTTP 202, and Grail query-back returned exactly one matching event with the same network, snapshot, assessment, and counts. |
| Forward and Dynatrace change-validation gate | `npm run forward:change-gate:test` covers deterministic pass output, fail-closed blocked-path/health/problem/drift decisions, partial-evidence warnings, CLI artifact generation, and public schema validation. The gate consumes files only and performs no external reads or writes. |
| ServiceNow change-assurance preflight | `npm run servicenow:change-preflight:test` covers exact `change_request` lookup, single-record enforcement, raw approval/state evaluation, active `start_date`/`end_date` window enforcement, repeated affected-service scope, sanitized output, and fail-closed requested/non-executable/missing-window cases. `npm run schemas:validate` validates the committed preflight example. |
| ServiceNow change-assurance feedback | `npm run servicenow:change-feedback:test` covers bounded evidence/work-note construction, the exact companion assurance-ingress path and request bytes, created/existing receipts, receipt correlation, and fail-closed idempotency mismatch. The companion repository separately tests contract hash/correlation enforcement and raw-body preservation. |
| ServiceNow final assurance conductor | `npm run servicenow:change-assurance:test` covers exact preflight/context/scope correlation, deterministic gate and publication artifacts, the shared ServiceNow attachment SHA-256/idempotency marker in the Dynatrace event, fail-closed mismatches, non-pass exit `2`, full dry-run handoff generation, and JSON Schema validation of every output. |
| ServiceNow two-phase workflow conductor | `npm run servicenow:change-workflow:test` covers exact affected-service dependency scoping, missing-service rejection, authoritative baseline capture, resumable state identity, waiting through the baseline snapshot, new processed-snapshot selection, bounded timeout failure, post-stabilization Dynatrace-context freshness, exclusive start/complete locking, and safe same-host stale-lock recovery. `npm run runtime:entrypoint:test` verifies container dispatch while preserving the importer default. |
| Purchase-free ServiceNow Flow worker | `npm run servicenow:flow-server:test` covers bounded request contracts, deterministic/idempotent run IDs, changed-input conflicts, asynchronous start/status/complete, completion-context binding, Basic authentication, request-size bounds, retry behavior, concurrency-limit admission without retry poisoning, orphaned-phase recovery after restart, and response path redaction. |
| ServiceNow Flow Designer assets | `npm run servicenow:flow-assets:validate` checks the instance-neutral start/status/complete blueprint, exact worker routes, HTTPS requirement, Basic Auth Profile use, bounded outputs, and absence of embedded authorization/password values. |
| Continuous check-health transitions | `npm run forward:check-health:test` verifies managed-check filtering, quiet baseline/unchanged cycles, failure, recovery, missing transitions, deterministic transition IDs, duplicate managed-key rejection, cross-network state rejection, and zero publication calls for empty cycles. |
| Check-health scheduler templates | `npm run runtime:validate` checks five-minute systemd/Kubernetes schedules, overlap prevention, durable state/PVC, token-file publication, least privilege, and digest-pinned-image placeholder requirements. |
| Security exposure correlation | `npm run security:correlate:test` verifies fact separation, traceable evidence references, high-confidence ranking, low-confidence severity caps, rejected incomplete mappings, and the no-remediation boundary. |
| Change-validation gate live rejection | On 2026-07-12, the live conductor selected 12 Trial flows and Forward network `235937`, snapshot `1322821` returned 12 blocked paths with 0 ambiguous/unmapped/failed. Dry-run reconciliation planned 10 creates with 0 changed/stale. Reusing the same snapshot for before/after was rejected with `FORWARD_SNAPSHOT_UNCHANGED` and `FORWARD_BLOCKED_PATHS`; enforcement exited 2. The schema-valid artifact SHA-256 was `c3691aea3a0d1a7fab1ba431ef0abedb29df81624b77f0ca7e0679c8ffacc34c`. |
| Live Forward pre/post change pair | On 2026-07-12, Forward network `235937` produced a safe gate for snapshots `1322819 -> 1322820` with 24/24 paths reachable before and after, then a regression gate for `1322820 -> 1322821` with reachable `24 -> 12` and blocked `0 -> 12`. The first decision was `pass`; the second failed with `FORWARD_BLOCKED_PATHS`, `FORWARD_PATH_REGRESSION`, `DYNATRACE_SERVICE_UNHEALTHY`, and `DYNATRACE_OPEN_PROBLEMS`. Both sanitized events were published and queried back from Grail. |
| Curated pre/post intent baseline | On 2026-07-12, read-only discovery tested 500 role-aware host paths on Forward network `235937`: pre-change snapshot `1322820` had 107 reachable paths and post-change snapshot `1322821` had 68. A curated 24-check package selected 12 stable paths and 12 pre-good/post-blocked regressions across SSH, HTTP, HTTPS, MySQL, and PostgreSQL. Create-only apply produced check IDs `27161725` through `27161748`; read-back returned 12 PASS and 12 FAIL. Reconciliation rerun returned 24 unchanged with 0 changed/stale. Package intent-check SHA-256: `ed42c5af6b9f699b6b76ed30e9d5eca265f81beded5eff65dcd1b6d6897111b9`. |
| Check-health transition trial exercise | The applied 24-check baseline was used to produce one bounded `PASS_TO_FAIL` and one `FAIL_TO_PASS` transition. Both events were explicitly marked `synthetic=true`, published to the Trial tenant, and queried back with stable transition IDs. This proves publication, deduplication, and portal rendering without claiming that the saved state edits were live network changes. A customer-owned live poller/change pair remains an external validation gate. |
| Security-correlation trial exercise | Two ranked synthetic correlations were published and queried back from Grail: one high-confidence critical investigation and one low-confidence medium identity-review item. The portal includes them only with visible `SYNTHETIC DEMO` provenance; customer-approved Dynatrace/Forward evidence remains an external validation gate. |
| Cross-domain assurance portal | Version `1.1.3` deployed to the non-production Trial tenant on 2026-07-12. Visual verification loaded 24 live Grail dependency rows, two reconciliation runs, one problem-network event, the safe and regression pre/post gates, and the explicitly labeled synthetic check-health/security evidence. The portal exposes run/package IDs, network/snapshot IDs, path deltas, application health, drift, reason codes, evidence IDs, and provenance without Forward credentials or detailed topology. |
| Network-evidence DQL query pack | `deploy/dynatrace-dql/forward-network-evidence-latest.dql` and `deploy/dynatrace-dql/forward-network-evidence-attention.dql` provide problem-correlated latest and attention views without detailed Forward topology. |
| Dynatrace status dashboard query pack | `deploy/dynatrace-dql/forward-ingest-status-latest.dql` and `deploy/dynatrace-dql/forward-ingest-status-attention.dql` provide read-only status-event views for latest runs and operator attention. |
| Dynatrace status dashboard artifact | `deploy/dynatrace-dashboard/forward-ingest-status-dashboard.template.json` provides a tenant dashboard construction artifact and `npm run repo:validate` verifies that referenced DQL files exist. |
| Live demo runbook | `docs/live-demo-runbook.md` keeps customer-owned Dynatrace data as the production path and documents standard demo replay for trial sandboxes. `npm run repo:validate` requires the doc and release packaging includes it. |
| Forward API compatibility notes | `docs/forward-api-compatibility.md` documents required Forward endpoints, the no-fallback bulk create gate, and optional NQE/query-ID paths. `npm run repo:validate` requires the doc and release packaging includes it. |
| Synthetic Forward workflow | `npm run workflow:smoke` exercises validate-only, signed package validation, config import, metrics output, dry-run, 1001-check chunked apply, transient retry, unchanged, changed, stale, approved changed replacement, and approved stale deactivation flows against a fake Forward API. |
| Load and scale smoke | `npm run load:scale` generates 2500 synthetic Dynatrace dependency rows, normalizes them, builds a `data-connector` package, validates it, applies exportable checks to a fake Forward API in 400-check batches, and reruns the same package to confirm unchanged reconciliation. |
| Live Forward workflow | Real non-production Forward test network validated on 2026-06-30: dry-run create=3, apply create=3, rerun unchanged=3, changed drift=1, stale drift=1, and `--fail-on-drift` exit code 2. Validation checks were deleted after the run and confirmed remaining=0. |
| UI workflow screenshots | `npm run demo:capture` captures five checked screenshots from the built app with local app-function shims and placeholder data. The ServiceNow assurance capture is generated from the deterministic rehearsal artifacts and fails if the comparison table clips horizontally or omits any safe/regression reason label. |
| Dynatrace app build package | Version `1.0.0` builds locally. |
| Dynatrace install policy | A live unsigned deploy of the default `com.forwardnetworks.*` app ID was correctly rejected by Dynatrace AppEngine because unsigned non-`my.*` app IDs must be signed. `npm run dynatrace:deploy:test` now enforces the signed enterprise path or explicit `my.*` trial app ID before invoking `dt-app`. |
| Dynatrace trial app install | Version `1.0.10` installed successfully into a non-production Dynatrace Apps tenant on 2026-07-03 with the explicit unsigned trial app ID `my.forwardnetworks.dynatrace.field.integration`. The deploy wrapper restored the public `app.config.json` after install. |
| Dynatrace App Toolkit pin | `dt-app` is pinned to `1.11.2` and enforced by `npm run repo:validate`; a newer toolkit was not adopted during this pass because tenant deploy did not complete reliably in local validation. |
| Dynatrace live query path | Live read-only DQL queries against a non-production Dynatrace Apps environment succeeded on 2026-07-03. The saved demo fixture provides 100 replayable dependency records for trial tenants. |
| Dynatrace live UI source | The app uses `useDql` to load deduplicated dependency events from Grail on demand, labels live versus synthetic provenance, and retains an explicit fixture fallback. `npm run build` validates the bundled query path. |
| Dynatrace app deploy | Version `1.0.6` deployed successfully to a non-production Dynatrace Apps environment on 2026-07-03. The previous `1.0.5` deploy attempt was correctly rejected because that version was already installed with a different checksum. |
| Dynatrace saved demo replay | `npm run dynatrace:replay-demo` dry-runs a checked 100-row standard demo fixture. With `--apply`, it replays those rows into a trial tenant through OpenPipeline using a local Platform Token. Live replay/query on 2026-07-03 returned 100 records, 100 ready rows, and 0 review/needs-map rows. |
| Dynatrace ingest status feedback | A real Forward-side dry-run produced a sanitized status artifact on 2026-07-03. `npm run dynatrace:status:publish -- --apply` published the derived aggregate event to a non-production Dynatrace tenant, and a read-only DQL query returned `forward.dynatrace.ingest.status`, `import_state=reconciled`, and `planned_checks=100`. |
| Standard demo Forward reconciliation | The standard demo replay was queried from Dynatrace, packaged without `--include-review`, and dry-run reconciled against a non-production Forward demo network on 2026-07-03: planned=100, create=0, unchanged=100, changed=0, stale=0. |
| Acceptance evidence bundle | `npm run acceptance:bundle:test` builds the standard demo package, validates optional NQE artifacts, emits a sanitized status event, validates schemas, and writes `ACCEPTANCE.md` without contacting Forward. |
| Live deployment readiness gate | `npm run forward:readiness -- --dry-run` passed against the non-production Forward standard demo network on 2026-07-03: 100 eligible dependencies, 100 planned checks, 100 existing Dynatrace-managed checks, create=0, unchanged=100, changed=0, stale=0. |
| Legacy export path removal | `npm run repo:validate` blocks legacy secondary-artifact terms. |
| Secret hygiene | `npm run repo:validate` blocks committed Dynatrace token-shaped secrets, concrete tenant URLs, OAuth callbacks, private token filenames, personal references, and non-placeholder Forward credentials. |
| Connector pull workflow | Importer supports `--package-url`, validates the manifest, rejects stale packages, and still performs create-missing-only reconciliation. |
| Forward-side connector runtime templates | `deploy/docker-compose/`, `deploy/systemd/`, and `deploy/kubernetes/` provide scheduled import templates; `npm run runtime:validate` checks required safety controls and secret boundaries. Kubernetes YAML parsed locally on 2026-06-30. |
| Optional cron importer | `npm run forward:cron:test` covers argument parsing, explicit scheduled-apply approval, overlap prevention, and stale-lock recovery. `npm run runtime:validate` checks the dry-run cron config, protected credential boundary, and 15-minute schedule. |
| Dynatrace workflow trigger payloads | `deploy/dynatrace-workflows/` includes schedule and problem-trigger payload examples; `npm run dynatrace:workflow:validate` checks they generate valid package artifacts without Forward writes. |
| Dynatrace custom Workflow action | `npm run dynatrace:action:test` covers object/expression-resolved request input, exact artifact correlation, no-write boundary, and blocked empty scope. `npm run build` bundles `export-forward-package` action/widget into the app. |
| Dynatrace live query command | `npm run dynatrace:query` exports DQL records from a tenant and can write normalized dependency candidates without contacting Forward. |
| Dynatrace dependency normalization | `npm run dynatrace:normalize:test` verifies DQL-shaped rows normalize into ready/review/needs-map dependency candidates. |
| Dynatrace deploy wrapper | `npm run dynatrace:deploy:test` verifies unsigned trial app IDs, signed enterprise app ID requirements, dry-run behavior, and invalid app ID rejection. |
| Forward package builder | `npm run forward:package` builds manifest and `NewNetworkCheck[]` artifacts from normalized dependencies without contacting Forward. |
| Client rehearsal | `npm run demo:rehearsal` generates a package from DQL-shaped synthetic rows and validates it without Forward credentials. |
| ServiceNow safe/regression rehearsal | `npm run demo:servicenow:test` builds deterministic pass/fail scenarios through the production gate, ServiceNow evidence/receipt, and Dynatrace event builders. It validates every public artifact schema, asserts 24→24 safe and 24→12/12-blocked regression evidence, binds the same attachment SHA-256 into the event, and proves explicit synthetic provenance with zero external reads or writes. |
| Forward ingest status display | `api/forward-status.function.ts` and `shared/demo-forward-ingest-status.json` validate/display aggregate Forward-side ingest status only. |
| Dependency audit | `npm run security:audit` passes for production dependencies. |
| SBOM generation | `npm run sbom:check` generates a CycloneDX SBOM from production dependencies. |
| Importer container | `docker build -f Dockerfile.forward-importer -t forward-dynatrace-importer:local-hardening .`, `docker run --rm forward-dynatrace-importer:local-hardening --help`, and a runtime check confirming `npm`/`npx` are absent passed locally for the release line. |
| Release checksums | `npm run release:checksums:test` verifies SHA-256 checksum file generation for release artifacts. |
| Release checksum signing | `npm run release:sign:test` verifies detached Ed25519 signing and tamper-detection for `SHA256SUMS`. |
| Self-managed release signing key generation | `npm run release:signing-key:test` verifies local Ed25519 key generation, private-key file mode, public-key export, and signature verification. |
| Release archive packaging | `npm run release:package:smoke` builds the app/importer archives and `SHA256SUMS`, then verifies runtime commands, ServiceNow worker assets, cross-domain DQL, schemas, examples, and documentation by exact archive member. |
| Release SBOM publication | `npm run release:package:smoke` writes a CycloneDX release SBOM and includes it in `SHA256SUMS`. |
| Release archive download verification | The `v1.0.0` GitHub release archives were downloaded locally. `SHA256SUMS`, `SHA256SUMS.sig`, importer archive attestation, and GHCR image attestation all verified successfully. Earlier pre-1.0 archives were retained as `v0.9.x` prereleases. |
| GitHub release workflow | `.github/workflows/release.yml` runs CI, calls `npm run release:package`, uploads artifacts, and publishes tag releases with `SHA256SUMS`. |
| GHCR importer image workflow | `.github/workflows/release.yml` publishes `ghcr.io/forwardnetworks/forward-dynatrace-importer:<tag>` on tag releases and requests image/artifact attestations. The `v1.0.0` image was inspected locally at index digest `sha256:7f884e44a2b54303d7da708bc805f0e16c1d19b192f95a90e94a63aad66bb7c6`. |
| Container vulnerability scan workflow | `.github/workflows/release.yml` scans the published GHCR importer image with `aquasecurity/trivy-action@v0.36.0`, fails on HIGH/CRITICAL findings, uploads SARIF through CodeQL, and publishes the SARIF as a workflow artifact. The `v1.0.0` Trivy SARIF artifact was downloaded locally and contained 0 results. |
| Data handling rules | `docs/data-handling.md` defines publish-safe artifact rules and `npm run repo:validate` blocks known tenant, token, local path, and personal-reference patterns. |
| RBAC model | `docs/rbac.md` defines least-privilege roles and separation rules for package publishing, review, apply, signing, and runtime administration. |
| Package handoff controls | `docs/package-handoff.md` defines retention, immutability, access logging, publish order, and storage requirements. |
| Observability plan | `docs/observability.md` defines report fields, metrics, suggested alerts, and evidence retention. |
| Admin operations | `docs/admin-operations.md` defines audit export, config restore, disaster recovery, and access review. |
| Dependency update workflow | `.github/dependabot.yml` opens weekly npm and GitHub Actions update PRs and suppresses semver-major updates for deliberate compatibility review. |

## Automated In GitOps

| Check | Command |
| --- | --- |
| Repository, knowledge-map, and execution-plan invariants | `npm run repo:validate` |
| Formal schemas | `npm run schemas:validate` |
| Schema validator tests | `npm run schemas:validate:test` |
| Acceptance evidence bundle | `npm run acceptance:bundle:test` |
| Importer tests | `npm run forward:import:test` |
| Atomic package handoff publisher | `npm run forward:handoff:test` |
| Cron importer wrapper | `npm run forward:cron:test` |
| Forward and Dynatrace change-validation gate | `npm run forward:change-gate:test` |
| ServiceNow change-assurance preflight | `npm run servicenow:change-preflight:test` |
| ServiceNow change-assurance feedback | `npm run servicenow:change-feedback:test` |
| ServiceNow final assurance conductor | `npm run servicenow:change-assurance:test` |
| ServiceNow two-phase workflow conductor | `npm run servicenow:change-workflow:test` |
| Purchase-free ServiceNow Flow worker | `npm run servicenow:flow-server:test` |
| ServiceNow Flow Designer assets | `npm run servicenow:flow-assets:validate` |
| Runtime command dispatcher | `npm run runtime:entrypoint:test` |
| Continuous check-health transitions | `npm run forward:check-health:test` |
| Security exposure correlation | `npm run security:correlate:test` |
| Optional NQE artifact tests | `npm run forward:nqe-artifacts:test` |
| Read-only NQE preview tests | `npm run forward:nqe-preview:test` |
| Read-only NQE live smoke shape | `npm run forward:nqe-live-smoke:test` |
| Forward host-resolution preflight | `npm run forward:resolve-hosts:test` |
| Read-only path evidence preflight | `npm run forward:path-evidence:test` |
| Optional NQE package workflow | `npm run forward:package:test` |
| Deployment readiness | `npm run forward:readiness:test` |
| Forward status display | `npm run forward:status:test` |
| Forward status publisher | `npm run forward:status:publish:test` |
| Dynatrace status event publisher | `npm run dynatrace:status:publish:test` |
| Dynatrace network-evidence publisher | `npm run dynatrace:network-evidence:publish:test` |
| Dynatrace live query help/shape | `npm run dynatrace:query -- --help` |
| Dynatrace deploy policy | `npm run dynatrace:deploy:test` |
| Dynatrace custom Workflow action | `npm run dynatrace:action:test` |
| Dynatrace dependency normalization | `npm run dynatrace:normalize:test` |
| Forward package builder help/shape | `npm run forward:package -- --help` |
| Synthetic end-to-end workflow | `npm run workflow:smoke` |
| Load and scale smoke | `npm run load:scale` |
| Client rehearsal | `npm run demo:rehearsal` |
| ServiceNow safe/regression rehearsal | `npm run demo:servicenow:test` |
| Live demo conductor | `npm run demo:live:test` |
| Runtime manifest validation | `npm run runtime:validate` |
| Runtime SLO gate | `npm run runtime:slo:test` |
| Dynatrace workflow payload validation | `npm run dynatrace:workflow:validate` |
| Release checksum script | `npm run release:checksums:test` |
| Release checksum signing | `npm run release:sign:test` |
| Release signing key generation | `npm run release:signing-key:test` |
| Release archive packaging | `npm run release:package:smoke` |
| Dependency audit | `npm run security:audit` |
| SBOM generation | `npm run sbom:check` |
| Static lint | `npm run lint` |
| Dynatrace app build | `npm run build` |
| Whitespace sanity | `npm run whitespace:check` |

## Not Yet Fully Live-Validated

| Gap | What is needed |
| --- | --- |
| Forward-side connector runtime installation | Select/install a target runtime and assign operational ownership. Repo includes systemd/Kubernetes/cron/Compose templates, atomic filesystem handoff publication, package URL pull, and release packaging. |
| Dynatrace Workflow installation | Install the bundled `export-forward-package` custom action in the target tenant, create a real problem/schedule workflow from the checked payloads, and capture execution/result evidence. |
| ServiceNow change-assurance live acceptance | Build the Flow from checked Script-step assets, use one approved and one blocked non-production change, capture a customer-approved before/after pair, read back bounded result/checksum, retry without duplicates, and query back the matching Dynatrace event. |
| Check-health transition live pair | Install one checked systemd/Kubernetes poller with durable protected state, baseline managed checks, then capture one customer-approved failure and recovery transition plus Dynatrace query-back. |
| Security exposure customer evidence | Run the read-only correlator with customer-approved Dynatrace findings, Forward exposure evidence, and identity mappings; security and network owners must approve sharing, retention, and response boundaries. |
| Live Dynatrace demo dependency data | Customer-owned topology remains the production source of intent. The repo includes a saved 100-row standard demo fixture for replay into trial/demo sandboxes when live demo-tenant source tokens are unavailable. |
| Read-only dynamic NQE credential model | Needs customer approval and a live run of `npm run forward:nqe-live-smoke -- --execute --approval-file <approval.json>` for the exact Forward read-only credential model before enabling execute mode in Dynatrace. Base package export/import does not depend on this optional path. |
| Standard demo replay | `npm run dynatrace:replay-demo -- --help` documents replaying the checked demo fixture into a trial sandbox; not for production source-of-intent. |

## Production Gate

Before promoting a field integration deployment beyond this reference implementation:

1. Run manual importer dry-run against a Forward test network.
2. Apply a small package to that test network.
3. Re-run the same package and confirm it reports unchanged.
4. Change one dependency and confirm it reports changed.
5. Remove one dependency and confirm it reports stale.
6. If update/stale automation is enabled, require signed package verification, exact-key approval, change window, and
   mutation budgets. Otherwise keep both report-only.
