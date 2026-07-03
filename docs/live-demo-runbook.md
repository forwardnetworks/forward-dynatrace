# Live Demo Runbook

Use this runbook for a customer meeting, trial sandbox, or internal rehearsal. The production story is customer-owned
Dynatrace topology into a Forward-side import workflow. Demo-copy and synthetic seed data are optional sidecars only
when the trial tenant does not yet have useful dependency evidence.

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

4. Review rows marked `needs-map`. Those rows are evidence for follow-up mapping, not check creation.
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

8. Run a Forward dry run:

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

9. Apply only after the Forward operator reviews create, changed, stale, unresolved, and optional NQE counts:

   ```bash
   npm run forward:import -- \
     --checks /tmp/forward-dynatrace-package/forward-intent-checks.json \
     --manifest /tmp/forward-dynatrace-package/forward-dynatrace-manifest.json \
     --apply
   ```

10. Rerun the same package without `--apply`. The expected result is unchanged for checks created by the previous run.
11. Publish the sanitized status artifact for Dynatrace display:

   ```bash
   npm run forward:status:publish -- \
     --status /tmp/forward-ingest-status.json \
     --output-dir /tmp/forward-dynatrace-status
   ```

12. In the Dynatrace app, load the status artifact or status artifact URL through the Forward ingest status function.

## Iterative Update Path

Treat every run as desired state from the latest Dynatrace export.

- Missing in Forward: create with `--apply`.
- Present and identical: report unchanged.
- Present but different: report changed by default.
- Present in Forward but absent from export: report stale by default.

Changed replacement and stale deactivation are optional Forward-side paths. They require a signed package, exact
approval artifact, explicit mutation budgets, and an operator-owned change window. Do not enable them for a first
customer trial unless rollback and audit expectations are already agreed.

## Optional Demo Sidecars

Use sidecars only when the customer-owned Dynatrace tenant cannot yet produce a useful dependency export.

Synthetic seed:

```bash
npm run dynatrace:seed:demo -- \
  --environment-url https://<trial-sandbox-id>.apps.dynatrace.com/ \
  --token-file /secure/path/platform-token \
  --apply
```

Demo-copy:

```bash
npm run dynatrace:copy-demo -- \
  --source-environment-url https://<demo-source-id>.apps.dynatrace.com/ \
  --destination-environment-url https://<trial-sandbox-id>.apps.dynatrace.com/ \
  --source-token-file /secure/path/source-token.txt \
  --destination-token-file /secure/path/destination-token.txt \
  --output-dir /tmp/forward-dynatrace-demo-copy \
  --apply
```

Sidecar evidence must be labeled as demo-only. Do not use copied demo topology as the production source for Forward
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
