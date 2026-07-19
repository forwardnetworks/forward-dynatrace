# Soak And Recovery Validation

## Automated Repeated-Cycle Gate

`npm run load:soak` exercises 1,000 managed application relationships across 100 deterministic reconciliation cycles.
The first cycle creates the complete managed set in bounded 100-check batches; every subsequent cycle must be
idempotent with zero create, update, stale, or collision rows.

The gate records elapsed time, maximum batch size, cycle count, and heap high-water mark. Any mutation after the first
cycle, identity drift, unbounded batch, or readback discrepancy fails CI.

## Failure And Recovery Coverage

The full CI gate separately validates:

- transient retry limits and request timeouts;
- response-size and mutation budgets;
- credential and access-profile mismatch rejection;
- collision, partial-write, and snapshot-change stop behavior;
- exact digest and changed-source-key approval;
- post-write reconciliation and new-plan recovery;
- Guardian failure, missing evidence, and recovery outcomes.

## Environment Qualification

Before production promotion, run the same release for an organization-defined observation window in controlled
non-production environments. Include normal collection turnover, credential rotation, snapshot changes, rate-limit
behavior, Workflow scheduling, one bounded partial-failure exercise, and baseline restoration.

Retain sanitized aggregate timing, error-class, retry, reconciliation, Guardian, and resource results. Do not retain
credentials, tenant URLs, dependency rows, endpoints, hostnames, raw API bodies, or detailed path topology here.
