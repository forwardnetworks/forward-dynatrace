# RBAC Model

Use least privilege across the Dynatrace package publisher and Forward-side importer. Do not give one principal both
unreviewed package-generation authority and unrestricted Forward write authority.

## Roles

| Role | Allowed | Not allowed |
| --- | --- | --- |
| Dynatrace package viewer | View generated package status and sanitized Forward ingest status. | Export packages, change mappings, or access Forward credentials. |
| Dynatrace package publisher | Generate and publish `forward-dynatrace-manifest.json` and `forward-intent-checks.json`. | Store Forward credentials or call Forward write APIs. |
| Optional Forward NQE preview runner | Run approved read-only NQE preview requests with `NetworkOperation.USE_NQE`. | Hold `NetworkOperation.EDIT_CHECKS`, commit NQE Library content, or run unapproved query IDs/templates. |
| Forward import reviewer | Run validate-only and dry-run, inspect create/changed/stale counts, approve apply. | Change Dynatrace mappings or bypass package validation. |
| Forward import applier | Run apply with create-missing-only policy after review. | Delete or update stale/changed checks without separate approval. |
| Forward mutation approver | Approve exact changed/stale `dynatrace-key:*` values, change window, and mutation budgets. | Generate packages, hold signing private keys, or run unreviewed imports. |
| Signing key custodian | Rotate signing keys and publish trusted public key material. | Run Forward imports using private signing keys. |
| Runtime administrator | Configure scheduler, package URL, network ID, log shipping, metrics, and secret references. | Commit secrets or package artifacts to source control. |

## Separation Rules

- Dynatrace app roles must not have Forward write credentials.
- Optional NQE preview execution must use a dedicated Forward principal with `NetworkOperation.USE_NQE` and without
  `NetworkOperation.EDIT_CHECKS`.
- If a built-in Forward read-only role grants broader NQE Library rights, restrict NQE Library directory access or run
  the preview through a Forward-side proxy instead of giving Dynatrace-hosted execution broader authority.
- Forward importer credentials must live only in the Forward-side runtime secret store.
- Package signing private keys must not be present in the Forward import runtime.
- Changed and stale checks require a signed package and exact approval artifact before update or retirement automation.
- Production apply requires a recorded package ID, run ID, and reviewer identity.

## Review Cadence

Review access at least quarterly and after any incident. Remove access for inactive users, stale service principals,
old signing keys, retired schedulers, and unused package handoff locations.
