# Forward Host Resolution

Forward host resolution is the preflight gate that turns Dynatrace dependency names into Forward-resolved host or subnet values before intent checks or path evidence are generated.

This is a Forward-side read-only step. The Dynatrace app does not store Forward credentials and does not call Forward directly in the production workflow.

## Forward API Used

The resolver uses the same Forward inventory-backed host lookup used by Forward host search:

```text
GET /api/networks/{networkId}/hosts/{hostSpecifier}?snapshotId={snapshotId}
```

Forward source documents this endpoint as matching a host name, cloud host ID, IP address, or MAC address. The implementation is backed by `inventoryService.getSpecificHosts`, which resolves through the snapshot host inventory rather than only collection endpoints.

If `--snapshot-id` is omitted, the resolver first reads:

```text
GET /api/networks/{networkId}/snapshots/latestProcessed
```

## Why This Matters

Dynatrace service mapping may produce names that are not valid Forward `HostFilter` values in the target snapshot. If those rows are imported directly, Forward can reject the bulk check creation because the source or destination does not resolve.

Run host resolution before package generation to:

- mark rows `ready` only when both sides resolve in Forward
- mark rows `review` when Forward returns multiple host/subnet candidates
- mark rows `needs-map` when Forward returns no usable host subnet
- keep original Dynatrace source and destination fields for stable reconciliation keys
- use `sourceResolvedValue` and `destinationResolvedValue` for the actual Forward check filters

## Command

```bash
npm run forward:resolve-hosts -- \
  --dependencies dependencies.json \
  --forward-base-url https://forward.example.com \
  --forward-network-id <network-id> \
  --authorization-file /secure/path/read-only-forward-auth-header \
  --execute \
  --output resolved-dependencies.json \
  --report forward-host-resolution-report.json
```

The authorization file contains the full `Authorization` header value for a Forward read-only credential. The credential needs snapshot/network read access and host inventory access. It does not need check write permission.

## Intent Check Workflow

Use the resolved dependency file as package-builder input:

```bash
npm run forward:package -- \
  --dependencies resolved-dependencies.json \
  --source-instance-id <stable-opaque-dynatrace-source-id> \
  --output-dir out/package \
  --eligibility-report out/package/forward-dependency-eligibility.json
```

The generated `forward-intent-checks.json` hashes the stable Dynatrace identity into an opaque, source-scoped key; the
Forward check location values use the resolved Forward values when available:

```json
{
  "definition": {
    "filters": {
      "from": {
        "location": { "type": "HostFilter", "value": "10.10.10.10" }
      },
      "to": {
        "location": { "type": "HostFilter", "value": "10.20.20.20/32" }
      }
    }
  },
  "tags": [
    "managed-by:com.forward.dynatrace",
    "contract-version:1",
    "source-instance:dt-production-1",
    "source-key:sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa"
  ]
}
```

## Path Evidence Workflow

Use the same resolved file for read-only path evidence. Path Search needs concrete IP/subnet inputs, so `sourceResolvedValue` and `destinationResolvedValue` are the preferred fields for path queries. Rows that remain `review` or `needs-map` should not become automated path-evidence queries without operator review.

## Result Handling

Resolution status is intentionally conservative:

| Status | Package behavior |
| --- | --- |
| `ready` | Both source and destination resolved. Eligible for default package generation. |
| `review` | One side is ambiguous or only plan-mode resolution was performed. Held out unless `--include-review` is used deliberately. |
| `needs-map` | One side did not resolve. Held out of automated check creation. |

The report is operator evidence. Do not publish it into Dynatrace unless the customer explicitly accepts host/IP disclosure. Status events should remain aggregate-only.
