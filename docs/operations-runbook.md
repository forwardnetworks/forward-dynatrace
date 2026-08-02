# Operations Runbook

## Normal Run

1. Confirm current Dynatrace dependency rows and the Forward processed snapshot.
2. Select the intended `forward-api-connection`.
3. Run `plan` and review counts, collisions, mapping gaps, snapshot ID, and digest.
4. For Read Only or Network Operator, retain the plan as evidence; no write is possible.
5. For Network Admin, approve the exact digest, budgets, and changed source keys, then run `apply`.
6. Require `postApplyVerification: verified`.
7. Run or review the scoped Site Reliability Guardian validation.

## First On-Demand Deployment

1. Confirm the installed app registry version and status before opening the Workflow draft.
2. Open **Synchronize Forward intent checks** and verify its connection picker and request editor render.
3. Confirm the connection uses Read Only and the request is a plan with required path preflight.
4. Confirm the Workflow trigger is **On demand**, deploy the draft, and require the live-state confirmation.
5. Run the deployed Workflow and require both the Grail query task and Forward synchronization task to succeed.
6. In the query log, retain the DQL query ID and returned aggregate row count. In the action result, retain only the
   bounded acceptance fields listed in `docs/templates/customer-acceptance-record.md`.
7. Do not add a recurring schedule or Network Admin apply as part of Read Only acceptance.

## Credential Vault Review

- Scope the secret to **AppEngine**, keep ad hoc/no-app-context access off, and keep owner-only user access unless an
  approved operating group needs access.
- Prefer the exact installed app under **Dynatrace apps with access**. Some enterprise-preview tenants do not offer
  unsigned custom apps in that selector. If neither `my.forward` nor `Forward` is offered, discard the unsaved edit,
  preserve the working **All applications** value, and record the exception as a production blocker.
- Verify the Forward credential resolves to an integration-named, least-privilege service identity. A credential tied
  to a person or an organization administrator can support sandbox acceptance but must be replaced before production.

## Recovery

- Authentication failure: verify Vault sharing and rotate the Credential Vault entry; do not place credentials in app settings, Workflow JSON, or logs.
- Workflow widget failure: verify the installed archive contains the selected action under both `/widgets/actions`
  and `/ui/widgets/actions`, load the hosted JavaScript without a syntax error, then install a new semantic version.
  Do not overwrite an already installed version.
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
