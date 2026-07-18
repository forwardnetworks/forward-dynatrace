# Forward for Dynatrace

Forward for Dynatrace turns observed Dynatrace application dependencies into reviewed Forward network intent checks
and returns bounded network-assurance evidence to Dynatrace.

## The Problem

Forward can model every possible network path, but the network model alone does not know which application
relationships are most important. Dynatrace observes service-to-service dependencies and business context, but it does
not provide Forward's end-to-end modeled network path or persistent network intent. The integration combines those two
authoritative views without copying either platform's credentials or complete topology into the other.

## The Workflow

1. Dynatrace Workflow queries real service dependency evidence and normalizes application, environment, endpoints,
   protocol, port, owner, confidence, and provenance.
2. Forward-side tooling resolves the endpoints against a selected processed Forward snapshot and optionally evaluates
   read-only path evidence.
3. The integration builds a deterministic signed package of Forward `NewNetworkCheck[]` intent definitions.
4. A Forward operator validates, reconciles, stages, and approves the exact immutable plan.
5. The Forward-side importer creates missing checks by default, verifies the result, and publishes sanitized aggregate
   status back to Dynatrace.

## Enterprise Boundaries

- The Dynatrace app never stores a Forward credential and never calls a Forward write API.
- Forward writes occur only in a customer-controlled Forward-side runtime.
- Create-missing-only is the default; changed and stale mutations require separate exact approval and budgets.
- Ambiguous or unmapped dependencies remain review evidence and cannot silently become checks.
- Packages, plans, approvals, results, and managed checks carry deterministic, source-scoped identity.
- Status returned to Dynatrace excludes credentials, endpoints, check names, path topology, and raw API bodies.

## What Customers Deploy

- A signed `com.forward.dynatrace` application archive for shared non-production or production tenants.
- A digest-pinned Forward-side importer image or extracted importer archive.
- A customer-owned immutable HTTPS handoff with separate publish/read identities.
- Dedicated least-privilege Forward and Dynatrace service principals held in the customer secret manager.
- A supported systemd, Kubernetes, or equivalent runtime with customer log, metrics, alert, backup, and on-call ownership.

## Acceptance

The published kit includes checksums, an Ed25519 checksum signature, CycloneDX SBOM, artifact and image attestations,
container vulnerability evidence, runtime templates, runbooks, and a customer acceptance checklist. Promotion requires
one customer-owned non-production run that proves real dependency query, deterministic package, reviewed apply,
idempotent rerun, sanitized Dynatrace readback, failure recovery, and operational handoff.

Start with [workflow.md](workflow.md), [install.md](install.md), and
[customer-acceptance-checklist.md](customer-acceptance-checklist.md).
