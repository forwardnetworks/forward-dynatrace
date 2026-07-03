# Workflow Screenshots

These screenshots show the Forward Field Integration workflow: Dynatrace application mapping becomes Forward intent
package JSON for Forward-side reconciliation. Optional read-only NQE preview and optional query-ID artifacts are shown
as optional paths; the base workflow remains intent-check package export plus Forward-side import.

## Overview

![Forward Dynatrace overview](assets/screenshots/01-overview.jpg)

## Read-Only NQE Preview

![Forward read-only NQE preview](assets/screenshots/02-export-package-readiness.jpg)

This screen demonstrates the optional read-only NQE planning path. It should not be presented as a required step for
bulk intent-check import.

## Forward Package And Bulk Check API Sequence

![Forward-side API sequence](assets/screenshots/03-forward-side-api.jpg)

This screen demonstrates the iterative Forward workflow: validate, dry-run, reconcile, create missing checks, report
changed/stale drift, and publish sanitized status back to Dynatrace.

## Persistent Intent Check Payload

![Forward intent check payload](assets/screenshots/04-intent-check-payload.jpg)
