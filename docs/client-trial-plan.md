# Client Trial Plan

Use this before a customer meeting or short Dynatrace trial. The goal is to prove value on both sides without changing
the trust boundary: Dynatrace exports packages and status views; Forward imports packages. The detailed execution
runbook is in `docs/live-demo-runbook.md`.

## Demo Story

Use two connected acts. The first establishes application-to-network intent; the second proves that the same evidence
can govern an actual change without moving approval or deployment authority into the integration.

### Act 1: Dependency Evidence To Network Intent

1. Dynatrace dependency data is normalized into dependency candidates.
2. The app classifies rows as `ready`, `review`, or `needs-map`.
3. The app exports:
   - `forward-dynatrace-manifest.json`
   - `forward-intent-checks.json`
4. The Forward-side importer validates package integrity and reconciles checks.
5. Forward creates missing checks only when `--apply` is used.
6. Dynatrace displays a sanitized Forward ingest status artifact.

### Act 2: ServiceNow Change Assurance

1. Open an approved ServiceNow change with its active window, deployment ID, and affected Dynatrace services.
2. Start assurance and show the stable `fdca-*` run plus exact Forward before-snapshot ID.
3. Let the customer-owned deployment step run; the integration does not deploy or roll back.
4. Complete assurance with fresh Dynatrace health/problem context and a new processed Forward snapshot.
5. Show one safe decision and one regression with explicit reason codes and reachability deltas.
6. Match the ServiceNow attachment SHA-256/work-note marker to the same checksum on the Dynatrace assurance row.
7. Enable `--verify-servicenow-retry` for the acceptance completion and show that the second receipt reports the same
   attachment and work-note sys_ids as `existing`, with no duplicate evidence.

## Local Rehearsal

Run:

```bash
npm run demo:rehearsal
```

This uses `shared/demo-dynatrace-query-rows.json`, normalizes dependency rows, builds the Forward package, and runs
validate-only import without Forward credentials.

Rehearse the ServiceNow safe/regression act with:

```bash
npm run demo:servicenow
```

The command emits a presenter-ready `DEMO.md`, exact safe/regression gates, dry-run ServiceNow receipts, checksummed
evidence attachments, and schema-valid Dynatrace events. It is deliberately synthetic and contacts no external
system; use it to rehearse the story, not as customer acceptance evidence.

## Dynatrace Trial

Production path: query the customer's own Dynatrace topology, normalize it, build a Forward package, and let Forward
import it. The saved fixture replay is the standard demo-data path for trial sandboxes; do not use replayed demo data
as the production source of intent.

1. Deploy the app to the trial tenant:

   ```bash
   npm run dynatrace:deploy -- \
     --environment-url https://<environment-id>.apps.dynatrace.com/ \
     --app-id my.forwardnetworks.dynatrace.field.integration \
     --no-open \
     --non-interactive
   ```

   Use the default `com.forwardnetworks.*` app ID only when the deployment is signed with the Dynatrace App Toolkit
   signing OAuth client.

2. Create a Platform Token with the trial-safe scopes:

   ```text
   openpipeline:events:ingest
   storage:events:read
   storage:buckets:read
   app-engine:apps:install
   app-engine:apps:run
   app-engine:functions:run
   app-engine:certificates:create
   automation:workflows:read
   automation:workflows:write
   automation:workflows:run
   ```

3. Query dependency rows from the trial or customer-owned tenant:

   ```bash
   npm run dynatrace:query -- \
     --environment-url https://<environment-id>.apps.dynatrace.com/ \
     --token-file /secure/path/platform-token \
     --query-file deploy/dynatrace-dql/service-dependency-candidates-openpipeline-events.dql \
     --output /tmp/forward-dynatrace-rows.json \
     --dependencies-output /tmp/forward-dynatrace-dependencies.json
   ```

4. Review the normalized dependencies and endpoint mappings. When a Forward endpoint-resolution query ID is approved,
   run the read-only preflight from the Dynatrace app. Rows with unresolved Forward locations should be set to
   `mappingState=needs-map` and excluded from package creation.

5. Build the Forward package:

   ```bash
   npm run forward:package -- \
     --dependencies /tmp/forward-dynatrace-dependencies.json \
     --output-dir /tmp/forward-dynatrace-package \
     --sync-mode manual-import
   ```

   Optional Forward-owned query ID paths for persistent NQE checks or NQE diffs can be added here only after the
   customer approves specific query IDs. Do not make query IDs a prerequisite for the base intent-check trial.

