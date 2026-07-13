# ServiceNow Flow Designer Worker

This is the purchase-free invocation surface for ServiceNow Workflow Studio. It runs inside the existing
`forward-dynatrace` runtime image and wraps the tested two-phase `servicenow-change-workflow` command. It is not a new
system of record and does not move evidence or gate logic into ServiceNow.

## Boundary

- ServiceNow owns the Change Request and Flow Designer triggers.
- The worker re-reads ServiceNow approval, state, and the active window before baseline and finalization.
- ServiceNow supplies affected CI/service record references only. The worker resolves Dynatrace service IDs, the
  Forward network, and reviewed endpoint bindings from a protected environment-bound mapping.
- The worker collects Forward evidence, waits for a different processed snapshot, performs dry-run reconciliation,
  and computes the deterministic gate.
- Dynatrace dependencies can be supplied by the caller or collected with an explicitly configured tenant DQL file.
- Completion requires a fresh `forward-dynatrace-change-context/v1` document from the trusted deployment/Dynatrace
  evidence path. ServiceNow values are not silently promoted into Dynatrace truth.
- The customer deployment system still owns deployment and rollback.

## Flow Designer Assets

`deploy/servicenow-flow/` contains an instance-neutral blueprint plus exact core Script-step bodies:

- `start-assurance.js`
- `get-assurance-status.js`
- `complete-assurance.js`
- `forward-change-assurance.flow.example.json`

Build instructions and required inputs/outputs live in `deploy/servicenow-flow/README.md`. Scripts require HTTPS and a
ServiceNow Basic Auth Profile, never embed an Authorization header, and expose only bounded run state. Validate before
handoff with `npm run servicenow:flow-assets:validate`.

## Run The Worker

Required runtime configuration:

```bash
export SERVICENOW_FLOW_USERNAME='<dedicated-flow-user>'
export SERVICENOW_FLOW_PASSWORD='<random-runtime-secret>'
export SERVICENOW_FLOW_HOST=0.0.0.0
export SERVICENOW_FLOW_PORT=8080
export SERVICENOW_FLOW_RUN_DIR=/var/lib/forward-dynatrace/servicenow-flow
export SERVICENOW_FLOW_MAX_ACTIVE_RUNS=4
export SERVICENOW_FLOW_EVIDENCE_SOURCE=live-customer-dependencies
export SERVICENOW_FLOW_SYNTHETIC=0
export SERVICENOW_FLOW_SCOPE_MAPPING_FILE=/secure/config/servicenow-scope-mapping.json
export SERVICENOW_FLOW_SCOPE_ENVIRONMENT=customer-nonproduction

# Existing read-only workflow credentials
export SERVICENOW_BASE_URL=https://your-instance.service-now.com
export SERVICENOW_USER=<read-only-integration-user>
export SERVICENOW_PASSWORD=<runtime-secret>
export FORWARD_BASE_URL=https://forward.example.com
export FORWARD_READONLY_AUTHORIZATION='<runtime-secret>'
export FORWARD_USER=<user>
export FORWARD_PASSWORD=<password-or-token>

npm run servicenow:flow-server
```

In the runtime image:

```bash
docker run --rm \
  --env-file /secure/forward-dynatrace-flow.env \
  -p 127.0.0.1:8080:8080 \
  -v /secure/servicenow-flow:/var/lib/forward-dynatrace/servicenow-flow \
  -v /secure/config:/secure/config:ro \
  forward-dynatrace-importer:local \
  servicenow-flow-server
```

For a host-native service, use the dry-run-first `npm run systemd:install` path in
[connector-runtime.md](connector-runtime.md). It installs the unit and stages
`/etc/forward-dynatrace/servicenow-flow.env` at mode `0600` without creating credentials or activating the service.
Replace every placeholder and the showcase scope mapping with customer-owned values before activation.

Expose the worker to ServiceNow only through a customer-owned TLS reverse proxy or private HTTPS ingress. The
ServiceNow client rejects HTTP and requires an exact origin allowlist plus a Basic Auth Profile. `/healthz` returns
only the worker schema and health state; every workflow route requires Basic authentication.

## Optional Live Dynatrace Dependency Collection

If the start request omits `dependencies`, configure a tenant-owned DQL file and the existing Dynatrace query
credential:

```bash
export DYNATRACE_DEPENDENCY_QUERY_FILE=/secure/queries/customer-dependencies.dql
export DYNATRACE_ENVIRONMENT_URL=https://your-environment-id.apps.dynatrace.com/
export DYNATRACE_TOKEN_FILE=/secure/platform-token
```

