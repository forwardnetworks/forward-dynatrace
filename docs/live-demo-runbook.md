# Live Demo Runbook

Use this runbook for a customer meeting, trial sandbox, or internal rehearsal. The production story is customer-owned
Dynatrace topology into a Forward-side import workflow. The standard demo replay path is available when the trial
tenant needs demo dependency evidence aligned to the standard Forward demo snapshot.

## Production Demo Path

1. Confirm the Dynatrace tenant can run the app and query dependency evidence.
2. Confirm the Forward test network is non-production or explicitly approved for trial check creation.
3. Query customer-owned Dynatrace topology:

   ```bash
   npm run dynatrace:query -- \
     --environment-url https://<environment-id>.apps.dynatrace.com/ \
     --token-file /secure/path/platform-token \
     --query-file deploy/dynatrace-dql/service-dependency-candidates-openpipeline-events.dql \
     --output /tmp/forward-dynatrace-rows.json \
     --dependencies-output /tmp/forward-dynatrace-dependencies.json
   ```

4. Run the read-only endpoint-resolution preflight for review rows when a Forward NQE query ID is approved. If Forward
   cannot resolve the Dynatrace source or destination, mark the row `needs-map`; those rows are evidence for follow-up
   mapping, not check creation.
5. Build the base package:

   ```bash
   npm run forward:package -- \
     --dependencies /tmp/forward-dynatrace-dependencies.json \
     --output-dir /tmp/forward-dynatrace-package \
     --sync-mode manual-import
   ```

6. Optional path: add persistent NQE checks or diff request metadata only when Forward-owned query IDs have been
   approved and allowlisted:

   ```bash
   npm run forward:package -- \
     --dependencies /tmp/forward-dynatrace-dependencies.json \
     --output-dir /tmp/forward-dynatrace-package \
     --nqe-query-id FQ_aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa \
     --nqe-diff-query-id FQ_aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa \
     --nqe-diff-before-snapshot-id <before-snapshot-id> \
     --nqe-diff-after-snapshot-id <after-snapshot-id>
   ```

7. Validate locally before using Forward credentials:

   ```bash
   npm run forward:import -- \
     --checks /tmp/forward-dynatrace-package/forward-intent-checks.json \
     --manifest /tmp/forward-dynatrace-package/forward-dynatrace-manifest.json \
     --validate-only
   ```

8. Optional read-only NQE live smoke: run only when the customer has approved a read-only Forward credential for NQE
   execution from the selected runtime. This proves the preview path without creating, updating, or deleting checks:

   ```bash
   npm run forward:nqe-live-smoke -- \
     --forward-base-url https://forward.example.com \
     --forward-network-id <network-id> \
     --approval-file /secure/path/nqe-preview-approval.json \
     --authorization-file /secure/path/read-only-forward-auth-header \
     --execute \
     --output /tmp/forward-nqe-live-smoke.json
   ```

   Skip this step when the customer has not approved Dynatrace-hosted read-only execution. The base intent package
   workflow does not depend on it.

9. Run a Forward dry run:

   ```bash
   FORWARD_BASE_URL=https://forward.example.com \
   FORWARD_USER=<user> \
   FORWARD_PASSWORD=<password-or-token> \
   FORWARD_NETWORK_ID=<network-id> \
   npm run forward:import -- \
     --checks /tmp/forward-dynatrace-package/forward-intent-checks.json \
     --manifest /tmp/forward-dynatrace-package/forward-dynatrace-manifest.json \
     --report /tmp/forward-dynatrace-report.json \
     --status-artifact /tmp/forward-ingest-status.json
   ```

10. Apply only after the Forward operator reviews create, changed, stale, unresolved, endpoint-resolution, and optional
    NQE counts:

   ```bash
   npm run forward:import -- \
     --checks /tmp/forward-dynatrace-package/forward-intent-checks.json \
     --manifest /tmp/forward-dynatrace-package/forward-dynatrace-manifest.json \
     --apply
   ```

11. Rerun the same package without `--apply`. The expected result is unchanged for checks created by the previous run.
12. Publish the sanitized status artifact for Dynatrace display:

   ```bash
   npm run forward:status:publish -- \
     --status /tmp/forward-ingest-status.json \
     --output-dir /tmp/forward-dynatrace-status
   ```

13. In the Dynatrace app, load the status artifact or status artifact URL through the Forward ingest status function.

## Iterative Update Path

Treat every run as desired state from the latest Dynatrace export.

- Missing in Forward: create with `--apply`.
- Present and identical: report unchanged.
- Present but different: report changed by default.
- Present in Forward but absent from export: report stale by default.

Changed replacement and stale deactivation are optional Forward-side paths. They require a signed package, exact
approval artifact, explicit mutation budgets, and an operator-owned change window. Do not enable them for a first
customer trial unless rollback and audit expectations are already agreed.

## Standard Demo Replay

Use the standard demo replay when the customer-owned Dynatrace tenant cannot yet produce a useful dependency export.

Saved fixture replay:

```bash
npm run dynatrace:replay-demo -- \
  --environment-url https://<trial-sandbox-id>.apps.dynatrace.com/ \
  --token-file /secure/path/platform-token \
  --apply
```

Replay evidence must be labeled as demo-only. Do not use the saved replay fixture as the production source for Forward
intent.

## Evidence To Keep

- Dynatrace query output row count and rejected row count.
- Package manifest, checks artifact, and optional NQE artifacts.
- Signature verification result when signing is enabled.
- Forward dry-run report.
- Forward apply report, if applied.
- Sanitized Forward status artifact and SHA-256 file.
- Screenshot set from `docs/screenshots.md` when the UI workflow is shown.

Do not keep credentials, token files, OAuth callback URLs, real tenant IDs, or unapproved topology screenshots in the
repository or release archive.
