# Forward for Dynatrace

Forward for Dynatrace turns live application dependencies observed by Dynatrace into governed network intent in
Forward. It helps application and network teams answer one shared question during a change: **are the services healthy,
and can the network still deliver the paths they depend on?**

Dynatrace identifies which service relationships matter. Forward resolves those relationships against its modeled
network, validates reachability, and maintains the approved intent checks. Sanitized results return to Dynatrace
without copying Forward credentials or detailed network topology into the Dynatrace tenant.

> **Current status:** `0.10.0` design-partner preview. Use an exact reviewed commit for sandbox and non-production
> evaluation. There is no generally available or supported production release yet.

![Forward for Dynatrace application overview](docs/assets/screenshots/dynatrace-app-overview.png)

_The Dynatrace app presents the application-to-network workflow and keeps the Forward credential and write boundary
explicit._

## Customer Outcomes

- Turn real service-to-service dependencies into persistent Forward intent checks.
- Validate application health and modeled network behavior before and after a change.
- Identify unmapped endpoints, path regressions, check drift, and missing evidence before approval.
- Give application and network teams a correlated view while each platform remains authoritative for its own data.
- Automate read-only analysis or approved check maintenance according to the Forward credential supplied by the
  customer.

## How It Works

```text
Dynatrace service dependencies
            |
            v
normalize + resolve endpoints against a Forward snapshot
            |
            v
deterministic intent package + manifest
            |
            v
Forward-side validation, reconciliation, and approval
            |
            +----> create missing / exact-approved updated intent checks
            |
            v
sanitized status, path evidence, and change results back to Dynatrace
```

1. A Dynatrace Workflow queries live dependency evidence and records application, environment, endpoints, protocol,
   port, ownership, confidence, and provenance.
2. Forward-side tooling resolves those endpoints against a selected processed snapshot and can run read-only path
   analysis.
3. The integration creates a deterministic `NewNetworkCheck[]` package and manifest.
4. The importer validates signatures and schemas, reads existing checks, and produces a reconciliation plan.
5. The selected access profile determines whether the run stops at evidence or performs an approved create/update.
6. Bounded aggregate results are published to Dynatrace for dashboards, Workflow, and Site Reliability Guardian.

The Dynatrace app never writes to Forward. All Forward credentials and mutations stay in a customer-controlled
Forward-side runtime.

## Deployment Components

| Component | Runs in | Responsibility |
| --- | --- | --- |
| Dynatrace app and Workflow action | Dynatrace SaaS | Discover dependencies, build packages, and display sanitized results. |
| Immutable package handoff | Customer-controlled storage | Transfer the checks, manifest, signature, and approval evidence. |
| Forward importer or connector | Customer-controlled runtime | Resolve hosts, analyze paths, reconcile checks, enforce policy, and publish aggregate status. |
| Deployment/change system | Customer environment | Own approval, execution, rollback, and any promotion gate. |

The importer supports systemd, Kubernetes, Docker Compose, and manual operation. A customer can start with manual
review and later schedule the same validated workflow without changing the package contract.

## Forward Access Profiles

| Profile | Forward capability | Intent-check behavior |
| --- | --- | --- |
| Read Only | Read modeled data and checks; execute approved library queries by ID. | Build, validate, and reconcile packages; never write. |
| Network Operator | Read Only plus execution of arbitrary NQE used by the configured workflow. | Build richer read-only evidence; never write intent checks. |
| Network Admin | Read access plus intent-check mutation. | Create missing checks and apply exact-approved updates within mutation budgets. |

Changed checks require an immutable signed plan, explicit approval of the exact managed identity, a valid change
window, and configured budgets. Stale checks are report-only; deletion is a separate policy and is never implied by
synchronization.

## Evaluate the Preview

### Prerequisites

- Node.js 24.x and npm for source builds.
- A Dynatrace SaaS sandbox with AppEngine, Grail dependency evidence, and the scopes listed in
  [docs/install.md](docs/install.md).
- A Forward network with a processed snapshot for live endpoint resolution and path validation.
- Separate least-privilege service identities for Dynatrace and Forward, stored outside this repository.

### Validate the source checkout

```bash
git clone https://github.com/forwardnetworks/forward-dynatrace.git
cd forward-dynatrace
git checkout <reviewed-commit>
npm ci
npm run ci
```

### Build a credential-free acceptance bundle

```bash
npm run acceptance:bundle -- \
  --dependencies /secure/export/dynatrace-dependencies.json \
  --output-dir out/acceptance \
  --source-instance-id <stable-opaque-dynatrace-source-id> \
  --forward-access-profile read-only \
  --sync-mode data-connector
```

