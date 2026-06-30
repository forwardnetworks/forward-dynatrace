# Incident Response Runbook

Use this when Forward-side import fails, drifts unexpectedly, or creates only part of a planned package.

## Triage

1. Stop scheduled imports until the failure class is known.
2. Preserve the manifest, checks package, import report, and runtime logs.
3. Record package ID, run ID, Forward network ID, Forward snapshot ID, and importer version.
4. Do not rerun with `--apply` until validation and dry-run pass.

## Failure Classes

| Failure | First Action |
| --- | --- |
| Manifest checksum mismatch | Reject package; regenerate export; inspect handoff storage access logs. |
| Stale manifest | Regenerate package or raise `maxPackageAgeMinutes` only with operator approval. |
| Missing Forward credential | Fix runtime secret injection; do not add credentials to config or Dynatrace. |
| Forward 401/403 | Rotate or rescope credentials; confirm target tenant/network permissions. |
| Forward 429/5xx | Let retry budget run; increase schedule interval or reduce batch size. |
| Forward 4xx on create | Treat as mapping/config error; inspect rejected location filters and package rows. |
| Changed drift | Review generated field differences; do not auto-update without approved policy. |
| Stale drift | Review service retirement and ownership; do not auto-delete without approved policy. |
| Partial bulk create | Keep report/logs; rerun dry-run to identify remaining missing checks before apply. |

## Recovery

1. Run `--validate-only`.
2. Run dry-run and compare counts with the failed run.
3. If only missing checks remain and policy allows, rerun `--apply`.
4. If changed or stale drift remains, route to the Forward owner for review.
5. Close the incident only after the report and Forward readback agree.

## Post-Incident

- Add a regression test when the failure was deterministic.
- Update package validation if a malformed package reached Forward calls.
- Update runbook steps if operator action was ambiguous.
- Rotate credentials if logs, package storage, or runtime access may have exposed secrets.
