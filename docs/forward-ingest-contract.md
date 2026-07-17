# Forward Ingest Contract

Goal: use Dynatrace application mapping to create and maintain Forward intent checks without letting the Dynatrace app
write to Forward.

The Dynatrace app exports dependency candidates and optional draft artifacts. Forward manual import or a Forward-side
connector resolves those candidates, builds the final Forward package, and performs all Forward API writes.

A Forward-side connector is a pull/import process that runs outside Dynatrace with Forward-scoped credentials. It can
be implemented as a customer-operated service or a Forward-provided connector, but it must keep writes out of the
Dynatrace app.

## Source Data From Dynatrace

Each dependency row needs:

| Field | Required | Forward use |
| --- | --- | --- |
| `app` | yes | Tag and check name |
| `environment` | yes | Tag and check name |
| `service_entity_id` | yes | Integration key and audit note |
| `service_name` | yes | Audit note |
| `source` | yes | Original Dynatrace source identity; also a fallback `from.location.value` when already Forward-resolvable |
| `sourceFilterType` | optional | Fallback Forward `from.location.type`; defaults to `HostFilter` |
| `sourceResolvedValue` | optional | Forward-resolved value used for `from.location.value` after host-resolution preflight |
| `sourceResolvedFilterType` | optional | Forward-resolved filter type used for `from.location.type` |
| `destination` | yes | Original Dynatrace destination identity; also a fallback `to.location.value` when already Forward-resolvable |
| `destinationFilterType` | optional | Fallback Forward `to.location.type`; defaults to `HostFilter` |
| `destinationResolvedValue` | optional | Forward-resolved value used for `to.location.value` after host-resolution preflight |
| `destinationResolvedFilterType` | optional | Forward-resolved filter type used for `to.location.type` |
| `protocol` | yes | PacketFilter `ip_proto` |
| `port` | yes | PacketFilter `tp_dst` |
| `owner` | recommended | Tag and priority review |
| `criticality` | recommended | Forward priority |
| `confidence` | recommended | Gating and audit |
| `mapping_state` | yes | `needs-map` rows do not auto-create checks |

## Export Artifacts

After host resolution, the Forward-side package builder emits two required artifacts:

- `forward-intent-checks.json`: JSON array of Forward `NewNetworkCheck` objects.
- `forward-dynatrace-manifest.json`: schema, package metadata, counts, artifact names, integrity checksum, and ingest
  policy.

Optional NQE artifacts can be added only when the customer has approved Forward-owned query IDs:

- `forward-nqe-checks.json`: JSON array of Forward `NewNetworkCheck` objects whose `definition.checkType` is `NQE`.
- `forward-nqe-diff-requests.json`: read-only diff request metadata for `POST /api/nqe-diffs/{before}/{after}`.

The base integration must work without the optional NQE artifacts.

Before any Forward API write, the importer or connector must reject the generated package if:

- the intent-check artifact is not a JSON array
- any check is missing a name, definition, or any member of the four-tag ownership tuple
- any generated name or managed source key is duplicated
- any base intent-check artifact entry uses a check type other than `Existential`
- optional NQE checks use a query ID that is missing from the Forward-side allowlist
- the manifest schema version, package type, generated timestamp, check count, checksum, credential policy, or
  reconciliation policy does not match the supported contract
- source or destination mappings do not resolve to valid Forward locations in the target snapshot

## Forward Bulk Ingest

Forward receives the dependency export through manual import or Forward-side connector pull. Before package generation,
the Forward-side workflow should resolve dependency endpoints with:

```text
GET /api/networks/{networkId}/hosts/{hostSpecifier}?snapshotId={snapshotId}
```

This host lookup accepts host name, cloud host ID, IP address, or MAC address and is backed by Forward snapshot host
inventory. Rows that resolve to exactly one usable host subnet can become `ready`. Rows with multiple candidates stay
`review`; rows with no candidates become `needs-map`.

Optional read-only path evidence uses the same resolved dependency file before approval:

```text
POST /api/networks/{networkId}/paths-bulk?snapshotId={snapshotId}
```

Path evidence is not part of the write transaction. It is an operator confidence signal and should not publish
hostnames or IPs back into Dynatrace unless the customer explicitly accepts that disclosure.

Forward-side ingest then uses:

```text
GET /api/networks/{networkId}/snapshots/latestProcessed
GET /api/snapshots/{snapshotId}/checks?type=Existential
POST /api/snapshots/{snapshotId}/checks?bulk
```

The optional approval-gated update/stale path also uses:

```text
DELETE /api/snapshots/{snapshotId}/checks/{checkId}
```

Important: the Forward bulk endpoint accepts an array and creates checks, but the import workflow must dedupe before
posting. Do not rely on the endpoint to dedupe Dynatrace-managed intent checks by name or tag.

For each eligible dependency, the package includes one persistent `Existential` check request. Eligible dependencies
must have source and destination values that endpoint-resolution has marked `ready` for the target Forward network.
Rows in `review` are held by default and rows in `needs-map` are never included in apply packages. Forward persistence
defaults to true for this endpoint. Include `persistent=false` only for single-snapshot test imports.

