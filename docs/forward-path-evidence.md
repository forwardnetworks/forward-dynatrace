# Forward Path Evidence

Path evidence is an optional Forward-side preflight. It uses the same host-resolved Dynatrace dependency rows that feed intent-check package generation, then runs read-only Forward bulk path search to show whether each candidate dependency is currently reachable, blocked, ambiguous, unmapped, or failed.

This workflow does not let Dynatrace write to Forward. It runs from a Forward-controlled operator workstation, automation runner, or connector runtime with a read-only Forward credential that can view snapshots and execute path search.

## Why It Exists

Dynatrace application mapping can say “service A depends on service B,” but Forward intent checks need valid Forward locations. The production sequence is:

1. Export dependency candidates from the Dynatrace app.
2. Resolve endpoint names through Forward inventory with `forward:resolve-hosts`.
3. Use resolved endpoint values to generate Forward intent-check packages.
4. Optionally run `forward:path-evidence` before import to show the current Forward path result for each ready row.
5. Import intent checks from the Forward side only after review or approval.

The same `sourceResolvedValue` and `destinationResolvedValue` fields are used by both path evidence and intent-check creation. Original Dynatrace names remain in the `dynatrace-key:*` reconciliation tag, so iterative imports can diff and reconcile without depending on mutable resolved IP details.

## Command

```bash
npm run forward:path-evidence -- \
  --dependencies resolved-dependencies.json \
  --forward-base-url https://forward.example.com \
  --forward-network-id <network-id> \
  --snapshot-id <snapshot-id> \
  --authorization-file /secure/path/read-only-forward-auth-header \
  --execute \
  --output forward-path-evidence.json
```

If `--snapshot-id` is omitted in execute mode, the command reads `GET /api/networks/{networkId}/snapshots/latestProcessed` first and uses that snapshot for path search.

To combine host resolution and path evidence in one step:

```bash
npm run forward:path-evidence -- \
  --dependencies dependencies.json \
  --forward-base-url https://forward.example.com \
  --forward-network-id <network-id> \
  --authorization-file /secure/path/read-only-forward-auth-header \
  --resolve-hosts \
  --execute \
  --output forward-path-evidence.json
```

## Forward APIs Used

- `GET /api/networks/{networkId}/snapshots/latestProcessed`
- `GET /api/networks/{networkId}/hosts/{hostSpecifier}?snapshotId={snapshotId}` when `--resolve-hosts` is used
- `POST /api/networks/{networkId}/paths-bulk?snapshotId={snapshotId}`

The path-search payload is Forward's standard bulk model: `queries`, `intent`, `maxCandidates`, `maxResults`, `maxReturnPathResults`, `maxSeconds`, `maxOverallSeconds`, `includeTags`, and `includeNetworkFunctions`.

## Evidence States

- `reachable`: Forward found at least one delivered path that was not denied.
- `blocked`: Forward found no delivered allowed path.
- `ambiguous`: Forward timed out or returned unresolved/unrecognized values.
- `unmapped`: the dependency did not have a Forward-resolved source/destination suitable for path search.
- `failed`: the Forward response represented an execution error.

The evidence report is aggregate operational evidence. Rows include dependency IDs and status/reason only; do not publish host/IP details into Dynatrace unless the customer explicitly accepts that disclosure.

## Intent-Check Relationship

Intent-check package generation reads the same resolved dependency file:

```bash
npm run forward:package -- \
  --dependencies resolved-dependencies.json \
  --output-dir out/forward-package
```

For each ready dependency:

- `definition.filters.from.location.value` uses `sourceResolvedValue` when present.
- `definition.filters.to.location.value` uses `destinationResolvedValue` when present.
- `definition.filters.*.location.type` uses the resolved filter type when present.
- `dynatrace-key:*` still uses the original Dynatrace source and destination names for stable reconciliation.

This is the key production behavior: Forward creates intent checks only for dependencies that map cleanly to Forward locations, and review/unmapped rows stay out of automatic writes unless an operator explicitly overrides policy.
