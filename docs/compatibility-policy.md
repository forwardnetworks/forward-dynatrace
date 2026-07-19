# Compatibility Policy

Forward for Dynatrace integrates two SaaS control planes through published application and API contracts. Compatibility
is certified by capability, not by private tenant identity.

## Supported Capability Set

| Platform | Required capabilities |
| --- | --- |
| Dynatrace SaaS | AppEngine, Workflow, Grail spans, entities, app settings, external-request allowlist, and Site Reliability Guardian |
| Forward | HTTPS `/api`, processed snapshots, host resolution, bulk path search, existential checks, and NQE APIs appropriate to the configured access profile |
| Tooling | Node.js 24 for verification, installation, and development commands |

## Certification Gates

Every release must pass:

1. schema and contract tests for every request and bounded result;
2. Read Only, Network Operator, and Network Admin policy tests;
3. pagination, timeout, retry, response-cap, batching, collision, partial-failure, and readback tests;
4. Dynatrace bundle validation and installation in a current SaaS environment;
5. Forward read/path/check compatibility against a current processed snapshot;
6. independent release checksum, signature, SBOM, and attestation verification.

## Rolling SaaS Changes

Dynatrace and Forward SaaS may evolve without a customer-managed version boundary. A capability disappearance, schema
change, unexpected status, or response-shape change must fail closed. The app does not infer a substitute endpoint,
downgrade an access profile, or bypass an approval gate.

## Release Qualification

The release record must identify the app version, commit, CI run, release run, verification run, Dynatrace installation
result, and sanitized Forward compatibility result. Customer-specific tenant, network, snapshot, endpoint, and
topology details remain in the customer's controlled evidence store.