If `forward-nqe-checks.json` is present, Forward-side ingest validates it separately, reads existing NQE checks with:

```text
GET /api/snapshots/{snapshotId}/checks?type=NQE
```

and creates only missing approved NQE checks through the same `/checks?bulk` endpoint. Persistent NQE checks must
reference existing committed Forward NQE Library query IDs from the runtime allowlist. Dynatrace supplies parameters
and context; Forward owns the query library content.

If `forward-nqe-diff-requests.json` is present, the importer validates and reports it only. Executing the diff is a
separate read-only Forward-side workflow using:

```text
POST /api/nqe-diffs/{before}/{after}
```

The default apply policy is `create-missing-only`. Changed and stale Dynatrace-managed checks are reported for review
unless the Forward-side runtime enables the optional approval-gated update/stale path with a verified signed package,
exact approval file, and mutation budgets.

Endpoint mapping must be Forward-resolvable before apply. `HostFilter` works for known hostnames, IP prefixes, or MAC
addresses. The resolver preserves original Dynatrace `source` and `destination` values for reconciliation identity and
writes `sourceResolvedValue` and `destinationResolvedValue` for the generated Forward filters. Use
`SubnetLocationFilter` for subnet/IP mappings and `DeviceFilter` only when the dependency has been intentionally mapped
to a Forward device. A live Forward apply rejects unresolved locations before creating checks.

The app maps:

| Dynatrace field | Forward check field |
| --- | --- |
| `sourceResolvedFilterType` + `sourceResolvedValue`, otherwise `sourceFilterType` + `source` | `definition.filters.from.location.type/value` |
| `destinationResolvedFilterType` + `destinationResolvedValue`, otherwise `destinationFilterType` + `destination` | `definition.filters.to.location.type/value` |
| `protocol` | `definition.filters.from.headers[].values.ip_proto` (`tcp` -> `6`, `udp` -> `17`) |
| `port` | `definition.filters.from.headers[].values.tp_dst` |
| `criticality` | `priority` |
| `app`, `environment`, `owner` | `tags` |
| scoped dependency identity | opaque `source-key:sha256:*` tag |

## Forward-Side Reconciliation

Before creating checks, Forward-side ingest reads existing checks:

```text
GET /api/snapshots/{snapshotId}/checks?type=Existential
```

Then:

1. Match existing checks only by a complete ownership tuple and opaque source key; report name conflicts as collisions.
2. Compute a canonical JSON SHA-256 fingerprint over generated fields: `definition`, `enabled`, `name`, `note`,
   `priority`, and sorted `tags`.
3. Skip unchanged checks.
4. Create missing checks with `POST /api/snapshots/{snapshotId}/checks?bulk`.
5. Report changed checks for review unless exact-key approval allows replacement.
6. Report stale Dynatrace-managed checks for review unless exact-key approval allows deactivation.

Do not blindly delete checks. Forward may contain user-owned checks that look similar but are not managed by this app.

## Connector Pull Contract

The Forward-side connector can be implemented as a scheduled job around the included importer:

```bash
npm run forward:import -- \
  --package-url https://package.example.com/dynatrace-forward/latest/ \
  --report forward-import-report.json \
  --fail-on-drift
```

`--package-url` resolves the standard artifact names:

- `forward-dynatrace-manifest.json`
- `forward-intent-checks.json`
- `forward-nqe-checks.json` when listed by the manifest
- `forward-nqe-diff-requests.json` when listed by the manifest

Non-local package URLs must use HTTPS. The connector runtime owns package authentication, Forward credentials, retry
scheduling, alerting, and report retention.

Connector settings can be loaded from `config/forward-connector.config.example.json`. The config file is intentionally
non-secret: Forward user/password/token values must be injected by the runtime secret store.
When provenance is required, publish `forward-dynatrace-package.sig` beside the package and use
`config/forward-connector.signed.config.example.json` with a trusted Ed25519 public key.

## Snapshot Handling

Use:

```text
GET /api/networks/{networkId}/snapshots/latestProcessed
```

Create persistent checks only against a processed snapshot. If a new collection is needed, that should be a separate
Forward-side workflow before import.

## Status Readback

After create/dedupe:

```text
GET /api/snapshots/{snapshotId}/checks?type=Existential
```

Return status to Dynatrace as:

- app screen result
- problem annotation
- workflow event
- report/export

## Hard Gates

Dynatrace app gates:

- No Forward write credential in Dynatrace.
- Export package contains deterministic `integration_key`.
- At least one dependency row has complete mapping.

Forward-side ingest gates:

- Forward base URL configured in Forward-side import/connector.
- Forward network ID configured in Forward-side import/connector.
- Forward credential configured outside Dynatrace.
- Package validation passes before any Forward API request.
- Manifest checksum matches the exact intent-check package bytes.
- Detached signature verifies when the runtime policy requires package provenance.
- Dedupe/read-before-write is enabled before check creation.
- Bulk post chunking is configured for large packages.
- Update and stale-check automation is disabled by default.
- Update and stale-check automation requires a verified signed package, exact approval file, non-expired approval,
  matching package ID, optional matching change window, and explicit mutation budgets.
