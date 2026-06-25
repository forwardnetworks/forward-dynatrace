# Forward Importer

Use `scripts/forward-import-package.mjs` when the package is imported manually from a Forward-controlled environment.
The script is intentionally dry-run by default.

## Required Inputs

- `forward-intent-checks.json`: required `NewNetworkCheck[]` payload from the Dynatrace app.
- `forward-dynatrace-manifest.json`: recommended for review and audit.

## Required Environment

```bash
export FORWARD_BASE_URL=https://fwd.app
export FORWARD_USER=<user>
export FORWARD_PASSWORD=<password-or-token>
export FORWARD_NETWORK_ID=<network-id>
```

Keep these values out of Dynatrace and out of the exported package.

## Dry Run

```bash
npm run forward:import -- --checks forward-intent-checks.json
```

The dry run:

1. Reads the latest processed snapshot:
   `GET /api/networks/{networkId}/snapshots/latestProcessed`
2. Reads existing Forward intent checks:
   `GET /api/snapshots/{snapshotId}/checks?type=Existential`
3. Matches planned checks by exact `name` or `dynatrace-key:*` tag.
4. Computes canonical SHA-256 fingerprints for the generated check fields.
5. Reports checks to create, unchanged checks, changed checks, and stale Dynatrace-managed checks.

## Apply Checks

```bash
npm run forward:import -- --checks forward-intent-checks.json --apply
```

The apply run posts only missing checks:

```text
POST /api/snapshots/{snapshotId}/checks?bulk
```

Body shape is `NewNetworkCheck[]`. The Forward API defaults `persistent` to `true`.

Changed and stale checks remain report-only. Use the import report to review updates or retirement separately.

## Reconciliation Report

Write the report to disk with:

```bash
npm run forward:import -- --checks forward-intent-checks.json --report forward-import-report.json
```

The report includes:

- `create`: package checks not found in Forward.
- `unchanged`: package checks already present with the same generated fingerprint.
- `changed`: same key/name exists, but generated fields differ.
- `stale`: Dynatrace-managed Forward checks no longer present in the package.

Use `--fail-on-drift` in automation when changed or stale checks should block the run:

```bash
npm run forward:import -- --checks forward-intent-checks.json --fail-on-drift
```
