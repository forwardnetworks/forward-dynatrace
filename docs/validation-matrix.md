# Validation Matrix

The release gate combines deterministic tests, static policy checks, scale validation, tenant bundle validation, and
independent post-publication verification. Automated action evidence is mock-verified unless a live acceptance is
explicitly identified; environment evidence is live-verified.

| Control | Automated evidence | Environment evidence before promotion |
| --- | --- | --- |
| Dependency discovery | normalization, profile, schema, and Workflow generator tests | Current spans from the applications in scope |
| Fail-closed mapping | stale, malformed, review-required, and unmapped-row tests | Operator review of aggregate exclusion counts |
| Read Only and Network Operator | action tests prove plan-only behavior and zero mutation calls | Read Only Workflow run against a processed snapshot |
| Network Admin approval | Mock-verified digest, snapshot, budget, changed-key, collision, zero-mutation rejection, and post-apply readback tests | Live-verified negative guards and bounded PATCH/readback cycle described below |
| Forward API compatibility | Mock-verified host resolution, path, NQE, pagination, timeout, streaming response-cap, invocation deadline, and retry behavior | Live-verified bounded apply/readback. **Not covered:** concurrent apply and partial failure handling inside a mutation bulk batch |
| Site Reliability Guardian | manifest, DQL, workflow, and result readback validation | Pass, failure, recovery, and missing-evidence outcomes |
| Scale and idempotency | 1,000-relationship scale smoke and deterministic package tests | Representative dependency volume and rate-limit observation |
| Release supply chain | exact membership, checksum, SBOM, signature, tag, and attestation tests | Independent verification of the published release |
| Security boundary | secret scanning, schema policy, lint, audit, threat-model controls | IAM, outbound allowlist, data-handling, and incident review |

## Live Apply-Path Acceptance

The live acceptance against Forward network `252606` verified:

- rejection before mutation when path preflight was disabled, the approved digest was wrong, a mutation budget was
  exceeded, or the approved changed-key set did not match;
- the default-budget guard on a plan in which all 1,000 checks were changed;
- one approved five-check PATCH apply followed by successful post-apply readback; and
- restoration and read-only verification of 1,000 checks, all with performance monitoring enabled, `MEDIUM` priority,
  and `criticality:high`.

The action suite separately mock-verifies create/update behavior, collision reasons (including
`duplicate-existing-source-key`), exact digest and changed-key binding, mutation budgets, and readback failures. Those
tests do not make concurrent execution live-verified.

Concurrent apply remains **not covered** and is not fully prevented. A durable lock was rejected because the required
`app-settings:objects:write` scope would let the app modify the credential-bearing `forward-api-connection` settings
object and its access profile. The actual controls are an immediate pre-mutation state re-read and digest
re-verification, per-invocation mutation budgets, and post-apply readback. If simultaneous identical applies create
duplicates, the next plan reports `duplicate-existing-source-key` and blocks apply fail-closed. Because the action
does not delete checks, manual cleanup may still be required.

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
