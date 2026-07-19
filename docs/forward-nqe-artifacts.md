# Optional NQE Evidence

NQE is an optional policy extension, not the default host-resolution or path-search mechanism.

- Read Only requests must name a committed Forward Library query ID on the app connection allowlist.
- Network Operator and Network Admin may run a reviewed arbitrary query when Forward RBAC permits it.
- Query parameters, row limits, response size, and returned columns are bounded.
- Results are evidence only and do not create intent checks.
- Diff requests are read-only and execute from the app backend when explicitly configured.

Customer-owned queries remain authoritative in Forward. The public app repository contains no customer query IDs,
credentials, or tenant data.
