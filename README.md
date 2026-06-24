# Forward Dynatrace

Dynatrace AppEngine scaffold for turning Dynatrace service dependency evidence into Forward Data Files, path proof,
and persistent intent checks.

## Shape

- UI: `ui/app/pages/Home.tsx`
- Proof app function: `api/network-proof.function.ts`
- Forward sync app function: `api/forward-sync.function.ts`
- UI request/response types: `ui/app/types/network-proof.ts`
- Workflow notes: `docs/workflow.md`

## Flow

1. Operator enters a Dynatrace service/problem context.
2. App function builds a Forward path query from source, destination, protocol, and port.
3. The app stages Dynatrace dependency rows as a Forward Data File payload.
4. The app stages persistent Forward intent checks for the same rows.
5. A Dynatrace Workflow can call the same app function on a problem trigger or schedule.
6. Next implementation step is to add server-side Forward credential lookup and execute the generated API sequence.

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

See `docs/workflow.md` for the proposed production workflow and payload model.

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
