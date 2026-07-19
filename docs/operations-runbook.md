# Operations Runbook

## Normal Run

1. Confirm current Dynatrace dependency rows and the Forward processed snapshot.
2. Select the intended `forward-api-connection`.
3. Run `plan` and review counts, collisions, mapping gaps, snapshot ID, and digest.
4. For Read Only or Network Operator, retain the plan as evidence; no write is possible.
5. For Network Admin, approve the exact digest, budgets, and changed source keys, then run `apply`.
6. Require `postApplyVerification: verified`.
7. Run or review the scoped Site Reliability Guardian validation.

## Recovery

- Authentication failure: rotate the secret connection; do not place credentials in Workflow JSON or logs.
- External-request denial: approve the exact Forward host in Dynatrace tenant settings.
- Snapshot changed: discard the digest and create a new plan.
- Collision: resolve the unmanaged name or duplicate managed source key in Forward; never force adoption.
- Partial write: stop. Read current Forward state and generate a new plan before another apply.
- Stale checks: review separately; synchronization never deletes them.
- Guardian failure: keep the change open and investigate application and network evidence independently.

## Restore The Approved Baseline

Restore the application and network environment through its owned change procedure, refresh the Forward collection
snapshot, confirm current Dynatrace telemetry has resumed, run a plan-only reconciliation, and verify the Guardian
baseline. Do not remove the app or its settings connection during a normal recovery.
