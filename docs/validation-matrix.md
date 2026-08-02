# Validation Matrix

The release gate combines deterministic tests, static policy checks, scale validation, tenant bundle validation, and
independent post-publication verification. Automated action evidence is mock-verified unless a live acceptance is
explicitly identified; environment evidence is live-verified.

| Control | Automated evidence | Environment evidence before promotion |
| --- | --- | --- |
| Dependency discovery | normalization, profile, schema, and Workflow generator tests | Current spans from the applications in scope |
| Workflow widget | Unicode-regex parse test plus archive, installer, and release-package checks for both widget paths | Open the action task and require the connection picker and request editor to render without a hosted JavaScript error |
| Fail-closed mapping | stale, malformed, review-required, and unmapped-row tests | Operator review of aggregate exclusion counts |
| Read Only and Network Operator | action tests prove plan-only behavior and zero mutation calls | Read Only Workflow run against a processed snapshot |
| Network Admin approval | Mock-verified compatibility digest authorization plus engine-approval success; missing context, declined outcome, stale original plan, mismatched original plan/nonce; snapshot, budget, changed-key, collision, zero-mutation rejection, and post-apply readback tests | Existing live digest-mode negative guards and bounded PATCH/readback cycle described below. **Not covered live:** engine-approval mode |
| Forward API compatibility | Mock-verified host resolution, path, NQE, pagination, timeout, streaming response-cap, invocation deadline, and retry behavior | Live-verified bounded apply/readback. **Not covered:** concurrent apply and partial failure handling inside a mutation bulk batch |
| Site Reliability Guardian | manifest, DQL, workflow, and result readback validation | Pass, failure, recovery, and missing-evidence outcomes |
| Scale and idempotency | 1,000-relationship scale smoke, deterministic package tests, legacy 501-update rejection, and successful 500-of-501 partition with one outstanding key | Representative dependency volume and rate-limit observation. **Not covered live:** partitioned apply |
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
tests also verify that a partition key outside the changed set and a partition against drifted whole-plan state are
rejected before PATCH. They do not make engine approval, partitioning, or concurrent execution live-verified.

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

The bounded August 2, 2026 UTC Read Only tenant result is recorded in
[`docs/acceptance/2026-08-02-v0.13.4-live-sandbox.md`](acceptance/2026-08-02-v0.13.4-live-sandbox.md). It is explicit
environment evidence and does not convert mocked write-path controls into live-verified controls.

## Promotion Evidence

Retain only bounded operational evidence:

- release tag, commit, app ID, version, archive digest, and verification report;
- Dynatrace Workflow and Guardian execution IDs;
- Forward network and processed snapshot identifiers;
- aggregate discovery, mapping, path, reconciliation, and health outcomes;
- approved access profile, budgets, change owner, defects, and rollback decision.

Do not retain credentials, authorization headers, tenant URLs, dependency rows, endpoints, hostnames, raw API bodies,
or detailed path topology in this repository.
