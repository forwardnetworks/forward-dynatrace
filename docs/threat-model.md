# Threat Model

| Threat | Control |
| --- | --- |
| Credential exposure to UI or logs | Secret app setting; backend-only load; sanitized errors and output. |
| Target substitution from browser data | URL, network, and profile come from the selected connection; request profile must match. |
| Server-side request forgery | HTTPS-only URL ending `/api`, tenant external-request allowlist, no credentials in URL. |
| Unauthorized mutation | Read Only and Network Operator are plan-only; Network Admin requires exact plan approval. |
| Stale or replayed approval | Digest binds current snapshot, profile, source-key tuples, path-evidence rows, budgets, and payload fingerprints. |
| Check takeover by name | Complete managed ownership tuple required; collisions fail closed. |
| Concurrent apply race | Apply re-runs check/reconcile against current state before mutation and revalidates digest, but still cannot use durable cross-invocation locks without additional permission scope. |
| Excessive mutation | Explicit budgets and 100-check create batches. |
| Partial apply ambiguity | Stop on first error, sanitize it, then require a new plan and readback. |
| Silent deletion | No deletion endpoint in the synchronization action; stale is report-only. |
| Async execution lifecycle | Async NQE calls are bounded by one-second polling intervals and bounded result `limit`; 404 on status/result is treated as key-expired, and there is no action-side cancellation API. |
| Oversized or hostile response | Content-length early reject, bounded streaming transfer (5 MiB) and strict JSON parsing. |
| Supply-chain substitution | Immutable tags, exact asset membership, checksums, SBOM, signatures, attestations. |

Forward modeled reachability and Dynatrace observed telemetry remain separate evidence. The integration does not infer
root cause solely from a cross-domain correlation.
