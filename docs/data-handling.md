# Data Handling

## Stored In Dynatrace

- observed dependency evidence and application/entity identifiers;
- app settings connection metadata and an encrypted secret password;
- Workflow plans, aggregate synchronization results, and Guardian history;
- bounded Forward network/snapshot identifiers and evidence counts.

## Sent To Forward

- authenticated API requests from app functions;
- endpoint values required for host/path evaluation;
- managed intent-check payloads only during approved Network Admin apply.

## Never Exposed To The Browser Or Result

- Forward username, password, or Authorization header;
- deployment OAuth secrets;
- raw authenticated error bodies;
- complete Forward inventory or detailed path topology.

Use a stable opaque source instance ID. Keep customer names, tenant URLs, credentials, private topology, and telemetry
out of this repository and public release artifacts.
