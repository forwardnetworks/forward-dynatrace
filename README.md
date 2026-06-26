# Forward Dynatrace

Forward Field Integration reference for turning Dynatrace application dependency mapping into Forward bulk
intent-check import packages.

This is a field-built integration reference and is not an officially supported Forward product integration. The
Dynatrace app never mutates Forward. It exports a desired-state package; a Forward operator or Forward-side connector
imports or pulls that package.

## Shape

- UI: `ui/app/pages/Home.tsx`
- Path preview app function: `api/network-proof.function.ts`
- Forward export app function: `api/forward-sync.function.ts`
- UI request/response types: `ui/app/types/network-proof.ts`
- Install and release model: `docs/install.md`
- Workflow notes: `docs/workflow.md`
- Forward ingest contract: `docs/forward-ingest-contract.md`
- Forward importer workflow: `docs/forward-importer.md`
- Forward importer script: `scripts/forward-import-package.mjs`
- Synthetic fixture and Dynatrace seeding: `docs/demo-data.md`
- Production checklist: `docs/production-readiness.md`
- Validation matrix: `docs/validation-matrix.md`
- Harness engineering notes: `docs/harness-engineering.md`
- GitOps checks: `docs/gitops.md`

## Flow

1. Dynatrace application mapping supplies dependency rows: app, environment, source, destination, protocol, port,
   owner, criticality, and confidence.
2. The app generates a deterministic `integration_key` for each dependency.
3. The app stages one Forward-native `NewNetworkCheck` JSON object per eligible dependency.
4. A Dynatrace Workflow can call the same function on a problem trigger or schedule.
5. Forward-side ingest performs latest snapshot lookup, existing-check readback, name/tag dedupe, bulk persistent
   check creation, and status reporting.

## Screenshots

Workflow overview:

![Forward Dynatrace overview](docs/assets/screenshots/01-overview.jpg)

Forward bulk export package, readiness gates, and payloads:

![Forward export package and readiness](docs/assets/screenshots/02-export-package-readiness.jpg)

Forward-side bulk check API sequence:

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
   metadata.
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
responses, and applies a create-missing-only policy unless a future reviewed update/retirement workflow is added.

## Configure

The dev environment is configured in `app.config.json`:

Keep `app.config.json` on the public placeholder and pass the tenant URL at deploy time:

```bash
npm run deploy -- --environment-url https://your-environment-id.apps.dynatrace.com/
```

The Dynatrace app should not store Forward write credentials. Forward credentials belong in Forward-side manual import
or the Forward-side connector.

For local Dynatrace API smoke checks, keep any platform token outside the repo and pass it with `DYNATRACE_TOKEN`,
`DYNATRACE_TOKEN_FILE`, or `--token-file`.

## Commands

```bash
npm install
npm run repo:validate
npm run forward:import:test
npm run workflow:smoke
npm run dynatrace:seed:demo
npm run lint
npm run build
npm run ci
npm run start
npm run deploy
```

`npm run ci` is the local equivalent of the GitHub Actions `gitops` workflow.
`npm run dynatrace:seed:demo -- --apply` optionally posts only synthetic Business Events to Dynatrace using a local
token; it is dry-run by default.
