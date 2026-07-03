# Operations Runbook

Use this runbook from a Forward-controlled environment. The Dynatrace app exports packages only; it does not store
Forward credentials and does not write to Forward.

## Owners

Before enabling scheduled import, fill in these local values outside the repo:

- runtime owner
- release approver
- on-call or escalation path
- Forward tenant/network owner
- Dynatrace package publisher owner

## Manual Import

1. Download `forward-dynatrace-manifest.json` and `forward-intent-checks.json`.
2. Put both files in the Forward-controlled runtime.
3. Validate package integrity:

   ```bash
   npm run forward:import -- \
     --checks forward-intent-checks.json \
     --manifest forward-dynatrace-manifest.json \
     --validate-only
   ```

4. Dry-run reconciliation:

   ```bash
   export FORWARD_BASE_URL=https://forward.example.com
   export FORWARD_USER=<user>
   export FORWARD_PASSWORD=<password-or-token>
   export FORWARD_NETWORK_ID=<network-id>

   npm run forward:import -- \
     --checks forward-intent-checks.json \
     --manifest forward-dynatrace-manifest.json \
     --report forward-import-report.json \
     --metrics forward-import-metrics.prom
   ```

5. Review `create`, `unchanged`, `changed`, `stale`, and rejected package rows.
6. Apply missing checks only when `changed` and `stale` are understood:

   ```bash
   npm run forward:import -- \
     --checks forward-intent-checks.json \
     --manifest forward-dynatrace-manifest.json \
     --apply \
     --report forward-import-report.json \
     --metrics forward-import-metrics.prom \
     --status-artifact forward-ingest-status.json
   ```

7. To replace changed generated checks or deactivate stale generated checks, use the optional approval-gated workflow
   after reviewing the dry-run report:

   ```bash
   npm run forward:import -- \
     --checks forward-intent-checks.json \
     --manifest forward-dynatrace-manifest.json \
     --signature forward-dynatrace-package.sig \
     --public-key /secure/path/forward-dynatrace-public.pem \
     --require-signature \
     --require-approval-file approval.json \
     --change-window-id CHG-12345 \
     --apply \
     --apply-updates \
     --deactivate-stale \
     --max-updates 10 \
     --max-deactivations 10 \
     --report forward-import-report.json \
     --metrics forward-import-metrics.prom \
     --status-artifact forward-ingest-status.json
   ```

   The approval file must name exact `dynatrace-key:*` values from the current dry-run report. Keep the approval file
   with the import report for audit.

## Connector Import

1. Copy `config/forward-connector.config.example.json` to a local config path outside Git.
2. Set `packageUrl`, `forwardBaseUrl`, `forwardNetworkId`, batch, retry, age, and drift policy.
3. Keep `FORWARD_USER` and `FORWARD_PASSWORD` in the runtime secret store, not in the config file.
4. Run:

   ```bash
   npm run forward:import -- --config /secure/path/forward-connector.config.json
   ```

5. Schedule the command only after a manual dry-run has passed.

## Signed Package Import

When the deployment requires provenance:

1. Sign the exact package in the publishing environment:

   ```bash
   npm run forward:sign -- \
     --checks forward-intent-checks.json \
     --manifest forward-dynatrace-manifest.json \
     --private-key /secure/path/forward-dynatrace-private.pem \
     --signature forward-dynatrace-package.sig
   ```

2. Publish `forward-dynatrace-package.sig` beside the package.
3. Configure the importer with `--require-signature` and a trusted public key, or use
   `config/forward-connector.signed.config.example.json`.
4. Keep the private key out of the import runtime.

## Rollback

Default apply mode does not delete or update checks. The optional approval-gated mode can deactivate stale generated
checks and replace changed generated checks by deleting the old generated check and creating the replacement. Rollback
means:

- stop the scheduled connector job
- keep the package and report artifacts
- review created checks in Forward
- retire or recreate checks through an explicit Forward-approved workflow
- use the package ID, approval file, and report `mutations` section to identify affected generated checks

## Evidence To Keep

- package ID
- manifest checksum
- Forward network ID
- Forward snapshot ID
- report file
- metrics file
- sanitized status artifact
- operator or scheduler run ID
- created/unchanged/changed/stale counts
- updated/deactivated mutation counts
- approval file and change window ID when update/stale automation is used
