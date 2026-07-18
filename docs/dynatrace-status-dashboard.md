# Dynatrace Status Dashboard

The integration can publish aggregate Forward-side ingest status back to Dynatrace as
`event.type == "forward.dynatrace.ingest.status"`. Use these views in a Dynatrace Notebook or Dashboard to explain
the workflow during a trial and to monitor scheduled connector health.

The status event is telemetry only. It is not a command channel and does not contain Forward credentials, check names,
hostnames, dependency rows, or Forward API response bodies.

## Dashboard Template

Use `deploy/dynatrace-dashboard/forward-ingest-status-dashboard.template.json` as the tenant build artifact. It points to
the DQL files in `deploy/dynatrace-dql/` and documents the required event fields. Treat it as a construction template
because final dashboard JSON is tenant-specific.

## Latest Runs

Use `deploy/dynatrace-dql/forward-ingest-status-latest.dql`.

This view shows recent package IDs, explicit evidence source and live/synthetic classification, import state, planned
checks, create/unchanged/changed/stale counts, mutation counts, and the Forward-side publisher run ID.

## Attention Queue

Use `deploy/dynatrace-dql/forward-ingest-status-attention.dql`.

This view filters to failed, warning, changed, or stale runs. It is the best customer-facing panel for explaining why
some Dynatrace-discovered dependencies were not applied automatically.

## Suggested Dashboard Layout

| Panel | Query | Purpose |
| --- | --- | --- |
| Latest Forward ingest runs | `forward-ingest-status-latest.dql` | Shows the iterative sync timeline. |
| Needs Forward review | `forward-ingest-status-attention.dql` | Surfaces failed or drifted runs. |
| Planned check volume | Latest-runs query grouped by package/run | Shows scale and bulk behavior. |
| Signature status | Latest-runs query fields `signature_status` and `package_id` | Confirms production signature posture. |

## Operational Notes

- Alert on `severity == "ERROR"` or `forward.dynatrace.import_state == "failed"`.
- Alert on unresolved changed or stale counts when scheduled automation is expected to stay clean.
- Treat `planned_checks == 0` as suspicious unless the package scope is intentionally empty.
- Treat missing `evidence_source` or `synthetic` on new demo-conductor events as incomplete provenance; older events may
  remain visible as `PROVENANCE UNSPECIFIED`.
- Keep Forward-side logs and reports as the system of record for exact check details.
- Use the Dynatrace dashboard to explain health and workflow state, not to approve Forward writes.
