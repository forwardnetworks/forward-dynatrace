# Forward Dynatrace

Forward Field Integration reference for turning Dynatrace application dependency mapping into Forward bulk
intent-check import packages.

This is a field-built integration reference and is not an officially supported Forward product integration. The
Dynatrace app never mutates Forward. It exports a desired-state package; a Forward operator or Forward-side connector
imports or pulls that package.

## Shape

- UI: `ui/app/pages/Home.tsx`
- Path preview app function: `api/network-proof.function.ts`
- Read-only NQE preview app function: `api/forward-nqe-preview.function.ts`
- Forward export app function: `api/forward-sync.function.ts`
- Forward ingest status app function: `api/forward-status.function.ts`
- UI request/response types: `ui/app/types/network-proof.ts`
- Dynatrace live DQL exporter: `scripts/query-dynatrace-dependencies.mjs`
- Dynatrace dependency normalizer: `scripts/normalize-dynatrace-dependencies.mjs`
- Forward package builder: `scripts/build-forward-package.mjs`
- Optional NQE artifact helper: `scripts/forward-nqe-artifacts.mjs`
- Client trial plan: `docs/client-trial-plan.md`
- Execution roadmap: `docs/execution-roadmap.md`
- Install and release model: `docs/install.md`
- Workflow notes: `docs/workflow.md`
- Dynatrace workflow trigger examples: `docs/dynatrace-workflow-trigger.md`,
  `deploy/dynatrace-workflows/`
- Forward ingest contract: `docs/forward-ingest-contract.md`
- Read-only NQE preview: `docs/forward-nqe-preview.md`
- Optional NQE artifacts: `docs/forward-nqe-artifacts.md`
- Forward API compatibility gates: `docs/forward-api-compatibility.md`
- Forward importer workflow: `docs/forward-importer.md`
- Forward importer script: `scripts/forward-import-package.mjs`
- Forward deployment readiness: `scripts/forward-deployment-readiness.mjs`, `docs/deployment-readiness.md`
- Acceptance evidence bundle: `scripts/acceptance-bundle.mjs`
- Artifact schemas: `schemas/`, `scripts/schema-validate.mjs`
- Dynatrace deploy wrapper: `scripts/deploy-dynatrace-app.mjs`
- Forward status publisher: `scripts/publish-forward-status.mjs`
- Dynatrace status event publisher: `scripts/publish-dynatrace-status-event.mjs`
- Forward package signer: `scripts/sign-forward-package.mjs`
- Forward connector config examples: `config/forward-connector.config.example.json`,
  `config/forward-connector.signed.config.example.json`
- Forward importer container: `Dockerfile.forward-importer`, `docs/container-runtime.md`
- Forward connector runtime templates: `deploy/docker-compose/`, `deploy/systemd/`, `deploy/kubernetes/`,
  `docs/connector-runtime.md`
- Demo/test data: `docs/demo-data.md`
- Live demo runbook: `docs/live-demo-runbook.md`
- Dynatrace DQL starter/status queries: `deploy/dynatrace-dql/`
- Dynatrace status dashboard template: `deploy/dynatrace-dashboard/`
- Production checklist: `docs/production-readiness.md`
- Customer acceptance checklist: `docs/customer-acceptance-checklist.md`
- Customer one-page handout: `docs/customer-one-pager.md`
- Enterprise hardening backlog: `docs/enterprise-hardening.md`
- Operations runbook: `docs/operations-runbook.md`
- Incident response runbook: `docs/incident-response.md`
- Threat model: `docs/threat-model.md`
- Schema versioning: `docs/schema-versioning.md`
- Data handling: `docs/data-handling.md`
- RBAC model: `docs/rbac.md`
- Package handoff: `docs/package-handoff.md`
- Observability: `docs/observability.md`
- Dynatrace status dashboard: `docs/dynatrace-status-dashboard.md`
- Admin operations: `docs/admin-operations.md`
- Release workflow: `docs/release.md`
- Release provenance: `docs/release-provenance.md`
- PR-only governance: `docs/governance.md`
- Validation matrix: `docs/validation-matrix.md`
- Harness engineering notes: `docs/harness-engineering.md`
- GitOps checks: `docs/gitops.md`
- Prospect talk track: `docs/prospect-talk-track.md`

## Flow

1. Dynatrace application mapping supplies dependency rows: app, environment, source, destination, protocol, port,
   owner, criticality, and confidence.
2. The query exporter can pull those rows from a live Dynatrace tenant with a Platform Token.
3. The app or package builder generates a deterministic `integration_key` for each dependency.
4. The app or package builder stages one Forward-native `NewNetworkCheck` JSON object per eligible dependency.
   Eligible means the source and destination have been resolved in the target Forward network. Review rows are held
   unless an operator deliberately uses the review-row override.
5. A Dynatrace Workflow can call the same function on a problem trigger or schedule.
6. Forward-side ingest performs latest snapshot lookup, existing-check readback, name/tag dedupe, bulk persistent
   check creation, and status reporting.
7. Dynatrace displays the sanitized Forward ingest status artifact, or receives the aggregate status event through
   OpenPipeline, without Forward credentials or topology details.

## Screenshots

Workflow overview:

![Forward Dynatrace overview](docs/assets/screenshots/01-overview.jpg)

Read-only NQE preview and request plan:

![Forward read-only NQE preview](docs/assets/screenshots/02-export-package-readiness.jpg)

Forward-side package and bulk check API sequence:

![Forward-side API sequence](docs/assets/screenshots/03-forward-side-api.jpg)

Persistent intent-check payload:

![Forward intent check payload](docs/assets/screenshots/04-intent-check-payload.jpg)

## Forward-centric ingest path

