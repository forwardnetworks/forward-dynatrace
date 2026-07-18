# Support And Compatibility Matrix

This matrix defines the `0.10.x` design-partner boundary. A preview is eligible for a controlled sandbox or
non-production pilot only when the artifact, target platform, required API capabilities, runtime, and operating controls
all satisfy the same row. Passing repository CI alone does not create a supported production deployment.

## Product Contract

| Area | `0.10.x` baseline | Verification | Pilot gate |
| --- | --- | --- | --- |
| Forward for Dynatrace | Unreleased `0.10.0` reset baseline; future `0.x` tags are prereleases | CI and published-release verifier check commit, checksums, signature, attestations, SBOM, image digest, Trivy result, and prerelease status | Use an exact reviewed commit or immutable `0.x` prerelease; never install retired `v1.0.x` artifacts or a mutable image tag |
| Package schema | `forward-dynatrace/v1` | JSON Schema and import-plan tests | Reject unknown schema versions; no compatibility shim or silent downgrade |
| Connector schema | `forward-dynatrace-connector/v1` | Schema and runtime-manifest tests | Customer config must validate before credentials or network calls are enabled |
| Forward access profiles | Read Only, Network Operator, Network Admin | Shared profile module, schemas, API/importer tests, and readiness tests | Package and connector profiles must match; only Network Admin may write intent checks |
| Default mutation policy | Network Admin creates missing checks only after signature and runtime activation | Reconciliation, profile, and immutable-plan tests | Changed and stale mutations remain disabled unless separately exact-approval-gated |

## Dynatrace Baseline

| Area | Verified baseline | Production gate |
| --- | --- | --- |
| Application identity | `my.forward` for unsigned sandbox installation; `com.forward.dynatrace` reserved for signed shared-environment pilots and a future supported release | The reserved identity requires a Dynatrace-signed archive and tenant-admin approval |
| App Toolkit | `dt-app` `1.11.2` | Rebuild and run full CI before adopting another toolkit baseline |
| Node.js | `>=24.0.0 <25.0.0`; CI and version files use Node 24 | Do not run the supported kit on another Node major |
| App dependencies | Exact versions in the release `package-lock.json` | Install with `npm ci`; do not resolve a fresh dependency graph during deployment |
| Grail evidence | Customer-owned application dependency and Guardian evidence | Query-back must verify the same bounded correlation identity and evidence window |

The repository checksum signature protects release membership. It is separate from the Dynatrace archive signature
required to install the reserved `com.forward.dynatrace` application identity.

## Forward Baseline

Forward compatibility is capability-gated because product release labels alone do not confirm that every required API
surface and policy is enabled in a particular environment. The required endpoint and schema contract is defined in
[`forward-api-compatibility.md`](forward-api-compatibility.md).

A target Forward environment is accepted only after it passes all of the following with its dedicated identities:

1. latest processed snapshot lookup;
2. exact host resolution and optional approved read-only path evidence;
3. complete existing-check inventory and ownership reconciliation;
4. validate-only and staged dry-run with no mutations;
5. bulk create of a bounded approved package;
6. post-apply readback and an unchanged idempotent rerun.

Missing endpoints, incompatible response schemas, unresolved host mappings, incomplete inventory, or a failed readback
are hard stops. The importer does not silently switch API paths or fall back to individual writes.

## Forward-Side Runtime Baseline

| Substrate | Repository evidence | Production gate |
| --- | --- | --- |
| OCI container | Multi-stage importer image, non-root runtime, SBOM, provenance, vulnerability scan | Deploy by immutable digest and apply customer registry/runtime policy |
| systemd | Checked unit, timer, environment examples, protected-file model, installer test | Linux owner validates filesystem permissions, restart behavior, log shipping, and rollback |
| Kubernetes | Checked CronJobs, ConfigMap, Secret, and persistent-state examples | Platform owner supplies namespace policy, secret provider, storage class, network policy, and workload identity |
| Cron | Checked non-overlap runner and examples | Use only where the customer accepts host-level scheduling and equivalent secret/log controls |

Windows-native execution, mutable `latest` image deployment, credentials in command arguments or environment values,
and direct Forward writes from Dynatrace are unsupported.

## Support Lifecycle

- There is no supported general-availability line yet; `0.10.x` is a design-partner preview.
- Every `0.x` tag must be a GitHub prerelease and must not update the GHCR `latest` tag.
- The published `v1.0.0` through `v1.0.2` artifacts are retired history and are not installable baselines.
- Schema identifiers ending in `/v1` remain the current strict wire contract and do not signal product maturity.
- Preview patches may correct behavior without weakening schemas, identity, approval, or credential boundaries.
- Toolkit, Node-major, Forward API, and deployment-substrate expansion requires full contract and acceptance evidence.
- General availability requires named product ownership, signing authority, escalation ownership, and completed customer
  non-production acceptance before an explicitly approved new `1.0.0` is published.

Use [`templates/customer-acceptance-record.md`](templates/customer-acceptance-record.md) to record the evidence for a
specific environment without placing credentials, tenant URLs, private topology, or customer data in this repository.
