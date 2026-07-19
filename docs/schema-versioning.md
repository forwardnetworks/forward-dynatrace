# Schema Versioning

The product is pre-1.0 while wire payloads use explicit `/v1` schema identifiers. A wire schema version is not a claim
of product maturity.

The current app supports one contract line only. It does not ship an obsolete-runtime compatibility layer. A future
breaking payload change must add a new schema ID, validators, migration decision, tests, and release note before use.

App settings schema `forward-api-connection` starts at `1.0.0` and contains URL, network, username, secret password, and
declared Forward access profile. Secret migrations must never expose or copy plaintext values through the UI.
