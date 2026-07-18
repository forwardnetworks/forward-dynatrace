# Threat Model

This model covers the Forward for Dynatrace trust boundary.

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
| Customer data leak through repo | Repo validation blocks tokens, tenant URLs, local paths, emails, and retired unsafe paths. |
| Duplicate or conflicting checks | Importer rejects incomplete or duplicate ownership tuples and refuses name-based adoption. |
| Unapproved NQE query execution | Optional NQE artifacts require committed Forward query IDs in the runtime allowlist. |
| Wrong check update | Default policy creates missing checks only; optional update/stale automation requires signed package verification, exact approval, and mutation budgets. |
| Bulk API partial failure | Import report keeps counts and planned creates; rerun dry-run before retrying apply. |
| Excessive API retry pressure | Bounded retry budget and configurable batch size. |

## Residual Risks

- Filesystem handoff publication is implemented and tested; operators must still choose and operate the access-logged,
  restricted storage/HTTPS layer.
- Connector and check-health scheduler templates are provided; runtime ownership, monitoring, and
  patching remain customer responsibilities.
- Update and stale-check automation needs customer-owned approval and runtime ownership before production use.
- Branch protection and release signing must be configured in GitHub org settings outside this repository.
