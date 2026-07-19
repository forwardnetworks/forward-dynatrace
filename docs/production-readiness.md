# Production Readiness

The current line is an enterprise preview for controlled evaluation and non-production use. Promotion to supported
production distribution requires the controls below in addition to the implemented product safeguards.

## Implemented Product Controls

- single Dynatrace app architecture with no Forward-side runtime;
- secret tenant-managed connections and explicit Forward access profiles;
- HTTPS target validation and Dynatrace outbound-host approval;
- immutable plans, bounded mutations, collision rejection, and post-write readback;
- fail-closed mapping, stale report-only behavior, and no implicit deletion;
- current-telemetry discovery, modeled-path evidence, and Guardian correlation;
- complete CI, scale, schema, security, release, SBOM, checksum, and attestation gates.

## Required For Supported Production

- signed `com.forward.dynatrace` archive and approved Dynatrace distribution path;
- named product, support, vulnerability-response, and incident owners;
- independent application-security and tenant data/privacy review;
- compatibility certification against supported Forward and Dynatrace release ranges;
- long-duration rate-limit, credential-rotation, partial-failure, and recovery validation;
- customer-operated acceptance under Read Only followed by a separately approved Network Admin workflow;
- documented Guardian scope taxonomy, closeout policy, rollback policy, and separation of duties;
- support documentation, upgrade policy, and release communication process.

## Promotion Decision

Production promotion is a governance decision, not an app setting. Record the exact signed release, control owners,
security findings, compatibility evidence, access profiles, Workflow approvals, recovery results, and residual risk.
