# Forward Ingest Contract

Goal: use Dynatrace application mapping to create and maintain Forward intent checks without letting the Dynatrace app
write to Forward.

The Dynatrace app exports artifacts. Forward manual import or a Forward-side connector performs all Forward API
writes.

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
| `source` | yes | Forward `from.location.value` |
| `sourceFilterType` | optional | Forward `from.location.type`; defaults to `HostFilter` |
| `destination` | yes | Forward `to.location.value` |
| `destinationFilterType` | optional | Forward `to.location.type`; defaults to `HostFilter` |
| `protocol` | yes | PacketFilter `ip_proto` |
| `port` | yes | PacketFilter `tp_dst` |
| `owner` | recommended | Tag and priority review |
| `criticality` | recommended | Forward priority |
| `confidence` | recommended | Gating and audit |
| `mapping_state` | yes | `needs-map` rows do not auto-create checks |

## Export Artifacts

The app exports exactly two artifacts:

- `forward-intent-checks.json`: JSON array of Forward `NewNetworkCheck` objects.
- `forward-dynatrace-manifest.json`: schema, package metadata, counts, artifact names, integrity checksum, and ingest
  policy.

There is intentionally no secondary file artifact in this workflow. Intent checks are created from `NewNetworkCheck[]`
through Forward's checks API.

Before any Forward API write, the importer or connector must reject the package if:

- the intent-check artifact is not a JSON array
- any check is missing a name, definition, or exactly one `dynatrace-key:*` tag
- any generated name or `dynatrace-key:*` tag is duplicated
- any check type is not `Existential`
- the manifest schema version, package type, generated timestamp, check count, checksum, credential policy, or
  reconciliation policy does not match the supported contract
- source or destination mappings do not resolve to valid Forward locations in the target snapshot

## Forward Bulk Ingest

Forward receives the package through manual import or Forward-side connector pull. Forward-side ingest uses:

```text
GET /api/networks/{networkId}/snapshots/latestProcessed
GET /api/snapshots/{snapshotId}/checks?type=Existential
POST /api/snapshots/{snapshotId}/checks?bulk
```

Important: the Forward bulk endpoint accepts an array and creates checks, but the import workflow must dedupe before
posting. Do not rely on the endpoint to dedupe Dynatrace-managed intent checks by name or tag.

For each eligible dependency, the package includes one persistent `Existential` check request. Forward persistence
defaults to true for this endpoint. Include `persistent=false` only for single-snapshot test imports.

The default apply policy is `create-missing-only`. Changed and stale Dynatrace-managed checks are reported for review
instead of being updated, disabled, or deleted automatically.

Endpoint mapping must be Forward-resolvable before apply. `HostFilter` works for known hostnames, IP prefixes, or MAC
addresses. Use `SubnetLocationFilter` for subnet/IP mappings and `DeviceFilter` only when the dependency has been
intentionally mapped to a Forward device. A live Forward apply rejects unresolved locations before creating checks.

The app maps:

| Dynatrace field | Forward check field |
| --- | --- |
| `sourceFilterType` + `source` | `definition.filters.from.location.type/value` |
| `destinationFilterType` + `destination` | `definition.filters.to.location.type/value` |
| `protocol` | `definition.filters.from.headers[].values.ip_proto` (`tcp` -> `6`, `udp` -> `17`) |
| `port` | `definition.filters.from.headers[].values.tp_dst` |
| `criticality` | `priority` |
| `app`, `environment`, `owner` | `tags` |
| `integration_key` | `dynatrace-key:*` tag and note |

## Forward-Side Reconciliation

Before creating checks, Forward-side ingest reads existing checks:

```text
GET /api/snapshots/{snapshotId}/checks?type=Existential
```

Then:

1. Match existing checks by exact name or `dynatrace-key:*` tag.
2. Compute a canonical JSON SHA-256 fingerprint over generated fields: `definition`, `enabled`, `name`, `note`,
   `priority`, and sorted `tags`.
3. Skip unchanged checks.
4. Create missing checks with `POST /api/snapshots/{snapshotId}/checks?bulk`.
5. Report changed checks for review unless an update policy is configured.
6. Report stale Dynatrace-managed checks for review before disable/delete.

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
- Update and stale-check policies are explicit before automated modification/removal.
