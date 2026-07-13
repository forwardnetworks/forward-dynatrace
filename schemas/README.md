# Artifact Schemas

These JSON Schemas define the public handoff artifacts used by the Forward Dynatrace field integration.

## Files

- `connector-config.schema.json`: Forward-side connector/importer non-secret configuration.
- `forward-package-manifest.schema.json`: package manifest emitted by the Dynatrace app export path.
- `forward-intent-checks.schema.json`: generated Forward `NewNetworkCheck[]` intent-check payload shape.
- `forward-ingest-status.schema.json`: sanitized Forward-side ingest status that can be shared back to Dynatrace.
- `forward-ingest-status-event.schema.json`: publish-safe Dynatrace event payload derived from ingest status, with
  paired optional evidence source and synthetic classification.
- `forward-network-evidence-event.schema.json`: publish-safe aggregate Forward path evidence correlated to a Dynatrace problem.
- `forward-change-context.schema.json`: Dynatrace deployment and service-health input for change validation.
- `forward-change-validation-gate.schema.json`: deterministic aggregate Forward and Dynatrace change-gate decision.
- `forward-change-validation-event.schema.json`: publish-safe change decision with optional ServiceNow receipt linkage
  and explicit live/synthetic provenance.
- `servicenow-change-preflight.schema.json`: authoritative, sanitized ServiceNow approval/state/window preflight.
- `servicenow-change-assurance-evidence.schema.json`: checksummed ServiceNow attachment binding preflight, aggregate gate, and lineage.
- `servicenow-change-feedback.schema.json`: dry-run or applied ServiceNow work-note and attachment receipt.
- `servicenow-change-assurance.schema.json`: final conductor summary and publication handoff state.
- `servicenow-change-workflow.schema.json`: v2 resumable baseline/completion state with explicit cross-domain provenance,
  artifact hashes, and snapshot lineage.
- `servicenow-change-assurance.schema.json`: v2 finalization summary with the same explicit source and synthetic flag.
- `servicenow-flow-run.schema.json`: bounded start/status/complete response from the purchase-free Flow worker.
- `forward-check-health-transitions.schema.json`: sanitized, bounded managed-check transition batch.
- `forward-security-correlation.schema.json`: read-only ranked investigation queue with separate evidence facts and
  explicit source/synthetic provenance.
- `forward-security-correlation-event-batch.schema.json`: bounded publish-safe Dynatrace security event batch.
- `forward-approval.schema.json`: optional exact-key approval artifact for changed or stale check mutation.

The schemas are package-boundary contracts. They do not replace the stricter runtime validators in the Forward-side
importer, which still enforce package age, checksums, signatures, query ID allowlists, mutation budgets, and Forward API
reconciliation behavior.

## Validate

```bash
npm run schemas:validate
```

The validator compiles every schema, validates committed examples, builds a demo package, and validates the generated
manifest, intent checks, status artifact, and Dynatrace status event.
