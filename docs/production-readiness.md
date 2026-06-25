# Production Readiness Checklist

This repository is an art-of-the-possible demo. Use this checklist before enabling Forward-owned ingest.

## Security

- Do not store Forward credentials in Dynatrace.
- Never accept Forward credentials from browser state.
- Store Forward credentials only in the Forward-owned connector or manual import environment.
- Restrict Forward credential scope to the needed tenant/network/API capabilities.
- Log correlation IDs, not secrets.

## Data Quality

- Require source, destination, protocol, port, service entity ID, app, and environment.
- Do not create checks for `needs-map` rows.
- Prefer minimum confidence threshold for automatic check creation.
- Keep rejected rows in the Data File for review.

## Forward-Owned Write Safety

- Read existing checks before writes.
- Dedupe by exact check name and `dynatrace-key:*` tag.
- Create missing checks only with `POST /api/snapshots/{snapshotId}/checks?bulk`.
- Chunk large `NewNetworkCheck[]` imports and report per-batch status.
- Do not delete stale checks automatically in the first production version.
- Make check retirement a separate reviewed workflow.

## Workflow

- Problem workflow: export only impacted app dependencies.
- Scheduled workflow: refresh critical production mappings.
- Manual workflow: build package, dry-run the Forward-side importer, review planned creates, then apply.
- Connector workflow: Forward connector pulls the latest package and performs deduped bulk check ingest.
- Treat the Data File as optional NQE/audit context; do not depend on it to create intent checks.

## Reliability

- Retry transient 429/5xx responses with bounded exponential backoff.
- Treat 4xx responses as configuration/data errors.
- Poll snapshot processing before check creation.
- Capture per-action result status.
- Surface partial failures in Forward connector/import logs and keep the generated artifacts.
- Keep the importer dry-run by default and require an explicit apply flag for writes.

## Observability

- Emit summary counts: rows received, rows accepted, checks planned, checks created, checks skipped, checks failed.
- Include Forward snapshot ID and network ID in results.
- Include app/environment/owner tags in generated checks.
- Record run ID for audit correlation.

## Tests Before Live Write

- Unit test CSV escaping.
- Unit test deterministic integration keys.
- Unit test `needs-map` rejection.
- Unit test intent check JSON shape.
- Unit test importer dedupe by name and `dynatrace-key:*` tag.
- Integration test against a non-production Forward network.
- Dry-run comparison: same input twice should produce identical payloads.
