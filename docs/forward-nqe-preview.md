# Forward NQE Preview

The `forward-nqe-preview` app function adds the optional preflight workflow from the execution roadmap: Dynatrace can
plan a read-only network-evidence request before exporting persistent intent-check packages.

The Dynatrace app makes no Forward network call and does not collect Forward credentials. A separate Forward-controlled
runtime may execute the planned request and return only sanitized aggregate evidence.

## Modes

Plan mode is the default:

- builds the Forward NQE request body
- shows the target `POST /api/nqe` path
- can be staged before Forward URL and network metadata are supplied
- enforces the requested Forward access profile before planning execution
- under Read Only, requires an approved Forward Library `queryId`
- under Network Operator or Network Admin, permits approved arbitrary NQE templates
- includes dependency parameters when an approved optional query ID is used
- performs no network call

Execute mode exists only in the standalone `forward:nqe-live-smoke` Forward-side helper. The Dynatrace app function
rejects it. Forward-side execution:

- requires the explicit `--execute` operator flag
- requires Forward URL metadata and a network ID
- requires a runtime-supplied authorization header matching the selected profile
- requires query IDs to be allowlisted when `queryId` is used
- returns sanitized aggregate evidence: row count, returned count, columns, and optionally a small row sample

## Forward-Side Runtime Settings

Mount one protected file containing the complete Forward `Authorization` header. Pass the file explicitly to the
Forward-side helper:

```bash
--authorization-file /secure/path/read-only-forward-auth-header
--allow-query-id FQ_<forward-owned-query-id>
```

The file must be a regular file inaccessible to group and other users. The helper does not accept authorization through
environment variables, command-line values, app settings, browser state, package artifacts, screenshots, or committed
config files.

## Templates

| Template | Uses Raw Query | Requires `queryId` | Purpose |
| --- | --- | --- | --- |
| `endpoint-inventory-smoke` | Yes | Network Operator or Network Admin | Confirm arbitrary NQE execution against the target network. |
| `approved-endpoint-resolution` | No | Yes | Run a Forward-owned endpoint-resolution query with Dynatrace dependency parameters. |
| `approved-blast-radius` | No | Yes | Run a Forward-owned blast-radius query with Dynatrace service context. |

Read Only can execute only committed Forward Library queries by approved query ID. Network Operator and Network Admin
can execute an approved arbitrary NQE template. Query-ID templates remain preferred for stable reusable previews,
diffs, or persistent NQE checks. The base integration continues to work with intent-check packages only.

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
  "forwardAccessProfile": "read-only",
  "templateId": "approved-endpoint-resolution",
  "queryId": "FQ_<forward-owned-query-id>",
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
- Execute the approved request from a Forward-controlled runtime; never inject Forward credentials into the Dynatrace
  app runtime.

## Validation

Run:

```bash
npm run forward:nqe-preview:test
```

The test covers target-free credential-free plan mode, the Dynatrace execute-mode block, target and authorization
fail-closed standalone execution, query-ID allowlisting, and the read-only `POST /api/nqe` Forward-side path.

For a customer-approved live credential smoke, run plan mode first:

```bash
npm run forward:nqe-live-smoke -- \
  --forward-base-url https://forward.example.com \
  --forward-network-id <network-id> \
  --forward-access-profile network-operator \
  --output /tmp/forward-nqe-live-smoke-plan.json
```

Then execute only with a Forward authorization header matching the selected profile:

```bash
npm run forward:nqe-live-smoke -- \
  --forward-base-url https://forward.example.com \
  --forward-network-id <network-id> \
  --forward-access-profile network-operator \
  --approval-file /secure/path/nqe-preview-approval.json \
  --authorization-file /secure/path/read-only-forward-auth-header \
  --execute \
  --output /tmp/forward-nqe-live-smoke.json
```

The Forward-side live smoke calls only `POST /api/nqe`, uses the `endpoint-inventory-smoke` template by default, and
emits a sanitized JSON report. Query-ID templates remain optional and require both `--query-id` and the matching
`--allow-query-id`.

The approval file must use `forward-dynatrace-nqe-preview-approval/v1`; see
`config/forward-nqe-live-smoke.approval.example.json`. Execution refuses to run without approval, refuses expired or
mismatched approvals, and rejects approval files containing credential-like content.
