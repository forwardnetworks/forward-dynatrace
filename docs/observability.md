# Observability

Monitor the app and Workflow, not a separate runtime.

Key signals:

- action execution count, duration, timeout, retry, and failure status;
- dependency rows, mapping readiness, and rejected rows;
- plan create, unchanged, changed, stale, and collision counts;
- apply created and updated counts plus post-apply verification;
- Forward snapshot age and ID;
- Guardian execution result and reason codes;
- connection authentication and external-request denials.

Never log the Forward username, password, Authorization header, raw failure response, host inventory, check names, or
full path topology. Use correlation IDs, snapshot IDs, plan digests, aggregate counts, and bounded reason codes.

## Connection Diagnostic Records

Source version v0.13.5 emits one JSON operational record for each **Test connection** invocation. The record contains
only schema version, timestamp, event name, correlation ID, `ready` or `blocked` status, duration, declared access
profile, optional HTTP status class, bounded reason code, and `PROCESSED` snapshot state. It excludes connection and
Vault entity IDs, Forward network and snapshot IDs, authorization material, endpoints, response bodies, and inventory.

Use the returned correlation ID to find the matching app-function record. A blocked diagnostic returns one of these
operator-facing reason codes:

- `connection-configuration-invalid`
- `credential-vault-unavailable`
- `credential-vault-invalid`
- `authentication-or-external-request-denied`
- `network-not-found`
- `no-processed-snapshot`
- `rate-limited`
- `forward-unavailable`
- `forward-transport-failed`
- `unexpected-diagnostic-failure`
