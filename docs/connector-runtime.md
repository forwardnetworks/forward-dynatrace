# Forward-Side Connector Runtime

The connector runtime is the scheduled process that imports a Dynatrace-generated package into Forward. It runs outside
Dynatrace, holds Forward credentials, validates the package, reconciles against existing checks, and applies only
missing checks when `apply` is enabled.

The repo includes three deployable runtime templates:

- `deploy/docker-compose/`: a small controlled runtime or trial environment.
- `deploy/systemd/`: a VM or appliance-style scheduled import.
- `deploy/kubernetes/`: a Kubernetes CronJob scheduled import.

Both templates use the same importer:

```bash
node scripts/forward-import-package.mjs --config /etc/forward-dynatrace/forward-connector.config.json
```

## Runtime Inputs

The runtime needs:

- a read-only package URL or mounted package files
- a non-secret connector config based on `config/forward-connector.config.example.json`
- `FORWARD_USER` and `FORWARD_PASSWORD` from a runtime secret store
- write access only to report, metrics, and status-artifact output paths

The connector config must not contain user names, passwords, tokens, or private keys. The importer enforces that rule.

## systemd Runtime

Install the importer source or release importer archive under `/opt/forward-dynatrace`.

Create a locked-down config directory:

```bash
install -d -m 0750 /etc/forward-dynatrace
install -d -m 0750 /var/lib/forward-dynatrace /var/log/forward-dynatrace
cp deploy/systemd/forward-connector.config.example.json /etc/forward-dynatrace/forward-connector.config.json
cp deploy/systemd/forward-dynatrace.env.example /etc/forward-dynatrace/forward-dynatrace.env
```

Populate `/etc/forward-dynatrace/forward-dynatrace.env` from the local secret manager:

```bash
FORWARD_USER=<user>
FORWARD_PASSWORD=<password-or-token>
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

After a successful run, publish sanitized status to the approved handoff location:

```bash
node scripts/publish-forward-status.mjs \
  --status /var/lib/forward-dynatrace/forward-ingest-status.json \
  --output-dir /handoff/dynatrace-forward/latest
```

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

- `apply=false` for first installation and dry-run acceptance.
- `apply=true` only after the Forward operator approves the package and target network.
- `failOnDrift=true` for scheduled automation so changed or stale checks block and require review.
- `requireSignature=true` when a package signing key is provisioned.
- `nqeQueryIdAllowlist` only when optional NQE artifacts are enabled.
- `applyUpdates=false` and `deactivateStale=false` unless the runtime owner has an approved change process.
- `maxUpdates=0` and `maxDeactivations=0` unless the same run supplies an approval file and explicit budget.

Changed and stale checks remain report-only by default. Optional update and retirement workflows require Forward-side
approval, a verified signed package, exact approved `dynatrace-key:*` values, and a non-expired approval artifact.

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
