# Forward Dynatrace

Art-of-the-possible Dynatrace AppEngine demo for turning Dynatrace application dependency mapping into Forward
bulk intent-check import packages, with optional Forward Data File context.

This is a production-oriented scaffold, not a turnkey supported integration. The Dynatrace app never mutates Forward.
It exports a Forward ingest package; a Forward operator or Forward-owned data connector imports or pulls that package.

## Shape

- UI: `ui/app/pages/Home.tsx`
- Proof app function: `api/network-proof.function.ts`
- Forward export app function: `api/forward-sync.function.ts`
- UI request/response types: `ui/app/types/network-proof.ts`
- Workflow notes: `docs/workflow.md`
- Forward ingest contract: `docs/forward-ingest-contract.md`
- Forward importer workflow: `docs/forward-importer.md`
- Forward importer script: `scripts/forward-import-package.mjs`
- Production checklist: `docs/production-readiness.md`

## Flow

1. Dynatrace application mapping supplies dependency rows: app, environment, source, destination, protocol, port,
   owner, criticality, and confidence.
2. The app generates a deterministic `integration_key` for each dependency.
3. The app stages one Forward-native `NewNetworkCheck` JSON object per eligible dependency.
4. The app can also stage the same rows as an optional Forward Data File payload for NQE and auditability.
5. A Dynatrace Workflow can call the same function on a problem trigger or schedule.
6. Forward-side ingest performs latest snapshot lookup, existing-check readback, name/tag dedupe, bulk persistent
   check creation, and optional Data File create/update.

## Screenshots

Workflow overview:

![Forward Dynatrace overview](docs/assets/screenshots/01-overview.jpg)

Forward bulk export package, readiness gates, and payloads:

![Forward export package and readiness](docs/assets/screenshots/02-export-package-readiness.jpg)

Forward-side API sequence and Data File payload:

![Forward-side API sequence and Data File payload](docs/assets/screenshots/03-forward-side-api.jpg)

Persistent intent-check payload:

![Forward intent check payload](docs/assets/screenshots/04-intent-check-payload.jpg)

## Forward-centric ingest path

The first production-grade route is an export package that Forward imports or pulls. The intent-check JSON is the
primary artifact; the Data File is optional context for NQE and audit.

1. Generate `forward-intent-checks.json` as Forward-native `NewNetworkCheck[]`.
2. Generate `forward-dynatrace-manifest.json` with schema version, counts, dedupe policy, and optional Forward target
   metadata.
3. Forward operator imports the package manually with the included script, or a Forward-owned connector pulls it.
4. Forward-side ingest resolves the latest processed snapshot with
   `GET /api/networks/{networkId}/snapshots/latestProcessed`.
5. Forward-side ingest reads existing intent checks with
   `GET /api/snapshots/{snapshotId}/checks?type=Existential`.
6. Forward-side ingest skips checks that match an existing name or `dynatrace-key:*` tag.
7. Forward-side ingest creates missing persistent Forward intent checks with
   `POST /api/snapshots/{snapshotId}/checks?bulk`.
8. Optional: import `dynatrace_service_dependencies.csv` with `POST /api/data-files`, replace later with
   `POST /api/data-files/{dataFileName}`, and attach with
   `POST /api/networks/{networkId}/data-files/{dataFileName}`.
9. NQE and Verify consume the checks and optional Data File for dependency coverage, path proofs, and intent status.

For fully automatic package generation, create a Dynatrace Workflow with either:

- Problem trigger: export only impacted service dependencies.
- Schedule trigger: refresh export package for all critical app dependencies.

See `docs/workflow.md` and `docs/forward-ingest-contract.md` for the proposed production workflow and payload model.

## Manual Import Dry Run

The included importer runs in dry-run mode unless `--apply` is supplied:

```bash
export FORWARD_BASE_URL=https://fwd.app
export FORWARD_USER=<user>
export FORWARD_PASSWORD=<password-or-token>
export FORWARD_NETWORK_ID=<network-id>

npm run forward:import -- --checks forward-intent-checks.json
npm run forward:import -- --checks forward-intent-checks.json --apply
```

Optional Data File import:

```bash
npm run forward:import -- \
  --checks forward-intent-checks.json \
  --data-file dynatrace_service_dependencies.csv \
  --data-file-request forward-data-file-request.json \
  --attach-data-file \
  --apply
```

## Configure

The dev environment is configured in `app.config.json`:

```json
"environmentUrl": "https://tjo85665.apps.dynatrace.com/"
```

The Dynatrace app should not store Forward write credentials. Forward credentials belong in Forward-side manual import
or the Forward-owned connector.

For local Dynatrace API smoke checks, keep any platform token outside the repo, for example `~/dynatrace.token`. A token
used to read monitored entities needs the `environment-api:entities:read` scope.

## Commands

```bash
npm install
npm run start
npm run build
npm run deploy
```
