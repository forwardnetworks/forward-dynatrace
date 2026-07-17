# Dynatrace Workflow Trigger

Dynatrace Workflow can generate the Forward intent package on a schedule or from an impacted-service problem workflow.
The workflow should call the app function that produces the package artifacts; it must not call Forward directly.

The separate lifecycle Guardian workflow consumes sanitized Forward change-validation SDLC events and evaluates
Dynatrace-owned service objectives. See [Site Reliability Guardian](site-reliability-guardian.md). It does not replace
the dependency-package workflows on this page.

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

## Generate Importable Workflow Templates

The checked generator turns customer-owned schedule and problem DQL into complete environment-agnostic Workflow
templates. Both queries must explicitly project the normalized dependency fields used by the export action; the
problem query must bind the triggering event with `event()`. The generator performs no tenant call and writes no
credential or connection ID.

```bash
npm run dynatrace:workflow:generate -- \
  --schedule-query /secure/queries/customer-dependencies.dql \
  --problem-query /secure/queries/customer-problem-dependencies.dql \
  --output-dir /secure/generated-workflows
```

The output contains on-demand, 15-minute schedule, and Davis problem templates plus
`forward-workflow-templates.manifest.json` with the exact app version and SHA-256 of each template. After installing
the matching app release, open Dynatrace **Workflows**, choose **Upload**, select one generated template, verify the
required app, and map the required `forward-package-handoff-connection` in the import wizard. Run the on-demand
template first and retain its checksum-bound handoff receipt. Deploy the schedule or problem workflow only after the
same query and connection produce the expected immutable package bytes.

`npm run dynatrace:workflow:generate:test` checks the current Dynatrace template shape, deterministic checksums,
connection indirection, normalized projection guard, and problem-event binding.

## Custom Workflow Action

The app registers `export-forward-package` as a Dynatrace custom Workflow action. Deploy the app, add **Export Forward
intent package** to a workflow, and set its `request` input to one checked payload or to an expression resolving to the
same object shape.

Select a `forward-package-handoff-connection` settings object containing the customer HTTPS publish URL, dedicated
write token, and retention class. The action publishes the exact checksummed manifest/check bytes before it returns a
receipt containing package ID, immutable/latest URLs, manifest checksum, access-log ID, and retention class. It
performs no Forward call or write. `npm run dynatrace:action:test` covers connection validation, byte correlation,
receipt validation, bounded failures, and blocked empty scope. `npm run build` verifies action and widget bundling.

## Schedule Trigger

Use a schedule trigger for steady-state desired-state export. The workflow should:

1. Query or assemble critical production dependency rows.
2. Run the **Export Forward intent package** action with `syncMode=data-connector`.
3. Require the action's checksum-bound handoff receipt; task output alone is not publication evidence.
4. Leave Forward writes to the Forward-side connector runtime.

## Problem Trigger

Use a problem trigger for impacted-service export. The workflow should:

1. Resolve impacted services and dependency rows from the problem context.
2. Run the **Export Forward intent package** action with only impacted rows.
3. Require the same checksum-bound handoff receipt.
4. Mark low-confidence or incomplete rows as review-only or `needs-map`.
5. Let the Forward-side importer reconcile the package before any check creation.
6. Optionally hand the impacted dependency array and problem/service IDs to the Forward-controlled read-only evidence
   workflow in `docs/problem-network-evidence.md`. Dynatrace Workflow must not receive the Forward credential.

## On-Demand Trigger

Use on-demand export during trials or mapping review. The workflow should:

1. Query a small dependency set.
2. Run the **Export Forward intent package** action with `syncMode=manual-import`.
3. Require the package handoff receipt for manual Forward-side validation.
4. Keep low-confidence rows in review or `needs-map`.

## Guardrails

- Do not put Forward credentials in Dynatrace Workflow inputs, task options, logs, or app settings.
- Do not call Forward write APIs from Dynatrace.
- Keep package handoff read-only from the Forward-side runtime.
- Preserve manifest and package bytes together so the checksum remains valid.
- Use the status artifact from the Forward-side runtime for read-only Dynatrace display.
