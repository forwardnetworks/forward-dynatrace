# Forward Ingest Contract

Goal: use Dynatrace application mapping to create and maintain Forward intent checks.

## Source Data From Dynatrace

Each dependency row needs:

| Field | Required | Forward use |
| --- | --- | --- |
| `app` | yes | Tag and check name |
| `environment` | yes | Tag and check name |
| `service_entity_id` | yes | Integration key and audit note |
| `service_name` | yes | Audit note |
| `source` | yes | Forward `from.location` HostFilter |
| `destination` | yes | Forward `to.location` HostFilter |
| `protocol` | yes | PacketFilter `ip_proto` |
| `port` | yes | PacketFilter `tp_dst` |
| `owner` | recommended | Tag and priority review |
| `criticality` | recommended | Forward priority |
| `confidence` | recommended | Gating and audit |
| `mapping_state` | yes | `needs-map` rows do not auto-create checks |

## Data File Artifact

The app generates `dynatrace_service_dependencies.csv` with deterministic `integration_key` values. Forward receives it
through the standard Data Files workflow:

```text
POST /api/data-files
POST /api/data-files/{dataFileName}
POST /api/networks/{networkId}/data-files/{dataFileName}
```

Use the Data File for:

- NQE queries over application dependencies.
- Audit trail of what Dynatrace supplied.
- Review of rows that should not yet become checks.

## Intent Check Artifact

For each eligible dependency, create one persistent `Existential` check:

```text
POST /api/snapshots/{snapshotId}/checks?persistent=true
```

The app maps:

| Dynatrace field | Forward check field |
| --- | --- |
| `source` | `definition.filters.from.location.value` |
| `destination` | `definition.filters.to.location.value` |
| `protocol` | `definition.filters.from.headers[].values.ip_proto` |
| `port` | `definition.filters.from.headers[].values.tp_dst` |
| `criticality` | `priority` |
| `app`, `environment`, `owner` | `tags` |
| `integration_key` | `dynatrace-key:*` tag and note |

## Idempotent Sync

Before creating checks:

```text
GET /api/snapshots/{snapshotId}/checks?type=Existential
```

Then:

1. Match existing checks by exact name or `dynatrace-key:*` tag.
2. Skip unchanged checks.
3. Create missing checks.
4. Mark stale Dynatrace-managed checks for review before deletion.

Do not blindly delete checks. Forward may contain user-owned checks that look similar but are not managed by this app.

## Snapshot Handling

Use:

```text
GET /api/networks/{networkId}/snapshots/latestProcessed
```

Create persistent checks only against a processed snapshot. If a collection is needed first:

```text
POST /api/networks/{networkId}/snapshots?async=1
```

Then poll or wait until latest processed changes.

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

No live Forward mutation unless all are true:

- Forward base URL configured.
- Forward network ID configured.
- Server-side Forward credential configured.
- Forward host reachable from Dynatrace runtime.
- At least one dependency row has complete mapping.
- Dedupe/read-before-write is enabled.