There is deliberately no demo-query default in service mode. Missing caller dependencies and a missing configured
tenant query fail the run.

## API

### Start

`POST /v1/servicenow/change-assurance/start`

```json
{
  "changeNumber": "CHG0042187",
  "deploymentId": "checkout-api-2026.07.15.3",
  "affectedRecords": [
    {
      "table": "cmdb_ci_service",
      "sysId": "0123456789abcdef0123456789abcdef"
    }
  ]
}
```

The mapping file uses `forward-dynatrace-servicenow-scope-mapping/v1`; see
[ServiceNow scope mapping](servicenow-scope-mapping.md). Missing, duplicate, ambiguous, disabled, stale,
low-confidence, or cross-environment mappings return a conflict before baseline collection. The protected resolution
artifact is checksummed into workflow state and its mapping identity is retained in the final Dynatrace event. Endpoint
bindings remain inside the worker evidence directory and are never returned to ServiceNow.

Legacy callers can supply `forwardNetworkId` plus `serviceEntityIds` only when the runtime explicitly sets
`SERVICENOW_FLOW_ALLOW_EXPLICIT_SCOPE=1`. It defaults off and is not the checked Flow Designer path.

Provenance is protected runtime configuration, not a customer-facing Flow input. Set
`SERVICENOW_FLOW_SYNTHETIC=1` only for an approved replay/demo runtime. The worker persists the internal source/flag
and carries it into Dynatrace diagnostic evidence without adding demo mechanics to the ServiceNow happy path. Both
provenance variables are mandatory; the worker refuses to start if the evidence source is missing or the synthetic
flag is not explicitly `0` or `1`.

The response is HTTP `202` with a deterministic `fdca-<24 hex>` run ID. Replaying identical input returns the same
run. Reusing the same change/deployment/mapped-scope identity with different input returns HTTP `409`.
After investigating a failed Start phase, repeat the same body with `"retry": true`; changed authoritative input is
still rejected. The worker admits at most `SERVICENOW_FLOW_MAX_ACTIVE_RUNS` concurrent phases.

### Status

`GET /v1/servicenow/change-assurance/runs/{runId}`

The response contains only bounded state: phase, status, change identity, mapping ID/hash/environment/source records,
Forward network and snapshot IDs, decision, exit code, and a redacted error. Local paths, endpoint mappings,
dependencies, credentials, and detailed topology are never returned.

### Complete

`POST /v1/servicenow/change-assurance/runs/{runId}/complete`

```json
{
  "context": {
    "schemaVersion": "forward-dynatrace-change-context/v1",
    "changeId": "CHG0042187",
    "deploymentId": "checkout-api-2026.07.15.3",
    "observedAt": "2026-07-15T19:00:00.000Z",
    "serviceEntityIds": ["SERVICE-CHECKOUT-API", "SERVICE-PAYMENTS-API"],
    "dynatrace": {
      "deploymentState": "SUCCEEDED",
      "serviceHealth": "HEALTHY",
      "openProblemCount": 0
    }
  }
}
```

The worker rejects cross-change context, changed retry context, stale context, and completion before a baseline exists.
`warn` and `fail` are completed runs with process exit `2`; they are not worker failures.

To publish the final evidence to the ServiceNow ledger, enable it only in worker configuration and use the separate
feedback credential:

```bash
export SERVICENOW_FLOW_PUBLISH_SERVICENOW=1
export SERVICENOW_FLOW_VERIFY_RETRY=1
export SERVICENOW_FEEDBACK_USER='<assurance-writer-user>'
export SERVICENOW_FEEDBACK_PASSWORD='<runtime-secret>'
```

`SERVICENOW_FLOW_VERIFY_RETRY=1` is an explicit live-acceptance option. The worker submits the exact checksummed
evidence twice, requires the second ledger receipt to return `existing` for both the work note and attachment with the
same sys_ids, and retains `servicenow-change-feedback-retry.json`. Leave it disabled for normal operation after the
idempotency proof is captured.

Optional Dynatrace aggregate publication is similarly gated by `SERVICENOW_FLOW_PUBLISH_DYNATRACE=1` and the existing
Dynatrace publication credential.

## Recovery

Run records and evidence are stored with restricted permissions beneath `SERVICENOW_FLOW_RUN_DIR`. Start and complete
are asynchronous so ServiceNow does not hold a long outbound request. An active phase that remains orphaned beyond
`SERVICENOW_FLOW_STALE_RUN_MS` (30 minutes by default) changes to `failed`; retry from the authoritative phase input
after inspecting the protected local evidence. The
underlying workflow state lock still prevents concurrent mutation of one run.
