# Threat Model

| Threat | Control |
| --- | --- |
| Credential exposure to UI or logs | Secret app setting; backend-only load; sanitized errors and output. |
| Target substitution from browser data | URL, network, and profile come from the selected connection; request profile must match. |
| Server-side request forgery | HTTPS-only URL ending `/api`, tenant external-request allowlist, no credentials in URL. |
| Unauthorized mutation | Read Only and Network Operator are plan-only; Network Admin requires exact plan approval. |
| Stale or replayed approval | Digest binds current snapshot, profile, identities, and payload fingerprints. |
| Check takeover by name | Complete managed ownership tuple required; collisions fail closed. |
| Excessive mutation | Explicit budgets and 100-check create batches. |
| Partial apply ambiguity | Stop on first error, sanitize it, then require a new plan and readback. |
| Silent deletion | No deletion endpoint in the synchronization action; stale is report-only. |
| Oversized or hostile response | Timeout, bounded retry, 5 MiB response cap, strict JSON parsing. |
| Supply-chain substitution | Immutable tags, exact asset membership, checksums, SBOM, signatures, attestations. |

Forward modeled reachability and Dynatrace observed telemetry remain separate evidence. The integration does not infer
root cause solely from a cross-domain correlation.
