# Forward API Compatibility

The app uses documented Forward HTTPS APIs for:

- latest processed snapshot;
- existential check inventory;
- bulk check create;
- exact check update;
- host resolution;
- bulk path search;
- optional NQE execution. NQE execution uses the async `/networks/{networkId}/nqe-executions` workflow by default.

Operators enter the normal Forward HTTPS tenant origin, such as `https://fwd.app`. The connection validator adds
`/api` internally before any client is created, and action paths are relative to that normalized API root. Existing
saved values that already end in `/api` remain compatible and normalize to the same value. Any other URL path is
rejected. The app validates generated `NewNetworkCheck[]` payloads before mutation and canonicalizes `/32` and `/128`
endpoint forms during reconciliation.

Each connection binds an operator-supplied exact network ID. Credential Vault supplies authentication only; v0.13.x
does not enumerate accessible networks into the declarative settings form. All API requests require HTTPS with normal
certificate verification. Private or internal-CA Forward endpoints require an approved EdgeConnect route with the CA
configured in EdgeConnect. The app deliberately exposes no per-connection TLS bypass.

Compatibility must be proven against every supported Forward release. An unknown response shape, missing processed
snapshot, unsupported check field, collision, or non-JSON response fails closed. Raw authenticated response bodies are
never returned to Dynatrace.

Read Only can execute only approved Library NQE IDs. Network Operator and Network Admin may execute arbitrary NQE when
Forward RBAC and app policy allow it. Intent-check writes still require Network Admin and exact plan approval.
NQE executionKey-based status/result endpoints are bounded by Forward API invocation retry behavior. Resume requests use
the same bounded polling path as async submissions, and execution keys should be treated as session-scoped recovery values.
Execution keys remain valid until the next major Forward release; this is not intended as durable recovery.

Forward updates the server-managed `editedAt` timestamp on a check when it is PATCHed. `editedAt` is excluded from the
canonical check fingerprint and source key, so this timestamp-only change is not intent drift. Test mocks do not model
the server-side timestamp update; tooling must compare canonical identities and fingerprints rather than byte-compare
pre- and post-PATCH inventory responses.
