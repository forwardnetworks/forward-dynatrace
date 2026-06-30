# RBAC Model

Use least privilege across the Dynatrace package publisher and Forward-side importer. Do not give one principal both
unreviewed package-generation authority and unrestricted Forward write authority.

## Roles

| Role | Allowed | Not allowed |
| --- | --- | --- |
| Dynatrace package viewer | View generated package status and sanitized Forward ingest status. | Export packages, change mappings, or access Forward credentials. |
| Dynatrace package publisher | Generate and publish `forward-dynatrace-manifest.json` and `forward-intent-checks.json`. | Store Forward credentials or call Forward write APIs. |
| Forward import reviewer | Run validate-only and dry-run, inspect create/changed/stale counts, approve apply. | Change Dynatrace mappings or bypass package validation. |
| Forward import applier | Run apply with create-missing-only policy after review. | Delete or update stale/changed checks without separate approval. |
| Signing key custodian | Rotate signing keys and publish trusted public key material. | Run Forward imports using private signing keys. |
| Runtime administrator | Configure scheduler, package URL, network ID, log shipping, metrics, and secret references. | Commit secrets or package artifacts to source control. |

## Separation Rules

- Dynatrace app roles must not have Forward write credentials.
- Forward importer credentials must live only in the Forward-side runtime secret store.
- Package signing private keys must not be present in the Forward import runtime.
- Changed and stale checks require review before any update or retirement workflow.
- Production apply requires a recorded package ID, run ID, and reviewer identity.

## Review Cadence

Review access at least quarterly and after any incident. Remove access for inactive users, stale service principals,
old signing keys, retired schedulers, and unused package handoff locations.
