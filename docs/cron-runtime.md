# Cron Import Runtime

Use this optional runtime when a Forward-controlled Linux host has cron but not systemd or Kubernetes. It wraps the
same package importer used by every other deployment model; it does not introduce a second reconciliation path.

## Safety Model

- Dry-run is the default because the example connector config has `apply=false`.
- A config with `apply=true` is refused unless the cron command also has `--allow-apply` or the protected environment
  explicitly sets `FORWARD_DYNATRACE_ALLOW_APPLY=true`.
- An atomic lock prevents overlapping runs. A lock older than 120 minutes is treated as abandoned and reclaimed.
- Forward credentials come only from a root-readable environment file or the scheduler's secret injection.
- The non-secret connector config keeps changed and stale checks report-only and fails on drift.
- The package and connector access profiles must match; only Network Admin can pass an apply gate.
- Each run writes a mode-`0600` log. Import reports, metrics, and sanitized status use the paths in the connector config.

## Install

Install the importer release under `/opt/forward-dynatrace`, then create a dedicated account and directories:

```bash
useradd --system --home /var/lib/forward-dynatrace --shell /usr/sbin/nologin forward-dynatrace
install -d -o root -g forward-dynatrace -m 0750 /etc/forward-dynatrace
install -d -o forward-dynatrace -g forward-dynatrace -m 0750 \
  /var/lib/forward-dynatrace /var/log/forward-dynatrace
install -o root -g forward-dynatrace -m 0640 \
  deploy/cron/forward-connector.config.example.json \
  /etc/forward-dynatrace/forward-connector.config.json
install -o root -g forward-dynatrace -m 0640 \
  deploy/cron/forward-dynatrace.env.example \
  /etc/forward-dynatrace/forward-dynatrace.env
```

Edit the connector config to set the package URL, Forward URL, and network ID. Populate the environment file from the
local secret manager:

```bash
FORWARD_AUTHORIZATION_FILE=/etc/forward-dynatrace/forward-authorization.header
```

Do not put credentials in the connector config or crontab.

## Acceptance Before Scheduling

Run the wrapper manually as the service account:

```bash
sudo -u forward-dynatrace sh -c '
  set -a
  . /etc/forward-dynatrace/forward-dynatrace.env
  set +a
  exec /usr/bin/node /opt/forward-dynatrace/scripts/forward-cron-import.mjs \
    --config /etc/forward-dynatrace/forward-connector.config.json \
    --state-dir /var/lib/forward-dynatrace \
    --log-dir /var/log/forward-dynatrace
'
```

Review `forward-import-report.json` and confirm the intended `create`, `unchanged`, `changed`, and `stale` counts. Keep
`apply=false` until this dry-run and the target network are approved.

## Install The Schedule

Install the checked example for the dedicated account:

```bash
crontab -u forward-dynatrace deploy/cron/forward-dynatrace.crontab.example
crontab -u forward-dynatrace -l
```

The example runs every 15 minutes. Change only the first five cron fields to adjust cadence. Keep the absolute paths,
environment-file load, and log redirect intact.

## Enable Create-Missing Apply

After dry-run acceptance:

1. Set `forwardAccessProfile=network-admin` and `apply=true` in the local connector config, and generate the package
   with the matching Network Admin profile.
2. Add `--allow-apply` to the cron command.
3. Leave `applyUpdates=false`, `deactivateStale=false`, `maxUpdates=0`, and `maxDeactivations=0` for the initial
   production schedule.
4. Run once manually, confirm created counts, then confirm the next run reports those checks unchanged.

The explicit flag prevents an accidental config edit from silently converting a scheduled dry-run into a writer.

## Optional Dynatrace Status Handoff

Add this runner option when the approved handoff directory exists:

```bash
--status-handoff-dir /handoff/dynatrace-forward/latest
```

The runner publishes the sanitized aggregate status, checksum, and Dynatrace event payload only after a successful
import. It never publishes the detailed Forward reconciliation report or credentials.

## Operations

- Logs: `/var/log/forward-dynatrace/forward-import-<UTC timestamp>.log`
- Launcher log: `/var/log/forward-dynatrace/cron-launch.log`
- Lock: `/var/lib/forward-dynatrace/forward-cron-import.lock`
- Report, metrics, and status: configured in `forward-connector.config.json`

If a run fails, keep the report and log, correct the package or access problem, and run manually before waiting for the
next schedule. Never delete a recent lock while its process may still be active; the runner skips overlaps and reclaims
only locks older than its configured maximum age.
