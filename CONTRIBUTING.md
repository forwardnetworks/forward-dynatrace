# Contributing

Forward for Dynatrace accepts focused changes that preserve the product's single-app architecture, least-privilege
access model, and immutable release boundary.

## Development Environment

- Node.js 24
- npm with a clean `npm ci` installation
- A Dynatrace development tenant only when validating tenant deployment behavior
- A Forward environment only when exercising live API compatibility

Do not commit credentials, tenant URLs, private topology, proprietary telemetry, generated archives, or local agent
instructions.

## Change Workflow

1. Create a short-lived branch from `main`.
2. Keep the change scoped and update the related schema, test, and operator documentation together.
3. Run `npm run ci` before opening a pull request.
4. Complete the pull request security and release-impact checklist.
5. Require review for app functions, connection schemas, RBAC, release automation, and data-boundary changes.

## Design Principles

- Dynatrace owns observed application relationships, telemetry, Workflow, and Guardian history.
- Forward owns modeled reachability, snapshots, NQE results, and intent checks.
- The Dynatrace app is the only installable component.
- Read Only and Network Operator remain plan-only for intent synchronization.
- Network Admin writes require an immutable plan, exact approval, bounded mutations, and post-write readback.
- Published tags and artifacts are immutable.

## Pull Request Evidence

Include the affected control boundary, validation commands, test results, migration impact, and rollback behavior. Use
sanitized aggregate evidence only; never attach credentials, dependency rows, endpoints, hostnames, or path topology.
