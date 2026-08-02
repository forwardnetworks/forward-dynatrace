# Workflow

## End To End

1. Query real Dynatrace spans and entity context for service relationships.
2. Normalize source, destination, protocol, port, application, environment, owner, and confidence.
3. Resolve eligible endpoints against the selected Forward network and processed snapshot.
4. Evaluate resolved relationships through the read-only Forward `/paths-bulk` API in bounded batches.
5. Build managed Forward existential checks and compare them with current checks by ownership tags.
6. Return host/path evidence counts and a plan containing create, unchanged, changed, stale, and collision counts plus a
   digest bound to that evidence.
7. Optionally apply through a Network Admin connection after exact approval.
8. Read back Forward state; require full convergence for a full apply or selected-key convergence plus an outstanding
   report for a partition.
9. Correlate modeled network results with Dynatrace Site Reliability Guardian evidence.

## Plan Request

```json
{
  "sourceInstanceId": "<stable-opaque-dynatrace-source-id>",
  "syncMode": "direct-api",
  "forwardAccessProfile": "read-only",
  "operation": "plan",
  "approvalMode": "digest",
  "maxCreates": 1000,
  "maxUpdates": 100,
  "runPathPreflight": true,
  "approvedPlanDigest": "",
  "approvedSourceKeys": [],
  "dependencies": []
}
```

The selected connection owns the API URL and network ID. Browser-provided target metadata is never authoritative. A
read-only `/paths-bulk` evaluation uses HTTP POST but does not mutate Forward.

## Apply Request

`approvalMode` defaults to `digest`, preserving the existing contract. This mode authorizes by possession of the exact
current plan digest and is not the production-grade mode. Copy the current `planDigest` into `approvedPlanDigest`. For
a legacy full apply, copy the plan response's complete `changedSourceKeys` array into `approvedSourceKeys`. Do not add
unchanged, create, or `staleSourceKeys`; stale checks remain report-only.

For a production Workflow pilot, set `approvalMode` to `engine-approval` and supply `approvalNonce` from the same
Dynatrace approval lifecycle. The action accepts it only in engine-protected approval context, with outcome `APPROVED`,
an engine-carried original plan matching the current digest, an exact engine nonce match, and an original plan no more
than 15 minutes old. The Workflow approval history is the human audit record; the action does not parse the untyped
approval event for identity.

If the plan reports collisions, use `collisionReasonCounts` to identify the conflict class and
`collisionSourceKeys` to review the affected opaque managed identities. Collisions are never automatically mutated.

Apply is rejected when path evidence is failed, ambiguous, or unmapped; when any part of the approved plan tuple changes (including snapshot, path
evidence rows, budgets, and fingerprints); or when managed-identity collisions are present. Stage a new plan instead of
retrying an old digest.

Because Forward has no documented bulk PATCH for checks, updates are sequential. Apply rejects more than 500 selected
updates before the first mutation under the 120-second AppEngine deadline. To apply a partition, set
`applySourceKeys` to a non-empty subset of the current plan's `changedSourceKeys` and set `approvedSourceKeys` to the
exact same subset. The action still verifies the digest and budgets for the whole current plan, applies all planned
creates, patches only the selected updates, verifies their convergence, and returns outstanding source keys.

Every successful partition changes Forward state and invalidates the whole-plan digest. The outstanding list is not a
continuation token: stage a fresh plan and approval before the next partition. Drift anywhere in the plan before a
partition causes digest rejection, even when the selected keys themselves appear unchanged.

## Guardian

Forward and Dynatrace answer different questions:

- Forward: can the modeled network deliver the proposed application flows?
- Dynatrace Guardian: did observed service health remain within accepted objectives?

A mature change workflow requires both results. Neither is labeled root cause solely because the other failed.

## On-Demand Read Only Acceptance

Use an on-demand trigger for first acceptance. Do not add a schedule or Network Admin connection until cadence,
ownership, write approval, and rollback are separately approved.

1. Query a current evidence window from Grail and project the normalized dependency fields. For distributed tracing,
   require current client/server spans from the applications in scope; payload examples are request-shape fixtures and
   are not telemetry evidence.
2. Feed `result("query_dependencies")["records"]` into the synchronization action with `operation: "plan"`,
   `approvalMode: "digest"`, `runPathPreflight: true`, and the Read Only profile.
3. Before deployment, open the action task and require the widget to render **Forward API connection** and
   **Forward synchronization request draft**. A generic widget-load error is a release defect, not an acceptable
   headless configuration path.
4. Deploy only after confirming the trigger still reads **On demand**. Run once and retain the Workflow execution ID,
   DQL query ID, aggregate host/path counts, reconciliation counts, package ID, and plan digest.
5. Require the result boundary to be `tenant-managed-secret-backend-only`, the operation to be `plan`, and every
   mutation count to remain zero. A second run should report the managed set as unchanged.

Current lab acceptance may use generated application transactions only when they traverse the running lab network and
arrive as current instrumented OTLP spans. Record that provenance as live sandbox traffic, not production customer
traffic, and never substitute static, replayed, seeded, or payload-example rows.
