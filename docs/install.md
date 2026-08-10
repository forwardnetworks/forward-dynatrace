# Installation

Forward for Dynatrace is delivered as one Dynatrace app archive. Forward is accessed through HTTPS APIs; this
integration does not require a Forward-side service, connector, container, agent, or package.

## Prerequisites

- Dynatrace SaaS with AppEngine and Workflow enabled.
- Permission to install custom apps, manage app settings, and create or share APP_ENGINE-scoped Credential Vault entries.
- Tenant approval for the Forward API hostname under **Settings > General > External requests**. Use EdgeConnect only
  when the Forward API is reachable exclusively through a private network.
- A dedicated, auditable Forward service identity and a network with a processed snapshot. Use Read Only for initial acceptance.
- For non-instrumented discovery, OneAgent 1.337 or later with network connection monitoring enabled and current
  `default_network_flows` events in Grail.
- An OAuth client with `app-engine:apps:install` and `app-engine:apps:run`; add `app-engine:apps:delete` only when
  uninstall automation is required.
- Node.js 24 for the supplied verification and installation tooling.

The app scopes declared in `app.config.json` cover approved spans, network-flow events, app settings, and read access
to the selected Credential Vault entry. Deployment OAuth
is separate from the Forward service identity and is used only by the AppEngine Registry.

## Download And Verify

Download the app archive and all verification evidence from the same release:

```bash
export RELEASE_TAG=v0.13.4
mkdir -p "/secure/forward-dynatrace/${RELEASE_TAG}"
cd "/secure/forward-dynatrace/${RELEASE_TAG}"

gh release download "${RELEASE_TAG}" \
  --repo forwardnetworks/forward-dynatrace
sha256sum -c SHA256SUMS
gh attestation verify "forward-dynatrace-app-${RELEASE_TAG}.zip" \
  --repo forwardnetworks/forward-dynatrace
gh attestation verify "forward-dynatrace-sbom-${RELEASE_TAG}.cdx.json" \
  --repo forwardnetworks/forward-dynatrace
```

Verify `SHA256SUMS.sig` before trusting the checksum file when signature files are present. See
[release provenance](release-provenance.md).

## Install The Exact Archive

Use the installer from the same immutable tag:

```bash
git clone https://github.com/forwardnetworks/forward-dynatrace.git
cd forward-dynatrace
git checkout "${RELEASE_TAG}"
npm ci

export DT_APP_OAUTH_CLIENT_ID=<protected-client-id>
export DT_APP_OAUTH_CLIENT_SECRET=<protected-client-secret>

npm run dynatrace:release:install -- \
  --environment-url https://<environment-id>.apps.dynatrace.com/ \
  --archive "/secure/forward-dynatrace/${RELEASE_TAG}/forward-dynatrace-app-${RELEASE_TAG}.zip" \
  --checksums "/secure/forward-dynatrace/${RELEASE_TAG}/SHA256SUMS"
```

The installer verifies the archive checksum, manifest identity, required app functions, settings schemas, and Workflow
actions before upload. It polls the registry until the exact version is ready. OAuth credentials and access tokens are
never command-line arguments or output fields.

## Application Identity

| Channel | App ID | Requirement |
| --- | --- | --- |
| Enterprise preview | `my.forward` | Tenant-validated unsigned custom app |
| Signed distribution | `com.forward.dynatrace` | Approved Dynatrace signing and distribution path |

The preview and signed channels implement the same product contract. Promotion to the reserved identity does not
change the Forward API architecture or access model. See [application identities](app-identities.md).

## Configure Forward Access

1. Approve only the exact Forward API hostname in Dynatrace external requests.
2. Create the dedicated Forward service identity. Name it so Forward audit records identify this integration rather
   than a person, and grant Read Only for initial acceptance.
3. In Dynatrace Credential Vault, create a username/password entry for that identity with **AppEngine** scope. Record
   its `CREDENTIALS_VAULT-*` entity ID, keep **Allow access without app context** off, and keep owner-only user access
   unless additional Workflow actors are explicitly approved. Restrict **Dynatrace apps with access** to the exact
   installed app when the tenant selector offers `my.forward` or `com.forward.dynatrace`. If an enterprise-preview
   custom app is not offered, retain **All applications** only as a recorded sandbox exception; do not leave an
   empty app list or move the credential outside AppEngine scope.