6. Use this DQL shape as the starting point for tenant data:

   ```text
   fetch events
   | filter <tenant-specific dependency source>
   | fields app.name, app.environment, dt.entity.service, service.name,
       network.source, network.destination, network.protocol, network.port,
       owner.team, criticality, dependency.confidence, dependency.mapping_state
   | sort timestamp desc
   ```

## Live Forward Test

Use only a non-production Forward network.

1. Generate a package from live Dynatrace demo dependencies.
2. Validate without Forward credentials:

   ```bash
   npm run forward:import -- \
     --checks forward-intent-checks.json \
     --manifest forward-dynatrace-manifest.json \
     --validate-only
   ```

3. Dry-run against Forward:

   ```bash
   FORWARD_BASE_URL=https://forward.example.com \
   FORWARD_USER=<user> \
   FORWARD_PASSWORD=<password-or-token> \
   FORWARD_NETWORK_ID=<network-id> \
   npm run forward:import -- \
     --checks forward-intent-checks.json \
     --manifest forward-dynatrace-manifest.json \
     --report forward-import-report.json \
     --status-artifact forward-ingest-status.json
   ```

4. Publish sanitized status for Dynatrace display, then optionally publish the aggregate status event:

   ```bash
   npm run forward:status:publish -- \
     --status forward-ingest-status.json \
     --output-dir /handoff/dynatrace-forward/latest

   npm run dynatrace:status:publish -- \
     --event /handoff/dynatrace-forward/latest/forward-ingest-status-event.json \
     --environment-url https://<environment-id>.apps.dynatrace.com/ \
     --apply
   ```

5. Apply only after reviewing create/changed/stale counts:

   ```bash
   npm run forward:import -- \
     --checks forward-intent-checks.json \
     --manifest forward-dynatrace-manifest.json \
     --apply
   ```

6. Re-run without `--apply` and confirm the same package reports unchanged.

7. Delete demo checks after the trial if they were created in a shared test network.

## ServiceNow Non-Production Test

Build the Flow from the validated, instance-neutral assets in `deploy/servicenow-flow/` and run the authenticated worker
with `npm run servicenow:flow-server`. Use one approved change and one blocked or regressed change. Preserve the exact
run ID, change number/sys_id, deployment ID, network ID, before/after snapshot IDs, decision, evidence SHA-256, and
Dynatrace query-back count. Enable `SERVICENOW_FLOW_VERIFY_RETRY=1` only for the live idempotency acceptance run and
retain both feedback receipts. Do not use a copied JSON fixture as approval, and keep replay evidence visibly labeled
`SYNTHETIC DEMO` in every system.

## Standard Demo Replay

If the trial sandbox does not yet have useful topology, replay the checked standard demo fixture into the sandbox:

```bash
npm run dynatrace:replay-demo -- \
  --environment-url https://<trial-sandbox-id>.apps.dynatrace.com/ \
  --token-file /secure/path/platform-token \
  --apply
```

Then query the sandbox with:

```text
fetch events
| filter event.provider == "forward-dynatrace-demo"
| filter event.type == "com.forward.demo.dependency"
| filter demo.replay == true
```

This is for demos and trial sandboxes only. Production integrations must use the customer's own Dynatrace data, not the
checked replay fixture.

## Dynatrace-Side Value

- App teams see dependency rows that are not ready for network intent.
- Teams can see Forward ingest state without Forward credentials in Dynatrace.
- Problem or schedule workflows can regenerate packages as app topology changes.
- Drift remains visible without letting Dynatrace mutate Forward.
- ServiceNow users get a bounded, checksummed decision on the original change while Dynatrace users get the same
  publish-safe receipt identity for cross-team diagnosis.
- See `docs/prospect-talk-track.md` for the concise customer-facing explanation of what Forward and Dynatrace each get.

## Stop Conditions

- Dynatrace token lacks `openpipeline:events:ingest`: stop and issue a Platform Token with the required scope.
- Forward endpoint-resolution preflight or apply shows unresolved locations: keep those rows `needs-map`.
- Forward import reports changed or stale checks: review in Forward before update or retirement.
