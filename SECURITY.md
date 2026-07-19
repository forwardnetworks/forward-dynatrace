# Security Policy

Forward for Dynatrace treats app functions, secret connections, Forward API authorization, intent-check mutation,
release automation, and telemetry data handling as security-sensitive boundaries.

## Supported Versions

| Version | Security updates |
| --- | --- |
| Latest `0.x` enterprise preview | Yes |
| Earlier preview releases | Upgrade required before investigation or remediation |

The enterprise preview is intended for controlled evaluation and non-production use. A signed Dynatrace distribution
and production support policy are required before production deployment.

## Report A Vulnerability

Use the repository's **Security > Report a vulnerability** private advisory workflow. Do not open a public issue for a
suspected vulnerability and do not include credentials, tenant URLs, dependency rows, endpoints, hostnames, path
topology, or authenticated response bodies.

Include:

- affected release and app ID;
- affected trust boundary and access profile;
- minimal sanitized reproduction steps;
- expected and observed behavior;
- impact and any known workaround;
- whether credential exposure or Forward mutation may have occurred.

## Response Targets

For the enterprise preview, the maintainers target acknowledgement within two business days, initial severity triage
within five business days, and a remediation plan for confirmed critical issues within seven business days. These are
engineering response targets, not a production SLA.

## Coordinated Disclosure

Maintain confidentiality until a fixed release and advisory are available. Security fixes receive a new immutable
version, complete CI and release verification, an upgrade note, and an explicit statement of affected versions.

## Security Design

See [Threat model](docs/threat-model.md), [Data handling](docs/data-handling.md), [RBAC](docs/rbac.md), and
[Release provenance](docs/release-provenance.md).
