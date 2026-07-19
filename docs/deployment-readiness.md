# Deployment Readiness Checklist

## Release And Platform

- [ ] Verify the immutable app archive, SBOM, checksums, optional signature, and attestations.
- [ ] Confirm the Dynatrace environment provides AppEngine, Workflow, Grail spans, and the required app scopes.
- [ ] Approve the exact Forward API host in Dynatrace external requests.
- [ ] Confirm the target Forward network has a current processed snapshot.

## Identity And Data

- [ ] Create a dedicated Read Only Forward service identity for initial acceptance.
- [ ] Create and review the tenant-owned spans-only dependency discovery profile.
- [ ] Verify the canonical application, environment, endpoint, protocol, port, owner, and evidence-time mappings.
- [ ] Confirm secrets remain masked and absent from browser, Workflow, and release evidence.

## Assurance

- [ ] Run dependency discovery and review accepted, excluded, unmapped, and freshness counts.
- [ ] Run a Read Only intent plan and verify zero mutation calls.
- [ ] Validate modeled path evidence and Site Reliability Guardian results as distinct sources.
- [ ] Record the release, app version, Workflow execution, snapshot, and aggregate outcomes.

## Write Enablement

- [ ] Approve Network Admin ownership, separation of duties, budgets, and rollback.
- [ ] Prove exact digest and changed-source-key approval.
- [ ] Prove collision rejection, partial-failure handling, and post-write readback.
- [ ] Define the policy that prevents closeout while required Forward or Guardian objectives fail.
