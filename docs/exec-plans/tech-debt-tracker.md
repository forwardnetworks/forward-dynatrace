# Technical Debt Tracker

This tracker holds deferred structural work, not live deployment tasks or unapproved product ideas. Add an item only with
a trigger and verifiable exit condition.

| ID | Status | Debt | Trigger | Exit condition |
| --- | --- | --- | --- | --- |
| HD-001 | deferred | Multi-version Forward API compatibility coverage | A second Forward API version becomes a supported deployment target. | CI runs the contract suite against every supported Forward API version. |
| HD-002 | deferred | Multi-version Dynatrace App Toolkit compatibility coverage | Product/support declares more than one supported toolkit baseline. | CI builds and runs the app contract suite on every supported baseline. |
| HD-003 | deferred | Schema upgrade/migration tests | A second package schema version is introduced. | Upgrade, downgrade-rejection, and compatibility fixtures cover both versions. |
| HD-004 | monitoring | Repository knowledge can drift as docs grow | A new top-level document or execution plan is added. | `repo:validate` rejects unindexed docs, missing plan sections, and an oversized `AGENTS.md`. |

Product ideas such as a package-history UI stay in `docs/enterprise-hardening.md` until product ownership and support
scope are decided.

