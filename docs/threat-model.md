# Threat Model

| Threat | Control |
| --- | --- |
| Credential exposure to UI or logs | Secret app setting; backend-only load; sanitized errors and output. |
| Target substitution from browser data | URL, network, and profile come from the selected connection; request profile must match. |
| Server-side request forgery | HTTPS-only URL ending `/api`, tenant external-request allowlist, no credentials in URL. |
| Unauthorized mutation | Read Only and Network Operator are plan-only; Network Admin requires exact plan approval. |
| Stale or replayed approval | Digest binds current snapshot, profile, source-key tuples, path-evidence rows, budgets, and payload fingerprints. |
| Check takeover by name | Complete managed ownership tuple required; collisions fail closed. |
| Concurrent apply race | Not fully prevented. Apply re-reads and reconciles current checks and re-verifies the approved digest immediately before the first mutation; budgets bound each invocation and post-apply readback verifies its result. See the residual-risk decision below. |
| Excessive mutation | Explicit budgets and 100-check create batches. |
| Partial apply ambiguity | Stop on first error, sanitize it, then require a new plan and readback. |
| Silent deletion | No deletion endpoint in the synchronization action; stale is report-only. |
| Async execution lifecycle | Async NQE calls are bounded by one-second polling intervals and bounded result `limit`; 404 on status/result is treated as key-expired, and there is no action-side cancellation API. |
| Oversized or hostile response | Content-length early reject, bounded streaming transfer (5 MiB) and strict JSON parsing. |
| Supply-chain substitution | Immutable tags, exact asset membership, checksums, SBOM, signatures, attestations. |

Forward modeled reachability and Dynatrace observed telemetry remain separate evidence. The integration does not infer
root cause solely from a cross-domain correlation.

## Concurrent Apply Residual Risk

A durable cross-invocation lock was rejected. Implementing one in app settings would require
`app-settings:objects:write`, which would also let the app modify its credential-bearing `forward-api-connection`
object, including the Forward credential and access profile. That permanent privilege expansion is not justified for
a race that requires two Network Admin applies to run simultaneously against the same approved digest.

Concurrent apply is therefore not fully prevented. The pre-mutation re-read and digest re-verification narrow the
window, mutation budgets bound each apply, and post-apply readback detects a result that does not match the approved
plan. Two applies can nevertheless both create the same managed check during the remaining window. The next plan
detects the duplicate source key as `duplicate-existing-source-key`, reports a collision, and blocks apply
fail-closed. The duplicate checks already created in Forward are not removed automatically; deletion is not
implemented, so they require manual cleanup.
