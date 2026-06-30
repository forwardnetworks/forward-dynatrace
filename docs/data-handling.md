# Data Handling

This repository must stay safe to publish. Use synthetic examples in docs, screenshots, test fixtures, and release
artifacts.

## Allowed

- Synthetic service names, app names, owners, and dependency rows.
- Placeholder Forward URLs such as `https://forward.example.com`.
- Placeholder Dynatrace Apps URLs such as `https://your-environment-id.apps.dynatrace.com/`.
- Generated `dynatrace-key:*` values derived from synthetic rows.
- Import reports from synthetic or sanitized non-production runs.

## Not Allowed

- Forward, Dynatrace, or customer credentials.
- Real tenant URLs, OAuth callback URLs, private token filenames, or local user paths.
- Personal email addresses or customer-specific names.
- Real hostnames, device names, subnet names, application topology, or screenshots that reveal production topology.
- Package exports from a real environment unless every row is reviewed and sanitized first.

## Package Boundary

The Dynatrace package contains desired Forward intent checks only. It must not contain Forward credentials, Forward
session data, personal identifiers, or private tenant details beyond the metadata explicitly approved for the target
deployment.

The Forward-side importer report can contain reconciliation evidence. Store reports in the Forward-side runtime log or
artifact store, apply retention, and sanitize before sharing externally.

The optional Forward ingest status artifact is safer to reflect back into Dynatrace because it contains aggregate state
only. It must still be treated as operational evidence and reviewed before external sharing.

## Release Gate

Before publishing source, screenshots, docs, or release artifacts:

1. Run `npm run repo:validate`.
2. Run `git diff --check`.
3. Inspect screenshots for topology or tenant leakage.
4. Confirm `app.config.json` uses the placeholder Dynatrace environment URL.
5. Confirm connector config examples contain no secrets.
