# Forward-Side Connector Runtime

The connector runtime is the scheduled process that imports a Dynatrace-generated package into Forward. It runs outside
Dynatrace, holds Forward credentials, validates the package, reconciles against existing checks, and enforces the
configured Read Only, Network Operator, or Network Admin profile.

The checked primary non-production topology is a single customer-controlled systemd host: handoff ingress,
scheduled Forward importer, and optional check-health poller run as separate least-privilege
units behind customer TLS. The repo also keeps three alternative connector templates:

- `deploy/docker-compose/`: a small controlled runtime or trial environment.
- `deploy/systemd/`: a VM or appliance-style scheduled import.
- `deploy/kubernetes/`: a Kubernetes CronJob scheduled import.
- `deploy/cron/`: a portable Linux cron schedule using the guarded importer wrapper.

All scheduled templates use the same importer:

```bash
node scripts/forward-import-package.mjs --config /etc/forward-dynatrace/forward-connector.config.json
```

## Runtime Inputs

The runtime needs:

- a read-only package URL or mounted package files
- a dedicated handoff read-token file referenced by `packageTokenFile` when the package URL uses the checked ingress
- a non-secret connector config based on `config/forward-connector.config.example.json`
- a protected Forward authorization-header file mounted from a runtime secret store
- write access only to report, metrics, and status-artifact output paths

The connector config must not contain user names, passwords, tokens, or private keys. The importer enforces that rule.
It must declare `forwardAccessProfile`, and that profile must exactly match the package request. Read Only and Network
Operator are non-mutating. Network Admin may create missing checks and may replace changed managed checks only when the
signed-package, exact-approval, change-window, and budget controls are present.

## systemd Runtime

Install from the extracted, verified importer release with the checked dry-run-first installer. It stages the runtime,
unit files, and secret-free configuration templates, but it never creates token files, invokes `systemctl`, or treats
placeholder configuration as activation-ready:

```bash
npm run systemd:install -- \
  --source-dir /secure/releases/forward-dynatrace-importer-<verified-release> \
  --root / \
  --output /secure/evidence/systemd-install-plan.json

npm run systemd:install -- \
  --source-dir /secure/releases/forward-dynatrace-importer-<verified-release> \
  --root / \
  --output /secure/evidence/systemd-install-report.json \
  --apply
```

Run the apply command as root after reviewing the plan. Existing runtime and unit files must be byte-identical;
upgrades fail closed unless the operator explicitly adds `--replace-existing` after reviewing the diff. Staged files
under `/etc/forward-dynatrace` become operator-owned and are preserved on every later run, including replacement runs.
The report binds every source file by SHA-256 and enumerates its ownership class, mode, required customer-owned input,
and the activation commands that remain. Replace every placeholder, replace the staged showcase scope mapping with the reviewed customer
mapping, install the listed token files at mode `0600`, and only then run the emitted activation commands.
`npm run systemd:install:test` proves dry-run, source-plan checksum binding, secret omission, exact staging, protected
modes, operator-config preservation, idempotence, and conflict rejection.

The equivalent manual layout is `/opt/forward-dynatrace` for runtime files, `/etc/forward-dynatrace` for protected
configuration, `/etc/systemd/system` for units, and dedicated state/log directories under `/var`. The commands below
remain as an auditable manual reference.

Create a locked-down config directory:

```bash
install -d -m 0750 /etc/forward-dynatrace
install -d -m 0750 /var/lib/forward-dynatrace /var/log/forward-dynatrace
cp deploy/systemd/forward-connector.config.example.json /etc/forward-dynatrace/forward-connector.config.json
cp deploy/systemd/forward-dynatrace.env.example /etc/forward-dynatrace/forward-dynatrace.env
```

Populate `/etc/forward-dynatrace/forward-dynatrace.env` from the local secret manager:

```bash
FORWARD_AUTHORIZATION_FILE=/etc/forward-dynatrace/forward-authorization.header
```

Install and enable the timer:

```bash
cp deploy/systemd/forward-dynatrace-connector.service /etc/systemd/system/
cp deploy/systemd/forward-dynatrace-connector.timer /etc/systemd/system/
systemctl daemon-reload
systemctl enable --now forward-dynatrace-connector.timer
```

Manual run:

```bash
systemctl start forward-dynatrace-connector.service
journalctl -u forward-dynatrace-connector.service
```

The service is oneshot, uses `NoNewPrivileges`, writes only to `/var/lib/forward-dynatrace` and
`/var/log/forward-dynatrace`, and relies on `UMask=0077` for generated artifacts.

Install the handoff ingress before configuring the Dynatrace export action. Copy
`deploy/systemd/forward-handoff.env.example`, install distinct mode-`0600` write/read token files, and enable
`forward-dynatrace-handoff.service`. It binds to localhost by default; customer TLS ingress exposes the write endpoint
to Dynatrace and the read endpoint to the Forward-side importer. Set `packageTokenFile` in the connector config to
`/etc/forward-dynatrace/handoff-read-token`; the importer never stores or forwards that identity outside the exact
handoff URL path. Full retention, backup, and identity rules are in [package-handoff.md](package-handoff.md).

