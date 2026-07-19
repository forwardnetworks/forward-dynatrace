# Customer Acceptance Checklist

## Install And Identity

- [ ] Verify the immutable app release, checksum, SBOM, signature when present, and attestations.
- [ ] Install the exact verified archive only in the approved evaluation environment.
- [ ] Approve only the exact Forward API host for outbound requests.
- [ ] Create one reviewed tenant-owned spans-only dependency discovery profile.
- [ ] Confirm application, environment, endpoint, protocol, port, owner, and evidence-time mappings are authoritative.
- [ ] Store a dedicated Read Only Forward identity in the secret connection.
- [ ] Confirm the browser and Workflow result cannot reveal the credential.

## Data And Evidence

- [ ] Confirm dependency rows come from real current telemetry, not seeded or replayed data.
- [ ] Confirm stale, malformed, and substitute rows fail closed and remain counted.
- [ ] Record source instance, Forward network, processed snapshot, and Guardian execution IDs.
- [ ] Review endpoint mapping readiness and incomplete path evidence.
- [ ] Confirm modeled reachability and observed application health remain separate facts.

## Synchronization

- [ ] Run plan under Read Only and prove no mutation requests occur.
- [ ] If Network Operator is used, prove intent-check writes remain blocked.
- [ ] Before Network Admin, approve budgets and separation of duties.
- [ ] Prove exact digest and changed-source-key approval.
- [ ] Prove collision rejection, stale report-only behavior, partial-failure recovery, and post-write readback.

## Promotion

- [ ] Run a real pre-change, regression, and recovery rehearsal.
- [ ] Require Forward and Guardian pass results before closeout.
- [ ] Assign app, connection, Workflow, security, and incident owners.
- [ ] Record known limits and support boundary for the enterprise preview.
