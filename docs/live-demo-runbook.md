# Standalone Live Demo Runbook

This runbook demonstrates only Forward for Dynatrace. It uses real Dynatrace dependency evidence and a real Forward
non-production network; it does not require or mention another integration. The conductor is dry-run by default and
never gives Forward credentials to Dynatrace.

## Story

1. Dynatrace knows which observed application relationships matter.
2. Forward resolves those endpoints in its modeled network and evaluates whether each relationship can work.
3. The integration builds a deterministic, reviewable intent package.
4. A Forward operator—not the Dynatrace app—stages, approves, and applies persistent checks.
5. Forward publishes only sanitized aggregate reconciliation and path evidence back to Dynatrace.

## Prestage

- Use the signed `com.forward.dynatrace` app in shared non-production, or `my.forward` only in an isolated sandbox.
- Verify the exact release and pin the importer image digest as described in [release-provenance.md](release-provenance.md).
- Select a processed Forward snapshot that models the networks between the observed endpoints.
- Prepare a customer-owned DQL file that emits the normalized fields required by the app.
- Store Dynatrace and Forward tokens in protected files outside the repository.
- Choose 6–12 relationships with resolvable endpoints and recognizable business context.

Run the full repository gate and a credential-free rehearsal before the meeting:

```bash
npm run ci
npm run demo:rehearsal -- --output-dir /tmp/forward-dynatrace-rehearsal
```

The rehearsal is explicitly synthetic and proves only package mechanics. Do not show it as live evidence.

## Run The Live Dry-Run

Set Forward target metadata and the protected authorization file only in the Forward-controlled shell:

```bash
export FORWARD_BASE_URL=https://forward.example.com
export FORWARD_AUTHORIZATION_FILE=/secure/path/forward-authorization.header
export FORWARD_NETWORK_ID=<network-id>
export FORWARD_DYNATRACE_SOURCE_INSTANCE_ID=<stable-opaque-source-id>
```

Query real Grail evidence and omit `--synthetic`:

```bash
npm run demo:live -- \
  --dynatrace-environment-url https://<environment-id>.apps.dynatrace.com/ \
  --dynatrace-token-file /secure/path/platform-token \
  --dynatrace-query-file /secure/queries/customer-dependencies.dql \
  --evidence-source customer-observed-nonproduction \
  --showcase-limit 12 \
  --output-dir /tmp/forward-dynatrace-live
```

Stop if the conductor reports replay/synthetic provenance, no usable rows, unresolved endpoints, no processed Forward
snapshot, credential failure, or path evidence that cannot be tied to the selected snapshot.

## What To Show

1. In Dynatrace, show the scoped service relationships and their owner/environment context.
2. In the Forward for Dynatrace app, show ready, review, and needs-map counts. Explain that only ready rows can export.
3. Show the selected package ID, checksum, source instance, and deterministic check count—not credentials or raw tokens.
4. In Forward, show one matching modeled path and the latest processed snapshot identity.
5. Show the reconciliation result: create, unchanged, changed, stale, collision, and unresolved counts.
6. Emphasize that the conductor stopped at dry-run. Persistent checks require the signed stage/approve/apply workflow.
7. If approved, show the sanitized status event queried back from Grail with the same run/package correlation.

Use this concise narration:

> Dynatrace supplies observed application importance. Forward supplies modeled network truth. The integration resolves
> and packages the overlap, but the Dynatrace app never holds a Forward credential or writes a check. A Forward-side
> operator approves the exact immutable plan, and only bounded aggregate results return to Dynatrace.

## Optional Approved Apply

Do not improvise an apply during a meeting. Pre-authorize it under the customer change process and follow
[customer-acceptance-checklist.md](customer-acceptance-checklist.md). The required sequence is signed package,
reconciliation, immutable plan, exact short-lived approval, source/network lock, apply, and post-apply reconciliation.
Rerun the same package afterward and show zero new writes and all checks unchanged.

## Reset Between Demonstrations

- Keep the app, runtime, identities, DQL, and Forward network installed.
- Remove only meeting-specific output under the selected temporary evidence directory.
- Re-query real Dynatrace evidence and use a new package/run ID.
- Restore any deliberately changed non-production dependency or network state through its owning system.
- Take a new Forward snapshot and wait for processing before the next path/reconciliation claim.
- Never replay old status events as the current run.

## Evidence To Retain

Retain the release/commit, app identity, importer digest, Dynatrace query checksum, evidence-source label, Forward
network/snapshot IDs, package/checksums, reconciliation counts, path summary, status-event ID, and any approval record.
Keep tenant URLs, tokens, hostnames, path hops, and raw dependency data only in the protected customer evidence store.
