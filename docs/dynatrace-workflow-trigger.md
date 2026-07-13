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

## Custom Workflow Action

The app registers `export-forward-package` as a Dynatrace custom Workflow action. Deploy the app, add **Export Forward
intent package** to a workflow, and set its `request` input to one checked payload or to an expression resolving to the
same object shape.

The action returns package ID/time, counts, exact manifest/check bytes, and boundary marker
`dynatrace-never-writes-forward`. It performs no Forward call or write. `npm run dynatrace:action:test` covers object
input, expression-resolved JSON text, artifact correlation, and blocked empty scope. `npm run build` verifies action and
widget bundling.

## Schedule Trigger

Use a schedule trigger for steady-state desired-state export. The workflow should:

1. Query or assemble critical production dependency rows.
2. Run the **Export Forward intent package** action with `syncMode=data-connector`.
3. Write `forward-dynatrace-manifest.json` and `forward-intent-checks.json` to the approved package handoff location.
4. Update only the `latest/` pointer after both artifacts are written.
5. Leave Forward writes to the Forward-side connector runtime.

## Problem Trigger

Use a problem trigger for impacted-service export. The workflow should:

1. Resolve impacted services and dependency rows from the problem context.
2. Run the **Export Forward intent package** action with only impacted rows.
3. Publish the same two package artifacts.
4. Mark low-confidence or incomplete rows as review-only or `needs-map`.
5. Let the Forward-side importer reconcile the package before any check creation.
6. Optionally hand the impacted dependency array and problem/service IDs to the Forward-controlled read-only evidence
   workflow in `docs/problem-network-evidence.md`. Dynatrace Workflow must not receive the Forward credential.

## On-Demand Trigger

Use on-demand export during trials or mapping review. The workflow should:

1. Query a small dependency set.
2. Run the **Export Forward intent package** action with `syncMode=manual-import`.
3. Publish package artifacts for manual Forward-side validation.
4. Keep low-confidence rows in review or `needs-map`.

## Guardrails

- Do not put Forward credentials in Dynatrace Workflow inputs, task options, logs, or app settings.
- Do not call Forward write APIs from Dynatrace.
- Keep package handoff read-only from the Forward-side runtime.
- Preserve manifest and package bytes together so the checksum remains valid.
- Use the status artifact from the Forward-side runtime for read-only Dynatrace display.
