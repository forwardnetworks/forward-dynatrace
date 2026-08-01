# Schema Versioning

The product is pre-1.0 while wire payloads use explicit `/v1` schema identifiers. A wire schema version is not a claim
of product maturity.

The current app supports one contract line only. It does not ship an obsolete-runtime compatibility layer. A future
breaking payload change must add a new schema ID, validators, migration decision, tests, and release note before use.

App settings schema versions are immutable after registration. Adding, removing, or structurally changing a property
requires a new semantic version; an additive optional property stays on the current major contract line.

Schema `forward-api-connection` started at `1.0.0`. Version `2.0.0` established the current connection contract.
Version `2.1.0` adds the optional, nullable `approvedQueryDigests` defense-in-depth allowlist. The property addition
requires a new version, but does not require a major-version migration because existing v2 objects remain valid when
the field is absent. Version `3.0.0` removes raw username/password properties and requires a
`CREDENTIALS_VAULT-*` reference to an APP_ENGINE-scoped username/password entry. It is a deliberate breaking
migration: administrators recreate or update the object with the Vault entity ID; the app never reads or copies an
old plaintext setting. Version `3.0.1` removes obsolete inline-secret resubmission metadata from that Vault-reference
contract so current Dynatrace tenants can register it without requiring a nonexistent secret property.

Schema `dependency-discovery-profile` version `2.0.0` adds the required source contract. Every profile explicitly
declares `distributed-traces` or `network-flows`, and its DQL is validated against that source before execution.
