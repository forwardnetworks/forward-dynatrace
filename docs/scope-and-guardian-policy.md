# Scope Mapping And Guardian Policy

This is the customer-neutral decision contract for joining Dynatrace service evidence, Forward network evidence, and
Site Reliability Guardian without copying either platform's topology into the other. Complete one reviewed record per
pilot application/environment scope before enabling scheduled export or automated Guardian execution.

## Authority Boundary

| Data | Authority | Shared form |
| --- | --- | --- |
| Application, service entity, environment, request telemetry, and historical health | Dynatrace | Stable IDs and aggregate health evidence |
| Endpoint resolution, possible paths, intent checks, and snapshot comparison | Forward | Stable target IDs and sanitized aggregate outcomes |
| Owner, criticality, location/failure domain, and change identity | Customer operating model | Reviewed scope-mapping record |

Neither platform imports the other's full topology. The stable `mappingId` joins the selected scope and evidence
window. Detailed hostnames, IP addresses, path hops, raw query results, and credentials stay in the protected
Forward API or Dynatrace evidence record.

## Required Scope Record

| Field | Rule |
| --- | --- |
| `mappingId` | Opaque, stable, customer-assigned ID. Do not reuse it for unrelated applications or environments. |
| `applicationId` | Stable application identifier selected by the Dynatrace owner. |
| `environmentId` | Stable environment identifier such as a non-production stage, not a display label that changes. |
| `serviceEntityIds` | One to 100 reviewed Dynatrace service entity IDs. |
| `owner` | Team or service owner responsible for telemetry and threshold decisions. |
| `criticality` | `low`, `medium`, `high`, or `critical`. |
| `locations` | Zero to 20 stable location or failure-domain IDs; omit when not part of the pilot decision. |
| `protocolsAndPorts` | At least one bounded protocol/port set observed in live spans. |
| `minimumConfidence` | Minimum mapping confidence accepted for automatic package eligibility. Start at 100 for a pilot. |
| `forwardNetworkId` | Exact non-production Forward network selected by the network owner. |
| `evidenceWindowPolicy` | Positive window no longer than 24 hours; use the shortest window that contains authoritative telemetry. |

The checked `forward-guardian-execution-context/v1` schema enforces the runtime subset of this record. Keep the full
reviewed record in the customer's protected change or configuration system, not in this public repository.

## Eligibility Decisions

| Condition | Default decision |
| --- | --- |
| Both endpoints resolve exactly and confidence meets the reviewed minimum | `ready` |
| An endpoint has multiple candidates or confidence is below the minimum | `review`; excluded unless an operator explicitly overrides it |
| An endpoint has no Forward mapping | `needs-map`; always excluded from apply |
| Service entity or required protocol/port evidence is missing | Fail closed; do not generate intent |
| Mapping ID, application, environment, or evidence window does not match the trigger | Fail closed; do not run or accept Guardian evidence |

Endpoint eligibility is established by the Forward host-resolution report. NQE is not part of this mapping contract.

## Guardian Pilot Policy

The Monaco package ships conservative starter objectives. These values are pilot inputs, not universal service-level
objectives:

| Objective | Starter behavior | Promotion rule |
| --- | --- | --- |
| Forward validation evidence | Enforcing; newest matching event must pass (`>= 1`). | Keep fail-closed. |
| Service telemetry present | Enforcing; at least one matching server span (`>= 1`). | Keep fail-closed. |
| Request availability | Fail below 99%; warning below 99.5%. | Owner reviews service-specific baseline and error semantics. |
| Request performance | Fail below 95% within 500 ms; warning below 98%. | Owner reviews the latency target and evidence window. |
| Request volume | Informational. | Enforce only after a minimum-volume baseline is approved. |
| Error log count | Informational. | Enforce only after log scope and acceptable count are approved. |

Start with static thresholds. Evaluate auto-adaptive thresholds only after at least five representative validation runs
and an owner review of seasonality, low-volume behavior, and missing-data semantics.

## Review Record

Record these decisions before a controlled non-production run:

- Dynatrace scope owner and network scope owner;
- exact mapping ID, application/environment IDs, and service entity IDs;
- Forward network and approved access profile;
- minimum confidence and review-row policy;
- Guardian objective values, warnings, informational objectives, and evidence window;
- installer, operator, approver, support route, and rollback owner;
- review date and next review date.

Acceptance requires one passing run, one deliberate objective failure, and one missing-evidence run that fails closed,
all joined to the same reviewed scope contract and retained correlation evidence.
