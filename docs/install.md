# Installation

Forward for Dynatrace is delivered as one Dynatrace app archive. Forward is accessed through HTTPS APIs; this
integration does not require a Forward-side service, connector, container, agent, or package.

## Prerequisites

- Dynatrace SaaS with AppEngine and Workflow enabled.
- Permission to install custom apps and manage app settings.
- Tenant approval for the Forward API hostname under **Settings > General > External requests**. Use EdgeConnect only
  when the Forward API is reachable exclusively through a private network.
- A dedicated Forward service identity and a network with a processed snapshot.
- An OAuth client with `app-engine:apps:install` and `app-engine:apps:run`; add `app-engine:apps:delete` only when
  uninstall automation is required.
- Node.js 24 for the supplied verification and installation tooling.

The app scopes declared in `app.config.json` cover approved spans, entities, events, and app settings. Deployment OAuth
is separate from the Forward service identity and is used only by the AppEngine Registry.

## Download And Verify

Download the app archive and all verification evidence from the same release:

```bash
export RELEASE_TAG=v0.11.0
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
2. Create a reviewed **Dependency discovery profile**. Its DQL must begin with `fetch spans` and return the canonical
   current-evidence fields in [dependency discovery](dependency-discovery.md).
3. In Workflow, add **Synchronize Forward intent checks**.
4. Create a **Forward API connection** with the HTTPS `/api` URL, exact network ID, dedicated username, secret
   password, declared access profile, and optional allowlisted Forward Library query IDs.
5. Begin with `operation: plan` and Read Only.
6. Enable Network Admin apply only after approval ownership, mutation budgets, and post-change closeout are defined.

The browser and Workflow result never receive the Forward credential.

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
4. Reopen both settings schemas and confirm the discovery profile, connection metadata, and masked secret remain valid.
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
