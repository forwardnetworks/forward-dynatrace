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
8. Read back Forward state and require zero remaining create, changed, or collision rows.
9. Correlate modeled network results with Dynatrace Site Reliability Guardian evidence.

## Plan Request

```json
{
  "sourceInstanceId": "<stable-opaque-dynatrace-source-id>",
  "syncMode": "direct-api",
  "forwardAccessProfile": "read-only",
  "operation": "plan",
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

Copy the current `planDigest` into `approvedPlanDigest`. For updates, copy the plan response's complete
`changedSourceKeys` array into `approvedSourceKeys`. Do not add unchanged, create, or `staleSourceKeys`; stale checks
remain report-only.

If the plan reports collisions, use `collisionReasonCounts` to identify the conflict class and
`collisionSourceKeys` to review the affected opaque managed identities. Collisions are never automatically mutated.

Apply is rejected when path evidence is failed, ambiguous, or unmapped, or when the snapshot, path result, or desired
check payload changes after approval. Stage a new plan instead of retrying an old digest.

## Guardian

Forward and Dynatrace answer different questions:

- Forward: can the modeled network deliver the proposed application flows?
- Dynatrace Guardian: did observed service health remain within accepted objectives?

A mature change workflow requires both results. Neither is labeled root cause solely because the other failed.
