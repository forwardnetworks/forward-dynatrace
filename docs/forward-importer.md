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
4. Reports planned checks, existing matches, and checks that would be created.

## Apply Checks

```bash
npm run forward:import -- --checks forward-intent-checks.json --apply
```

The apply run posts only missing checks:

```text
POST /api/snapshots/{snapshotId}/checks?bulk
```

Body shape is `NewNetworkCheck[]`. The Forward API defaults `persistent` to `true`.
