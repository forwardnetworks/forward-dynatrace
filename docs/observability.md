# Observability

The Forward-side importer emits a structured JSON report and optional Prometheus text metrics. The runtime that runs
the importer should ship both to its standard log and metrics systems.

## Import Report

Write a report on every run:

```bash
npm run forward:import -- \
  --config /secure/path/forward-connector.config.json \
  --report forward-import-report.json \
  --metrics forward-import-metrics.prom \
  --status-artifact forward-ingest-status.json
```

The report includes run ID, timestamps, duration, package ID, package checksum, signature status, source locators,
planned-check count, optional NQE artifact counts, reconciliation counts, changed fields, and stale check summaries.

## Status Artifact

Write `forward-ingest-status.json` when the Forward-side result needs to be shown back in Dynatrace. The artifact is
read-only status, not an instruction channel. It uses `schemaVersion: forward-dynatrace-status/v1` and includes
aggregate state only: run ID, package ID, mode, import state, package integrity, signature status, target IDs, counts,
planned-check count, optional NQE check/diff counts, and duration.

The status artifact intentionally excludes check names, hostnames, dependency rows, credentials, and Forward API
response bodies. Publish it only after the Forward-side run finishes.

Publish a sanitized copy into the package handoff location:

```bash
node scripts/publish-forward-status.mjs \
  --status forward-ingest-status.json \
  --output-dir /handoff/dynatrace-forward/latest
```

This writes `forward-ingest-status.json` and `forward-ingest-status.sha256`. Dynatrace can display that aggregate
status by supplying the artifact or a read-only HTTPS artifact URL to the `forward-status` app function.

## Metrics

The metrics file currently includes:

- `forward_dynatrace_import_planned_checks`
- `forward_dynatrace_import_result_count{result="create|unchanged|changed|stale"}`
- `forward_dynatrace_import_duration_ms`
- `forward_dynatrace_import_signature_verified{status="verified|not-provided"}`

Ship these metrics from the selected runtime. Do not scrape from Dynatrace; Forward-side ingest is the system of
record for write status.

## Alert Thresholds

Start with these thresholds, then tune per deployment:

| Signal | Suggested alert |
| --- | --- |
| Validation failure | Any failure in a scheduled run. |
| Auth failure | Any Forward `401` or `403`. |
| Package staleness | Manifest age exceeds the configured `maxPackageAgeMinutes`. |
| Changed drift | Any changed check when `--fail-on-drift` is enabled. |
| Stale drift | Any stale check when `--fail-on-drift` is enabled. |
| Partial write | Any apply run that exits non-zero after creating at least one batch. |
| Repeated transient errors | Three consecutive runs with `429` or `5xx` retries. |
| Missing signature | Any production run where `packageSignature.status` is not `verified`. |

## Evidence Retention

Retain the package manifest, intent-check JSON, optional NQE artifacts, signature if used, import report, metrics, and
status artifact for the same period as other Forward-side change evidence. These artifacts are enough to explain what
was planned, what was imported, what was unchanged, and what was held for review.
