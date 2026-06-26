# Synthetic Data

The repo uses synthetic dependency rows only. Do not put customer names, customer topology, real Forward network IDs, or
real credentials in GitHub.

## Fixture

The shared fixture is [shared/demo-dependencies.json](../shared/demo-dependencies.json). It contains:

- 3 Forward-exportable rows
- 1 `needs-map` row that proves incomplete mappings are rejected from check creation
- synthetic service IDs prefixed with `SERVICE-DEMO-`
- synthetic host names, app names, owners, and ports

The local app imports this fixture so screenshots, browser tests, and package generation tell the same story.

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

## Optional Dynatrace Seed

Dry-run:

```bash
npm run dynatrace:seed:demo
```

Live ingest:

```bash
npm run dynatrace:seed:demo -- --apply
```

The script reads `DYNATRACE_TOKEN`, `DYNATRACE_TOKEN_FILE`, or `--token-file` locally. The token must have the
`bizevents.ingest` scope. No token is written to the repo. The script sends synthetic Business Events to:

```text
https://{environment-id}.live.dynatrace.com/api/v2/bizevents/ingest
```

All events include:

- `event.provider = forward-dynatrace-demo`
- `event.type = com.forward.demo.dependency`
- `demo.synthetic = true`
- `demo.run_id = <timestamped run id>`

Example DQL for verification in Dynatrace:

```text
fetch bizevents
| filter event.provider == "forward-dynatrace-demo"
| filter event.type == "com.forward.demo.dependency"
| sort timestamp desc
| limit 20
```

Dynatrace documents the Business Events API as JSON ingest through `/api/v2/bizevents/ingest`; the endpoint supports
single events and arrays of events.
