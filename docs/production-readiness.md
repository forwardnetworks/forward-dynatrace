# Production Readiness

The current line is an enterprise preview for controlled evaluation and non-production use. Promotion to supported
production distribution requires the controls below in addition to the implemented product safeguards.

## Implemented Enterprise Preview Controls

- single Dynatrace app architecture with no Forward-side runtime;
- secret tenant-managed connections and explicit Forward access profiles;
- HTTPS target validation and Dynatrace outbound-host approval;
- immutable plans, bounded mutations, collision rejection, and post-write readback;
- fail-closed mapping, stale report-only behavior, and no implicit deletion;
- current-telemetry discovery, modeled-path evidence, and Guardian correlation;
- documented product, support, vulnerability-response, incident, and release ownership;
- capability-based Forward and Dynatrace compatibility policy;
- deterministic 1,000-relationship scale validation and 100-cycle idempotency soak on every CI run;
- credential-rotation, partial-failure, and recovery acceptance procedures;
- complete CI, schema, security, release, SBOM, checksum, signature, and attestation gates;
- documented support intake, upgrade policy, and release communication process.

## External Production Gates

- signed `com.forward.dynatrace` archive and approved Dynatrace distribution path;
- independent application-security and tenant data/privacy review;
- customer-operated acceptance under Read Only followed by a separately approved Network Admin workflow;
- customer-owned Guardian scope taxonomy, closeout policy, rollback policy, and separation of duties;
- named commercial support and production-promotion record for the exact signed version.

## Promotion Decision

Production promotion is a governance decision, not an app setting. Record the exact signed release, control owners,
security findings, compatibility evidence, access profiles, Workflow approvals, recovery results, and residual risk.
The repository cannot self-approve these independent or customer-owned gates.
