# Prospect Talk Track

Use this to explain what the integration does, why it matters, and what each side receives from it.

## One-Liner

Forward Integration for Dynatrace turns observed application dependencies into Forward-owned intent, then gives an
approved ServiceNow change one checksummed answer from both Dynatrace application health and Forward modeled-network
evidence.

## What It Does

1. Dynatrace supplies application dependency rows from observed service/application mapping.
2. The app normalizes those rows into dependency candidates and classifies each row as ready, review, or needs-map.
3. Only rows with Forward-resolved source and destination endpoints are eligible for Forward intent checks.
4. Forward-side tooling can run read-only path evidence from the same resolved endpoints before approval.
5. The app exports a signed or checksum-verified package containing Forward-native intent-check JSON and a manifest.
6. A Forward operator or Forward-side connector validates and reconciles that package.
7. Forward creates missing checks only when the Forward-side operator or approved Forward-side automation applies it.
8. Dynatrace can display aggregate ingest status back from Forward without receiving Forward credentials or topology.

## Forward Value

- Converts application dependency mapping into persistent Forward intent checks.
- Reduces manual translation between app teams, operations, and network teams.
- Keeps Forward as the only write authority for Forward checks.
- Reconciles iteratively as Dynatrace dependency evidence changes.
- Shows create, unchanged, changed, and stale state before any write.
- Blocks unresolved endpoint mappings before they become bad intent checks.
- Uses the same resolved dependency file for optional path evidence and eventual intent-check creation.
- Supports optional read-only NQE preview or query-ID based artifacts when the customer approves that workflow.

## Dynatrace Value

Dynatrace is not just a source feed. The app gives Dynatrace users a useful operational view:

- App teams can see which observed dependencies are ready for network intent and which need mapping cleanup.
- Dynatrace workflows can regenerate packages on a schedule or from a problem trigger as application topology changes.
- Dynatrace can display sanitized Forward-side ingest status, including package ID, run status, counts, and drift state.
- The status loop tells Dynatrace users whether observed dependencies became enforceable Forward intent, without giving
  Dynatrace permission to mutate Forward.
- Readiness and drift information can help app owners fix missing host/service mappings before asking network teams to
  accept the package.

## ServiceNow Value

- The original change remains the authoritative approval and audit surface.
- Start captures an exact pre-change Forward snapshot; complete requires a new processed snapshot and fresh Dynatrace
  health context.
- Pass, warn, or fail includes explicit reason codes instead of a generic automation status.
- The evidence attachment, work-note marker, and Dynatrace event share one SHA-256/idempotency identity.
- Identical retries are safe; changed inputs fail closed instead of silently creating a second lineage.
- The customer's deployment and rollback controls remain untouched.

## Security Boundary

- Dynatrace never stores Forward write credentials.
- Dynatrace never calls Forward write APIs.
- Forward writes happen only in the manual importer or Forward-side connector runtime.
- Forward credentials stay in a Forward-controlled runtime or secret manager.
- Package validation, checksums, optional signatures, dry-run reconciliation, and mutation policies happen before apply.

## Iterative Workflow

1. Dynatrace observes or updates dependencies.
2. The app exports a new package with stable integration keys.
3. Forward-side readiness runs validation and dry-run reconciliation.
4. Optional Forward path evidence shows whether resolved dependencies are currently reachable or blocked.
5. Operators review unresolved mappings, changed checks, stale checks, and evidence state.
6. Forward applies missing checks when approved.
7. Forward publishes aggregate ingest status.
8. Dynatrace shows the latest status and remaining mapping work.

This makes changes repeatable: the same dependency key produces the same intended check, and Forward reconciliation
shows what changed since the last package.

## Customer Framing

- "Dynatrace tells us what the app is doing; Forward verifies and enforces whether the network intent exists."
- "The integration does not bypass network governance. It produces a reviewed package that Forward imports."
- "The main outcome is fewer hand-built intent checks and a visible gap list for dependencies that cannot yet be mapped."
- "The loop is useful to both teams: app owners see readiness and network teams get deterministic Forward-native input."
- "Automation is possible, but the write boundary remains Forward-side and approval-gated."

## Demo Flow

### Act 1: Create Governed Intent

1. Show the Dynatrace app dependency readiness view.
2. Point out ready, review, and needs-map classifications.
3. Export the Forward package.
4. Resolve endpoints against the Forward snapshot and optionally run path evidence.
5. Run Forward-side deployment readiness in dry-run mode.
6. Show create/unchanged/changed/stale counts.
7. Apply only missing checks if the test network and operator approval are in place.
8. Publish or load the sanitized Forward ingest status back into Dynatrace.

### Act 2: Assure A ServiceNow Change

1. Show the approved ServiceNow change, active window, deployment, owner, and affected services.
2. Start assurance and show the stable run ID plus exact Forward baseline snapshot.
3. Run the customer-owned deployment step.
4. Complete assurance with a new Forward snapshot and stabilized Dynatrace health/problem evidence.
5. Compare a safe change with a regression: reachability delta, application health, drift, and reason codes.
6. Show the checksummed attachment on ServiceNow and the same SHA-256 on the Dynatrace assurance row.
7. Retry the same input and show the existing receipt instead of duplicate notes or attachments.

## Common Questions

**Does this replace Forward modeling?**

No. Dynatrace dependency evidence becomes candidate intent. Forward still resolves endpoints, validates against the
network model, and owns the write path.

**Can this run continuously?**

Yes. Dynatrace can schedule package generation, and a Forward-side connector can pull and reconcile packages. Default
automation is dry-run/report. Writes require Forward-side apply policy.

**What happens when Dynatrace has a host that Forward cannot match?**

The row is marked needs-map and is not eligible for intent-check creation unless an operator deliberately uses the
review-row override for a controlled test.

**Is there value for Dynatrace if Forward owns the writes?**

Yes. Dynatrace users get readiness, rejected-row reasons, drift status, and proof that observed dependencies were or
were not accepted into Forward governance.

**Does ServiceNow approval let this integration change Forward or deploy the app?**

No. Approval authorizes evidence collection for the scoped change. Forward mutation and customer deployment/rollback
remain separately controlled; non-pass assurance blocks by default but does not perform rollback itself.