This command validates a live dependency export, builds the package, and writes an `ACCEPTANCE.md` record. It does not
contact Forward or require Forward credentials.

### Install in a Dynatrace sandbox

Unsigned sandbox installs must use a `my.*` application ID:

```bash
npm run dynatrace:deploy -- \
  --environment-url https://<environment-id>.apps.dynatrace.com/ \
  --app-id my.forward \
  --no-open \
  --non-interactive
```

Shared non-production and production installs use the `com.forward.dynatrace` ID and a signed archive. See the
[installation guide](docs/install.md) for OAuth scopes, signing, install, upgrade, and uninstall instructions.

## Operate the Forward Side

The first design-partner path is an operator-reviewed manual import:

1. Export live dependencies from Dynatrace.
2. Move the package to the customer-controlled handoff.
3. Resolve endpoints and optionally run Forward path evidence.
4. Validate and dry-run reconciliation.
5. Review create, unchanged, changed, stale, collision, blocked, and failed rows.
6. Approve the exact signed plan and apply it only with the required Network Admin profile.
7. Verify the resulting checks and publish sanitized status to Dynatrace.

The scheduled connector follows the same validation and approval contract. Start with the
[workflow overview](docs/workflow.md), then use the [Forward importer guide](docs/forward-importer.md) or
[connector runtime guide](docs/connector-runtime.md) for commands and deployment examples.

## Enterprise Guardrails

- No Forward credential is stored in or sent through Dynatrace.
- No Forward write API is called from the Dynatrace app.
- Unresolved, ambiguous, replayed, seeded, fixture, or synthetic dependencies fail closed.
- Package bytes, manifests, plans, approvals, and results are checksummed and source-scoped.
- Create-missing-only is the default mutation policy.
- Updated checks require exact approval; stale checks are never silently deleted.
- Status returned to Dynatrace excludes credentials, endpoints, hostnames, check names, path topology, and raw API
  responses.
- Forward modeled reachability and Dynatrace observed traffic remain distinct facts; neither is presented as root
  cause by itself.

See [data handling](docs/data-handling.md), [RBAC](docs/rbac.md), and the [threat model](docs/threat-model.md) for the
full control boundary.

## Project Maturity and Releases

- Product line: pre-1.0 design-partner preview.
- Application version: `0.10.0`.
- Runtime baseline: Node.js 24.x.
- Distribution: exact source commits today; future `0.x` tags are GitHub prereleases with versioned GHCR images.
- Support: no generally available or supported production release exists.

The prematurely published `v1.0.0` through `v1.0.2` artifacts are retired and must not be installed. They remain
immutable for provenance. Contracts that contain `/v1` are wire-format versions, not a statement of product maturity.
This preview requires a clean installation and contains no compatibility runtime for the retired builds.

## Development

```bash
npm ci
npm run start       # local Dynatrace app development
npm run repo:validate
npm run lint
npm run build
npm run ci          # complete local GitHub Actions equivalent
```

Keep tenant URLs, customer data, credentials, private token paths, and customer-specific orchestration out of the
repository. Run focused tests while iterating and `npm run ci` on Node 24 before handoff.

Repository layout:

```text
api/       Dynatrace app functions
actions/   Dynatrace Workflow action and widget
ui/        Dynatrace app UI
scripts/   package, importer, runtime, validation, and release tooling
schemas/   versioned package, approval, status, and evidence contracts
deploy/    systemd, Kubernetes, Compose, Workflow, DQL, and dashboard templates
config/    secret-free configuration examples
docs/      architecture details, operations, security, acceptance, and plans
```

## Documentation

| Start here | Use it for |
| --- | --- |
| [Architecture](ARCHITECTURE.md) | Components, trust boundaries, ownership, and data paths. |
| [Workflow](docs/workflow.md) | End-to-end dependency-to-intent and feedback flow. |
| [Installation](docs/install.md) | Dynatrace scopes, signing, deployment, and clean installation. |
| [Forward importer](docs/forward-importer.md) | Reconciliation, approval, access profiles, and writes. |
| [Customer acceptance](docs/customer-acceptance-checklist.md) | Evidence required before non-production promotion. |
| [Operations runbook](docs/operations-runbook.md) | Normal operation, failure recovery, and support handoff. |
| [Validation matrix](docs/validation-matrix.md) | Automated proof, live evidence, and remaining gaps. |
| [Documentation index](docs/index.md) | Complete task-oriented documentation map. |

The live network, traffic generators, meeting dashboard, and customer-specific orchestration are deliberately kept in
separate deployment projects. This repository remains independently installable and customer-neutral.

## License

This project is licensed under the ISC License. See [LICENSE](LICENSE).
