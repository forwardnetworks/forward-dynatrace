# Artifact Schemas

These JSON Schemas define the public handoff artifacts used by the Forward Dynatrace field integration.

## Files

- `connector-config.schema.json`: Forward-side connector/importer non-secret configuration.
- `forward-package-manifest.schema.json`: package manifest emitted by the Dynatrace app export path.
- `forward-intent-checks.schema.json`: generated Forward `NewNetworkCheck[]` intent-check payload shape.
- `forward-ingest-status.schema.json`: sanitized Forward-side ingest status that can be shared back to Dynatrace.
- `forward-ingest-status-event.schema.json`: publish-safe Dynatrace event payload derived from ingest status.
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
