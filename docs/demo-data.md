# Demo And Test Data

The repo keeps committed fixtures demo-only and customer-safe. Production integrations must use customer-owned
Dynatrace topology through `npm run dynatrace:query` or the Dynatrace app workflow and keep exported rows outside
GitHub. The saved replay fixture is the standard demo-data path for trial sandboxes and is aligned to the standard
Forward demo snapshot using resolvable host-filter IP values. Do not put customer names, customer topology, real
Forward network IDs, or real credentials in GitHub.

## Fixtures

The app fixture is [shared/demo-dependencies.json](../shared/demo-dependencies.json). It contains:

- 100 ready rows derived from a Dynatrace Playground Smartscape service-call export
- deterministic service IDs, service names, Forward-resolvable source/destination host filters, protocol, and port fields
- no tenant ID, user identity, credential, customer name, Forward network ID, or customer topology

The app starts with this fixture as an explicit synthetic fallback. Operators can select **Load live Dynatrace data**
to query the same event contract from Grail. The UI labels the active source and replay run ID so fixture-backed and
live tenant evidence cannot be confused. Production packages still require customer-owned Dynatrace topology and
customer-approved endpoint mapping.

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
saved demo fixture normalizes to 100 ready rows.

For the complete presenter flow, run:

```bash
npm run demo:showcase -- --output-dir /tmp/servicenow-forward-dynatrace-showcase
```

This creates the checked Dynatrace-to-Forward package act plus one safe and one regressed synthetic ServiceNow
scenario. It uses the same package, gate, checksummed ServiceNow evidence attachment, retry receipt, and Dynatrace
event builders as the live workflow, but performs zero external reads or writes. The generated `SHOWCASE.md`, bundle
index, and every change event keep `SYNTHETIC DEMO SHOWCASE` provenance explicit. Use `npm run demo:servicenow` when
only the assurance act is needed.

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

Use this for trial tenants that need the standard demo topology. This is not a production workflow.

The repo includes a saved standard demo service-dependency fixture with Forward-resolvable demo endpoints:

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

For a customer demo, add `--showcase`. The replay remains 100 rows for scale evidence, but marks one clean service row
`review` and one `needs-map` so the UI demonstrates governance and exclusion before package creation.

The script reads `DYNATRACE_TOKEN`, `DYNATRACE_TOKEN_FILE`, or `--token-file` locally. The Platform Token must have the
`openpipeline:events:ingest` scope. No token is written to the repo. When given an Apps URL, the script derives the
Dynatrace live ingest origin and sends saved demo dependency events to:

```text
https://{environment-id}.live.dynatrace.com/platform/ingest/v1/events
```

All events include:

- `event.provider = forward-dynatrace-demo`
- `event.type = com.forward.demo.dependency`
- `demo.fixture = standard-forward-demo`
- `demo.replay = true`
- `demo.synthetic = true`
- `demo.run_id = <timestamped run id>`

Example DQL for verification in Dynatrace:

```text
fetch events
| filter event.provider == "forward-dynatrace-demo"
| filter event.type == "com.forward.demo.dependency"
| filter `demo.fixture` == "standard-forward-demo"
| sort timestamp desc
| limit 20
```

The DQL starter query for event-backed trial data is
[deploy/dynatrace-dql/service-dependency-candidates-openpipeline-events.dql](../deploy/dynatrace-dql/service-dependency-candidates-openpipeline-events.dql).
