# ServiceNow Scope Mapping

The change-assurance Flow sends ServiceNow affected CI/service references, not operator-entered Dynatrace entity IDs
or Forward network IDs. The Forward-side worker resolves those references from a customer-owned mapping before it
reads any external system.

## Contract

`schemas/servicenow-scope-mapping.schema.json` defines
`forward-dynatrace-servicenow-scope-mapping/v1`. Each mapping binds one ServiceNow `{table, sysId}` record to:

- one or more Dynatrace service entity IDs;
- one Forward network through the mapping's exact environment boundary;
- at least one reviewed Forward-resolvable `HostFilter`, `SubnetLocationFilter`, or `DeviceFilter` value for every
  mapped service;
- confidence, owner, observation time, and expiry time.

The worker rejects the entire start request when a requested record is missing, duplicated, ambiguous, disabled,
below the configured confidence floor, stale, not yet valid, or associated with another environment. It never guesses
from display names, CI labels, IP overlaps, or a similarly named environment.

After Dynatrace dependency scoping, every selected dependency must contain an exact source or destination
`locationType:value` pair from the reviewed binding for its service entity. An unexpected endpoint is treated as
identity drift and blocks baseline capture before Forward host resolution.

Validate and exercise a mapping without credentials or API calls:

```bash
npm run schemas:validate -- \
  --servicenow-scope-mapping /secure/config/servicenow-scope-mapping.json

npm run servicenow:scope:resolve -- \
  --mapping /secure/config/servicenow-scope-mapping.json \
  --environment-id customer-nonproduction \
  --source-record cmdb_ci_service:0123456789abcdef0123456789abcdef \
  --as-of 2026-07-15T18:30:00.000Z \
  --output /secure/evidence/servicenow-scope-resolution.json
```

The resolution is deterministic for the same mapping bytes, affected records, environment, and `as-of` time. It
records the mapping SHA-256 and bounded ownership/validity metadata. The worker retains full endpoint bindings only in
its protected evidence directory. ServiceNow status responses and Dynatrace events receive mapping identity and counts,
not endpoint topology.

## Operating Rules

1. Store the customer mapping outside Flow inputs and outside public artifacts; mount it read-only into the worker.
2. Use a stable `environmentId` per ServiceNow, Dynatrace, and Forward non-production tuple. Never reuse one mapping
   across production and non-production.
3. Require a named owner to review CMDB or Dynatrace identity changes, increment `mappingId`, and refresh observation
   and expiry timestamps.
4. Keep `minimumConfidence` at the customer's approved enforcement threshold. Low confidence is a blocked mapping,
   not a warning that can silently select scope.
5. Test the exact affected records before the change window and retain the schema-valid resolution with acceptance
   evidence.

`config/servicenow-scope-mapping.example.json` is a reviewed fixed showcase shape only. It uses placeholder records,
environments, and endpoints and must never be described as automatic CMDB correlation or installed unchanged for a
customer.
