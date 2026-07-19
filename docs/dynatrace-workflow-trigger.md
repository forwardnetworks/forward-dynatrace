# Dynatrace Workflow Action

The app registers **Synchronize Forward intent checks** and **Run Forward NQE evidence**. Both call Forward APIs only
from the app backend through the selected tenant-managed secret connection.

## Configure

1. Add the action to an on-demand, scheduled, or problem-triggered Workflow.
2. Select a `forward-api-connection` settings object.
3. Provide dependency rows through a Workflow expression or JSON request.
4. Run `operation: "plan"` first and retain the action result.
5. For Network Admin apply, require human or policy approval of the exact plan digest, budgets, and changed source keys.

Use Read Only for the initial sandbox. Network Operator is appropriate only when reviewed arbitrary NQE execution is
needed. Neither profile can create or update intent checks.

For optional NQE evidence, add **Run Forward NQE evidence** as a separate task. Read Only accepts only a committed
Forward Library query ID from the connection allowlist. Network Operator or Network Admin accepts either a query ID or
bounded reviewed query text. NQE execution is read-only regardless of profile.

## Output

The action returns only:

- selected network and snapshot identifiers;
- package and plan identifiers;
- access profile;
- aggregate reconciliation and mutation counts;
- post-apply verification state;
- the explicit tenant-managed-secret boundary.

The NQE action adds an exact snapshot ID, query kind and fingerprint, row counts, and bounded column names. Neither
action returns a username, password, Authorization header, raw Forward response body, query text, row values, hostname
list, or path topology.
