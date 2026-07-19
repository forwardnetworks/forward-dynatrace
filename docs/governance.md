# Governance

- Protect `main` and require CI plus code review.
- Treat app function, connection schema, RBAC policy, release workflow, and data boundary changes as security-sensitive.
- Keep customer-specific environments, topology, telemetry, and credentials outside the public repository.
- Do not add repository-local `AGENTS.md`, `CLAUDE.md`, or equivalent collaborator-specific instructions.
- Require a Read Only acceptance pass before enabling a Network Admin connection.
- Require exact plan approval and post-apply readback for every mutation workflow.
- Never move or reuse a published tag; create a new version.
- Publish one tenant-validated Dynatrace app bundle plus checksum, SBOM, optional signature, and attestation evidence.
- Record live evidence and remaining gaps in the validation matrix before promotion.
