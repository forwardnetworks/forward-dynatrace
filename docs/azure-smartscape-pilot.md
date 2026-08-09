# Azure Smartscape Pilot

Use this runbook when the design-partner tenant already has Azure topology in Dynatrace and the corresponding Azure
cloud accounts in Forward. It replaces synthetic lab topology with a real Azure inventory for endpoint mapping. It
does **not** replace the observed network-flow evidence required to create Forward intent checks.

## Evidence Lanes

Keep the two lanes independent during setup and acceptance:

| Lane | Source | What it proves |
| --- | --- | --- |
| Azure inventory and relationships | Dynatrace `smartscapeNodes` and `smartscapeEdges`; Forward Azure cloud accounts | The same Azure resource population is visible in both products and can be mapped. |
| Application dependency | OneAgent network-flow events or distributed traces | A current source, destination, TCP/UDP protocol, and destination port were observed. |

Edges such as `runs_on`, `is_attached_to`, and `belongs_to` are configuration or placement relationships. Do not turn
them into application-flow intent checks. If current flow evidence is unavailable, finish the inventory mapping review
and record the end-to-end dependency test as blocked rather than supplying guessed ports or protocols.

## 1. Create The Azure-Only Forward Workspace

Create a child workspace from the main Forward network so the pilot cannot inherit or mutate the customer's existing
checks.

1. In the main network, create a workspace named for the Dynatrace Azure pilot.
2. Include only the reviewed Azure cloud accounts. Do not include devices, vCenters, or non-Azure cloud accounts.
3. Omit custom commands, NQE checks, predefined checks, and intent checks.
4. Use short sandbox retention for the pilot unless the customer approves a longer period.
5. Wait for the initial subset snapshot to reach `PROCESSED`.
6. Read back the workspace cloud-account list and snapshot device inventory. Require only the selected Azure sources,
   Azure device types, and Forward's optional built-in Internet service.
7. Confirm inherited existential and predefined check counts are zero.

Record the workspace network ID and current processed snapshot ID in the protected operator record. Do not put
customer IDs, resource names, subscription IDs, or raw API responses in this repository.

## 2. Review Native Azure Smartscape Data

In a Dynatrace Notebook, run the supplied mapping queries:

- `deploy/dynatrace-dql/azure-smartscape-inventory.dql`
- `deploy/dynatrace-dql/azure-smartscape-relationships.dql`

Review the returned Azure entity types, resource names/groups, regions, and relationship types. Compare aggregate
counts and representative approved resources with the Forward workspace. The products use different entity type and
identity conventions, so matching total counts is useful evidence but is not an identity join by itself.

For an engineering tenant without native Azure monitoring, a temporary replica may use Dynatrace's direct
`/platform/ingest/v1/smartscape.events` endpoint with the `openpipeline.events_smartscape` token scope. Use only
`CUSTOM_*` entity types, an approved tenant, and an approved minimum data set. Keep payloads below the documented
200-KB limit, query the custom nodes and edges back after ingest, and allow the unrefreshed test entities to expire.
This replica proves DQL and topology handling only; it is not customer Azure monitoring or observed application flow.

## 3. Configure Credential Vault

Create a dedicated, auditable Forward service identity and begin with Read Only access to the Azure workspace.

1. In **Credential Vault**, add a username/password credential.
2. When Forward issued an API token pair, store the token access key as **Username** and token secret as **Password**.
3. Set the credential scope to **AppEngine**.
4. Keep **Allow access without app context** off.
5. Restrict app access to the installed Forward app (`my.forward` for enterprise preview or
   `com.forward.dynatrace` for signed distribution) when the tenant selector supports it. Record a sandbox exception
   if the selector offers only all applications.
6. Record the `CREDENTIALS_VAULT-*` entity ID; never paste the secret into app settings, Workflow input, or chat.

The Forward service identity must be able to read the child workspace. The Credential Vault entry does not contain or
discover a Forward network ID.

## 4. Configure The Forward App

Under **Settings > Apps > Forward API connection**, create a connection with:

| Setting | Value |
| --- | --- |
| Connection name | Stable Azure pilot label |
| Forward API base URL | Exact HTTPS URL ending in `/api` |
| Network ID | Azure child workspace ID from step 1 |
| Credential Vault ID | Entity ID from step 3 |
| Forward access profile | `Read Only` |

Save the connection. The app intentionally does not expose the Vault secret or populate a network dropdown from it.

Do not paste a `smartscapeNodes` or `smartscapeEdges` query into **Dependency discovery profile**. The current profile
contract accepts only distributed traces or OneAgent network flows because intent checks require current address,
protocol, and port evidence.

For the Azure pilot, create a **OneAgent network flows** profile when `default_network_flows` contains the required
Azure application connections. Start from `deploy/dynatrace-dql/oneagent-network-flow-dependencies.dql`, narrow it to
the reviewed Azure/application scope, run it in a Notebook, and verify every canonical output field before saving.
Use distributed traces only when they are the authoritative source for those same endpoint fields.

## 5. Debug And Positive Controls

Use positive controls at each boundary instead of treating an empty screen as success:

1. **Forward workspace:** processed snapshot, selected Azure cloud accounts, nonzero Azure inventory, and zero inherited
   checks.
2. **Dynatrace topology:** both Azure Notebook queries return current rows; inspect representative node and edge types.
3. **Credential:** the Vault entity exists with AppEngine scope and the installed app is permitted.
4. **Connection:** the saved connection shows the exact workspace network ID and Read Only profile.
   On source version v0.13.5 or later, run **Apps > Forward > Test connection** and require all diagnostic checks to
   pass. Published v0.13.4 uses the first on-demand Read Only plan as this positive control.
5. **Discovery:** **Refresh live evidence** reports accepted/rejected counts and current evidence metadata. Merely saving
   a connection does not call Forward, so no Forward audit activity is expected until an app function or Workflow runs.
6. **Forward audit:** after a live refresh or Workflow plan, confirm the dedicated identity made the expected bounded
   read calls. Do not log credentials, authorization headers, raw dependency rows, or topology bodies.

If discovery returns zero, first run the exact profile DQL in a Notebook and check the selected time window. If rows
are rejected, review the app's bounded reason counts for missing endpoint, protocol, port, service identity, stale
evidence, or synthetic markers. Dynatrace platform/app-function execution logs are the runtime log source; Forward
audit records prove whether the call reached Forward.

## 6. Read-Only End-To-End Acceptance

1. Select the reviewed Azure-scoped dependency profile in **Apps > Forward** and refresh live evidence.
2. Require current, non-synthetic rows with source, destination, `tcp`/`udp`, destination port, and reviewed mapping
   state.
3. Run **Synchronize Forward intent checks** on demand with the Azure workspace connection,
   `operation: plan`, Read Only, and modeled-path preflight enabled.
4. After editing the request JSON, click **Use staged plan request** before saving and deploying the Workflow. The
   editor is a draft buffer; closing or deploying without staging leaves the previously active request in place.
5. Require the selected Forward snapshot to be `PROCESSED`; review resolved/unresolved hosts, reachable/failed paths,
   collisions, create/change/stale counts, and the plan digest.
6. Require zero Forward mutations. Retain only aggregate evidence and protected execution identifiers.
7. Run the optional async NQE acceptance separately when an approved query or execution key is available. NQE proves
   that surface; it does not substitute for dependency discovery or modeled path preflight.

Do not enable a schedule or Network Admin apply during this pilot. Production writes require the dedicated service
identity, approval ownership, mutation budgets, rollback policy, and a new approved plan.
