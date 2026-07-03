# Read-Only NQE Preview

The `forward-nqe-preview` app function adds the optional Phase 3 workflow from the execution roadmap: Dynatrace can
ask Forward for read-only network evidence before exporting persistent intent-check packages.

This path does not write to Forward. It calls only `POST /api/nqe`, and the UI does not collect Forward credentials.

## Modes

Plan mode is the default:

- builds the Forward NQE request body
- shows the target `POST /api/nqe` path
- uses allowlisted raw-query templates by default
- includes dependency parameters when an approved optional query ID is used
- performs no network call

Execute mode is optional:

- requires `execute: true`
- requires a runtime-supplied read-only authorization header
- requires query IDs to be allowlisted when `queryId` is used
- returns sanitized aggregate evidence: row count, returned count, columns, and optionally a small row sample

## Runtime Settings

Use runtime secret injection for execution:

```bash
FORWARD_NQE_READONLY_AUTHORIZATION=<read-only-forward-authorization-header>
FORWARD_NQE_ALLOWED_QUERY_IDS=FQ_<forward-owned-query-id>,FQ_<another-forward-owned-query-id>
```

Do not store Forward credentials in Dynatrace app settings, browser state, package artifacts, screenshots, or committed
config files.

## Templates

| Template | Uses Raw Query | Requires `queryId` | Purpose |
| --- | --- | --- | --- |
| `endpoint-inventory-smoke` | Yes | No | Confirm read-only NQE execution against the target network. |
| `approved-endpoint-resolution` | No | Yes | Run a Forward-owned endpoint-resolution query with Dynatrace dependency parameters. |
| `approved-blast-radius` | No | Yes | Run a Forward-owned blast-radius query with Dynatrace service context. |

The raw-query template path is the default read-only preview option. Query-ID templates are optional and should be used
only when the customer approves specific Forward-owned query IDs for stable reusable previews, diffs, or persistent NQE
checks. The base integration continues to work with intent-check packages only.

## Endpoint-Resolution Contract

Run `approved-endpoint-resolution` before applying generated intent checks. This catches the common Forward apply
failure where `/api/snapshots/{snapshotId}/checks?bulk` rejects a `HostFilter` because a Dynatrace source or destination
name does not match any location in the target Forward snapshot.

The Forward-owned NQE query should return either one aggregate row:

```json
{
  "sourceMatchCount": 1,
  "destinationMatchCount": 0
}
```

or one row per endpoint:

```json
[
  {"endpointRole": "source", "endpoint": "checkout-vip", "matchCount": 1},
  {"endpointRole": "destination", "endpoint": "orders-db", "matchCount": 0}
]
```

The Dynatrace app classifies the dependency as:

- `ready`: source and destination each resolve to exactly one Forward location; the row can become an intent-check
  candidate.
- `review`: either endpoint is ambiguous or the query result is not recognized; the row is held unless an operator uses
  the explicit review-row override.
- `needs-map`: either endpoint has zero matches.

Rows classified as `needs-map` are excluded from apply packages until the Dynatrace dependency is mapped to a
Forward-resolvable `HostFilter`, `SubnetLocationFilter`, or `DeviceFilter` value.

## Request Example

```json
{
  "forwardBaseUrl": "https://forward.example.com",
  "forwardNetworkId": "123",
  "templateId": "approved-endpoint-resolution",
  "queryId": "FQ_<forward-owned-query-id>",
  "execute": false,
  "dependency": {
    "appName": "Checkout",
    "environment": "prod",
    "serviceEntityId": "SERVICE-123",
    "source": "checkout-vip",
    "destination": "orders-db",
    "protocol": "tcp",
    "port": "443"
  }
}
```

## Production Rules

- Use the preview to mark rows `ready`, `review`, or `needs-map`.
- Use endpoint-resolution results to mark unresolved rows as `needs-map` before Forward apply.
- Treat `ready` as the default package-eligibility gate.
- Do not block package export when NQE preview fails.
- Do not let Dynatrace commit NQE Library content.
- Keep persistent Forward writes in the manual importer or Forward-side connector.
- Use a Forward-side proxy instead of Dynatrace-hosted execution if customer policy requires Forward credentials to stay
  entirely outside Dynatrace.

## Validation

Run:

```bash
npm run forward:nqe-preview:test
```

The test covers plan mode, missing authorization blocking, query-ID allowlisting, and the read-only `POST /api/nqe`
execution path.

For a customer-approved live credential smoke, run plan mode first:

```bash
npm run forward:nqe-live-smoke -- \
  --forward-base-url https://forward.example.com \
  --forward-network-id <network-id> \
  --output /tmp/forward-nqe-live-smoke-plan.json
```

Then execute only with a read-only Forward authorization header supplied by secret file or runtime secret:

```bash
npm run forward:nqe-live-smoke -- \
  --forward-base-url https://forward.example.com \
  --forward-network-id <network-id> \
  --approval-file /secure/path/nqe-preview-approval.json \
  --authorization-file /secure/path/read-only-forward-auth-header \
  --execute \
  --output /tmp/forward-nqe-live-smoke.json
```

The live smoke calls only `POST /api/nqe`, uses the `endpoint-inventory-smoke` template by default, and emits a
sanitized JSON report. Query-ID templates remain optional and require `--query-id` plus `--allow-query-id` or
`FORWARD_NQE_ALLOWED_QUERY_IDS`.

The approval file must use `forward-dynatrace-nqe-preview-approval/v1`; see
`config/forward-nqe-live-smoke.approval.example.json`. Execution refuses to run without approval, refuses expired or
mismatched approvals, and rejects approval files containing credential-like content.
