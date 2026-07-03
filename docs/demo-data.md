# Demo And Test Data

The repo keeps committed fixtures synthetic. Production integrations must use customer-owned Dynatrace topology through
`npm run dynatrace:query` or the Dynatrace app workflow and keep exported rows outside GitHub. Demo-copy and
synthetic-seed workflows are sidecars for trial sandboxes only. Do not put customer names, customer topology, real
Forward network IDs, or real credentials in GitHub.

## Fixtures

The app fixture is [shared/demo-dependencies.json](../shared/demo-dependencies.json). It contains:

- 3 Forward-exportable rows
- 1 `needs-map` row that proves incomplete mappings are rejected from check creation
- synthetic service IDs prefixed with `SERVICE-DEMO-`
- synthetic host names, app names, owners, and ports

The local app imports this fixture so screenshots, browser tests, and package generation tell the same story.

The DQL-shaped fixture is
[shared/demo-dynatrace-query-rows.json](../shared/demo-dynatrace-query-rows.json). Normalize it with:

```bash
npm run dynatrace:normalize -- \
  --input shared/demo-dynatrace-query-rows.json \
  --output /tmp/forward-dynatrace-dependencies.json
```

The read-only Forward status fixture is
[shared/demo-forward-ingest-status.json](../shared/demo-forward-ingest-status.json). It contains aggregate import
counts only and is safe for Dynatrace display.

## Client Rehearsal

Run:

```bash
npm run demo:rehearsal
```

This normalizes DQL-shaped rows, builds the Forward package, and validates package shape without Forward credentials.

## Local Workflow Smoke

Run the full synthetic workflow without any external systems:

```bash
npm run workflow:smoke
```

This starts a fake Forward API and verifies:

- package validation without Forward credentials
- dry-run create report
- apply creates missing checks
- second dry-run reports unchanged checks
- changed generated fields are reported
- stale Dynatrace-managed checks are reported

## Live Dynatrace Query

Run a DQL query against the customer's tenant or trial sandbox and normalize the result:

```bash
npm run dynatrace:query -- \
  --environment-url https://<environment-id>.apps.dynatrace.com/ \
  --token-file /secure/path/platform-token \
  --query-file deploy/dynatrace-dql/service-dependency-candidates-openpipeline-events.dql \
  --output /tmp/forward-dynatrace-rows.json \
  --dependencies-output /tmp/forward-dynatrace-dependencies.json
```

Build a Forward package from the normalized rows:

```bash
npm run forward:package -- \
  --dependencies /tmp/forward-dynatrace-dependencies.json \
  --output-dir /tmp/forward-dynatrace-package
```

## Demo Tenant Copy Sidecar

Use this only to copy demo dependency evidence into a trial sandbox when the live demo tenant has the topology you want
to show but the sandbox has the permissions you want to validate. This is not a production workflow.

```bash
npm run dynatrace:copy-demo -- \
  --source-environment-url https://<demo-source-id>.apps.dynatrace.com/ \
  --destination-environment-url https://<trial-sandbox-id>.apps.dynatrace.com/ \
  --source-token-file /secure/path/source-token.txt \
  --destination-token-file /secure/path/destination-token.txt \
  --output-dir /tmp/forward-dynatrace-demo-copy \
  --apply
```

The sidecar writes local `source-rows.json`, `openpipeline-events.json`, and `dependencies.json` artifacts. Keep those
outside GitHub.

## Synthetic Dynatrace Seed

Use this only for isolated test tenants that do not already have useful demo topology. This is not a production
workflow.

Dry-run:

```bash
npm run dynatrace:seed:demo
```

Live ingest:

```bash
npm run dynatrace:seed:demo -- --apply
```

The script reads `DYNATRACE_TOKEN`, `DYNATRACE_TOKEN_FILE`, or `--token-file` locally. The Platform Token must have the
`openpipeline:events:ingest` scope. No token is written to the repo. The script sends synthetic dependency events to:

```text
https://{environment-id}.apps.dynatrace.com/platform/ingest/v1/events
```

All events include:

- `event.provider = forward-dynatrace-demo`
- `event.type = com.forward.demo.dependency`
- `demo.synthetic = true`
- `demo.run_id = <timestamped run id>`

Example DQL for verification in Dynatrace:

```text
fetch events
| filter event.provider == "forward-dynatrace-demo"
| filter event.type == "com.forward.demo.dependency"
| sort timestamp desc
| limit 20
```

The DQL starter query for event-backed trial data is
[deploy/dynatrace-dql/service-dependency-candidates-openpipeline-events.dql](../deploy/dynatrace-dql/service-dependency-candidates-openpipeline-events.dql).
