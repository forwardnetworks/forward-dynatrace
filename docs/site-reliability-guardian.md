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
match the gate artifact. Guardian trigger mode additionally requires a resolved, high-confidence mapping and
trace-backed live evidence. It also rejects windows longer than 24 hours and credential/topology-detail keys. The
canonical context SHA-256 and `correlationId` are published beside the nested `execution_context`.

The enforced correlation join uses the Automation execution: the triggering SDLC event remains in
`execution.params.event`, including `execution_context`, and the `run_validation` task returns the Guardian validation
ID, status, summary, and objective details. This is deliberately stronger than assuming the lifecycle validation event
will retain `execution_context`; current tenants can return that field as null on the finished result event.

## Install The Guardian And Workflow

The primary enterprise path uses Dynatrace Monaco. The package is in `deploy/dynatrace-guardian/`; the manifest points
to the single project definition at `project/configs.yaml`, which references the Guardian and Workflow templates in its
parent directory.

1. Select one reviewed Dynatrace service entity from the trace-backed dependency scope. Use the same scope mapping ID
   in the Guardian deployment and the correlation context.
2. Set the following values in the operator's secret manager or process environment; never write them into this
   repository or a Monaco file:

   ```bash
   export DYNATRACE_ENVIRONMENT_URL=https://<environment-id>.apps.dynatrace.com/
   export DYNATRACE_PLATFORM_TOKEN=<protected-platform-token>
   export FORWARD_GUARDIAN_APPLICATION_ID=<application-id>
   export FORWARD_GUARDIAN_ENVIRONMENT_ID=<environment-id>
   export FORWARD_GUARDIAN_OWNER=<owner>
   export FORWARD_GUARDIAN_SERVICE_ENTITY_ID=<SERVICE-id>
   export FORWARD_GUARDIAN_SCOPE_MAPPING_ID=<stable-scope-id>
   ```
3. From `deploy/dynatrace-guardian/`, run `monaco deploy --dry-run manifest.example.yaml`.
4. Review the rendered change and then run `monaco deploy manifest.example.yaml`.
5. Open **Site Reliability Guardian** in Dynatrace. Select **Forward change validation - `<application>` -
   `<environment>`**. Verify **Lifecycle guardian**, the six objectives, the two variables, and all scope tags.
6. Open **Workflows**. Select **Forward change validation**. Verify the event trigger uses **events**, requires
   `event.kind == "SDLC_EVENT"`, filters the exact scope mapping ID, and runs **Site Reliability Guardian** after a
   30-second **Wait before** delay. The delay allows the triggering OpenPipeline record to become queryable before the
   Forward-evidence objective runs.

The Forward-evidence objective sorts matching events newest-first, evaluates exactly the newest record, and passes only
when that record passed. This prevents an older passing event from masking a newer failed gate. A busy scope with
overlapping changes must use distinct mapping IDs or non-overlapping validation windows.

In **Workflows > Settings > Authorization**, grant the Workflow identity only the permissions required by the checked
package: `app-engine:apps:run`, `app-engine:functions:run`, `app-settings:objects:read`,
`openpipeline:events.sdlc:ingest`, `storage:buckets:read`, `storage:events:read`, `storage:spans:read`, and
`storage:logs:read`. The publishing identity separately needs SDLC event ingestion. Apply the tenant's normal
least-privilege and separation-of-duties controls.

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
3. Query back the Workflow execution and join its trigger context to the Guardian task result:

   ```bash
   node scripts/query-dynatrace-guardian-execution.mjs \
     --environment-url https://<environment-id>.apps.dynatrace.com/ \
     --token-file /secure/tokens/dynatrace-platform.token \
     --correlation-id GATE-RUN-001 \
     --expected-status pass \
     --output /secure/evidence/guardian-readback.json
   ```

   Confirm that `correlationId`, change/deployment IDs, network/snapshot IDs, Workflow execution ID, validation ID, and
   validation status are present in the sanitized artifact. The command polls for the terminal execution and never
   writes the token to the artifact.
4. In **Notebooks** or **Dashboards**, run
   `deploy/dynatrace-dql/forward-guardian-validation-latest.dql` and confirm `validation.result` matches the Workflow
   action. Treat `execution_context` on the result event as optional; correlation authority is the Workflow readback.
5. In the Forward app view, query the existing change-validation evidence by the same correlation ID and confirm the
   network and snapshot IDs match the retained gate artifact.

## Acceptance Runs

- Passing run: use a window with service spans, reviewed thresholds, and a passing Forward gate.
- Objective failure: use a bounded non-production window with a known failed request or temporarily tighten one
  reviewed static threshold; restore the reviewed value immediately afterward.
- Missing evidence: manually validate a reviewed test Guardian against a window with no matching Forward event or no
  instrumented server spans. `Forward validation evidence` or `Service telemetry present` must fail; missing data must
  not pass.
- Correlation failure: alter a context copy so a snapshot or service ID differs from the gate. The publisher must stop
  locally before any Dynatrace call.

Run the mechanical package check with:

```bash
npm run dynatrace:guardian:validate
```

Live customer acceptance remains open until the pass, deliberate failure, and missing-evidence cases are queried back
from the target tenant.
