# Documentation Index

Use this page to route a task to the smallest relevant source of truth. `AGENTS.md` deliberately links here instead of
listing every document.

## Understand The System

- [Workflow](workflow.md): end-to-end Dynatrace-to-Forward flow.
- [Forward ingest contract](forward-ingest-contract.md): package, reconciliation, and ownership contract.
- [Harness engineering](harness-engineering.md): agent-first repository model and feedback loop.
- [Collaboration guide](collaboration.md): branch/worktree workflow, review loop, and evidence handoff.

## Install, Package, And Release

- [Install](install.md): supported toolchain, installation, and public-release gate.
- [App identities](app-identities.md): production/sandbox IDs and clean-install reset rule.
- [Deployment readiness](deployment-readiness.md): validate-only and dry-run gates.
- [Release](release.md): release workflow and checksum verification.
- [Release provenance](release-provenance.md): signatures, SBOM, GHCR image, and attestations.
- [Schema versioning](schema-versioning.md): sole-version contract and future-version gate.
- [GitOps](gitops.md): CI and delivery workflow.
- [Governance](governance.md): review and branch-control expectations.
- [Support matrix](support-matrix.md): single-version platform, runtime, compatibility, and lifecycle boundary.

## Build The Dynatrace Side

- [Dynatrace app agent guide](agent-guides/dynatrace-app.md): AppEngine, Strato, SDK, and UI guidance.
- [Dynatrace workflow trigger](dynatrace-workflow-trigger.md): schedule/problem payload contract.
- [Site Reliability Guardian](site-reliability-guardian.md): lifecycle Guardian, execution context, Monaco package, and acceptance runs.
- [Dynatrace status dashboard](dynatrace-status-dashboard.md): status events and DQL views.

## Build The Forward Evidence And Import Path

- [Forward host resolution](forward-host-resolution.md): read-only endpoint mapping.
- [Forward path evidence](forward-path-evidence.md): optional modeled path preflight.
- [Problem network evidence](problem-network-evidence.md): aggregate problem-triggered evidence.
- [Forward NQE preview](forward-nqe-preview.md): optional dynamic read-only preview.
- [Forward NQE artifacts](forward-nqe-artifacts.md): optional persistent checks and diffs.
- [Forward API compatibility](forward-api-compatibility.md): supported Forward API surfaces.
- [Forward importer](forward-importer.md): validation, reconciliation, and mutation gates.

## Change And Security Evidence

- [Change validation gate](change-validation-gate.md): deterministic before/after gate.
- [Check-health transition feedback](check-health-transition-feedback.md): idempotent transition polling.
- [Security exposure correlation](security-exposure-correlation.md): evidence-separated risk ranking.

## Operate The Runtime

- [Container runtime](container-runtime.md): image build and execution.
- [Connector runtime](connector-runtime.md): systemd and Kubernetes scheduling.
- [Cron runtime](cron-runtime.md): optional cron runner and overlap controls.
- [Operations runbook](operations-runbook.md): normal operation and recovery actions.
- [Incident response](incident-response.md): failure triage and containment.
- [Observability](observability.md): reports, metrics, alerts, and evidence retention.
- [Admin operations](admin-operations.md): audit, restore, disaster recovery, and access review.
- [Package handoff](package-handoff.md): storage, retention, immutability, and access logs.

## Security And Readiness

- [Production readiness](production-readiness.md): pre-production checklist.
- [Customer acceptance checklist](customer-acceptance-checklist.md): evidence-driven non-production promotion gate.
- [Customer acceptance record template](templates/customer-acceptance-record.md): protected-environment evidence and sign-off record.
- [Enterprise hardening](enterprise-hardening.md): control catalog and productization choices.
- [Threat model](threat-model.md): trust boundaries, threats, and mitigations.
- [Data handling](data-handling.md): publish-safe data and artifact rules.
- [RBAC](rbac.md): least-privilege roles and separation.
- [Validation matrix](validation-matrix.md): automated, live, and remaining evidence.
- [Customer one-pager](customer-one-pager.md): customer-facing value, boundary, deployment, and acceptance summary.

## Demonstrate And Explain

- [Standalone live demo runbook](live-demo-runbook.md): live-evidence prestage, delivery, reset, and evidence capture.

## Plan Work

- [Execution plans](exec-plans/README.md): plan lifecycle and index.
- [Active pre-1.0 product-readiness plan](exec-plans/active/pre-1.0-product-readiness.md): current prioritized work before a supported 1.0 release.
- [Active design-partner pilot](exec-plans/active/design-partner-pilot.md): sandbox, Guardian, scale, and non-production gates.
- [Technical debt tracker](exec-plans/tech-debt-tracker.md): deferred structural work with triggers and exits.
