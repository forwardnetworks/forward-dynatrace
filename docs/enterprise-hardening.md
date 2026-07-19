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
- 1,000-relationship scale smoke and live pre/regression/recovery evidence.

## Before Supported Production

- official product ownership, support policy, and vulnerability response;
- signed app identity and approved Dynatrace distribution channel;
- independent security review and tenant data/privacy review;
- long-duration rate-limit, credential-rotation, and partial-failure tests against supported Forward releases;
- customer-operated evaluation and non-production acceptance;
- documented Guardian scope taxonomy and change-control integration patterns.
