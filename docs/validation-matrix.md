# Validation Matrix

This document tracks what is validated today and what still needs a live Forward/Dynatrace workflow exercise.

## Verified

| Area | Evidence |
| --- | --- |
| Dynatrace app build | `npm run build` passes locally and in GitHub Actions. |
| Forward importer reconciliation | `npm run forward:import:test` covers create, unchanged, changed, stale, fingerprints, keys, and validation failures. |
| Package validation | Importer rejects malformed packages before Forward environment variables or API calls are required. |
| UI workflow screenshots | `docs/assets/screenshots/*.jpg` were captured from the running local app. |
| Dynatrace dev deploy | Version `0.0.4` was deployed to `tjo85665.apps.dynatrace.com`. |
| Legacy export path removal | `npm run repo:validate` blocks legacy secondary-artifact terms. |
| Secret hygiene | `npm run repo:validate` blocks committed Dynatrace token-shaped secrets and non-placeholder Forward passwords. |

## Automated In GitOps

| Check | Command |
| --- | --- |
| Repository invariants | `npm run repo:validate` |
| Importer tests | `npm run forward:import:test` |
| Static lint | `npm run lint` |
| Dynatrace app build | `npm run build` |
| Whitespace sanity | `git diff --check` |

## Not Yet Fully Live-Validated

| Gap | What is needed |
| --- | --- |
| Forward dry-run against a real test network | Forward base URL, credentials, and a specific non-production `FORWARD_NETWORK_ID`. |
| Forward apply against a real test network | Explicit approval to create test intent checks in that network. |
| Forward-owned connector | Connector implementation or target connector runtime. Current repo defines the contract and manual importer. |
| Dynatrace Workflow trigger | A real problem or schedule workflow wired to call the export function. |
| End-to-end drift loop | At least two package generations with an intentional dependency change, then dry-run/report/apply review. |

## Production Gate

Before calling this production-ready beyond art-of-the-possible:

1. Run manual importer dry-run against a Forward test network.
2. Apply a small package to that test network.
3. Re-run the same package and confirm it reports unchanged.
4. Change one dependency and confirm it reports changed.
5. Remove one dependency and confirm it reports stale.
6. Document the approved update and stale-check policy, or keep both report-only.
