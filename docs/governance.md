# Governance

This repository is run as a PR-only product integration. The expected model is that all normal changes land
through review, automated checks, and an auditable release tag. Direct pushes are reserved for emergency maintenance and
must be followed by a corrective PR or documented post-change review.

## PR-Only Rules

- Require a pull request before merging to `main`.
- Require `CODEOWNERS` review for source, workflow, packaging, runtime, and documentation changes.
- Require the `gitops` workflow to pass before merge.
- Require branches to be up to date before merge.
- Dismiss stale approvals when new commits are pushed.
- Restrict direct pushes to repository admins or release maintainers only.
- Do not allow bypass for routine feature work, dependency updates, documentation updates, or release prep.

## Branch-Rule Checklist

Use this as the repository settings checklist for `main`:

| Setting | Required Value |
| --- | --- |
| Require a pull request before merging | Enabled |
| Required approvals | At least 1 |
| Dismiss stale pull request approvals | Enabled |
| Require review from Code Owners | Enabled |
| Require status checks to pass | Enabled |
| Required status check | `gitops` |
| Require branches to be up to date | Enabled |
| Require conversation resolution | Enabled |
| Require signed commits | Preferred where customer policy requires it |
| Require linear history | Preferred |
| Restrict who can push | Enabled for `main` |
| Allow force pushes | Disabled |
| Allow deletions | Disabled |

## Current Activation State

The repository names an accountable maintainer in `CODEOWNERS`; it no longer points at a non-existent placeholder team.
Required code-owner review is intentionally not enabled until Forward assigns an appropriate product or integration
team with at least two eligible reviewers. A single author cannot approve their own pull request, so enabling the rule
against only the interim owner would block valid maintenance rather than add independent review.

Before general availability:

1. assign the product and engineering owner teams;
2. replace or augment the interim maintainer in `CODEOWNERS`;
3. verify two independent members can review and merge a test pull request;
4. enable required code-owner review and administrator enforcement; and
5. decide whether organization-managed signed commits are mandatory.

All third-party GitHub Actions are pinned to full commit SHAs. The adjacent release comment preserves the upstream
version for human review and Dependabot updates. `npm run github-actions:validate` rejects mutable action tags or
missing version comments.

## Required PR Evidence

Every production-impacting PR should include:

- `npm run ci` result.
- Scope of change and customer-facing impact.
- Confirmation that the Dynatrace app still never writes to Forward.
- Confirmation that Forward credentials remain Forward-side only.
- Screenshot update status when workflow UI changes.
- Release artifact impact when package, schema, workflow, or runtime files change.

## Release Governance

- Releases are tag-driven from `main`.
- Release tags and versioned GHCR tags are immutable. Never force-move or reuse a release tag; use a new version after
  any partial publication.
- The checked pre-publish guard must confirm no prior workflow run, GitHub release, or versioned GHCR tag exists before
  release writes begin.
- Release artifacts must include checksums, SBOM, provenance attestations, and GHCR image evidence.
- `SHA256SUMS.sig` is published when the self-managed release signing key is available.
- Customer-facing verification commands live in `docs/release-provenance.md`.
- Container vulnerability evidence is published as SARIF in the release workflow.

## Emergency Bypass

Use an admin bypass only when waiting for PR approval would materially worsen a customer-impacting outage or release
integrity issue. Record the reason in the commit or release notes, run `npm run ci`, and open a follow-up PR or issue
that captures the bypass reason, validation evidence, and any longer-term control improvement.
