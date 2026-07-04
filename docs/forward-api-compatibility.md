# Forward API Compatibility Notes

These notes pin the Forward API assumptions used by this field integration. Forward source is reference material only;
this repository must not modify Forward source code.

## Required Base Workflow

The base workflow requires these Forward API capabilities:

| Capability | Endpoint or schema | Use |
| --- | --- | --- |
| Latest processed snapshot | `GET /api/networks/{networkId}/snapshots/latestProcessed` | Pick a snapshot that can accept new checks. |
| Host resolution | `GET /api/networks/{networkId}/hosts/{hostSpecifier}?snapshotId={snapshotId}` | Resolve Dynatrace names, cloud host IDs, IPs, or MACs through Forward snapshot host inventory before package generation. |
| Optional path evidence | `POST /api/networks/{networkId}/paths-bulk?snapshotId={snapshotId}` | Evaluate resolved dependencies with read-only Forward path search before approval. |
| Existing check inventory | `GET /api/snapshots/{snapshotId}/checks?type=Existential` | Reconcile by name and `dynatrace-key:*` tag before writing. |
| Persistent check create | `POST /api/snapshots/{snapshotId}/checks?bulk` | Create missing `NewNetworkCheck[]` entries after validation. |
| Optional deactivation | `DELETE /api/snapshots/{snapshotId}/checks/{checkId}` | Replace changed checks or retire stale checks only behind approval gates. |

Forward schema references used by the package builder:

- `NewNetworkCheck` requires `definition` and may include `enabled`, `name`, `note`, `perfMonitoringEnabled`,
  `priority`, and `tags`.
- `CheckDefinition` supports `Existential`, `Isolation`, `Reachability`, `QueryStringBased`, `Predefined`, and `NQE`.
- The base package emits `Existential` checks. `ExistsCheck` requires `filters`.
- Location filters include `HostFilter`, `DeviceFilter`, `SubnetLocationFilter`, aliases, VRFs, security zones, and
  related filter types.

The importer validates `NewNetworkCheck[]` locally before any Forward API request. It rejects unresolved or unsupported
generated data rather than relying on Forward to clean it up after the fact.

## Host Resolution Compatibility

The host-resolution preflight uses Forward's inventory-backed host lookup:

```text
GET /api/networks/{networkId}/hosts/{hostSpecifier}?snapshotId={snapshotId}
```

The Forward implementation describes `hostSpecifier` as a host name, cloud host ID, IP address, or MAC address. The
response contains a `hosts` array with host details such as `subnets`, `deviceName`, and endpoint metadata. This
integration treats exactly one usable host subnet as `ready`, multiple candidates as `review`, and no candidates as
`needs-map`.

The package builder keeps original Dynatrace source/destination values for deterministic `dynatrace-key:*` tags and
uses `sourceResolvedValue` and `destinationResolvedValue` for the generated Forward check filters when the resolver
provides them.

## Optional Path Evidence Compatibility

Read-only path evidence uses Forward's bulk path-search endpoint:

```text
POST /api/networks/{networkId}/paths-bulk?snapshotId={snapshotId}
```

The request body uses Forward's `PathSearchBulkRequest` contract: `queries`, `intent`, `maxCandidates`, `maxResults`,
`maxReturnPathResults`, `maxSeconds`, `maxOverallSeconds`, `includeTags`, and `includeNetworkFunctions`. Each query uses
Forward `FlowSpec` fields such as `srcIp`, `from`, `dstIp`, `ipProto`, and `dstPort`.

This is evidence only. It does not create or update Forward checks. The same resolved dependency file can then be used
for package generation so path evidence and intent checks are based on the same Forward-resolved endpoint values.

## Bulk Create Compatibility

This integration uses the Forward bulk check create path:

```text
POST /api/snapshots/{snapshotId}/checks?bulk
```

Target Forward environments must support this field integration contract before production use. The local Forward API
source also documents single-check creation at `POST /api/snapshots/{snapshotId}/checks`; that is useful for schema
reference, but this project intentionally uses the bulk path for scalable intent-check creation and does not implement
a silent fallback. If a target Forward version does not support bulk create, stop and resolve the API/version mismatch
instead of partially importing checks one at a time.

## Optional Read-Only NQE Preview

Read-only preview uses:

```text
POST /api/nqe
```

The synchronous `NqeQueryRunRequest` contract supports exactly one of:

- raw `query` source, used for allowlisted preview templates and the default read-only preview path
- committed Forward NQE Library `queryId`, used only when the customer enables the optional query-ID path

It may also include `commitId`, `parameters`, and `queryOptions` such as `limit` and `offset`. Dynatrace preview
execution must use a read-only Forward credential with NQE execution permission only.

Query-ID preview is optional. The base intent-check workflow and the default read-only preview path must continue to
work when no Forward query IDs are configured. Use query IDs only for customer-approved stable previews, persistent NQE
checks, or NQE diffs.

## Optional Persistent NQE Checks

Persistent NQE checks use the same Forward check API as other checks, but their definition must be:

```json
{
  "checkType": "NQE",
  "queryId": "FQ_aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
  "params": {
    "application": "checkout",
    "environment": "prod"
  }
}
```

Compatibility requirements:

- `queryId` must refer to committed Forward-owned NQE Library content.
- The Forward-side runtime must allowlist each query ID.
- Dynatrace may supply parameters and context, but must not create or commit NQE Library queries.
- Customers can opt out of this path without losing the base intent-check workflow.

## Optional NQE Diffs

NQE diff metadata targets:

```text
POST /api/nqe-diffs/{before}/{after}
```

The documented request body uses a committed `queryId`, optional `commitId`, optional `options`, and documented
parameter support for queries that declare parameters. Because this is a read-only analysis workflow, the importer
validates and reports diff request metadata but does not execute diffs during check import.

NQE diffs are optional. They are useful for before/after evidence and trial storytelling, but the production intent
workflow must not depend on them and must not require a customer to approve query IDs before base intent-check ingest
works.

## Version Gate Before A Customer Trial

Before enabling a target Forward environment, run:

1. Validate-only with no Forward credentials.
2. Forward dry-run against the target network.
3. If approved, apply one small package.
4. Rerun the same package and confirm unchanged reconciliation.
5. If optional NQE artifacts are enabled, validate query ID allowlisting and run one read-only preview or diff outside
   the import transaction.

Stop if any required endpoint is missing, if the bulk create contract is unsupported, or if the customer-approved
credential model cannot separate Dynatrace read-only preview from Forward-side write import.
