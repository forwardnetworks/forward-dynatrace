# Forward For Dynatrace

Dynatrace identifies which application relationships matter. Forward determines whether the modeled network can
deliver them. Forward for Dynatrace combines those facts for application-aware change planning and validation.

## Value

- Derive network validation scope from current observed application relationships.
- Detect unmapped endpoints and modeled path failures before a change.
- Maintain application-aware Forward intent checks under explicit policy.
- Combine Forward pre/post-change evidence with Dynatrace Site Reliability Guardian history.
- Give application and network teams a shared view while each platform remains authoritative.

## Deployment

Install one Dynatrace app and configure a tenant-managed Forward API connection. Nothing is installed in Forward or on
an application host.

Start with Read Only. Network Operator adds arbitrary NQE capability but remains plan-only. Network Admin can create and
exact-approved update managed intent checks; stale checks are never deleted automatically.

## Release Boundary

The current `0.x` line is an enterprise preview for controlled evaluation and non-production use. Each immutable
release provides one Dynatrace app archive plus checksum, SBOM, optional signature, and attestation evidence.
