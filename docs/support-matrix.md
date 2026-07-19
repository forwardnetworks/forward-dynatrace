# Support Matrix

| Area | Current support boundary |
| --- | --- |
| Product maturity | `0.12.x` enterprise preview; controlled evaluation and non-production use |
| Dynatrace | SaaS with AppEngine, Workflow, Grail spans, app settings, and Site Reliability Guardian |
| Forward | HTTPS `/api`, processed collection snapshots, host/path/check APIs, and approved NQE APIs |
| Application runtime | Dynatrace AppEngine; no external runtime |
| Development and release tooling | Node.js 24 |
| Dependency evidence | Current spans normalized by a tenant-owned discovery profile |
| Intent synchronization | Read Only/Network Operator plan; Network Admin exact-approved create and update |
| Deletion | Not implemented; stale managed checks are report-only |
| Distribution | Tenant-validated GitHub prerelease; signed Dynatrace distribution required for supported production |
| Release evidence | App archive, CycloneDX SBOM, SHA-256 checksums, optional signature, GitHub attestations |
| Compatibility | Capability-based contract in [Compatibility policy](compatibility-policy.md); validated per release |
| Support | Community preview support under [Support policy](../SUPPORT.md); commercial production support is an external promotion gate |

Unsupported configurations fail closed. A missing capability, stale snapshot, incomplete mapping, ownership collision,
or mismatched approval produces an operator-visible plan or error and does not broaden access or mutate Forward.
