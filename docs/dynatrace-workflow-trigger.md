# Dynatrace Workflow Trigger

Dynatrace Workflow can generate the Forward intent package on a schedule or from an impacted-service problem workflow.
The workflow should call the app function that produces the package artifacts; it must not call Forward directly.

Example payloads live in:

- `deploy/dynatrace-workflows/forward-sync-schedule.payload.example.json`
- `deploy/dynatrace-workflows/forward-sync-problem.payload.example.json`
- `deploy/dynatrace-workflows/forward-sync-on-demand.payload.example.json`

The DQL starter query for dependency candidates lives at:

- `deploy/dynatrace-dql/service-dependency-candidates-openpipeline-events.dql`

Validate the examples with:

```bash
npm run dynatrace:workflow:validate
```

## Schedule Trigger

Use a schedule trigger for steady-state desired-state export. The workflow should:

1. Query or assemble critical production dependency rows.
2. Call the Forward sync app function with `syncMode=data-connector`.
3. Write `forward-dynatrace-manifest.json` and `forward-intent-checks.json` to the approved package handoff location.
4. Update only the `latest/` pointer after both artifacts are written.
5. Leave Forward writes to the Forward-side connector runtime.

## Problem Trigger

Use a problem trigger for impacted-service export. The workflow should:

1. Resolve impacted services and dependency rows from the problem context.
2. Call the Forward sync app function with only impacted rows.
3. Publish the same two package artifacts.
4. Mark low-confidence or incomplete rows as review-only or `needs-map`.
5. Let the Forward-side importer reconcile the package before any check creation.

## On-Demand Trigger

Use on-demand export during trials or mapping review. The workflow should:

1. Query a small dependency set.
2. Call the Forward sync app function with `syncMode=manual-import`.
3. Publish package artifacts for manual Forward-side validation.
4. Keep low-confidence rows in review or `needs-map`.

## Guardrails

- Do not put Forward credentials in Dynatrace Workflow inputs, task options, logs, or app settings.
- Do not call Forward write APIs from Dynatrace.
- Keep package handoff read-only from the Forward-side runtime.
- Preserve manifest and package bytes together so the checksum remains valid.
- Use the status artifact from the Forward-side runtime for read-only Dynatrace display.
