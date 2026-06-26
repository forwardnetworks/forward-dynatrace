# Production Readiness Checklist

This repository is a Forward Field Integration reference, not an officially supported Forward product integration.
Use this checklist before enabling Forward-side ingest.

## Security

- Do not store Forward credentials in Dynatrace.
- Never accept Forward credentials from browser state.
- Store Forward credentials only in the Forward-side connector or manual import environment.
- Keep tenant URLs, private token filenames, OAuth callback URLs, and customer-specific references out of GitHub.
- Restrict Forward credential scope to the needed tenant/network/API capabilities.
- Log correlation IDs, not secrets.

## Data Quality

- Require source, destination, protocol, port, service entity ID, app, and environment.
- Do not create checks for `needs-map` rows.
- Reject packages with missing or duplicate `dynatrace-key:*` tags.
- Reject packages with duplicate generated check names.
- Reject unsupported check types before contacting Forward.
- Prefer minimum confidence threshold for automatic check creation.
- Report rejected rows in the manifest/import report for review.

## Forward-Side Write Safety

- Read existing checks before writes.
- Dedupe by exact check name and `dynatrace-key:*` tag.
- Fingerprint generated fields so result/status/timestamp fields do not cause false drift.
- Create missing checks only with `POST /api/snapshots/{snapshotId}/checks?bulk`.
- Chunk large `NewNetworkCheck[]` imports and report per-batch status.
- Keep Forward writes in the manual importer or Forward-side connector, never in the Dynatrace app.
- Do not delete stale checks automatically in the first production version.
- Make check retirement a separate reviewed workflow.

## Workflow

- Problem workflow: export only impacted app dependencies.
- Scheduled workflow: refresh critical production mappings.
- Manual workflow: build package, dry-run the Forward-side importer, review planned creates, then apply.
- Connector workflow: Forward-side connector pulls the latest package URL, validates manifest and checks, then performs
  deduped bulk check ingest.
- Treat each export as desired state and reconcile before writing.
- Keep the default apply policy as create-missing-only until update and stale-check policies are approved.

## Reliability

- Retry transient 429/5xx responses with bounded exponential backoff.
- Honor `Retry-After` when Forward returns it.
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

- Unit test deterministic integration keys.
- Unit test `needs-map` rejection.
- Unit test intent check JSON shape.
- Unit test package validation failures before Forward API calls.
- Unit test importer dedupe by name and `dynatrace-key:*` tag.
- Unit test importer reconciliation for create, unchanged, changed, and stale cases.
- Integration test against a non-production Forward network.
- Dry-run comparison: same input twice should produce identical payloads.
