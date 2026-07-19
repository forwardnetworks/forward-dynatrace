# Validation Matrix

The release gate combines deterministic tests, static policy checks, scale validation, tenant bundle validation, and
independent post-publication verification.

| Control | Automated evidence | Environment evidence before promotion |
| --- | --- | --- |
| Dependency discovery | normalization, profile, schema, and Workflow generator tests | Current spans from the applications in scope |
| Fail-closed mapping | stale, malformed, review-required, and unmapped-row tests | Operator review of aggregate exclusion counts |
| Read Only and Network Operator | action tests prove plan-only behavior and zero mutation calls | Read Only Workflow run against a processed snapshot |
| Network Admin approval | digest, snapshot, budget, changed-key, collision, and readback tests | Approved create/update cycle with reconciliation readback |
| Forward API compatibility | host resolution, path, NQE, pagination, retry, timeout, and response-cap tests | Supported Forward release and representative network |
| Site Reliability Guardian | manifest, DQL, workflow, and result readback validation | Pass, failure, recovery, and missing-evidence outcomes |
| Scale and idempotency | 1,000-relationship scale smoke and deterministic package tests | Representative dependency volume and rate-limit observation |
| Release supply chain | exact membership, checksum, SBOM, signature, tag, and attestation tests | Independent verification of the published release |
| Security boundary | secret scanning, schema policy, lint, audit, threat-model controls | IAM, outbound allowlist, data-handling, and incident review |

## Release Gate

`npm run ci` must pass from a clean checkout on Node.js 24. The tag workflow repeats the gate before it builds or
publishes an archive. After publication, `npm run release:published:verify` independently downloads and verifies the
release.

## Promotion Evidence

Retain only bounded operational evidence:

- release tag, commit, app ID, version, archive digest, and verification report;
- Dynatrace Workflow and Guardian execution IDs;
- Forward network and processed snapshot identifiers;
- aggregate discovery, mapping, path, reconciliation, and health outcomes;
- approved access profile, budgets, change owner, defects, and rollback decision.

Do not retain credentials, authorization headers, tenant URLs, dependency rows, endpoints, hostnames, raw API bodies,
or detailed path topology in this repository.
