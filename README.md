# Forward Dynatrace

Art-of-the-possible Dynatrace AppEngine demo for turning Dynatrace application dependency mapping into Forward
Data Files and persistent Forward intent checks.

This is a production-oriented scaffold, not a turnkey supported integration. It intentionally keeps Forward mutation
behind a dry-run plan until server-side credentials, egress allow-listing, idempotent check sync, and operational
ownership are configured.

## Shape

- UI: `ui/app/pages/Home.tsx`
- Proof app function: `api/network-proof.function.ts`
- Forward sync app function: `api/forward-sync.function.ts`
- UI request/response types: `ui/app/types/network-proof.ts`
- Workflow notes: `docs/workflow.md`
- Forward ingest contract: `docs/forward-ingest-contract.md`
- Production checklist: `docs/production-readiness.md`

## Flow

1. Dynatrace application mapping supplies dependency rows: app, environment, source, destination, protocol, port,
   owner, criticality, and confidence.
2. The app generates a deterministic `integration_key` for each dependency.
3. The app stages those rows as a Forward Data File payload for NQE and auditability.
4. The app stages one persistent Forward `Existential` intent check per eligible dependency.
5. A Dynatrace Workflow can call the same function on a problem trigger or schedule.
6. Production execution then performs Data File create/update, network attachment, latest snapshot lookup, check
   dedupe, persistent check create, and check status readback.

## Forward automation path

The first production-grade route is a Forward Data File sync:

1. Generate `dynatrace_service_dependencies.csv` from Dynatrace service dependencies.
2. Create or replace the org-level file with `POST /api/data-files` or `POST /api/data-files/{dataFileName}`.
3. Enable it for the target network with `POST /api/networks/{networkId}/data-files/{dataFileName}`.
4. Optionally trigger a new snapshot with `POST /api/networks/{networkId}/snapshots`.
5. Resolve the latest processed snapshot with `GET /api/networks/{networkId}/snapshots/latestProcessed`.
6. Create persistent Forward intent checks with `POST /api/snapshots/{snapshotId}/checks?persistent=true`.
7. NQE and Verify consume the file and checks for dependency coverage, path proofs, and intent status.

For fully automatic operation, create a Dynatrace Workflow with either:

- Problem trigger: sync only impacted service dependencies and add network proof back to the problem.
- Schedule trigger: refresh all critical app dependencies into Forward once per collection window.

See `docs/workflow.md` and `docs/forward-ingest-contract.md` for the proposed production workflow and payload model.

## Configure

The dev environment is configured in `app.config.json`:

```json
"environmentUrl": "https://tjo85665.apps.dynatrace.com/"
```

Forward calls from an app function need one of these:

- Forward host in Dynatrace Settings > General > External requests.
- EdgeConnect if Forward is private/internal.

Do not put Forward credentials in browser state. Store them server-side using Dynatrace credential/app settings patterns.

For local Dynatrace API smoke checks, keep any platform token outside the repo, for example `~/dynatrace.token`. A token
used to read monitored entities needs the `environment-api:entities:read` scope.

## Commands

```bash
npm install
npm run start
npm run build
npm run deploy
```
