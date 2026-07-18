# Architecture

This is the top-level map of Forward for Dynatrace. Detailed contracts, runbooks, and plans are indexed
in [docs/index.md](docs/index.md).

## System Boundary

Dynatrace is the source of application dependency evidence. Forward is the source of modeled network state and the only
system in this integration that persists Forward intent checks.

```text
Dynatrace app/workflow
  -> dependency evidence
  -> deterministic signed/checksummed package
  -> customer-approved handoff
  -> Forward-side importer or connector
  -> enforce Read Only, Network Operator, or Network Admin profile
  -> validate + read existing checks + reconcile
  -> Network Admin creates missing checks and performs exact-approved updates
  -> sanitized status/evidence events
  -> Dynatrace display and query-back
```

The Dynatrace app may request approved read-only Forward evidence. It does not hold Forward write credentials, write
checks, or own committed Forward NQE Library content.

## Component Map

| Area | Location | Responsibility |
| --- | --- | --- |
| Dynatrace app functions | `api/` | Package/status/NQE planning and sanitized app-facing responses. |
| Dynatrace UI | `ui/` | Provenance-aware dependency, package, reconciliation, and cross-domain evidence views. |
| Operator and runtime tools | `scripts/` | Query, normalize, package, resolve, analyze, reconcile, publish, validate, and release. |
| Contracts | `schemas/` | Boundary validation for packages, approvals, status, change assurance, and evidence events. |
| Runtime examples | `deploy/` | Kubernetes, systemd, cron, Docker Compose, Dynatrace workflow, DQL, and dashboard templates. |
| Safe examples | `config/` | Secret-free configuration and placeholder contracts; no seeded dependency evidence ships with the product. |
| Knowledge system | `docs/` | Design contracts, runbooks, evidence records, and versioned execution plans. |
| Feedback harness | `scripts/validate-repo.mjs`, CI | Structural, security, schema, test, build, scale, and release invariants. |

## Dependency And Ownership Rules

1. UI and app functions can produce or display evidence; they cannot call Forward write APIs.
2. Package construction is deterministic and independent of Forward credentials.
3. Forward-side runtimes validate packages before any Forward API call.
4. Reconciliation reads current Forward state before planning changes.
5. Read Only and Network Operator never call intent-check write APIs. Network Admin may create missing checks; changed
   checks still require a signed package, exact-key approval, change window, and mutation budget.
6. Stale-check retirement is a separate deletion policy and is never implied by Network Admin synchronization.
7. Detailed Forward topology stays inside the Forward-controlled boundary; return paths publish bounded aggregates.
8. Customer deployment systems may consume checksummed evidence and enforce promotion decisions outside Forward and
   Dynatrace.
9. Every live proof records environment, correlation IDs, Forward network/snapshot IDs, counts, and provenance.

## Primary Data Paths

### Intent Package

Dynatrace dependency rows are normalized, optionally resolved against Forward read-only inventory, converted into
`NewNetworkCheck[]`, checksummed, handed off, and reconciled by the Forward-side importer.

### Read-Only Network Evidence

The Forward-side runtime resolves endpoints and runs approved path or NQE queries. Only aggregate assessments and counts
are eligible for publication back to Dynatrace.

### Change Validation

The runtime can combine before/after Forward snapshots, Dynatrace health context, and dry-run reconciliation into a
deterministic pass/warn/fail artifact. A customer-operated deployment system decides whether promotion continues.

### Continuous Feedback

The Forward-side poller persists protected state and publishes bounded, idempotent check-health transitions. Security
correlation combines separately sourced facts without treating modeled reachability as observed traffic or root cause.

## Change Routes

- App or UI behavior: `docs/agent-guides/dynatrace-app.md`, then `docs/workflow.md`.
- Package/import behavior: `docs/forward-ingest-contract.md`, then `docs/forward-importer.md`.
- Runtime deployment: `docs/connector-runtime.md`, `docs/container-runtime.md`, or `docs/cron-runtime.md`.
- Change validation: `docs/change-validation-gate.md`.
- Security or data handling: `docs/threat-model.md`, `docs/data-handling.md`, and `docs/rbac.md`.
- Current priorities: `docs/exec-plans/active/pre-1.0-product-readiness.md`.
- Verified truth: `docs/validation-matrix.md` and executable CI.
