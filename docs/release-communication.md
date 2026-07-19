# Release Communication

Every release announcement must state:

- version, maturity channel, publication time, and immutable commit;
- customer-visible capabilities and behavior changes;
- security, RBAC, schema, settings, Workflow, and data-boundary impact;
- compatibility and validation evidence;
- exact installable archive name and verification commands;
- upgrade, rollback, known-limit, and support information.

Security advisories identify affected versions and fixed versions without publishing exploit details before coordinated
disclosure. Breaking changes require a new minor version during the `0.x` preview. Fixes that preserve the documented
contract use a patch version.

Release notes must not contain credentials, tenant URLs, customer names, dependency rows, endpoints, network or
snapshot IDs, hostnames, path topology, or private acceptance evidence.
