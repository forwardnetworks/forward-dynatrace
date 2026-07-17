# Forward And Dynatrace Change-Validation Gate

The change-validation gate combines already-collected Dynatrace deployment/service-health context, Forward before and
after path evidence, and sanitized Forward reconciliation status into one deterministic `pass`, `warn`, or `fail`
artifact. The command is read-only and does not call or mutate Forward, Dynatrace, or a deployment system.

## Inputs

- Change context matching `schemas/forward-change-context.schema.json`.
- Before-change path evidence from `npm run forward:path-evidence -- --execute`.
- After-change path evidence from the same Forward network and an approved processed snapshot.
- Sanitized Forward reconciliation status matching `schemas/forward-ingest-status.schema.json` and targeting the after
  snapshot.

Each input is SHA-256 hashed into the gate artifact. The output contains only aggregate evidence; it does not copy path
rows, endpoints, devices, check definitions, credentials, or Forward response bodies.

An optional lifecycle Guardian context can add the reviewed application/service scope, evidence window, protocol/port
sets, and matching Forward network/snapshot IDs. The publisher rejects mismatched evidence before publication. See
[Site Reliability Guardian](site-reliability-guardian.md).

## Build The Gate

```bash
npm run schemas:validate -- \
  --change-context config/forward-change-context.example.json

npm run forward:change-gate -- \
  --context config/forward-change-context.example.json \
  --before-evidence /secure/evidence/before-path-evidence.json \
  --after-evidence /secure/evidence/after-path-evidence.json \
  --reconciliation-status /secure/evidence/forward-ingest-status.json \
  --output /secure/evidence/forward-change-validation-gate.json

npm run schemas:validate -- \
  --change-validation-gate /secure/evidence/forward-change-validation-gate.json
```

Use `--fail-on-non-pass` in a customer-owned deployment job when both `warn` and `fail` should stop promotion. The
command writes the evidence artifact first, then exits `2` for a non-pass decision.

To trigger the checked lifecycle Guardian after the gate is built, publish the sanitized event with
`--guardian-context`, `--guardian-trigger`, and an identical `--run-id`. Guardian trigger publication is opt-in so the
existing batch event path remains unchanged.

## Decision Rules

The gate fails closed for:

- missing or mismatched Forward networks/snapshots;
- plan-only rather than executed Forward evidence;
- failed or blocked after-change path results;
- a reachability regression from the before snapshot;
- failed Dynatrace deployment, unhealthy service, or open affected-service problems;
- reconciliation against the wrong target, failed reconciliation, or changed/stale managed intent.

The gate warns for:

- the same before and after snapshot;
- partial, ambiguous, or unmapped Forward evidence;
- in-progress/unknown deployment state or degraded/unknown service health;
- reconciliation that has not reached `reconciled` or `applied`.

It passes only when there are no fail or warning reasons. The same input bytes and context `observedAt` produce the same
decision, reasons, evidence hashes, and output bytes.

## Ownership And Stop Rules

- Forward remains the source for modeled network evidence and persistent intent.
- Dynatrace remains the source for deployment, problem, and service-health context.
- The customer's deployment system decides whether and how to enforce the artifact.
- Do not auto-remediate a failed gate.
- Do not compare unrelated networks or silently substitute latest snapshots.
- Missing, partial, or low-confidence evidence must not silently pass.

## Live Evidence Exercise

On 2026-07-12, a non-production live exercise queried 100 Trial dependency rows and selected 12 showcase flows. Forward
network `235937`, snapshot `1322821` returned 12 blocked path results with 0 ambiguous, unmapped, or failed rows. The
Forward dry-run planned 10 creates with 0 changed or stale checks.

The exercise intentionally supplied snapshot `1322821` as both before and after. The gate returned `fail` with
`FORWARD_SNAPSHOT_UNCHANGED` and `FORWARD_BLOCKED_PATHS`; `--fail-on-non-pass` exited `2`. The output passed its public
schema and had SHA-256 `c3691aea3a0d1a7fab1ba431ef0abedb29df81624b77f0ca7e0679c8ffacc34c`. This validates
fail-closed behavior, not a safe-change result. A real before/after snapshot pair remains required for the Increment 2
acceptance demonstration.
