# Design-Partner Evaluation

This sequence turns an installed preview into evidence for a product and security decision. It is intentionally
customer-neutral: tenant names, URLs, credentials, queries, topology, and observed dependency rows belong in the
customer's approved evidence system, never in this repository.

## Phase 1: Sandbox Contract Validation

1. Install the verified app archive and confirm the exact app ID and version.
2. Approve the exact Forward API hostname for outbound app requests.
3. Create a dedicated Forward integration identity and grant **Read Only**.
4. Store that identity in an APP_ENGINE-scoped Dynatrace Credential Vault username/password entry. Share it only with
   the users who configure and execute this app.
5. Create one reviewed distributed-trace profile and, when OneAgent network connection monitoring is available, one
   reviewed network-flow profile.
6. Run each query in a Notebook first. Record the selected fields, evidence age, row count, rejected rows, and mapping
   gaps without exporting raw customer data.
7. Create the Forward connection by Vault entity ID and run a Read Only intent-check plan. No Forward mutation is part
   of sandbox acceptance.

Sandbox exit criteria are successful Vault resolution, exact host allowlisting, current evidence from the declared
source, bounded query execution, Forward endpoint resolution, modeled-path preflight, deterministic plan output, and
zero credential or topology-detail disclosure in browser and Workflow results.

## Phase 2: Non-Production Scope Validation

Use a non-production environment that contains real monitored services and a corresponding Forward network model.

- Compare distributed-trace dependencies with OneAgent network-flow dependencies. Treat them as complementary inputs,
  not duplicate authoritative topology stores.
- Confirm how service, host, process, endpoint, protocol, and destination-port fields map in this tenant.
- Select important application scope through tenant-owned tags or an approved external application/CMDB mapping.
- Review duplicate connections, shared endpoints, NAT or proxy boundaries, IPv6, missing ports, and endpoint ambiguity.
- Confirm deterministic application, environment, owner, criticality, and source-identity tags on planned checks.
- Repeat the same plan after a new processed Forward snapshot and confirm stable reconciliation.

Only after Read Only evidence passes should the tenant consider a separate Network Admin service identity. Network
Admin requires explicit plan approval, mutation budgets, bounded create/update scope, immediate readback, and an
organizational closeout policy. Network Operator remains plan-only in this app.

## Query Handoff

The tenant observability team owns the reviewed DQL because entity attributes and tagging vary by environment. The app
team needs only the field contract and sanitized aggregate results:

- source type and query profile name;
- accepted and rejected row counts;
- mappings used for application, environment, service/process, endpoints, protocol, port, owner, and criticality;
- evidence time window and stable evidence-source label;
- known gaps or duplicates that require operator review.

Start from the templates in `deploy/dynatrace-dql/`. Do not commit tenant query values or exported rows.

## Product Promotion Gates

- Dynatrace technical-partnership and signed distribution path agreed.
- Independent security, privacy, accessibility, and support review complete.
- Credential rotation, audit attribution, incident response, upgrade, and rollback exercised.
- Sandbox and non-production acceptance records approved by the application, network, observability, and security
  owners.
- Store metadata, support ownership, compatibility policy, immutable release evidence, and vulnerability policy
  approved.

Until those gates pass, releases remain enterprise previews for controlled non-production evaluation.
