# Forward Intent Synchronization Contract

The Dynatrace action calls Forward APIs directly. Generated JSON is a deterministic preview and approval artifact, not
a second runtime or installable.

## Managed Identity

Every generated check carries exactly one of each:

- `managed-by:com.forward.dynatrace`
- contract-version tag
- normalized source-instance tag
- SHA-256 source-key tag

The action reconciles by the complete ownership tuple. It never adopts an unmanaged check by name.

## Plan

The plan reads the latest processed snapshot and current existential checks, then reports:

- create;
- unchanged;
- changed;
- stale;
- collision.

The digest binds the network, snapshot, access profile, source keys, and canonical desired check fingerprints.

## Apply

Read Only and Network Operator are plan-only. Network Admin apply requires the current digest, mutation budgets, zero
collisions, and every changed source key approved exactly. Creates use batches of 100; updates target the exact existing
check ID. Stale checks are never deleted.

After mutation, the action reads all checks again and requires zero remaining create, changed, or collision rows.
Partial failure stops the run and requires a new plan against current state.

## Secret And Error Boundary

Connection credentials exist only in Dynatrace secret app settings and app-function memory. Results never contain the
username, password, Authorization header, raw authenticated response body, or detailed topology.
