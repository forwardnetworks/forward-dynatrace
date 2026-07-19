# Forward API Compatibility

The app uses documented Forward HTTPS APIs for:

- latest processed snapshot;
- existential check inventory;
- bulk check create;
- exact check update;
- host resolution;
- bulk path search;
- optional NQE execution.

The connection base URL ends at `/api`; action paths are relative to that root. The app validates generated
`NewNetworkCheck[]` payloads before mutation and canonicalizes `/32` and `/128` endpoint forms during reconciliation.

Compatibility must be proven against every supported Forward release. An unknown response shape, missing processed
snapshot, unsupported check field, collision, or non-JSON response fails closed. Raw authenticated response bodies are
never returned to Dynatrace.

Read Only can execute only approved Library NQE IDs. Network Operator and Network Admin may execute arbitrary NQE when
Forward RBAC and app policy allow it. Intent-check writes still require Network Admin and exact plan approval.
