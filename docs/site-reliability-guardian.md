# Site Reliability Guardian Integration

This package adds a lifecycle Site Reliability Guardian to a reviewed Forward/Dynatrace scope. The Guardian evaluates
Dynatrace-owned service telemetry and confirms that a passing, sanitized Forward change-validation event exists in the
same window. Dynatrace does not receive Forward credentials, endpoints, devices, paths, or write authority.

Dynatrace documents lifecycle Guardians as SDLC-event based, the Workflow action as
`dynatrace.site.reliability.guardian:validate-guardian-action`, and finished results as `event.type == "validation"`
with `event.status == "finished"`. The checked package follows those current contracts:

- [Site Reliability Guardian](https://docs.dynatrace.com/docs/deliver/site-reliability-guardian)
- [Guardian execution context](https://docs.dynatrace.com/docs/deliver/site-reliability-guardian/execution-context)
- [Guardian as code](https://docs.dynatrace.com/docs/deliver/site-reliability-guardian/config-as-code-srg)
- [Guardian event structure](https://docs.dynatrace.com/docs/deliver/site-reliability-guardian/event-structure)

## Correlation Contract

`schemas/forward-guardian-execution-context.schema.json` is the public field contract and
`config/forward-guardian-execution-context.example.json` is a placeholder-only example.

| Field group | Authority | Purpose |
| --- | --- | --- |
| `correlationId`, `gateRunId`, change and deployment IDs, evidence window | Change orchestrator | Joins one trigger, Guardian execution, and validation result. |
| Application, environment, service entity, owner, criticality, location | Dynatrace owner | Selects the bounded observability scope and Guardian tags. |
| Network and before/after snapshot IDs | Forward-side runtime | Proves which modeled network evidence was evaluated. |
| Protocol and port sets | Joint reviewed mapping | Describes dependency intent without publishing source/destination endpoints. |
| Mapping state, confidence, and source count | Mapping owner | Makes ambiguous or incomplete correlation explicit. |

The publisher rejects a context when its change, deployment, service entities, network, or snapshots do not exactly
match the gate artifact. Guardian trigger mode additionally requires a resolved, high-confidence mapping and explicitly
non-synthetic evidence. It also rejects windows longer than 24 hours and credential/topology-detail keys. The canonical
context SHA-256 and `correlationId` are published beside the nested `execution_context`; Guardian result events propagate
that context.

## Install The Guardian And Workflow

The primary enterprise path uses Dynatrace Monaco. The package is in `deploy/dynatrace-guardian/` and includes the
deployment manifest, settings/workflow configuration, Guardian template, and Workflow template.

1. In `deploy/dynatrace-guardian/configs.yaml`, replace every placeholder value for application, environment, owner,
   criticality, service entity, and scope mapping. Use the same scope mapping ID in the correlation context.
2. Set `DYNATRACE_ENVIRONMENT_URL` to the Apps URL. Set `DYNATRACE_PLATFORM_TOKEN` in the operator's secret manager or
   process environment; never write it into this repository or a Monaco file.
3. From `deploy/dynatrace-guardian/`, run `monaco deploy --dry-run manifest.example.yaml`.
4. Review the rendered change and then run `monaco deploy manifest.example.yaml`.
5. Open **Site Reliability Guardian** in Dynatrace. Select **Forward change validation - `<application>` -
   `<environment>`**. Verify **Lifecycle guardian**, the six objectives, the two variables, and all scope tags.
6. Open **Workflows**. Select **Forward change validation**. Verify the event trigger uses **events**, requires
   `event.kind == "SDLC_EVENT"`, filters the exact scope mapping ID, and runs **Site Reliability Guardian**.

The Forward-evidence objective fails closed unless exactly one event for the selected scope mapping appears in the
validation window and that event passed. This prevents an older passing event from masking a newer failed gate; a busy
scope with overlapping changes must use distinct mapping IDs or non-overlapping validation windows.

The checked static thresholds are conservative pilot defaults, not universal production policy. `Request volume` and
`Error log count` are informational. Promote either to an enforcing objective only after the tenant owner validates the
data scope and threshold. Auto-adaptive thresholds require at least five validation runs before they affect results, so
they are intentionally not enabled for the first vertical slice.

## Publish A Correlated Trigger

Build the ordinary change gate first. Copy the placeholder context example outside the repository, replace it with
approved values, and keep its IDs identical to the gate. The `gateRunId` must also equal `--run-id`.

Dry-run and retain the sanitized event:

```bash
npm run dynatrace:change-gate:publish -- \
  --gate /secure/evidence/forward-change-validation-gate.json \
  --guardian-context /secure/evidence/forward-guardian-execution-context.json \
  --guardian-trigger \
  --run-id GATE-RUN-001 \
  --environment-url https://<environment-id>.apps.dynatrace.com/ \
  --output /secure/evidence/forward-change-validation-event.json
```

After schema review, add `--apply --token-file /secure/tokens/dynatrace-sdlc.token`. Guardian-trigger mode sends one
record to `/platform/ingest/v1/events.sdlc` using `Api-Token` authentication. Without `--guardian-trigger`, the command
retains the existing batch `/platform/ingest/v1/events` behavior for non-Guardian consumers.

The token used for Guardian trigger publication needs the Dynatrace SDLC event ingestion permission. The Workflow
owner also needs Guardian validator and Workflow run permissions. Keep publication and Workflow identities separate
where the tenant's access model allows it.

## Verify Results

1. In **Workflows**, open the latest **Forward change validation** execution and select **run_validation**. Confirm the
   action output has a Guardian ID, validation ID, validation URL, and `pass`, `warning`, `fail`, `error`, or `info`.
2. Open **Site Reliability Guardian**, select the Guardian, and open the same validation ID. Confirm each objective's
   value and evidence window.
3. In **Notebooks** or **Dashboards**, run
   `deploy/dynatrace-dql/forward-guardian-validation-latest.dql`. Confirm `execution_context.correlationId` matches the
   published context and `validation.result` matches the Workflow action.
4. In the Forward app view, query the existing change-validation evidence by the same correlation ID and confirm the
   network and snapshot IDs match the retained gate artifact.

## Acceptance Runs

- Passing run: use a window with service spans, reviewed thresholds, and a passing Forward gate.
- Objective failure: use a bounded non-production window with a known failed request or temporarily tighten one
  reviewed static threshold; restore the reviewed value immediately afterward.
- Missing evidence: manually validate a reviewed test Guardian against a window with no matching Forward event or no
  root service spans. `Forward validation evidence` or `Service telemetry present` must fail; missing data must not pass.
- Correlation failure: alter a context copy so a snapshot or service ID differs from the gate. The publisher must stop
  locally before any Dynatrace call.

Run the mechanical package check with:

```bash
npm run dynatrace:guardian:validate
```

Live customer acceptance remains open until the pass, deliberate failure, and missing-evidence cases are queried back
from the target tenant.
