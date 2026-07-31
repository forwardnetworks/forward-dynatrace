# App Identities

Forward for Dynatrace has two installation identities. Both implement the same sole `v1` contract.

| Use | App ID | Signing |
| --- | --- | --- |
| Enterprise preview and sandbox | `my.forward` | Tenant-validated unsigned custom app |
| Signed Dynatrace distribution | `com.forward.dynatrace` | Approved Dynatrace signing and distribution path |

The display name is **Forward**. Documentation and release notes use **Forward for Dynatrace**. Repository, package,
and runtime slugs remain `forward-dynatrace`.

## Reset Rule

Install this release as a clean application deployment. There is no alternate contract, identity migration, or
compatibility mode. Before installation, remove any experimental app installation and regenerate Workflows from this
release. Do not copy settings or generated artifacts from an experimental build.

## Clean Installation

1. Disable experimental schedules and problem triggers.
2. Uninstall the experimental app.
3. Install this enterprise-preview workflow in an isolated sandbox with `my.forward`, or install the signed
   `com.forward.dynatrace` archive in a controlled production-compatible pathway.
4. Generate Workflow templates from reviewed DQL:

   ```bash
   npm run dynatrace:workflow:generate -- \
     --schedule-query /secure/queries/dependencies.dql \
     --problem-query /secure/queries/problem-dependencies.dql \
     --output-dir /secure/generated-workflows
   ```

5. Create the Forward username/password in an APP_ENGINE-scoped Dynatrace Credential Vault entry, then create a
   `forward-api-connection` that stores only its `CREDENTIALS_VAULT-*` entity ID. Never place secret values in app
   settings, Git, or Workflow JSON.
6. Import the generated templates, select the new connection, and run an on-demand plan.
7. Verify the plan digest, target snapshot, reconciliation counts, and sanitized status before enabling a schedule or
   problem trigger. Enable apply only with a dedicated Network Admin connection and the documented approval gate.

## Acceptance Evidence

Retain the app ID, app version, archive checksum, signer verification, generated Workflow manifest checksum,
on-demand run ID, immutable plan digest, target snapshot ID, and sanitized Forward reconciliation result. Do not
retain connection secrets, tenant URLs, dependency rows, hostnames, or path topology in this repository.
