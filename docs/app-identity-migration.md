# App Identity Migration

Forward for Dynatrace uses one stable production identity and one deliberately separate sandbox identity.

| Use | App ID | Signing |
| --- | --- | --- |
| Production and non-production acceptance | `com.forward.dynatrace` | Signed archive required |
| Sandbox and local development | `my.forward` | Unsigned install allowed |

The display name is **Forward**. The product name in documentation and release notes is **Forward for Dynatrace**.
Repository, package, and runtime slugs remain `forward-dynatrace`.

## Retired Identities

The pre-production app IDs containing `forwardnetworks` or `field.integration` are retired. Dynatrace treats a changed
app ID as a different app, so an install under a retired ID does not upgrade in place to either canonical identity.
This is a one-time pre-production cutover, not a recurring version-upgrade procedure.

## Migration Procedure

1. Inventory Workflows, app settings, and handoff connections that reference the retired app ID.
2. Export customer-owned DQL and Workflow definitions without exporting secret values.
3. Disable schedules and problem triggers that invoke actions under the retired ID.
4. Uninstall the retired app from the sandbox.
5. Install `my.forward` for sandbox validation, or install a signed `com.forward.dynatrace` archive for a controlled
   non-production or production environment.
6. Regenerate Workflow templates from the reviewed DQL:

   ```bash
   npm run dynatrace:workflow:generate -- \
     --schedule-query /secure/queries/dependencies.dql \
     --problem-query /secure/queries/problem-dependencies.dql \
     --output-dir /secure/generated-workflows
   ```

7. Recreate the package-handoff connection in the Dynatrace credential store. Do not copy secret values into Git,
   Workflow JSON, or migration evidence.
8. Import the regenerated templates, select the new connection, and run an on-demand validation.
9. Confirm the generated template manifest and action references use the new app ID and contain no retired identity.
10. Remove disabled retired Workflows only after the new path passes package publication and status readback.

## Acceptance Evidence

Retain the new app ID, app version, archive checksum, signer verification, generated Workflow manifest checksum,
on-demand run ID, handoff receipt ID, and sanitized Forward reconciliation result. Do not retain connection secrets,
tenant URLs, dependency rows, hostnames, or path topology in the repository.
