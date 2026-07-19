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
overrides any target metadata supplied by the browser, and calls Forward directly. Credentials and Authorization
headers never appear in action output, logs, plans, packages, or browser responses.

## Ownership Rules

1. Dynatrace owns observed service relationships, telemetry, Workflow, and Guardian history.
2. Forward owns modeled reachability, snapshots, path evidence, NQE results, and persisted intent checks.
3. Read Only and Network Operator connections never use an intent-check mutation endpoint.
4. Network Admin creates or updates only checks carrying the complete managed ownership tuple.
5. Plan approval binds the exact snapshot, profile, source keys, and canonical payload fingerprints.
6. Names alone never establish ownership. Collisions fail closed.
7. Stale checks are reported, not deleted.
8. Forward details returned to Dynatrace are bounded to the application workflow; secrets and raw error bodies are
   always excluded.

## Direct Synchronization

The action performs this sequence:

1. Load and validate `forward-api-connection` from Dynatrace app settings.
2. Select the latest processed collection snapshot.
3. Resolve endpoint names through the Forward host API with bounded concurrency and deduplicated lookups.
4. By default, evaluate the resolved flows through `/paths-bulk` in bounded batches.
5. Build managed `NewNetworkCheck[]` payloads only from eligible resolved dependencies.
6. Read current existential checks and reconcile by managed source key.
7. Return host/path counts and a plan with create, unchanged, changed, stale, and collision counts plus an immutable
   digest bound to the path evidence.
8. On Network Admin `apply`, verify complete path evidence, the exact digest, changed-key approval, and mutation budgets.
9. Create in bounded bulk batches and patch exact existing IDs.
10. Read back and require zero remaining create, changed, or collision rows.

## Failure Model

- HTTPS only; the connection URL must terminate at `/api`.
- Every request has a timeout, bounded retries for transient status codes, and a 5 MiB response cap.
- Apply stops after the first failed mutation and requires a new plan against current Forward state.
- The action never logs or returns response bodies from failed authenticated calls.
- Deletion is not implemented in the synchronization action.

## Distribution Boundary

The tag workflow publishes the tenant-validated Dynatrace app bundle, SBOM, checksums, optional detached checksum signature, and artifact
attestations. It does not build or publish a container, operating-system service, Forward package, or Python package.

See [docs/index.md](docs/index.md) for implementation and operating guides.
