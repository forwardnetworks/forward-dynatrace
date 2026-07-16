# Live Change Assurance Presenter Guide

Use this guide for the local ARM64 cEOS demonstration that connects the independently deployable ServiceNow and
Dynatrace integrations through a customer-controlled Forward-side assurance worker. Keep the browser on the product
surfaces below; terminals are operator evidence, not the customer story.

## The Story In One Sentence

ServiceNow authorizes the change, Dynatrace identifies the affected application dependency and reports runtime
health, and Forward proves whether the real network still satisfies that dependency before and after the change.

## State The Ownership Before The Demo

| System | What it owns | What the integration demonstrates |
| --- | --- | --- |
| ServiceNow | Change approval, execution window, audit record, work notes, and evidence attachment | An approved change starts assurance and receives a checksum-bound decision. |
| Dynatrace | Application services, dependencies, deployment state, health, and problems | The dependency defines the assurance scope; the result is queryable with the same run identity. |
| Forward | Network snapshots, modeled paths, intent checks, and drift | A fresh before/after comparison turns the application dependency into an enforceable network gate. |
| Customer deployment system | Deployment and rollback | It consumes the decision; the integrations do not silently deploy or roll back. |
| Local containerlab | The real routed network used for the demonstration | Failure and recovery come from actual cEOS configuration changes, not invented API responses. |

The ServiceNow and Dynatrace packages remain separate products. The local `forward-change-demo` workspace owns only
the lab topology and staged network mutations.

## Presenter Preparation

1. Start from the healthy `local-fix` state and collect a fresh Forward snapshot.
2. Confirm the ServiceNow change is approved, executable, and inside its planned window.
3. Confirm the affected Dynatrace service and dependency are present. Keep synthetic provenance visible if the tenant
   is using approved replay evidence.
4. Confirm the Forward collector and assurance worker are healthy.
5. Open four browser tabs in order: ServiceNow change, Dynatrace dependency view, Forward network, and Dynatrace
   assurance portal.
6. Keep network IDs, tenant URLs, credentials, and OAuth callback values in ignored local state.

Operator-only preparation:

```bash
cd ~/src/forward-change-demo/enterprise-prepost-lab
make local-preflight
make local-collector-status
```

## Screen-By-Screen Workflow

### 1. Start With The Approved Change

**Do:** Open the ServiceNow change record. Show approval, planned window, assignment, deployment identifier, affected
services, and assurance status.

**Say:** “ServiceNow is the authority for whether this change may run. The integration fails closed if the record is
missing, ambiguous, unapproved, outside its window, or in the wrong state.”

**Integration proof:** The demo starts from the native change record customers already govern and audit, not from a
script or copied approval flag.

**Capture:** `01-servicenow-approved-change.png`

### 2. Show Why This Network Path Matters

**Do:** In Dynatrace, show the affected service and its source-to-destination dependency, including protocol and port.
If the evidence is replayed, keep the synthetic provenance label visible.

**Say:** “Dynatrace tells us which application communication matters. That evidence scopes assurance; we do not treat
every network path as equally relevant to this change.”

**Integration proof:** Application context originates in Dynatrace and becomes a precise Forward path question. The
Dynatrace app neither stores Forward credentials nor writes Forward intent.

**Capture:** `02-dynatrace-affected-dependency.png`

### 3. Establish The Healthy Before State

**Do:** Start assurance from ServiceNow and wait for `baseline-captured`. In Forward, show the selected network,
processed before snapshot, resolved endpoints, and healthy modeled path.

**Say:** “The Forward-side worker resolves the Dynatrace endpoints and captures a fresh baseline. The stable `fdca-*`
run ID now binds the ServiceNow change, Dynatrace service scope, and Forward snapshot.”

**Integration proof:** Later evidence is attached to one durable run identity and an exact processed network state.

**Capture:** `03-forward-healthy-baseline.png`

### 4. Apply A Real Network Regression

**Do:** Apply the staged ACL regression to the running cEOS lab, then request and wait for a new collection.

```bash
cd ~/src/forward-change-demo/enterprise-prepost-lab
make local-post1
make local-forward-collect
```

**Say:** “This is the only demo choreography: we are changing a real router configuration. The integrations receive no
special failure flag.”

**Integration proof:** The outcome comes from a real network state change observed by the normal Forward collector.

Do not make the terminal a primary screenshot. The proof is the new Forward snapshot and modeled path result.

### 5. Show Forward Blocking The Change

