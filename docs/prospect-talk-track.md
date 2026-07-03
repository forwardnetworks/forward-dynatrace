# Prospect Talk Track

Use this to explain what the integration does, why it matters, and what each side receives from it.

## One-Liner

Forward Dynatrace turns application dependency evidence from Dynatrace into reviewable Forward intent checks, so network
policy can be continuously aligned to how applications actually communicate.

## What It Does

1. Dynatrace supplies application dependency rows from observed service/application mapping.
2. The app normalizes those rows into dependency candidates and classifies each row as ready, review, or needs-map.
3. Only rows with Forward-resolved source and destination endpoints are eligible for Forward intent checks.
4. The app exports a signed or checksum-verified package containing Forward-native intent-check JSON and a manifest.
5. A Forward operator or Forward-side connector validates and reconciles that package.
6. Forward creates missing checks only when the Forward-side operator or approved Forward-side automation applies it.
7. Dynatrace can display aggregate ingest status back from Forward without receiving Forward credentials or topology.

## Forward Value

- Converts application dependency mapping into persistent Forward intent checks.
- Reduces manual translation between app teams, operations, and network teams.
- Keeps Forward as the only write authority for Forward checks.
- Reconciles iteratively as Dynatrace dependency evidence changes.
- Shows create, unchanged, changed, and stale state before any write.
- Blocks unresolved endpoint mappings before they become bad intent checks.
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
4. Operators review unresolved mappings, changed checks, and stale checks.
5. Forward applies missing checks when approved.
6. Forward publishes aggregate ingest status.
7. Dynatrace shows the latest status and remaining mapping work.

This makes changes repeatable: the same dependency key produces the same intended check, and Forward reconciliation
shows what changed since the last package.

## Customer Framing

- "Dynatrace tells us what the app is doing; Forward verifies and enforces whether the network intent exists."
- "The integration does not bypass network governance. It produces a reviewed package that Forward imports."
- "The main outcome is fewer hand-built intent checks and a visible gap list for dependencies that cannot yet be mapped."
- "The loop is useful to both teams: app owners see readiness and network teams get deterministic Forward-native input."
- "Automation is possible, but the write boundary remains Forward-side and approval-gated."

## Demo Flow

1. Show the Dynatrace app dependency readiness view.
2. Point out ready, review, and needs-map classifications.
3. Export the Forward package.
4. Run Forward-side deployment readiness in dry-run mode.
5. Show create/unchanged/changed/stale counts.
6. Apply only missing checks if the test network and operator approval are in place.
7. Publish or load the sanitized Forward ingest status back into Dynatrace.

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