The production-grade route is an export package that Forward imports or pulls. The intent-check JSON is the primary
artifact.

A Forward-side connector means a process outside Dynatrace that pulls the export package, validates the manifest and
checks, dedupes them, and then writes to Forward with Forward-scoped credentials. It is a pull/import path, not a
Dynatrace push into Forward.

1. Generate `forward-intent-checks.json` as Forward-native `NewNetworkCheck[]`.
2. Generate `forward-dynatrace-manifest.json` with schema version, counts, dedupe policy, and optional Forward target
   metadata. The manifest includes a SHA-256 checksum for `forward-intent-checks.json`.
3. Forward operator imports the package manually with the included script, or a Forward-side connector pulls it from a
   read-only package URL.
4. Forward-side ingest validates package shape, unique names, unique `dynatrace-key:*` tags, and allowed check type.
5. Forward-side ingest resolves the latest processed snapshot with
   `GET /api/networks/{networkId}/snapshots/latestProcessed`.
6. Forward-side ingest reads existing intent checks with
   `GET /api/snapshots/{snapshotId}/checks?type=Existential`.
7. Forward-side ingest produces a create/unchanged/changed/stale reconciliation report.
8. Forward-side ingest creates missing persistent Forward intent checks with
   `POST /api/snapshots/{snapshotId}/checks?bulk`.
9. Optional approved update/stale automation can replace or deactivate generated checks only from the Forward-side
   runtime with a verified signed package, exact approval file, and explicit mutation budgets.
10. Optional NQE check and diff artifacts can be included only with Forward-owned query IDs and a Forward-side
    allowlist; the intent-check workflow remains the default path.

For fully automatic package generation, create a Dynatrace Workflow with either:

- Problem trigger: export only impacted service dependencies.
- Schedule trigger: refresh export package for all critical app dependencies.

Forward-side automation should reconcile each package against existing Forward checks before writing.

## Manual Import Dry Run

The included importer runs in dry-run mode unless `--apply` is supplied:

```bash
export FORWARD_BASE_URL=https://forward.example.com
export FORWARD_USER=<user>
export FORWARD_PASSWORD=<password-or-token>
export FORWARD_NETWORK_ID=<network-id>

npm run forward:import -- --checks forward-intent-checks.json --manifest forward-dynatrace-manifest.json
npm run forward:import -- --checks forward-intent-checks.json --manifest forward-dynatrace-manifest.json --apply
npm run forward:import -- --checks forward-intent-checks.json --manifest forward-dynatrace-manifest.json --report forward-import-report.json
npm run forward:import -- --package-url https://package.example.com/dynatrace-forward/latest/ --fail-on-drift
```

The importer is dry-run by default, rejects malformed packages before Forward API calls, retries transient Forward API
responses, verifies package checksums, and applies a create-missing-only policy by default. Approved changed-check
replacement and stale-check deactivation are optional Forward-side paths described in `docs/forward-importer.md`.
For package provenance, sign the exact manifest/check package with `npm run forward:sign` and run the importer with
`--require-signature`.

## Acceptance Evidence

Generate a read-only evidence bundle for a trial, release intake, or customer acceptance packet:

```bash
npm run acceptance:bundle -- \
  --dependencies shared/demo-dependencies.json \
  --output-dir out/acceptance \
  --sync-mode data-connector
```

The bundle builds a package, validates it, emits sanitized Forward ingest status and Dynatrace status-event artifacts,
and runs schema validation. It does not contact Forward and does not apply checks.

Validate public artifact contracts directly with:

```bash
npm run schemas:validate
```

## Configure

The dev environment is configured in `app.config.json`:

Keep `app.config.json` on the public placeholder and pass the tenant URL at deploy time:

```bash
npm run dynatrace:deploy -- \
  --environment-url https://your-environment-id.apps.dynatrace.com/ \
  --app-id my.forwardnetworks.dynatrace.field.integration \
  --no-open \
  --non-interactive
```

Use `my.*` app IDs for unsigned trial or development installs. For the default enterprise `com.forwardnetworks.*` app
ID, use `--sign-archive` and provide the Dynatrace signing OAuth client environment variables required by the
Dynatrace App Toolkit.

The Dynatrace app should not store Forward write credentials. Forward credentials belong in Forward-side manual import
or the Forward-side connector.

For local Dynatrace API smoke checks, keep any platform token outside the repo and pass it with `DYNATRACE_TOKEN`,
`DYNATRACE_TOKEN_FILE`, or `--token-file`.

## Commands

```bash
npm install
npm run repo:validate
npm run forward:import:test
npm run forward:nqe-artifacts:test
npm run forward:nqe-live-smoke -- --help
npm run forward:nqe-live-smoke:test
npm run forward:nqe-preview:test
npm run forward:package:test
npm run forward:sign -- --help
npm run workflow:smoke
npm run runtime:validate
npm run dynatrace:workflow:validate
npm run dynatrace:query -- --help
npm run dynatrace:deploy -- --help
npm run dynatrace:deploy:test
npm run dynatrace:normalize:test
npm run forward:package -- --help
npm run forward:status:test
npm run forward:status:publish -- --help
npm run forward:status:publish:test
npm run schemas:validate
npm run schemas:validate:test
npm run acceptance:bundle:test
npm run demo:rehearsal
npm run security:audit
npm run sbom:check
npm run dynatrace:replay-demo
npm run lint
npm run build
npm run ci
npm run start
npm run deploy
```

`npm run ci` is the local equivalent of the GitHub Actions `gitops` workflow.
`npm run dynatrace:replay-demo -- --apply` posts the checked standard demo fixture to a trial sandbox using a
local Platform Token; it is dry-run by default. Production integrations should query the customer's own Dynatrace
topology.
