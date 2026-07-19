# Problem-Triggered Network Evidence

This workflow adds read-only Forward network evidence to a Dynatrace problem without installing a Forward-side
runtime and without claiming that the network caused the problem.

## Boundary

- Dynatrace supplies the problem ID, affected service context, and impacted dependency candidates.
- The `sync-forward-intent-checks` action loads the selected owner-controlled secret connection in its app function.
- The app function selects one processed Forward snapshot, resolves endpoints, and runs bounded `/paths-bulk` analysis
  through direct HTTPS APIs.
- The action returns aggregate mapping, reachability, snapshot, and plan evidence. It never returns the credential,
  endpoint inventory, hop topology, check definitions, or raw authenticated response.
- Read Only and Network Operator requests remain plan-only. Problem-triggered evidence never applies intent changes.

The supported assessments are deliberately narrow:

| Assessment | Meaning |
| --- | --- |
| `consistent-with-network-policy-block` | At least one modeled path was blocked. This is supporting evidence, not root-cause proof. |
| `no-modeled-policy-block` | Every queryable modeled path was reachable in the selected snapshot. This does not establish that live packets succeeded. |
| `inconclusive` | Mapping, ambiguity, execution, or evidence coverage prevents a stronger statement. |

## Dynatrace Workflow

1. Create a dedicated Read Only or Network Operator `forward-api-connection` and approve only its exact Forward API
   origin under Dynatrace external requests.
2. Trigger a Workflow from the bounded problem scope and call **Synchronize Forward intent checks**.
3. Start from `deploy/dynatrace-workflows/forward-sync-problem.payload.example.json`. Replace the example dependency
   with current trace-backed rows from the problem context.
4. Keep `syncMode` as `direct-api`, `operation` as `plan`, and `runPathPreflight` as `true`.
5. Record the action's bounded network, snapshot, mapping, path, and reconciliation counts beside the Dynatrace-owned
   problem and service-health evidence.
6. If the tenant retains a correlation event, use a tenant-native Workflow event action and publish only the sanitized
   action fields. No separate Forward credential or external executable is required.

The connection owns the authoritative Forward URL, network ID, and access profile. Target metadata supplied by the
problem payload is never authoritative. Although `/paths-bulk` uses HTTP POST, it is a read-only modeled-path query.

## Recorded Data

Retain only:

- problem, service, evidence-run, network, and snapshot identifiers;
- aggregate reachable, blocked, ambiguous, unmapped, and failed counts;
- aggregate reconciliation counts and the immutable plan digest;
- bounded assessment and reason codes.

Do not retain dependency endpoint values, device names, query URLs, hop details, credentials, Authorization headers,
or Forward response bodies in Dynatrace evidence.

## Stop Rules

- Do not publish detailed Forward path rows to Dynatrace.
- Do not translate `blocked` into a root-cause assertion.
- Do not auto-remediate a path, a Forward check, or a Dynatrace problem from this evidence.
- Treat `inconclusive`, `failed`, ambiguous, and unmapped results as operator follow-up.
- If the secret connection, processed snapshot, endpoint mapping, or path preflight is unavailable, fail closed.

## Live Validation Record

The non-production live workflow was validated on 2026-07-18:

- Forty instrumented container sources produced 1,000 current HTTP/DNS relationships.
- Dynatrace Grail returned exactly 1,000 client-span dependency rows from those transactions.
- The current processed Forward snapshot evaluated all 1,000 queryable paths with reachable `1,000`, blocked `0`,
  ambiguous `0`, unmapped `0`, and failed `0`; its tenant-specific ID remains in protected acceptance state.
- The app has no replay, seeded, fixture, or captured-data fallback.
