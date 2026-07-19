# Enterprise Hardening

## Implemented

- one Dynatrace app and no external installable;
- tenant-managed secret Forward connections;
- strict HTTPS `/api` target validation and tenant outbound allowlist;
- three explicit Forward access profiles;
- immutable plan digest and exact changed-key approval;
- managed ownership tuple, collision rejection, budgets, batching, retries, timeout, and response cap;
- stop-and-restage partial-failure behavior and post-apply readback;
- stale report-only behavior with no delete action;
- app-only release membership, SBOM, checksums, optional signature, and attestations;
- customer-name, secret, agent-instruction, and external-runtime repository gates;
- named product, support, security, incident, compatibility, and release ownership;
- 1,000-relationship scale smoke and 100-cycle idempotency soak in CI;
- documented credential-rotation, rate-limit, partial-failure, and recovery exercises;
- support, vulnerability reporting, upgrade, compatibility, and release communication policies.

## External Gates Before Supported Production

- signed app identity and approved Dynatrace distribution channel;
- independent security review and tenant data/privacy review;
- customer-operated evaluation and non-production acceptance;
- customer-approved Guardian scope taxonomy and change-control integration patterns;
- named commercial support and production-promotion record for the signed release.
