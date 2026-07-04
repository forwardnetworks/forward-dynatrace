# Workflow Screenshots

These screenshots show the Forward Field Integration workflow: Dynatrace application mapping becomes Forward-resolved
intent package JSON for Forward-side reconciliation. Forward-side host resolution happens before package generation,
optional read-only path evidence can run before approval, and optional NQE evidence remains a customer-approved add-on.

Regenerate them with:

```bash
npm run demo:capture
```

The capture harness builds the Dynatrace app, serves the built UI locally, answers app-function calls through the built
function modules, and drives Chromium with placeholder Forward/Dynatrace metadata. It does not contact a live Dynatrace
or Forward tenant.

## Overview

![Forward Integration for Dynatrace overview](assets/screenshots/01-overview.jpg)

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
