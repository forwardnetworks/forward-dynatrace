# Execution Plans

Plans are versioned repository artifacts. Small tasks may use an ephemeral working plan; multi-step or cross-system work
must have a checked-in plan with progress, decisions, verification, and evidence.

## Active

- [Customer production readiness](active/customer-production-readiness.md): land the current tranche, install owned
  runtimes, and complete live acceptance.
- [Design-partner pilot](active/design-partner-pilot.md): install in sandbox, define shared context, validate Guardian
  automation, exercise scale, and promote a signed build to non-production.

Only active work belongs in `active/`. Update its checkboxes and decision log as work progresses.

## Completed

Completed plans are immutable summaries. Correct factual errors, but do not reuse them for new work.

## Technical Debt

- [Technical debt tracker](tech-debt-tracker.md): deferred structural or compatibility work with an explicit trigger,
  owner, and exit condition.

## Required Plan Shape

Every active plan must state:

- status, owner, and last updated date;
- objective and non-goals;
- progress as checkboxes;
- ordered execution steps and verification;
- decision log;
- evidence to capture and completion criteria.
