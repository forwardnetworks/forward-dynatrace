# Optional NQE Evidence

NQE is an optional policy extension, not the default host-resolution or path-search mechanism.

- Read Only requests must name a committed Forward Library query ID on the app connection allowlist.
- Network Operator and Network Admin may run a reviewed arbitrary query when Forward RBAC permits it.
- Query parameters, row limits, response size, and returned columns are bounded.
- Results are evidence only and do not create intent checks.
- Diff requests are read-only and execute from the app backend when explicitly configured.
- Default execution uses async `POST /networks/{networkId}/nqe-executions`, status polling, and result paging.
  A separate `executeSync: true` request flag preserves legacy single-request sync behavior against `/api/nqe`.
- Resume behavior is supported via `executionKey`. When supplied, the action skips submit and resumes an existing async execution by polling status and fetching result.
- Execution keys (`executionKey`) are checked before reuse and are only valid until the next major Forward release; they are **not** durable recovery credentials.
- No async cancellation endpoint is documented for this action.

Customer-owned queries remain authoritative in Forward. The public app repository contains no customer query IDs,
credentials, or tenant data.
