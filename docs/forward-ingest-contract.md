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

Read Only and Network Operator are plan-only. Network Admin apply requires the current whole-plan digest, mutation
budgets, zero collisions, and exact approval of either every changed source key or an explicit `applySourceKeys`
subset. `approvalMode` defaults to possession-based `digest`; opt-in `engine-approval` also requires the trusted
Workflow outcome, original plan, nonce, and 15-minute freshness window. Creates use batches of 100; selected updates
target the exact existing check ID. Stale checks are never deleted.

After mutation, the action reads all checks again. Full apply requires zero remaining create, changed, or collision
rows. Partitioned apply requires every selected update to converge and reports outstanding changed keys; those keys
require a fresh plan, digest, and approval. Partial failure stops the run and requires a new plan against current state.

## Secret And Error Boundary

Connection credentials exist only in an APP_ENGINE-scoped Dynatrace Credential Vault entry and app-function memory. App
settings retain only the Vault entity ID. Results never contain the
username, password, Authorization header, raw authenticated response body, or detailed topology.
