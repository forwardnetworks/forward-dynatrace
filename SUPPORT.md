# Support Policy

## Enterprise Preview

The latest `0.x` release is supported for controlled evaluation and non-production integration work. Support covers:

- release verification and installation;
- Dynatrace dependency discovery profiles and Workflow actions;
- Forward access-profile behavior, host/path evidence, NQE evidence, and managed intent-check reconciliation;
- documented security, data-handling, upgrade, rollback, and incident procedures.

The preview does not include a production availability SLA, custom topology development, customer credential custody,
or operation of a customer's change process.

## Request Support

Use a GitHub issue for non-sensitive defects and documentation problems. Include the release, app ID, Dynatrace feature
set, Forward deployment type, access profile, sanitized aggregate result, reproduction steps, and business impact.

Use a private security advisory for suspected vulnerabilities. Never include secrets, tenant URLs, dependency rows,
endpoints, hostnames, detailed path topology, or authenticated API bodies in a public issue.

## Version Policy

- Reproduce on the latest preview before requesting a code fix.
- Published tags and release artifacts are immutable.
- Fixes are delivered in a new semantic version; releases are never replaced in place.
- Upgrade instructions identify schema, settings, Workflow, RBAC, and rollback impact.
- Unsupported platform behavior fails closed and never broadens access or enables Forward writes.

## Production Promotion

Supported production use requires a signed `com.forward.dynatrace` distribution, completed independent security and
privacy review, named commercial support ownership, compatibility certification, and customer-operated acceptance.
