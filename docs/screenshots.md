# Workflow Screenshots

These screenshots show the complete Forward Field Integration story: ServiceNow governs the change, Forward verifies
modeled-network intent, and Dynatrace supplies application context and the cross-domain evidence portal. Dynatrace
application mapping also becomes Forward-resolved intent package JSON for Forward-side reconciliation. Optional NQE
evidence remains a customer-approved add-on.

Regenerate them with:

```bash
npm run demo:capture
```

The capture harness builds the Dynatrace app, serves the built UI locally, answers app-function calls through the built
function modules, builds every assurance-portal row through the production event builders, and drives Chromium with
placeholder Forward/Dynatrace metadata. It does not contact a live Dynatrace, Forward, or ServiceNow tenant. The
capture fails if the overview contains a live-query error, omits a headline evidence domain, or clips the change table.

## Overview

![Forward Integration for Dynatrace overview](assets/screenshots/01-overview.jpg)

The overview is the explicitly labeled credential-free rehearsal: idempotent Forward reconciliation, safe/regressed
path evidence, ServiceNow change decisions, failure/recovery check-health, and security correlation are all populated
with checked synthetic records. Live Grail remains the production source.

## Host Resolution And Path Evidence

![Forward host resolution and path evidence](assets/screenshots/02-export-package-readiness.jpg)

This screen demonstrates the production preflight shape: resolve endpoint names through Forward host inventory, then
optionally run read-only path evidence from the same resolved values before intent-check import.

## Forward Package And Bulk Check API Sequence

![Forward-side API sequence](assets/screenshots/03-forward-side-api.jpg)

This screen demonstrates the iterative Forward workflow: validate, dry-run, reconcile, create missing checks, report
changed/stale drift, and publish sanitized status back to Dynatrace.

## Persistent Intent Check Payload

![Forward intent check payload](assets/screenshots/04-intent-check-payload.jpg)

The cropped preview makes the exact Forward `NewNetworkCheck[]` payload readable while the downloaded artifact retains
all 24 checks. It is generated only after both dependency endpoints resolve against Forward inventory.

## ServiceNow Change Assurance

![ServiceNow, Forward, and Dynatrace change assurance](assets/screenshots/05-servicenow-change-assurance.jpg)

This checked synthetic rehearsal renders the safe and regressed change scenarios through the same production gate,
ServiceNow evidence, and Dynatrace event builders used by the live workflow. The table preserves the exact change and
deployment IDs, evidence provenance, ServiceNow attachment checksum, Forward snapshot and reachability delta,
Dynatrace health, reconciliation drift, and decision reasons. Replace the rehearsal rows with authoritative readback
before presenting them as live customer evidence.
