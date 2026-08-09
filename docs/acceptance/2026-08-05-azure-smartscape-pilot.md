# Azure Smartscape Pilot Setup Evidence

This repository-safe record captures aggregate evidence from the August 5, 2026 engineering setup. Customer names,
tenant URLs, Forward network and snapshot IDs, cloud-account identifiers, resource names, subscription IDs,
Credential Vault IDs, credentials, and raw API responses remain in the protected operator record.

## Decision

**Azure inventory setup: PASS. Application-flow end-to-end: NOT YET VERIFIED.**

An isolated child workspace was created from the design-partner Forward network with only the two approved Azure cloud
accounts. Its initial subset snapshot reached `PROCESSED`, and no customer intent, predefined, NQE, or custom-command
configuration was inherited. A temporary engineering-tenant Smartscape replica accepted the same Azure inventory as
custom entities and returned the expected aggregate topology on DQL query-back. A Vault-backed Read Only connection
was then saved and exercised by an on-demand Workflow plan against that child workspace.

The Azure Smartscape data is inventory and mapping evidence. It does not contain an observed application source,
destination, TCP/UDP protocol, and destination port, so it was not promoted to Forward intent checks. The successful
Workflow used one manually selected Azure endpoint pair as a connectivity/model control; it is not application-flow
evidence.

## Aggregate Evidence

| Control | Result |
| --- | --- |
| Forward child workspace scope | Two Azure cloud accounts; no GCP, vCenter, or selected device setup |
| Initial workspace snapshot | `PROCESSED` |
| Azure objects | 4,637 |
| Other modeled object | One Forward built-in Internet service |
| Azure source split | 724 non-production; 3,913 production |
| Azure type totals | 3,208 subnets; 837 VNets; 302 load balancers; 108 application gateways; 85 Front Doors; 27 firewalls; 27 VNet gateways; 20 vWAN hubs; 9 ExpressRoute circuits; 8 ExpressRoute gateways; 6 VPN gateways |
| Inherited existential checks | Zero |
| Inherited predefined checks | Zero |
| Dynatrace ingest | 4,637 custom Azure resource entities accepted in bounded Smartscape event batches |
| Dynatrace DQL query-back | 4,637 resource-to-workspace relationships returned across the expected source/type groups |
| Forward app release | Existing enterprise-preview `my.forward` version `0.13.4` remained registry `OK` |
| Forward app connection | Saved with the isolated workspace, existing Credential Vault reference, and Read Only profile |
| Read Only Workflow plan | `SUCCESS`; one endpoint pair resolved, one path queryable and reachable, zero failed/ambiguous/unmapped paths |
| Reconciliation plan | One create proposed; zero changed, stale, or colliding rows |
| Forward mutations | Zero created and zero updated; existential-check read-back remained zero |

## Remaining Acceptance Work

- Confirm native design-partner Azure Notebook queries and representative cross-product resource mappings.
- Select a current OneAgent network-flow or trace query that returns the canonical endpoint/protocol/port contract.
- Repeat the installed Read Only plan with current observed dependency rows; the completed manual connectivity control
  does not satisfy application-flow acceptance.
- Run the separately approved async NQE acceptance if that surface is in the next-call scope.

Follow [Azure Smartscape pilot](../azure-smartscape-pilot.md) for the setup and debug sequence.
