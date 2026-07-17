# Deployment Readiness

Use the readiness command before enabling scheduled import or running an apply. It validates the package first, then
optionally performs a Forward dry-run. It never applies Forward changes.

## Command

Validate package artifacts only:

```bash
npm run forward:readiness -- \
  --checks forward-intent-checks.json \
  --manifest forward-dynatrace-manifest.json
```

Validate a connector package source and require signature verification:

```bash
npm run forward:readiness -- \
  --config /secure/path/forward-connector.config.json \
  --require-signature
```

Validate package plus live Forward dry-run:

```bash
export FORWARD_BASE_URL=https://forward.example.com
export FORWARD_AUTHORIZATION_FILE=/secure/path/forward-authorization.header
export FORWARD_NETWORK_ID=<network-id>

npm run forward:readiness -- \
  --config /secure/path/forward-connector.config.json \
  --dry-run \
  --output forward-deployment-readiness.json
```

Optional read-only NQE plan check:

```bash
npm run forward:readiness -- \
  --config /secure/path/forward-connector.config.json \
  --nqe-plan
```

Optional read-only NQE execution requires a customer-approved read-only authorization model:

```bash
npm run forward:readiness -- \
  --config /secure/path/forward-connector.config.json \
  --nqe-execute \
  --nqe-approval-file /secure/path/nqe-preview-approval.json \
  --nqe-authorization-file /secure/path/read-only-forward-authorization
```

## Gates

| Gate | Owner | Result Meaning |
| --- | --- | --- |
| Connector mutation policy | Forward operator | Fails if the connector config has `apply`, `applyUpdates`, or `deactivateStale` enabled. Readiness is non-mutating. |
| Package validation | Shared | Validates schema, manifest, checksums, required `source-key:sha256:*` tags, uniqueness, supported check types, and optional NQE artifacts. |
| Package signature | Forward operator | Passes when a detached package signature verifies. Skips when not required. Fails when `--require-signature` is supplied and verification is missing. |
| Forward connectivity | Forward operator | With `--dry-run`, verifies Forward URL, credentials, network ID, latest processed snapshot, and check inventory access. |
| Forward reconciliation | Forward operator | Reports `create`, `unchanged`, `changed`, and `stale`. Changed/stale results require Forward review before update or retirement automation. |
| Optional read-only NQE | Forward operator | Checks the optional dynamic NQE preview path. It is not required for package export/import. |

## Failure Ownership

| Symptom | Likely Owner | Action |
| --- | --- | --- |
| Package schema, checksum, duplicate key, or unsupported check-type failure | Shared package publisher | Regenerate the package from the Dynatrace app or package builder. |
| Signature required but not verified | Forward operator | Publish the signature beside the package and configure the trusted public key. |
| Missing Forward URL, user, password, or network ID | Forward operator | Fix runtime secrets or connector config outside Dynatrace. |
| No latest processed snapshot | Forward operator | Wait for Forward processing or select a network with a processed snapshot. |
| Forward apply would reject `HostFilter`, `DeviceFilter`, or `SubnetLocationFilter` | Shared mapping owner | Run endpoint-resolution preflight; mark unresolved dependencies `needs-map` before export. |
| Changed or stale generated checks | Forward operator | Review dry-run report; use approval-gated update/stale workflow only with exact-key approval. |
| NQE approval or authorization failure | Forward operator | Fix read-only NQE approval, authorization header, query ID allowlist, or Forward permission. |

## Dependency Eligibility Report

Generate an eligibility report when building packages:

```bash
npm run forward:package -- \
  --dependencies normalized-dependencies.json \
  --output-dir /tmp/forward-dynatrace-package \
  --eligibility-report /tmp/forward-dynatrace-package/forward-dependency-eligibility.json
```

The report lists every normalized dependency row, its mapping state, whether it is eligible for export, and the reason.
Use it to fix Dynatrace-to-Forward host/IP mismatches before dry-run or apply.

## Deployment Options

| Runtime | Use When | Template |
| --- | --- | --- |
| Manual CLI | First customer trial, one-time import, or operator review | `docs/operations-runbook.md` |
| Docker Compose | Small controlled runtime or trial environment | `deploy/docker-compose/compose.yaml` |
| systemd timer | Single Linux host with existing operations controls | `deploy/systemd/` |
| Kubernetes CronJob | Production scheduled connector in a cluster | `deploy/kubernetes/` |

All runtime options keep Forward credentials outside Dynatrace. The Dynatrace app exports artifacts and displays
sanitized Forward status; Forward-owned runtimes perform validation, dry-run, apply, and reconciliation.