**Do:** In Forward, compare the baseline and post-change snapshots. Show the affected path becoming unreachable and
the assurance decision becoming `fail`.

**Say:** “Forward found a regression in the exact application dependency supplied by Dynatrace. The path was healthy
before and broken after, so the gate blocks rather than relying on device-up status.”

**Integration proof:** Forward contributes modeled network truth, based on a fresh snapshot pair and explicit path
evidence, rather than generic monitoring.

**Capture:** `04-forward-regression-gate.png`

### 6. Close The Audit Loop In ServiceNow

**Do:** Return to the change. Show failed assurance, before/after snapshot IDs, reason codes, work note, and JSON
evidence attachment. Show that an identical retry reused the same work note and attachment.

**Say:** “The decision is now where the change is governed. One checksum binds the attachment, work note, and
Dynatrace event. Retrying the same result cannot create a second audit story.”

**Integration proof:** The result is durable, reviewable, checksum-bound, and safe under workflow retries.

**Capture:** `05-servicenow-failed-assurance.png`

### 7. Query Back The Same Failure In Dynatrace

**Do:** In the Dynatrace assurance portal, filter by the same change, deployment, and `fdca-*` run identity. Show the
failed decision, Forward snapshots, service context, and matching ServiceNow evidence checksum.

**Say:** “Dynatrace receives the same assurance event, with the same identifiers and checksum, alongside the
application context—not a vague notification.”

**Integration proof:** Operators can correlate application health, network evidence, and the change record without
creating a new source of approval truth.

**Capture:** `06-dynatrace-failure-queryback.png`

### 8. Apply The Complete Fix

**Do:** Apply the staged fix and collect another fresh Forward snapshot.

```bash
cd ~/src/forward-change-demo/enterprise-prepost-lab
make local-fix
make local-forward-collect
```

**Say:** “We are fixing the actual branch interfaces and data-center firewall policy, then asking the normal collector
to observe the result.”

**Integration proof:** Recovery is neither an acknowledgement nor a manual override; new evidence must demonstrate it.

### 9. Show The Recovery Gate Passing

**Do:** In Forward, show the new snapshot pair, every scoped path reachable, unchanged intent reconciliation, and no
drift. Then show the ServiceNow decision updated to `pass`.

**Say:** “The change passes only after every affected dependency is reachable in the fresh post-fix snapshot and the
managed intent is unchanged. Approval alone cannot make network evidence pass.”

**Integration proof:** The gate is deterministic and evidence-driven. A partial fix remains a failure; the complete
fix produces a pass.

**Capture:** `07-forward-recovery-gate.png` and `08-servicenow-passed-assurance.png`

### 10. Finish With Cross-Domain Recovery

**Do:** In Dynatrace, show the failure, intermediate recovery attempt, final pass, and per-check `FAIL_TO_PASS`
transitions for the same application scope.

**Say:** “The products retain their native responsibilities, but the evidence is now one traceable story: ServiceNow
authorization, Dynatrace application context, and Forward network truth.”

**Integration proof:** The integration supports both the immediate deployment gate and later operational analysis.

**Capture:** `09-dynatrace-recovery-transitions.png`

## Acceptance Evidence From The Rehearsed Local Run

Use fresh values on screen; the accepted rehearsal proved these invariants:

- one real regression failed after a new Forward snapshot;
- an incomplete recovery remained failed;
- the final recovery passed with all six scoped paths reachable, six unchanged checks, and zero drift;
- ServiceNow published one checksum-bound attachment and work note and reused them for an identical retry;
- Dynatrace query-back returned the failure, recovery attempts, final pass, and six `FAIL_TO_PASS` transitions;
- the ServiceNow package audit completed with zero failures or warnings.

## Screenshot Rules

- Use the isolated in-app browser when available. An isolated Playwright profile is the approved local fallback; never
  use the Chrome extension, Chrome profile, or browser credential store.
- Keep the product identity, record identity, evidence state, and field being discussed visible in every frame.
- Crop credentials, tenant URLs, OAuth state, tokens, customer data, and unrelated navigation.
- Store raw live captures outside Git under the demo workspace's ignored `out/` directory.
- Commit only reviewed, sanitized captures. Synthetic captures must retain their synthetic label.
- Each screenshot should answer one question. If narration is required to know what changed, capture a tighter frame.

## Final Presenter Close

“This is not three products pretending to be one. ServiceNow still owns approval, Dynatrace still owns application
health and dependencies, and Forward still owns modeled network truth. The integration gives the deployment process a
single checksum-bound answer while every piece of evidence remains in the system customers already trust.”
