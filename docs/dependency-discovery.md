# Dependency Discovery Profiles

A dependency discovery profile is the tenant-owned contract that converts current Dynatrace spans into bounded
application relationships that Forward can resolve and evaluate. The app does not ship a customer topology query,
guess missing ports, or require environment-specific span attributes.

## Create A Profile

Open **Settings > Apps > Dependency discovery profile** and create one object for each reviewed application and
environment scope.

| Setting | Rule |
| --- | --- |
| Profile name | Stable operator-visible scope label. |
| Scope description | State the application, environment, owner, and intended evidence window. |
| Status | Only `Enabled` profiles can run. |
| Selection | Mark exactly one enabled profile `Default`, or select another profile in the app. |
| Dependency discovery DQL | Must begin with `fetch spans` and return the canonical fields below. |
| Query size | At most `5,000` characters, matching the Dynatrace app-settings bound. |
| Maximum result records | `1` through `1000`; start with `100` for the first review. |
| Maximum evidence age | `1` through `1440` minutes; start with `30`. |

Start from `deploy/dynatrace-dql/otel-span-dependencies.dql`. Review every attribute and placeholder against the target
tenant before saving it. The included query intentionally marks rows `review` with zero confidence. It is not an
automatic assertion that a service name is a routable endpoint.

## Canonical Query Output

| Field | Required behavior |
| --- | --- |
| `dependency.id` | Stable identity for one application relationship. |
| `app.name` | Authoritative application or product identifier. |
| `app.environment` | Stable environment identifier. |
| `dt.entity.service` | Dynatrace service entity when available; a missing value forces `needs-map`. |
| `service.name` | Operator-readable service identity. |
| `network.source` | Actual source IP, CIDR, hostname, or reviewed Forward host specifier from the span mapping. |
| `network.destination` | Actual destination IP, CIDR, hostname, or reviewed Forward host specifier. |
| `network.protocol` | `tcp` or `udp`. |
| `network.port` | Observed destination port from `1` through `65535`. |
| `owner.team` | Tenant-authoritative owner. |
| `criticality` | `low`, `medium`, `high`, or `critical`. |
| `dependency.confidence` | Integer from `0` through `100`; tenant policy decides the automatic threshold. |
| `dependency.mapping_state` | `ready`, `review`, or `needs-map`. |
| `dependency.observed_at` | Timestamp of the current span evidence, normally the span `start_time`. |
| `dependency.evidence_source` | Stable source label such as `dynatrace-live-spans`. |

Optional `network.source.label`, `network.destination.label`, and `dependency.run_id` fields improve operator context
without changing Forward endpoint authority.

## Fail-Closed Rules

- Only a query beginning with `fetch spans` may execute. Queries reading logs, events, business events, security
  events, or metrics are rejected.
- Query text that constructs substitute `data` or `record` rows is rejected.
- Evidence source labels containing synthetic, fixture, seeded, replay, or captured markers are rejected.
- Rows explicitly marked synthetic are rejected.
- Stale or future-dated rows are rejected against the profile evidence window.
- Missing service or endpoint identity becomes `needs-map`; low confidence becomes `review` unless the query already
  assigns a stricter state.
- Rejected rows are counted and shown, not silently promoted.

The profile DQL is never returned by the discovery app function. The UI receives only the accessible profile names,
normalized dependency candidates, aggregate evidence metadata, and bounded rejection reasons.

## Initial Mapping Review

Before the first customer-data run, record and approve:

- application and environment fields;
- service entity and service-name rules;
- actual source and destination address attributes;
- protocol and destination-port attributes;
- owner, criticality, and location/failure-domain policy;
- confidence threshold and handling of `review` rows;
- evidence window and maximum row count.

Do not mark a profile default until its current query output has been reviewed in a Notebook and the same endpoints
can be resolved in the selected Forward network.
