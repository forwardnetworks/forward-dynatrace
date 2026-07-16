# Documentation Index

Use this page to route a task to the smallest relevant source of truth. `AGENTS.md` deliberately links here instead of
listing every document.

## Understand The System

- [Workflow](workflow.md): end-to-end Dynatrace-to-Forward flow and screenshots.
- [Forward ingest contract](forward-ingest-contract.md): package, reconciliation, and ownership contract.
- [Harness engineering](harness-engineering.md): agent-first repository model and feedback loop.
- [Execution roadmap](execution-roadmap.md): long-range design history and phased capability record.

## Install, Package, And Release

- [Install](install.md): supported toolchain, installation, and public-release gate.
- [Deployment readiness](deployment-readiness.md): validate-only and dry-run gates.
- [Release](release.md): release workflow and checksum verification.
- [Release provenance](release-provenance.md): signatures, SBOM, GHCR image, and attestations.
- [Schema versioning](schema-versioning.md): compatibility and migration rules.
- [GitOps](gitops.md): CI and delivery workflow.
- [Governance](governance.md): review and branch-control expectations.

## Build The Dynatrace Side

- [Dynatrace app agent guide](agent-guides/dynatrace-app.md): AppEngine, Strato, SDK, and UI guidance.
- [Dynatrace workflow trigger](dynatrace-workflow-trigger.md): schedule/problem payload contract.
- [Dynatrace status dashboard](dynatrace-status-dashboard.md): status events and DQL views.
- [Screenshots](screenshots.md): real capture and refresh workflow.

## Build The Forward Evidence And Import Path

- [Forward host resolution](forward-host-resolution.md): read-only endpoint mapping.
- [Forward path evidence](forward-path-evidence.md): optional modeled path preflight.
- [Problem network evidence](problem-network-evidence.md): aggregate problem-triggered evidence.
- [Forward NQE preview](forward-nqe-preview.md): optional dynamic read-only preview.
- [Forward NQE artifacts](forward-nqe-artifacts.md): optional persistent checks and diffs.
- [Forward API compatibility](forward-api-compatibility.md): supported Forward API surfaces.
- [Forward importer](forward-importer.md): validation, reconciliation, and mutation gates.

## Change And Security Assurance

- [Change validation gate](change-validation-gate.md): deterministic before/after gate.
- [Application change assurance](application-change-assurance.md): ServiceNow-first workflow.
- [ServiceNow flow worker](servicenow-flow-worker.md): bounded Flow Designer worker API.
- [ServiceNow scope mapping](servicenow-scope-mapping.md): reviewed affected-record identity and environment contract.
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
- [Enterprise hardening](enterprise-hardening.md): control catalog and productization choices.
- [Threat model](threat-model.md): trust boundaries, threats, and mitigations.
- [Data handling](data-handling.md): publish-safe data and artifact rules.
- [RBAC](rbac.md): least-privilege roles and separation.
- [Customer acceptance checklist](customer-acceptance-checklist.md): customer trial and production gates.
- [Validation matrix](validation-matrix.md): automated, live, synthetic, and remaining evidence.

## Demonstrate And Explain

- [Customer one-pager](customer-one-pager.md): customer-facing scope and verification.
- [Client trial plan](client-trial-plan.md): rehearsal and trial flow.
- [Live demo runbook](live-demo-runbook.md): customer-owned and standard replay paths.
- [Live change assurance presenter guide](live-change-demo-presenter-guide.md): exact screen flow, talk track, and integration proof for the local cEOS demo.
- [Demo data](demo-data.md): fixture provenance and replay rules.
- [Prospect talk track](prospect-talk-track.md): value narrative and demo flow.

## Plan Work

- [Execution plans](exec-plans/README.md): plan lifecycle and index.
- [Active customer production-readiness plan](exec-plans/active/customer-production-readiness.md): current prioritized work.
- [Completed non-production evidence tranche](exec-plans/completed/2026-07-12-non-production-evidence.md): completed proof record.
- [Technical debt tracker](exec-plans/tech-debt-tracker.md): deferred structural work with triggers and exits.
