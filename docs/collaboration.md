# Collaboration Guide

This repository is designed so a new collaborator can recover product intent, constraints, current work, and verified
evidence from the checkout alone. Chat, meetings, and private notes can inform a change, but durable decisions must be
recorded here before the change is considered complete.

## Start A Change

1. Start with `README.md`, then follow the smallest route in `docs/index.md`.
2. Read the active execution plan and the executable source of truth for the behavior being changed.
3. Record a complex or multi-session change in `docs/exec-plans/active/` with objective, non-goals, progress,
   verification, decision log, and evidence to capture.
4. Use Node 24 and run the focused validation closest to the change before broad CI.
5. Never copy tenant URLs, customer data, credentials, private communications, or local secret paths into the repo.

Use a dedicated branch or worktree for concurrent work. Keep commits scoped so another collaborator can review,
revert, or continue the change without reconstructing hidden context.

## Change Loop

1. Reproduce or inspect the current behavior from code, schemas, APIs, or the running app.
2. Implement the smallest coherent behavior change.
3. Add or update an executable invariant for every new boundary or failure mode.
4. Drive affected UI journeys in the running app and capture real screenshots when presentation behavior changes.
5. Review the diff for security, contract, failure recovery, documentation, and customer-data hygiene.
6. Run `npm run ci` on Node 24.
7. Update the active plan and `docs/validation-matrix.md` with what was actually verified.
8. Open a short-lived pull request and iterate until automated and human review feedback is resolved.

Repeated review feedback is a repository defect. Promote it into a schema, test, custom repository check, or runbook
rule so the next collaborator receives the correction automatically.

## Evidence Standard

- Code claims require tests or direct source evidence.
- UI claims require browser-driven validation against the built app.
- Live integration claims require sanitized run, package, snapshot, and count evidence in the validation matrix.
- Replay, seeded, fixture, and synthetic evidence must fail closed before any evaluation or acceptance gate.
- External policy or platform limitations must be linked to an authoritative source and recorded as an external gate.

## Review Handoff

A collaborator should be able to answer these questions from the pull request and repository alone:

- What user outcome changed?
- Which trust boundary or contract is involved?
- What fails closed, and how is it recovered?
- Which focused checks and full gates passed?
- Was the running UI or live integration exercised when relevant?
- Which decision, limitation, or follow-up remains open?

The pull request template encodes these questions. Do not use a chat transcript as the handoff artifact.