## Cron Runtime

Use [cron-runtime.md](cron-runtime.md) when the Forward-controlled host has cron but not systemd or Kubernetes. The
optional wrapper uses the same importer and connector config, prevents overlapping runs, reclaims abandoned locks,
writes protected per-run logs, refuses `apply=true` without a second explicit gate, and can publish sanitized status
to an approved handoff directory.

The checked schedule is `deploy/cron/forward-dynatrace.crontab.example`; it runs every 15 minutes in dry-run mode by
default.

After a successful run, publish sanitized status to the approved handoff location:

```bash
node scripts/publish-forward-status.mjs \
  --status /var/lib/forward-dynatrace/forward-ingest-status.json \
  --output-dir /handoff/dynatrace-forward/latest
```

The primary non-production systemd path selects direct OpenPipeline publication as its status-feedback lane. After a
successful import, `forward-dynatrace-connector.service` writes the sanitized status sidecar into the handoff and
publishes the derived aggregate event:

```bash
node scripts/publish-dynatrace-status-event.mjs \
  --event /handoff/dynatrace-forward/latest/forward-ingest-status-event.json \
  --environment-url https://<environment-id>.apps.dynatrace.com/ \
  --apply
```

Install the token at `/etc/forward-dynatrace/dynatrace-platform.token` with mode `0600`. It requires only
`openpipeline:events:ingest`; the publish step still runs outside Dynatrace, does not use Forward credentials, and
sends only aggregate ingest health. Query back the exact run ID with
`deploy/dynatrace-dql/forward-ingest-status-latest.dql`; use
`deploy/dynatrace-dql/forward-ingest-status-attention.dql` for failed or review-required runs. A successful POST without
that query-back is not acceptance evidence.

## Kubernetes Runtime

Build the importer image from `Dockerfile.forward-importer` and publish it to an internal registry. Update
`deploy/kubernetes/forward-dynatrace-connector-cronjob.yaml` with that image.

Create the non-secret config from the example after setting `packageUrl`, `forwardBaseUrl`, and `forwardNetworkId`:

```bash
kubectl apply -f deploy/kubernetes/forward-dynatrace-configmap.example.yaml
```

Create the secret after replacing both placeholders locally:

```bash
kubectl apply -f deploy/kubernetes/forward-dynatrace-secret.example.yaml
```

Apply the CronJob:

```bash
kubectl apply -f deploy/kubernetes/forward-dynatrace-connector-cronjob.yaml
```

Check status:

```bash
kubectl get cronjob forward-dynatrace-connector
kubectl logs job/<job-name>
```

The CronJob forbids overlapping runs, uses a non-root user, drops all Linux capabilities, disables privilege
escalation, uses a read-only root filesystem, and loads Forward credentials only from a Kubernetes Secret.

## Runtime Policy

Default runtime policy should stay conservative:

- `forwardAccessProfile=read-only` for initial install and package/reconciliation acceptance.
- Use `network-operator` only when arbitrary NQE execution is required.
- Use `network-admin` only for managed intent synchronization; do not treat it as an NQE convenience role.
- `apply=false` for first installation and dry-run acceptance.
- `apply=true` only after the Forward operator approves the package and target network.
- `failOnDrift=true` for scheduled automation so changed or stale checks block and require review.
- `requireSignature=true` when a package signing key is provisioned.
- `nqeQueryIdAllowlist` only when optional NQE artifacts are enabled.
- `applyUpdates=false` and `deactivateStale=false` unless the runtime owner has an approved change process.
- `maxUpdates=0` and `maxDeactivations=0` unless the same run supplies an approval file and explicit budget.

Changed and stale checks remain report-only by default. Optional update and retirement workflows require Forward-side
approval, a verified signed package, exact approved `source-key:sha256:*` values, and a non-expired approval artifact.
With `forwardAccessProfile=network-admin`, `apply=true`, and a verified package signature, the scheduled connector may
create newly missing managed checks automatically. That activation does not authorize changed-check replacement or
stale-check retirement; those continue to require their explicit flags, immutable plan, and exact approval.

## Docker Compose Runtime

Use the Compose template for a small controlled runtime or trial environment:

```bash
cd deploy/docker-compose
cp forward-dynatrace.env.example .env
```

Populate `.env` from the local secret manager, update `forward-connector.config.example.json` with package and Forward
metadata, then run:

```bash
docker compose --env-file .env -f compose.yaml run --rm forward-dynatrace-importer
```

The Compose service uses a read-only root filesystem, drops Linux capabilities, sets `no-new-privileges`, and writes
only to the named state volume.
