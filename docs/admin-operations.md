# Admin Operations

Use this when operating the Forward-side importer or connector in a controlled runtime.

## Audit Export

- Keep every `forward-import-report.json` with the matching package manifest and intent-check package.
- Capture stdout/stderr from the importer into the runtime log stream.
- Record the Forward network ID, package ID, run ID, operator or service principal, and apply mode.
- Export evidence by run ID when reviewing created, changed, stale, or failed checks.

## Config Backup And Restore

- Store connector config in source control only when it contains placeholders or non-secret defaults.
- Store production config in the runtime configuration system.
- Store credentials only in a secrets manager.
- Back up the non-secret config, public signing key, scheduler definition, and runtime image tag.
- Restore by redeploying the same image tag, config, public key, and secret references, then running `--validate-only`.

## Disaster Recovery

If a package import fails:

1. Stop scheduled apply runs.
2. Preserve the package, manifest, signature, report, metrics, and runtime logs.
3. Re-run validate-only with the same package.
4. Re-run dry-run against Forward and compare counts.
5. Apply only after validation and dry-run match the approved recovery plan.

If unintended checks were created, leave changed and stale workflows report-only, collect affected check IDs from the
report, and use the approved Forward change process to retire or modify them.

## Access Review

Review quarterly:

- Who can generate packages in Dynatrace.
- Who can approve and run Forward-side imports.
- Who can rotate signing keys.
- Who can change connector config and scheduler cadence.
- Who can view package artifacts and import reports.
