# Problem-Triggered Network Evidence

This workflow adds read-only Forward network evidence to a Dynatrace problem without moving Forward credentials into
Dynatrace and without claiming that the network caused the problem.

## Boundary

- Dynatrace supplies the problem ID, affected service ID, and impacted dependency candidates.
- A Forward-controlled runtime resolves those endpoints and runs read-only bulk path analysis against one processed
  snapshot.
- The runtime reduces the detailed Forward result to aggregate counts and a bounded assessment.
- Publishing the sanitized event to Dynatrace is a separate `--apply` gate.
- The workflow never creates or changes Forward checks.

The supported assessments are deliberately narrow:

| Assessment | Meaning |
| --- | --- |
| `consistent-with-network-policy-block` | At least one modeled path was blocked. This is supporting evidence, not root-cause proof. |
| `no-modeled-policy-block` | Every queryable modeled path was reachable in the selected snapshot. This does not establish that live packets succeeded. |
| `inconclusive` | Mapping, ambiguity, execution, or evidence coverage prevents a stronger statement. |

## Forward-Controlled Execution

Start with dependency candidates produced by the Dynatrace problem workflow, for example
`deploy/dynatrace-workflows/forward-sync-problem.payload.example.json`. Extract its `dependencies` array into a local
file in the Forward-controlled runtime, then run:

```bash
export FORWARD_BASE_URL=https://forward.example.com
export FORWARD_NETWORK_ID=<network-id>

npm run forward:path-evidence -- \
  --dependencies /secure/handoff/problem-dependencies.json \
  --authorization-file /secure/path/read-only-forward-auth-header \
  --resolve-hosts \
  --execute \
  --output /tmp/forward-problem-path-evidence.json

npm run dynatrace:network-evidence:publish -- \
  --evidence /tmp/forward-problem-path-evidence.json \
  --problem-id P-12345 \
  --service-entity-id SERVICE-ABC \
  --environment-url https://your-environment-id.apps.dynatrace.com/ \
  --output /tmp/forward-network-evidence-event.json
```

The second command is a dry-run by default. Review the event and validate it before publication:

```bash
npm run schemas:validate -- \
  --network-evidence-event /tmp/forward-network-evidence-event.json

npm run dynatrace:network-evidence:publish -- \
  --evidence /tmp/forward-problem-path-evidence.json \
  --problem-id P-12345 \
  --service-entity-id SERVICE-ABC \
  --environment-url https://your-environment-id.apps.dynatrace.com/ \
  --token-file /secure/path/platform-token \
  --output /tmp/forward-network-evidence-event.json \
  --apply
```

The Platform Token needs `openpipeline:events:ingest`. The Forward credential needs only the permissions required for
latest-snapshot lookup, host inventory, and bulk path search.

## Published Data

The event includes:

- problem, service, evidence-run, network, and snapshot identifiers;
- aggregate reachable, blocked, ambiguous, unmapped, and failed counts;
- aggregate forwarding/security outcomes and maximum modeled hop count;
- severity derived from the aggregate evidence.

It excludes dependency IDs, endpoint values, device names, query URLs, hop details, credentials, and Forward response
bodies. Use the DQL views in `deploy/dynatrace-dql/forward-network-evidence-latest.dql` and
`deploy/dynatrace-dql/forward-network-evidence-attention.dql` to inspect the published evidence.

## Stop Rules

- Do not publish detailed Forward path rows to Dynatrace.
- Do not translate `blocked` into a root-cause assertion.
- Do not auto-remediate a path, a Forward check, or a Dynatrace problem from this evidence.
- Treat `inconclusive`, `failed`, ambiguous, and unmapped results as operator follow-up.
- Keep the detailed path artifact inside the Forward-controlled evidence boundary and retention policy.

## Live Validation Record

The non-production live workflow was validated on 2026-07-18:

- Ten instrumented container sources produced 240 current HTTP/DNS relationships.
- Dynatrace Grail returned exactly 240 client-span dependency rows from those transactions.
- The current processed Forward snapshot evaluated all 240 queryable paths with reachable `240`, blocked `0`,
  ambiguous `0`, unmapped `0`, and failed `0`; its tenant-specific ID remains in protected acceptance state.
- The app and conductor have no replay, seeded, fixture, or capture-data fallback.