4. Create a reviewed **Dependency discovery profile**. Choose **Distributed traces** or **OneAgent network flows**, then
   use the matching template and canonical fields in [dependency discovery](dependency-discovery.md).
5. In Workflow, add **Synchronize Forward intent checks**.
6. Create a **Forward API connection** with the normal HTTPS Forward tenant URL, exact network ID, Credential Vault
   entity ID, declared access profile, and optional allowlisted Forward Library query IDs. The app adds `/api`
   internally; existing saved `/api` values remain supported.
7. Begin with `operation: plan` and Read Only.
8. Enable Network Admin apply only after approval ownership, mutation budgets, and post-change closeout are defined.

Source version v0.13.5 adds **Forward Connection Diagnostic** to **Apps > Forward**. Select the saved connection and
run **Test connection** to verify Vault resolution, verified HTTPS, authentication, network access, a processed
snapshot, and Read Only pilot posture using GET requests only. Published v0.13.4 uses the first on-demand Read Only
plan as the equivalent connection positive control.

The app settings object, browser, and Workflow result never receive the Forward username or password. See Dynatrace's
[Credential Vault guidance](https://developer.dynatrace.com/develop/guides/security/manage-secrets/).

### On-Premises And Lab Forward APIs

The v0.13.x connection schema stores an exact Forward network ID as operator-reviewed text. A Credential Vault entry
contains the Forward secret, not a network inventory, and the declarative settings form cannot populate a dynamic
network dropdown from that secret. Confirm the network ID in Forward before saving the connection. A future custom
configuration UI could resolve the Vault entry in an app function, list accessible networks through the Forward API,
return only sanitized network labels and IDs, and then save the selected ID; the browser must never receive the
credential.

Forward URLs must use HTTPS and contain no path; the app normalizes the tenant origin to its `/api` root. Legacy saved
values that already end in `/api` remain valid. Certificate verification cannot be disabled per connection. The app does not
support `http:`, a `verifyTls: false` setting, `NODE_TLS_REJECT_UNAUTHORIZED`, or a browser-supplied CA bundle. A direct
endpoint must present a certificate chain trusted by the Dynatrace runtime. When the Forward API is private or uses an
internal CA, route it through EdgeConnect and configure the CA certificate in EdgeConnect's `certificate_paths`; TLS
verification remains enabled. Follow Dynatrace's
[EdgeConnect custom TLS certificate guidance](https://docs.dynatrace.com/docs/ingest-from/edgeconnect#custom-tls-certificates).

For a lab, issue the Forward endpoint certificate from a lab CA, include the API hostname in the certificate SAN, and
mount that CA into EdgeConnect. A self-signed or hostname-mismatched endpoint without the required trust configuration
is unsupported and fails closed. Do not weaken certificate verification to make a lab connection succeed.

## Development Deployment

Source deployment is for engineering validation only and is not a substitute for an immutable release archive:

```bash
npm run dynatrace:deploy -- \
  --environment-url https://<environment-id>.apps.dynatrace.com/ \
  --app-id my.forward \
  --no-open \
  --non-interactive
```

## Upgrade

1. Download and verify the new immutable release into a new evidence directory.
2. Run the release installer from the matching tag with the new archive and checksum file.
3. Confirm the registry reports the exact version as ready.
4. Reopen both settings schemas and confirm the discovery profile, connection metadata, and Credential Vault reference remain valid.
5. Run a Read Only plan before re-enabling scheduled or write-enabled workflows.

## Uninstall

```bash
npm run dynatrace:uninstall -- \
  --environment-url https://<environment-id>.apps.dynatrace.com/ \
  --app-id my.forward \
  --no-open \
  --non-interactive
```

Uninstall removes the Dynatrace app and its settings schemas. It does not delete Forward intent checks. Disable
workflows first and rotate or remove the Forward service identity separately according to organizational policy.
