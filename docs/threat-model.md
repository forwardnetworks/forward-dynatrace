# Threat Model

This model covers the Forward Field Integration reference trust boundary.

## Assets

- Forward credentials in the Forward-side runtime.
- Forward network and snapshot IDs.
- Export package: manifest plus `NewNetworkCheck[]`.
- Dynatrace application dependency evidence.
- Import reports and runtime logs.

## Trust Boundaries

| Boundary | Trust Rule |
| --- | --- |
| Dynatrace app to package handoff | Export only. No Forward credentials or writes. |
| Package handoff to Forward-side runtime | Manifest checksum must match check payload bytes. |
| Package publisher to Forward-side runtime | Detached Ed25519 signature verifies when provenance is required. |
| Forward-side runtime to Forward API | Credentials live only in the runtime secret store. |
| Logs and reports | No secrets; keep package/run correlation IDs. |
| GitHub repo | No tenant IDs, customer names, tokens, credentials, or local paths. |

## Threats And Controls

| Threat | Control |
| --- | --- |
| Tampered check package | Manifest `integrity.intentChecksSha256` required and verified before Forward API calls. |
| Package source spoofing | Optional detached Ed25519 signature verification with trusted public key. |
| Stale package replay | Manifest age limit defaults to 1440 minutes and can be lowered in connector config. |
| Credential leak through Dynatrace | Dynatrace app never accepts Forward credentials; importer requires runtime env secrets. |
| Credential leak through config | Connector config validator rejects user/password/token fields. |
| Customer data leak through repo | Repo validation blocks tokens, tenant URLs, local paths, emails, and legacy unsafe paths. |
| Duplicate or conflicting checks | Importer rejects duplicate names and duplicate `dynatrace-key:*` tags. |
| Wrong check update | Default policy creates missing checks only; changed and stale checks are report-only. |
| Bulk API partial failure | Import report keeps counts and planned creates; rerun dry-run before retrying apply. |
| Excessive API retry pressure | Bounded retry budget and configurable batch size. |

## Residual Risks

- Package handoff storage is not implemented in this repo; operators must choose an access-logged, restricted location.
- The Forward-side runtime is not packaged as a managed service; scheduler ownership must be assigned per deployment.
- Update and stale-check retirement workflows need explicit Forward approval before automation.
- Branch protection and release signing must be configured in GitHub org settings outside this repository.
