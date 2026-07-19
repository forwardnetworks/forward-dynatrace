# RBAC

Each Dynatrace `forward-api-connection` binds one Forward network and one declared access profile. The app verifies that
the workflow request matches the connection exactly.

| Forward profile | Allowed API behavior | Synchronization behavior |
| --- | --- | --- |
| Read Only | Read modeled state and checks; execute approved Library NQEs by ID. | Plan only. No writes. |
| Network Operator | Read Only plus arbitrary NQE execution permitted by Forward RBAC. | Plan only. No intent-check writes. |
| Network Admin | Read evidence and mutate intent checks. | Create and exact-approved update only. |

The synchronization action does not invoke NQE implicitly. **Run Forward NQE evidence** is a separate action in the
same app: Read Only requires an exact query ID from the selected connection allowlist; Network Operator and Network
Admin may execute bounded reviewed arbitrary query text. Its result excludes query text and row values.

## Network Admin Gate

An apply requires all of the following:

- a Network Admin connection and matching request profile;
- the exact digest of a plan generated against the current processed snapshot;
- create and update counts within explicit budgets;
- exact approval of every changed managed source key;
- zero identity or name collisions;
- successful post-write readback.

Stale checks are report-only. The action has no delete path.

## Separation Of Duties

- Dynatrace app viewers inspect only the bounded action result; credentials never appear in that result or the browser.
- A tenant connection administrator stores the Forward service identity as an owner-controlled, secret-type app
  setting and shares it only with the required workflow actors through tenant IAM.
- A workflow editor selects dependencies and stages plans.
- A change approver reviews the digest, mutation counts, and changed source keys.
- Only an explicitly configured Network Admin connection can perform apply.

Use separate connections for plan-only and write-enabled workflows. Start every installation with Read Only, then add
a Network Admin connection only after acceptance evidence and tenant approval exist.
