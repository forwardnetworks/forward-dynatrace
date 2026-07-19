# Ownership And Responsibilities

## Repository Accountability

| Responsibility | Accountable owner |
| --- | --- |
| Source, CI, release engineering, and preview response | Repository maintainer (`@captainpacket`) |
| Product scope and production promotion | Forward product management |
| Security policy and vulnerability coordination | Forward security with the repository maintainer |
| Dynatrace signing and distribution approval | Forward product/release engineering with Dynatrace |

## Deployment Responsibilities

| Role | Responsibility |
| --- | --- |
| Dynatrace administrator | App installation, app settings, OAuth, outbound allowlist, Workflow IAM, and Guardian ownership |
| Forward administrator | Dedicated service identities, network scope, access profile, snapshots, Library NQE allowlist, and intent policy |
| Application owner | Dependency discovery mapping, service scope, criticality, ownership, and application-health objectives |
| Network change owner | Plan review, mutation budgets, changed-key approval, execution decision, rollback, and closeout |
| Security reviewer | Data boundary, credential handling, tenant policy, audit, and incident readiness |

## Separation Of Duties

Read Only acceptance precedes Network Admin configuration. Workflow editors can stage plans, but a change approver owns
the exact digest, mutation budget, changed source keys, and execution decision. The app never promotes its own access
profile, approves a change, deletes stale checks, or closes a change record.

## Promotion Record

Production promotion must name the accountable product, support, security, release, Dynatrace tenant, Forward tenant,
application, and change owners. Record those identities in the organization's controlled acceptance record rather than
this public repository.
