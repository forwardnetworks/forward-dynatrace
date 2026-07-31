# Architecture

Forward for Dynatrace is a single Dynatrace AppEngine application. The application UI, app functions, settings schema,
and Workflow action ship together. Forward requires no installed software from this project.

## Trust Boundary

```text
Dynatrace tenant
  UI: dependencies, plans, Guardian and modeled evidence
  app functions: validation, host/path queries, reconciliation
  app settings: Forward URL, network, profile, username, secret password
       |
       | HTTPS, outbound host allowlisted by the tenant
       v
Forward tenant
  REST APIs: snapshots, checks and path data
  NQE APIs: approved Library IDs or arbitrary queries according to Forward RBAC
```

The UI supplies dependency evidence and approval inputs. The app function loads the selected secret connection,
creates the Workflow action inputs, while the Workflow action performs all Forward API calls using
secret credentials loaded from app settings. Credentials and Authorization headers never appear in action output,
logs, plans, packages, or browser responses.

## Ownership Rules

1. Dynatrace owns observed service relationships, telemetry, Workflow, and Guardian history.
2. Forward owns modeled reachability, snapshots, path evidence, NQE results, and persisted intent checks.
3. Read Only and Network Operator connections never use an intent-check mutation endpoint.
4. Network Admin creates or updates only checks carrying the complete managed ownership tuple.
5. Plan approval binds the exact snapshot, profile, source keys, and canonical payload fingerprints. Legacy
   `digest` authorization is possession-based; opt-in `engine-approval` also binds the engine-carried original plan,
   engine outcome and nonce, and a 15-minute freshness window.
6. Names alone never establish ownership. Collisions fail closed.
7. Stale checks are reported, not deleted.
8. Forward details returned to Dynatrace are bounded to the application workflow; secrets and raw error bodies are
   always excluded.
9. NQE execution is async-first: action submit, status polling, and bounded result fetch. Optional sync execution remains
   available only with `executeSync: true`.

## Direct Synchronization

The action performs this sequence:

1. Load and validate `forward-api-connection` from Dynatrace app settings.
2. Select the latest processed collection snapshot.
3. Resolve endpoint names through the Forward host API with bounded concurrency and deduplicated lookups.
4. Resolve modeled path evidence through `/paths-bulk` when `runPathPreflight` is true or defaulted.
5. Build managed `NewNetworkCheck[]` payloads only from eligible resolved dependencies.
6. Read current existential checks and parse them through `parseCheckList`, which rejects any paginated or
   ambiguous response shape.
7. Reconcile by strict managed ownership tuple (`managed-by`, `contract-version`, `source-instance`, `source-key`);
   missing/ambiguous identity or foreign source-instance tuples are collisions.
8. Return host/path counts and a plan with create, unchanged, changed, stale, and collision counts plus an immutable
   digest bound to budgets, fingerprints, source-key set, and complete path-evidence quality.
9. On Network Admin `apply`, enforce `runPathPreflight !== false`, then re-read current checks, reconcile again, and
   re-verify the exact approved whole-plan digest, complete path evidence (`ready` only), and full-plan mutation
   budgets immediately before the first mutating operation.
10. If `applySourceKeys` is present, require it to be a non-empty subset of the current changed set and require
    `approvedSourceKeys` to equal that subset; otherwise retain the legacy exact-full-changed-set rule. Validate
    opt-in engine approval before mutation.
11. Create all planned creates in bounded bulk batches and patch exact existing IDs for either the full changed set or
    the selected update partition. At most 500 sequential PATCHes are allowed per invocation.
12. Read back after mutation. Full apply requires zero remaining create, changed, or collision rows. Partitioned apply
    requires zero creates and collisions plus convergence of every selected key, then reports current outstanding
    keys. Any later partition requires a newly planned and approved digest.

## Failure Model

- HTTPS only; the connection URL must terminate at `/api`.
- Every request has a timeout.
- Async execution uses 1-second minimum polling between `nqe-executions/{executionKey}` reads and bounded `limit` on result
  fetches; 404 on status/result is treated as an explicit key-expired condition.
- Read-only calls (including `GET` and selected `POST` usage such as `/paths-bulk`) have bounded retries for transient
  status codes; mutating `POST`/`PATCH` on checks are never retried.
- A 5 MiB bounded streaming transfer limit applies before JSON parsing. `Content-Length` is checked first; oversized
  responses fail with the existing error contract before buffering.
- Apply verifies `approvedPlanDigest` against current state and mutates nothing if any budget, ownership,
  evidence, or digest constraint fails.
- `approvalMode` defaults to possession-based `digest` for compatibility. `engine-approval` additionally requires a
  trusted `APPROVED` Workflow outcome, engine-carried matching original plan, matching engine nonce, and fresh
  15-minute window. The action does not infer a human identity from the untyped approval event.
- Partition selection never narrows digest validation: drift anywhere in the whole plan rejects before mutation.
  Successful mutation changes the digest, so outstanding keys are evidence only and cannot be applied with the old
  approval.
- Concurrent apply is not fully prevented. The pre-mutation re-read and digest re-verification narrow the race window,
  mutation budgets bound each invocation, and post-apply readback verifies the result, but there is no durable
  cross-invocation lock.
- A settings-backed lock was rejected because `app-settings:objects:write` would also allow modification of the
  credential-bearing `forward-api-connection` object and its access profile. If simultaneous applies both create the
  same managed check, the next plan reports `duplicate-existing-source-key` and blocks apply fail-closed. The
  duplicates require manual cleanup because deletion is not implemented.
- Apply stops after the first failed mutation and requires a new plan against current Forward state.
- The action never logs or returns response bodies from failed authenticated calls.
- Deletion is not implemented in the synchronization action.

## Distribution Boundary

The tag workflow publishes the tenant-validated Dynatrace app bundle, SBOM, checksums, optional detached checksum signature, and artifact
attestations. It does not build or publish a container, operating-system service, Forward package, or Python package.

See [docs/index.md](docs/index.md) for implementation and operating guides.
