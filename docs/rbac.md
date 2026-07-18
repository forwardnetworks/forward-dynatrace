# RBAC Model

Use least privilege across the Dynatrace package publisher and Forward-side importer. Do not give one principal both
unreviewed package-generation authority and unrestricted Forward write authority.

## Roles

### Forward Credential Profiles

| Forward profile | Integration capabilities | Intent-check behavior |
| --- | --- | --- |
| Read Only | Read modeled data and paths; execute committed Forward Library NQE queries by approved query ID. | Package, validate, reconcile, and report only. No intent-check writes. |
| Network Operator | Read Only capabilities plus arbitrary NQE execution from the Forward-controlled runtime. | Package, validate, reconcile, and report only. No intent-check writes. |
| Network Admin | Network Operator capabilities plus intent-check mutation. | Create missing managed checks; replace changed managed checks only with the configured exact-approval controls. |

`forwardAccessProfile` is required in package and connector contracts. The package request and runtime configuration
must match. A more privileged credential does not silently upgrade a Read Only or Network Operator package. Stale-check
retirement remains a separate approval-gated deletion policy and is not implied by Network Admin.

## Integration Roles

| Role | Allowed | Not allowed |
| --- | --- | --- |
| Dynatrace package viewer | View generated package status and sanitized Forward ingest status. | Export packages, change mappings, or access Forward credentials. |
| Dynatrace package publisher | Generate and publish `forward-dynatrace-manifest.json` and `forward-intent-checks.json`. | Store Forward credentials or call Forward write APIs. |
| Forward NQE preview runner | Under Read Only, run approved Library query IDs; under Network Operator, run approved arbitrary NQE requests. | Exceed the configured Forward access profile or bypass query-ID/template policy. |
| Forward import reviewer | Run validate-only and dry-run, inspect create/changed/stale counts, approve apply. | Change Dynatrace mappings or bypass package validation. |
| Forward import applier | Run apply with create-missing-only policy after review. | Delete or update stale/changed checks without separate approval. |
| Forward mutation approver | Approve exact changed/stale `source-key:sha256:*` values, change window, and mutation budgets. | Generate packages, hold signing private keys, or run unreviewed imports. |
| Signing key custodian | Rotate signing keys and publish trusted public key material. | Run Forward imports using private signing keys. |
| Runtime administrator | Configure scheduler, package URL, network ID, log shipping, metrics, and secret references. | Commit secrets or package artifacts to source control. |

## Separation Rules

- Dynatrace app roles must not have Forward write credentials.
- Read Only NQE execution requires a Forward-owned Library query ID and Forward-side allowlist.
- Arbitrary NQE execution requires Network Operator or Network Admin and still runs only from the Forward-side runtime.
- Intent-check creation or replacement requires Network Admin. The Dynatrace app cannot use that credential.
- Forward importer credentials must live only in the Forward-side runtime secret store.
- Package signing private keys must not be present in the Forward import runtime.
- Changed and stale checks require a signed package and exact approval artifact before update or retirement automation.
- Production apply requires a recorded package ID, run ID, and reviewer identity.

## Review Cadence

Review access at least quarterly and after any incident. Remove access for inactive users, stale service principals,
old signing keys, retired schedulers, and unused package handoff locations.
