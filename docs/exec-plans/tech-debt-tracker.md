# Technical Debt Tracker

This tracker holds deferred structural work, not live deployment tasks or unapproved product ideas. Add an item only with
a trigger and verifiable exit condition.

| ID | Status | Debt | Trigger | Exit condition |
| --- | --- | --- | --- | --- |
| HD-001 | deferred | Multi-version Forward API compatibility coverage | A second Forward API version becomes a supported deployment target. | CI runs the contract suite against every supported Forward API version. |
| HD-002 | deferred | Multi-version Dynatrace App Toolkit compatibility coverage | Product/support declares more than one supported toolkit baseline. | CI builds and runs the app contract suite on every supported baseline. |
| HD-004 | monitoring | Repository knowledge can drift as docs grow | A new top-level document or execution plan is added. | `repo:validate` rejects unindexed docs and missing plan sections. |
| HD-005 | deferred | Multi-version contract and migration design | Product ownership intentionally approves a second public contract. | A separate execution plan defines support windows, downgrade rejection, migration evidence, and removal criteria before multi-version code is added. |
| HD-006 | blocked on ownership | Independent CODEOWNERS enforcement | Product and integration owner teams with at least two eligible reviewers are assigned. | Replace or augment the interim owner, verify independent review on a test PR, then enable code-owner and administrator enforcement. |

Product ideas such as a package-history UI stay in `docs/enterprise-hardening.md` until product ownership and support
scope are decided.
