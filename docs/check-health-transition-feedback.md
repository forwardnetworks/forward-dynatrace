# Continuous Forward Check-Health Transition Feedback

The Forward-side poller reads the latest processed snapshot and the Existential check inventory. It tracks only checks
tagged `dynatrace` with exactly one `dynatrace-key:*` tag. The durable state file stores the SHA-256 identity hash, last
status, and bounded owner/service context; it does not store check definitions, endpoints, paths, credentials, or API
responses.

```bash
export FORWARD_BASE_URL=https://forward.example.com
export FORWARD_USER=<user>
export FORWARD_PASSWORD=<password-or-token>
export FORWARD_NETWORK_ID=<network-id>

npm run forward:check-health -- \
  --state /var/lib/forward-dynatrace/check-health-state.json \
  --output /var/lib/forward-dynatrace/check-health-transitions.json
```

Live polling is labeled `live-forward-poll`. When exercising the portal from a saved demo inventory, pass a bounded
`--evidence-source` plus `--synthetic`; both fields are retained in the transition artifact and every published event.

The first run establishes a baseline. Later runs emit only `PASS_TO_FAIL`, `FAIL_TO_PASS`, `ERROR`, and `MISSING`.
Unchanged cycles emit no events. Transition IDs include network, snapshot, identity hash, and state pair, making retry
payloads deterministic. The OpenPipeline event ID uses the same transition ID, and the portal deduplicates on that ID.
Add `--apply`, a Dynatrace environment URL, and a Platform Token file only after reviewing the batch. Transient `429`
and `5xx` responses retry the same payload. State advances only after any requested publication succeeds.

The poller fails closed if the live inventory contains duplicate managed `dynatrace-key:*` identities, if a state file
created for one Forward network is reused for another network, or if one poll would publish more than 100 transitions.
Use `--max-transitions` to choose a lower bound. The output artifact is written before the volume gate, but state is
not advanced. Resolve the ownership or volume error instead of replacing state automatically.

Run one poller instance per state file. The poller takes an atomic `<state>.lock`; a second overlapping process fails
before reading or publishing. Retain transition batches for the customer's audit period, rotate the state backup with
runtime backups, and alert on poll or stale-lock failures. This workflow never changes or remediates a Forward check.

## Scheduled Runtime

Checked deployment assets make the poller continuous rather than command-only:

- systemd: `deploy/systemd/forward-dynatrace-check-health.service`, timer, and env example;
- Kubernetes: `deploy/kubernetes/forward-dynatrace-check-health-cronjob.yaml`, config example, and durable PVC example.

Both run every five minutes, forbid overlap, persist state, publish through a token-file secret, and retain
least-privilege/read-only-root controls. Replace the Kubernetes image placeholder with the new release's digest-pinned
importer image. `npm run runtime:validate` checks these controls.
