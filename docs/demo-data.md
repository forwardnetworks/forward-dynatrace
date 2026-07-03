# Demo And Test Data

The repo keeps committed fixtures demo-only and customer-safe. Production integrations must use customer-owned
Dynatrace topology through `npm run dynatrace:query` or the Dynatrace app workflow and keep exported rows outside
GitHub. Saved demo replay is a sidecar for trial sandboxes only. Do not put customer names, customer topology, real
Forward network IDs, or real credentials in GitHub.

## Fixtures

The app fixture is [shared/demo-dependencies.json](../shared/demo-dependencies.json). It contains:

- 100 review rows from a Dynatrace Playground Smartscape service-call export
- deterministic service IDs, service names, source names, destination names, protocol, and port fields
- no tenant ID, user identity, credential, customer name, Forward network ID, or customer topology

The local app imports this fixture so screenshots and browser tests tell the same story. These rows are demo evidence,
not production-ready Forward write candidates until endpoint-resolution marks both endpoints `ready`. The explicit
`--include-review` override exists for isolated demo replay only.

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

This normalizes DQL-shaped rows, builds the Forward package shape, and validates it without Forward credentials. The
saved demo fixture remains review-only unless a Forward endpoint-resolution preflight promotes rows to `ready`.

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

## Saved Demo Replay

Use this only for isolated trial tenants that do not already have useful demo topology. This is not a production
workflow.

The repo includes a saved Dynatrace Playground service-dependency fixture:

- `shared/demo-dynatrace-query-rows.json`
- `shared/demo-dependencies.json`

Replay it into a trial sandbox with OpenPipeline ingest. This does not require access to the live demo tenant.

Dry-run:

```bash
npm run dynatrace:replay-demo
```

Live ingest:

```bash
npm run dynatrace:replay-demo -- \
  --environment-url https://<trial-sandbox-id>.apps.dynatrace.com/ \
  --token-file /secure/path/platform-token \
  --apply
```

The script reads `DYNATRACE_TOKEN`, `DYNATRACE_TOKEN_FILE`, or `--token-file` locally. The Platform Token must have the
`openpipeline:events:ingest` scope. No token is written to the repo. When given an Apps URL, the script derives the
Dynatrace live ingest origin and sends saved demo dependency events to:

```text
https://{environment-id}.live.dynatrace.com/platform/ingest/v1/events
```

All events include:

- `event.provider = forward-dynatrace-demo`
- `event.type = com.forward.demo.dependency`
- `demo.fixture = dynatrace-playground-smartscape`
- `demo.replay = true`
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
