# NQE Preview

The app can stage optional NQE evidence through the same tenant-managed Forward connection.

| Profile | NQE policy |
| --- | --- |
| Read Only | Exact Forward Library query ID from the selected connection allowlist only. |
| Network Operator | Reviewed arbitrary NQE or approved Library query. |
| Network Admin | Same NQE capability; intent mutation remains a separate exact-plan gate. |

Use **Run Forward NQE evidence** in Dynatrace Workflow. The action selects the network and secret from the connection,
defaults to async execution via `/networks/{networkId}/nqe-executions` and polls status/result endpoints with a one-second
minimum interval, then returns only the query fingerprint, row count, and bounded column names. It never returns the query
text, row values, credential, or raw response. Set `executeSync: true` in the request to run through legacy synchronous
`/api/nqe` when needed. NQE does not replace host resolution, `/paths-bulk`, or persistent intent checks.

No Forward `nqe-execution` cancellation endpoint is currently documented.
