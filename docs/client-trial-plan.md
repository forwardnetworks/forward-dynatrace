# Client Trial Plan

Use this before a customer meeting or short Dynatrace trial. The goal is to prove value on both sides without changing
the trust boundary: Dynatrace exports packages and status views; Forward imports packages.

## Demo Story

1. Dynatrace dependency data is normalized into dependency candidates.
2. The app classifies rows as `ready`, `review`, or `needs-map`.
3. The app exports:
   - `forward-dynatrace-manifest.json`
   - `forward-intent-checks.json`
4. The Forward-side importer validates package integrity and reconciles checks.
5. Forward creates missing checks only when `--apply` is used.
6. Dynatrace displays a sanitized Forward ingest status artifact.

## Local Rehearsal

Run:

```bash
npm run demo:rehearsal
```

This uses `shared/demo-dynatrace-query-rows.json`, normalizes dependency rows, builds the Forward package, and runs
validate-only import without Forward credentials.

## Dynatrace Trial

Production path: query the customer's own Dynatrace topology, normalize it, build a Forward package, and let Forward
import it. Demo-copy and synthetic-seed workflows are sidecars for trial sandboxes only; do not use copied demo data as
the production source of intent.

1. Deploy the app to the trial tenant:

   ```bash
   npm run deploy -- --environment-url https://<environment-id>.apps.dynatrace.com/ --no-open --non-interactive
   ```

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

4. Review the normalized dependencies and endpoint mappings. Rows with `mappingState=needs-map` are excluded from
   package creation.

5. Build the Forward package:

   ```bash
   npm run forward:package -- \
     --dependencies /tmp/forward-dynatrace-dependencies.json \
     --output-dir /tmp/forward-dynatrace-package \
     --sync-mode manual-import
   ```

6. Use this DQL shape as the starting point for tenant data:

   ```text
   fetch events
   | filter <tenant-specific dependency source>
   | fields app.name, app.environment, dt.entity.service, service.name,
       network.source, network.destination, network.protocol, network.port,
       owner.team, criticality, dependency.confidence
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

4. Apply only after reviewing create/changed/stale counts:

   ```bash
   npm run forward:import -- \
     --checks forward-intent-checks.json \
     --manifest forward-dynatrace-manifest.json \
     --apply
   ```

5. Re-run without `--apply` and confirm the same package reports unchanged.

6. Delete demo checks after the trial if they were created in a shared test network.

## Demo Sidecar

If the live demo tenant has useful topology but your trial sandbox has the permissions needed for app install and
query validation, copy demo dependency evidence into the sandbox as a demo-only sidecar:

```bash
npm run dynatrace:copy-demo -- \
  --source-environment-url https://<demo-source-id>.apps.dynatrace.com/ \
  --destination-environment-url https://<trial-sandbox-id>.apps.dynatrace.com/ \
  --source-token-file /secure/path/source-token.txt \
  --destination-token-file /secure/path/destination-token.txt \
  --output-dir /tmp/forward-dynatrace-demo-copy \
  --apply
```

Then query the sandbox with:

```text
fetch events
| filter event.provider == "forward-dynatrace-demo-copy"
| filter event.type == "com.forward.demo.dependency"
```

This is for demos and trial sandboxes only. Production integrations must use the customer's own Dynatrace data.

## Dynatrace-Side Value

- App teams see dependency rows that are not ready for network intent.
- Teams can see Forward ingest state without Forward credentials in Dynatrace.
- Problem or schedule workflows can regenerate packages as app topology changes.
- Drift remains visible without letting Dynatrace mutate Forward.

## Stop Conditions

- Dynatrace token lacks `openpipeline:events:ingest`: stop and issue a Platform Token with the required scope.
- Forward dry-run shows unresolved locations: keep those rows `needs-map`.
- Forward import reports changed or stale checks: review in Forward before update or retirement.
