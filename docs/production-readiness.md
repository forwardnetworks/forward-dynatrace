# Production Readiness Checklist

This repository is an art-of-the-possible demo. Use this checklist before enabling live Forward writes.

## Security

- Store Forward credentials server-side only.
- Never accept Forward credentials from browser state.
- Restrict credential scope to the needed tenant/network/API capabilities.
- Allow-list the Forward host in Dynatrace External requests, or use EdgeConnect for private Forward.
- Log correlation IDs, not secrets.

## Data Quality

- Require source, destination, protocol, port, service entity ID, app, and environment.
- Do not create checks for `needs-map` rows.
- Prefer minimum confidence threshold for automatic check creation.
- Keep rejected rows in the Data File for review.

## Forward Write Safety

- Read existing checks before writes.
- Dedupe by exact check name and `dynatrace-key:*` tag.
- Create missing checks only.
- Do not delete stale checks automatically in the first production version.
- Make check retirement a separate reviewed workflow.

## Workflow

- Problem workflow: sync only impacted app dependencies.
- Scheduled workflow: refresh critical production mappings.
- Manual workflow: build plan, review payloads, then execute.

## Reliability

- Retry transient 429/5xx responses with bounded exponential backoff.
- Treat 4xx responses as configuration/data errors.
- Poll snapshot processing before check creation.
- Capture per-action result status.
- Surface partial failures in Dynatrace and keep the generated artifacts.

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
- Integration test against a non-production Forward network.
- Dry-run comparison: same input twice should produce identical payloads.
