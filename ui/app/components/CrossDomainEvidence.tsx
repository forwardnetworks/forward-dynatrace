import React from "react";

import { Button } from "@dynatrace/strato-components/buttons";
import { ProgressCircle } from "@dynatrace/strato-components/content";
import { Heading, Strong } from "@dynatrace/strato-components/typography";
import {
  AutomationEngineIcon,
  DatabaseIcon,
  NetworkIcon,
  SyncIcon,
} from "@dynatrace/strato-icons";
import { useDql } from "@dynatrace-sdk/react-hooks";

type EvidenceRecord = Record<string, unknown>;

const INGEST_QUERY = [
  "fetch events, from: now() - 24h",
  "| filter event.type == \"forward.dynatrace.ingest.status\"",
  "| filter `forward.dynatrace.synthetic` == false",
  "| sort timestamp desc",
  "| dedup `forward.dynatrace.publisher_run_id`",
  "| fields timestamp, severity, `forward.dynatrace.publisher_run_id`,",
  "    `forward.dynatrace.run_id`, `forward.dynatrace.package_id`,",
  "    `forward.dynatrace.evidence_source`, `forward.dynatrace.synthetic`,",
  "    `forward.dynatrace.mode`, `forward.dynatrace.import_state`,",
  "    `forward.dynatrace.signature_status`,",
  "    `forward.dynatrace.target.network_id`, `forward.dynatrace.target.snapshot_id`,",
  "    `forward.dynatrace.planned_checks`, `forward.dynatrace.count.create`,",
  "    `forward.dynatrace.count.unchanged`, `forward.dynatrace.count.changed`,",
  "    `forward.dynatrace.count.stale`",
  "| sort timestamp desc",
  "| limit 20",
].join("\n");

const NETWORK_EVIDENCE_QUERY = [
  "fetch events, from: now() - 24h",
  "| filter event.type == \"forward.dynatrace.network.evidence\"",
  "| filter `forward.dynatrace.synthetic` == false",
  "| sort timestamp desc",
  "| dedup `forward.dynatrace.evidence_run_id`",
  "| fields timestamp, severity, `forward.dynatrace.evidence_run_id`,",
  "    `forward.dynatrace.evidence_source`, `forward.dynatrace.synthetic`,",
  "    `forward.dynatrace.problem_id`, `forward.dynatrace.service_entity_id`,",
  "    `forward.dynatrace.network_assessment`, `forward.dynatrace.target.network_id`,",
  "    `forward.dynatrace.target.snapshot_id`, `forward.dynatrace.count.total`,",
  "    `forward.dynatrace.count.queryable`, `forward.dynatrace.count.reachable`,",
  "    `forward.dynatrace.count.blocked`, `forward.dynatrace.count.ambiguous`,",
  "    `forward.dynatrace.count.unmapped`, `forward.dynatrace.count.failed`",
  "| sort timestamp desc",
  "| limit 20",
].join("\n");

const CHECK_HEALTH_QUERY = [
  "fetch events, from: now() - 24h",
  "| filter event.type == \"forward.dynatrace.check.health.transition\"",
  "| filter `forward.dynatrace.synthetic` == false",
  "| sort timestamp desc",
  "| dedup `forward.dynatrace.transition_id`",
  "| fields timestamp, `event.status`, `forward.dynatrace.transition_id`,",
  "    `forward.dynatrace.evidence_source`, `forward.dynatrace.synthetic`,",
  "    `forward.dynatrace.transition`, `forward.dynatrace.previous_state`,",
  "    `forward.dynatrace.current_state`, `forward.dynatrace.network_id`,",
  "    `forward.dynatrace.snapshot_id`, `forward.dynatrace.owner`,",
  "    `forward.dynatrace.service`",
  "| sort timestamp desc",
  "| limit 50",
].join("\n");

const PATH_HEALTH_QUERY = [
  "fetch events, from: now() - 24h",
  "| filter event.type == \"forward.dynatrace.check.health.summary\"",
  "| filter `forward.dynatrace.synthetic` == false",
  "| sort timestamp desc",
  "| dedup `forward.dynatrace.health_summary_id`",
  "| fields timestamp, `event.status`, `forward.dynatrace.health_summary_id`,",
  "    `forward.dynatrace.evidence_source`, `forward.dynatrace.synthetic`,",
  "    `forward.dynatrace.network_id`, `forward.dynatrace.snapshot_id`,",
  "    `forward.dynatrace.health.tracked`, `forward.dynatrace.health.performance_enabled`,",
  "    `forward.dynatrace.health.healthy`, `forward.dynatrace.health.unhealthy`,",
  "    `forward.dynatrace.health.disabled`, `forward.dynatrace.health.not_applicable`,",
  "    `forward.dynatrace.health.unknown`",
  "| sort timestamp desc",
  "| limit 20",
].join("\n");

const SECURITY_QUERY = [
  "fetch events, from: now() - 24h",
  "| filter event.type == \"forward.dynatrace.security.correlation\"",
  "| filter `forward.dynatrace.synthetic` == false",
  "| sort timestamp desc",
  "| dedup `forward.dynatrace.correlation_id`",
  "| fields timestamp, severity, `forward.dynatrace.security_run_id`,",
  "    `forward.dynatrace.evidence_source`, `forward.dynatrace.synthetic`,",
  "    `forward.dynatrace.correlation_id`, `forward.dynatrace.correlation_confidence`,",
  "    `forward.dynatrace.correlation_disposition`, `forward.dynatrace.owner`,",
  "    `forward.dynatrace.dynatrace_finding_id`, `forward.dynatrace.forward_exposure_id`,",
  "    `forward.dynatrace.forward_snapshot_id`, `forward.dynatrace.fact.observed_execution`,",
  "    `forward.dynatrace.fact.vulnerable_runtime`,",
  "    `forward.dynatrace.fact.modeled_reachability`,",
  "    `forward.dynatrace.fact.internet_addressability`,",
  "    `forward.dynatrace.fact.policy_finding`",
  "| sort timestamp desc",
  "| limit 50",
].join("\n");

const CHANGE_VALIDATION_QUERY = [
  "fetch events, from: now() - 24h",
  "| filter event.type == \"forward.dynatrace.change.validation\"",
  "| filter `forward.dynatrace.synthetic` == false",
  "| sort timestamp desc",
  "| dedup `forward.dynatrace.correlation_id`",
  "| fields timestamp, severity, `forward.dynatrace.gate_run_id`,",
  "    `forward.dynatrace.change_id`, `forward.dynatrace.deployment_id`,",
  "    `forward.dynatrace.gate_decision`, `forward.dynatrace.gate_reason_codes`,",
  "    `forward.dynatrace.correlation_id`, `forward.dynatrace.correlation_sha256`,",
  "    `forward.dynatrace.scope_mapping_id`, `forward.dynatrace.evidence_source`,",
  "    `forward.dynatrace.synthetic`, `forward.dynatrace.network_id`,",
  "    `forward.dynatrace.before_snapshot_id`, `forward.dynatrace.after_snapshot_id`,",
  "    `forward.dynatrace.after_reachable`, `forward.dynatrace.after_blocked`,",
  "    `forward.dynatrace.after_ambiguous`, `forward.dynatrace.after_unmapped`,",
  "    `forward.dynatrace.after_failed`, `timeframe.from`, `timeframe.to`",
  "| sort timestamp desc",
  "| limit 50",
].join("\n");

const GUARDIAN_QUERY = [
  "fetch events, from: now() - 24h",
  "| filter event.kind == \"SDLC_EVENT\"",
  "| filter event.provider == \"dynatrace.site.reliability.guardian\"",
  "| filter event.type == \"validation\"",
  "| filter event.status == \"finished\"",
  "| sort timestamp desc",
  "| dedup task.id",
  "| fields timestamp, task.id, dt.srg.id, dt.srg.tags, validation.result, execution_context",
  "| sort timestamp desc",
  "| limit 50",
].join("\n");

const field = (record: EvidenceRecord | undefined, name: string, fallback = "—") => {
  const value = record?.[name];
  if (typeof value === "string") return value || fallback;
  if (typeof value === "number") return `${value}`;
  if (typeof value === "boolean") return value ? "true" : "false";
  if (Array.isArray(value)) return value.map(String).join(", ") || fallback;
  return fallback;
};

const numberField = (record: EvidenceRecord | undefined, name: string) => {
  const value = record?.[name];
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string" && value.trim()) {
    const parsed = Number(value);
    if (Number.isFinite(parsed)) return parsed;
  }
  return 0;
};

const contextField = (record: EvidenceRecord | undefined, name: string, fallback = "—") => {
  const context = record?.execution_context;
  if (context && typeof context === "object" && !Array.isArray(context)) {
    return field(context as EvidenceRecord, name, fallback);
  }
  if (typeof context === "string") {
    try {
      const parsed = JSON.parse(context) as EvidenceRecord;
      return field(parsed, name, fallback);
    } catch {
      return fallback;
    }
  }
  return fallback;
};

const timestampValue = (record: EvidenceRecord) => {
  const value = record.timestamp;
  if (typeof value !== "string") return Number.NEGATIVE_INFINITY;
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) ? parsed : Number.NEGATIVE_INFINITY;
};
const newestFirst = (records: EvidenceRecord[] | undefined) =>
  [...(records || [])].sort((left, right) => timestampValue(right) - timestampValue(left));
const latest = (records: EvidenceRecord[] | undefined) => newestFirst(records)[0];
const evidenceClassLabel = (record: EvidenceRecord | undefined) => {
  const value = record?.["forward.dynatrace.synthetic"];
  if (value === false) return "LIVE";
  return "NOT ELIGIBLE";
};
const provenanceLabel = (record: EvidenceRecord | undefined) => {
  const source = field(record, "forward.dynatrace.evidence_source", "unspecified-source");
  return `${source} · ${evidenceClassLabel(record)}`;
};
const detailWithProvenance = (
  record: EvidenceRecord | undefined,
  name: string,
  fallback: string,
) => record
  ? `${evidenceClassLabel(record)} · ${field(record, name)} · ${field(
    record,
    "forward.dynatrace.evidence_source",
    "unspecified-source",
  )}`
  : fallback;
const driftCount = (record: EvidenceRecord | undefined) =>
  numberField(record, "forward.dynatrace.count.changed") +
  numberField(record, "forward.dynatrace.count.stale");
const incompleteCount = (record: EvidenceRecord | undefined) =>
  numberField(record, "forward.dynatrace.count.ambiguous") +
  numberField(record, "forward.dynatrace.count.unmapped") +
  numberField(record, "forward.dynatrace.count.failed");
const pathHealthStatus = (record: EvidenceRecord | undefined) => {
  if (!record) return "not loaded";
  const enabled = numberField(record, "forward.dynatrace.health.performance_enabled");
  const healthy = numberField(record, "forward.dynatrace.health.healthy");
  const incomplete =
    numberField(record, "forward.dynatrace.health.unhealthy") +
    numberField(record, "forward.dynatrace.health.disabled") +
    numberField(record, "forward.dynatrace.health.not_applicable") +
    numberField(record, "forward.dynatrace.health.unknown");
  return enabled > 0 && healthy === enabled && incomplete === 0 ? "healthy" : "needs attention";
};

const tone = (value: string) => {
  const normalized = value.toLowerCase();
  if (
    [
      "pass",
      "passed",
      "clear",
      "ready",
      "reconciled",
      "applied",
      "verified",
      "info",
      "fail_to_pass",
      "no-modeled-policy-block",
    ].includes(normalized)
  ) {
    return "ready";
  }
  if (
    [
      "fail",
      "failed",
      "error",
      "warn",
      "warning",
      "pass_to_fail",
      "missing",
      "critical",
      "high",
      "medium",
      "consistent-with-network-policy-block",
    ].includes(normalized)
  ) {
    return "needs-work";
  }
  return "controlled";
};

const EvidenceCard = ({
  icon,
  label,
  status,
  detail,
  metrics,
}: {
  icon: React.ReactNode;
  label: string;
  status: string;
  detail: string;
  metrics: Array<{ label: string; value: string }>;
}) => (
  <article className="evidence-card">
    <div className="evidence-card-heading">
      <span className="metric-icon">{icon}</span>
      <div>
        <span>{label}</span>
        <span title={detail}><Strong>{detail}</Strong></span>
      </div>
      <span className={`evidence-status ${tone(status)}`}>{status}</span>
    </div>
    <div className="evidence-card-metrics">
      {metrics.map((metric) => (
        <div key={metric.label}>
          <span>{metric.label}</span>
          <span title={metric.value}><Strong>{metric.value}</Strong></span>
        </div>
      ))}
    </div>
  </article>
);

const EmptyEvidence = ({ text }: { text: string }) => (
  <div className="evidence-empty">{text}</div>
);

const EvidenceHeading = ({ title, detail }: { title: string; detail: string }) => (
  <div className="evidence-table-heading">
    <Heading level={4}>{title}</Heading>
    <span>{detail}</span>
  </div>
);

export const CrossDomainEvidence = () => {
  const ingest = useDql<EvidenceRecord>(
    { query: INGEST_QUERY, maxResultRecords: 20 },
    { staleTime: 0 },
  );
  const network = useDql<EvidenceRecord>(
    { query: NETWORK_EVIDENCE_QUERY, maxResultRecords: 20 },
    { staleTime: 0 },
  );
  const health = useDql<EvidenceRecord>(
    { query: CHECK_HEALTH_QUERY, maxResultRecords: 50 },
    { staleTime: 0 },
  );
  const pathHealth = useDql<EvidenceRecord>(
    { query: PATH_HEALTH_QUERY, maxResultRecords: 20 },
    { staleTime: 0 },
  );
  const security = useDql<EvidenceRecord>(
    { query: SECURITY_QUERY, maxResultRecords: 50 },
    { staleTime: 0 },
  );
  const change = useDql<EvidenceRecord>(
    { query: CHANGE_VALIDATION_QUERY, maxResultRecords: 50 },
    { staleTime: 0 },
  );
  const guardian = useDql<EvidenceRecord>(
    { query: GUARDIAN_QUERY, maxResultRecords: 50 },
    { staleTime: 0 },
  );

  const ingestRows = newestFirst(ingest.data?.records);
  const networkRows = newestFirst(network.data?.records);
  const healthRows = newestFirst(health.data?.records);
  const pathHealthRows = newestFirst(pathHealth.data?.records);
  const securityRows = newestFirst(security.data?.records);
  const changeRows = newestFirst(change.data?.records);
  const guardianRows = newestFirst(guardian.data?.records);
  const ingestLatest = latest(ingestRows);
  const networkLatest = latest(networkRows);
  const healthLatest = latest(healthRows);
  const pathHealthLatest = latest(pathHealthRows);
  const securityLatest = latest(securityRows);
  const changeLatest = latest(changeRows);
  const guardianLatest = latest(guardianRows);
  const isFetching = (
    ingest.isFetching ||
    network.isFetching ||
    health.isFetching ||
    pathHealth.isFetching ||
    security.isFetching ||
    change.isFetching ||
    guardian.isFetching
  );
  const errors = [
    ingest.error,
    network.error,
    health.error,
    pathHealth.error,
    security.error,
    change.error,
    guardian.error,
  ].filter(Boolean);

  const refresh = async () => {
    await Promise.allSettled([
      ingest.forceRefetch(),
      network.forceRefetch(),
      health.forceRefetch(),
      pathHealth.forceRefetch(),
      security.forceRefetch(),
      change.forceRefetch(),
      guardian.forceRefetch(),
    ]);
  };

  return (
    <section className="panel cross-domain-panel" aria-label="Forward and Dynatrace live evidence">
      <div className="cross-domain-header">
        <div>
          <p className="eyebrow">Live Grail network evidence</p>
          <Heading level={2}>Live intent and modeled-network evidence</Heading>
          <span>
            Sanitized Forward-controlled events with traceable runs and snapshots. No Forward credentials,
            endpoints, devices, or path topology enter Dynatrace.
          </span>
        </div>
        <div className="source-actions">
          {isFetching && <ProgressCircle aria-label="Loading cross-domain evidence" />}
          <Button color="primary" variant="accent" onClick={() => void refresh()}>
            <Button.Prefix>
              <SyncIcon />
            </Button.Prefix>
            Refresh live evidence
          </Button>
        </div>
      </div>

      <div className="evidence-card-grid">
        <EvidenceCard
          icon={<AutomationEngineIcon />}
          label="Intent reconciliation"
          status={field(ingestLatest, "forward.dynatrace.import_state", "not loaded")}
          detail={detailWithProvenance(
            ingestLatest,
            "forward.dynatrace.package_id",
            "No live event",
          )}
          metrics={[
            { label: "Planned", value: field(ingestLatest, "forward.dynatrace.planned_checks", "0") },
            { label: "Unchanged", value: field(ingestLatest, "forward.dynatrace.count.unchanged", "0") },
            { label: "Drift", value: String(driftCount(ingestLatest)) },
          ]}
        />
        <EvidenceCard
          icon={<AutomationEngineIcon />}
          label="Change validation"
          status={field(changeLatest, "forward.dynatrace.gate_decision", "not loaded")}
          detail={changeLatest
            ? `${field(changeLatest, "forward.dynatrace.change_id")} · ${field(changeLatest, "forward.dynatrace.correlation_id")}`
            : "No correlated live event"}
          metrics={[
            { label: "Before", value: field(changeLatest, "forward.dynatrace.before_snapshot_id") },
            { label: "After", value: field(changeLatest, "forward.dynatrace.after_snapshot_id") },
            { label: "Blocked", value: field(changeLatest, "forward.dynatrace.after_blocked", "0") },
          ]}
        />
        <EvidenceCard
          icon={<AutomationEngineIcon />}
          label="Site Reliability Guardian"
          status={field(guardianLatest, "validation.result", "not loaded")}
          detail={guardianLatest
            ? `Guardian ${field(guardianLatest, "dt.srg.id")} · ${contextField(guardianLatest, "correlationId")}`
            : "No lifecycle validation"}
          metrics={[
            { label: "Validation", value: field(guardianLatest, "task.id") },
            { label: "Change", value: contextField(guardianLatest, "changeId") },
            { label: "Runs", value: String(guardianRows.length) },
          ]}
        />
        <EvidenceCard
          icon={<NetworkIcon />}
          label="Modeled reachability"
          status={field(networkLatest, "forward.dynatrace.network_assessment", "not loaded")}
          detail={networkLatest
            ? `${field(networkLatest, "forward.dynatrace.problem_id")} · ${evidenceClassLabel(networkLatest)}`
            : "No live event"}
          metrics={[
            { label: "Reachable", value: `${field(networkLatest, "forward.dynatrace.count.reachable", "0")} / ${field(networkLatest, "forward.dynatrace.count.total", "0")}` },
            { label: "Blocked", value: field(networkLatest, "forward.dynatrace.count.blocked", "0") },
            { label: "Incomplete", value: String(incompleteCount(networkLatest)) },
          ]}
        />
        <EvidenceCard
          icon={<DatabaseIcon />}
          label="Evidence target"
          status={networkLatest ? evidenceClassLabel(networkLatest) : "not loaded"}
          detail={networkLatest
            ? `network ${field(networkLatest, "forward.dynatrace.target.network_id")} · snapshot ${field(networkLatest, "forward.dynatrace.target.snapshot_id")}`
            : "No live event"}
          metrics={[
            { label: "Network", value: field(networkLatest, "forward.dynatrace.target.network_id") },
            { label: "Snapshot", value: field(networkLatest, "forward.dynatrace.target.snapshot_id") },
            { label: "Live events", value: String(ingestRows.length + networkRows.length + changeRows.length + guardianRows.length) },
          ]}
        />
        <EvidenceCard
          icon={<AutomationEngineIcon />}
          label="Package integrity"
          status={field(ingestLatest, "forward.dynatrace.signature_status", "not loaded")}
          detail={field(ingestLatest, "forward.dynatrace.package_id", "No live package")}
          metrics={[
            { label: "Mode", value: field(ingestLatest, "forward.dynatrace.mode") },
            { label: "Create", value: field(ingestLatest, "forward.dynatrace.count.create", "0") },
            { label: "Stable", value: field(ingestLatest, "forward.dynatrace.count.unchanged", "0") },
          ]}
        />
        <EvidenceCard
          icon={<DatabaseIcon />}
          label="Path health monitoring"
          status={pathHealthStatus(pathHealthLatest)}
          detail={pathHealthLatest
            ? `network ${field(pathHealthLatest, "forward.dynatrace.network_id")} · snapshot ${field(pathHealthLatest, "forward.dynatrace.snapshot_id")} · ${evidenceClassLabel(pathHealthLatest)}`
            : "No live Forward health summary"}
          metrics={[
            { label: "Healthy", value: `${field(pathHealthLatest, "forward.dynatrace.health.healthy", "0")} / ${field(pathHealthLatest, "forward.dynatrace.health.performance_enabled", "0")}` },
            { label: "Unhealthy", value: field(pathHealthLatest, "forward.dynatrace.health.unhealthy", "0") },
            { label: "Incomplete", value: String(
              numberField(pathHealthLatest, "forward.dynatrace.health.disabled") +
              numberField(pathHealthLatest, "forward.dynatrace.health.not_applicable") +
              numberField(pathHealthLatest, "forward.dynatrace.health.unknown"),
            ) },
          ]}
        />
        {healthRows.length > 0 && (
          <EvidenceCard
            icon={<DatabaseIcon />}
            label="Check-health transitions"
            status={field(healthLatest, "forward.dynatrace.transition")}
            detail={detailWithProvenance(
              healthLatest,
              "forward.dynatrace.service",
              "Managed-check transition",
            )}
            metrics={[
              { label: "Previous", value: field(healthLatest, "forward.dynatrace.previous_state") },
              { label: "Current", value: field(healthLatest, "forward.dynatrace.current_state") },
              { label: "Transitions", value: String(healthRows.length) },
            ]}
          />
        )}
        {securityRows.length > 0 && (
          <EvidenceCard
            icon={<NetworkIcon />}
            label="Security correlation"
            status={field(securityLatest, "severity")}
            detail={detailWithProvenance(
              securityLatest,
              "forward.dynatrace.correlation_disposition",
              "Correlated finding",
            )}
            metrics={[
              { label: "Confidence", value: field(securityLatest, "forward.dynatrace.correlation_confidence") },
              { label: "Finding", value: field(securityLatest, "forward.dynatrace.dynatrace_finding_id") },
              { label: "Queue", value: String(securityRows.length) },
            ]}
          />
        )}
      </div>

      {(ingestLatest || networkLatest || changeLatest || guardianLatest) && (
        <div className="live-binding-grid" aria-label="Live evidence identity binding">
          <div><span>Network</span><Strong>{field(networkLatest, "forward.dynatrace.target.network_id", field(ingestLatest, "forward.dynatrace.target.network_id"))}</Strong></div>
          <div><span>Snapshot</span><Strong>{field(networkLatest, "forward.dynatrace.target.snapshot_id", field(ingestLatest, "forward.dynatrace.target.snapshot_id"))}</Strong></div>
          <div><span>Package</span><Strong>{field(ingestLatest, "forward.dynatrace.package_id")}</Strong></div>
          <div><span>Reconciliation run</span><Strong>{field(ingestLatest, "forward.dynatrace.run_id")}</Strong></div>
          <div><span>Evidence run</span><Strong>{field(networkLatest, "forward.dynatrace.evidence_run_id")}</Strong></div>
          <div><span>Problem</span><Strong>{field(networkLatest, "forward.dynatrace.problem_id")}</Strong></div>
          <div><span>Correlation</span><Strong>{field(changeLatest, "forward.dynatrace.correlation_id", contextField(guardianLatest, "correlationId"))}</Strong></div>
          <div><span>Guardian validation</span><Strong>{field(guardianLatest, "task.id")}</Strong></div>
        </div>
      )}

      <div className="evidence-table-section">
        <EvidenceHeading
          title="Change-validation and Guardian results"
          detail="One correlation identity joins the sanitized Forward decision to the Dynatrace lifecycle validation."
        />
        {(changeRows.length > 0 || guardianRows.length > 0) ? (
          <div className="evidence-table-wrap">
            <table className="evidence-table change-evidence-table">
              <thead>
                <tr><th>Time</th><th>Source</th><th>Result</th><th>Correlation</th><th>Change / validation</th><th>Scope</th><th>Evidence target</th></tr>
              </thead>
              <tbody>
                {changeRows.slice(0, 10).map((row, index) => (
                  <tr key={`${field(row, "forward.dynatrace.correlation_id")}-${index}`}>
                    <td>{field(row, "timestamp")}</td>
                    <td><Strong>Forward change gate</Strong><span className="evidence-subvalue">{provenanceLabel(row)}</span></td>
                    <td><span className={`evidence-status ${tone(field(row, "forward.dynatrace.gate_decision"))}`}>{field(row, "forward.dynatrace.gate_decision")}</span><span className="evidence-subvalue">{field(row, "forward.dynatrace.gate_reason_codes")}</span></td>
                    <td>{field(row, "forward.dynatrace.correlation_id")}</td>
                    <td>{field(row, "forward.dynatrace.change_id")}<span className="evidence-subvalue">{field(row, "forward.dynatrace.gate_run_id")}</span></td>
                    <td>{field(row, "forward.dynatrace.scope_mapping_id")}</td>
                    <td>{field(row, "forward.dynatrace.network_id")}<span className="evidence-subvalue">{field(row, "forward.dynatrace.before_snapshot_id")} → {field(row, "forward.dynatrace.after_snapshot_id")}</span></td>
                  </tr>
                ))}
                {guardianRows.slice(0, 10).map((row, index) => (
                  <tr key={`${field(row, "task.id")}-${index}`}>
                    <td>{field(row, "timestamp")}</td>
                    <td><Strong>Dynatrace Guardian</Strong><span className="evidence-subvalue">{field(row, "dt.srg.id")}</span></td>
                    <td><span className={`evidence-status ${tone(field(row, "validation.result"))}`}>{field(row, "validation.result")}</span></td>
                    <td>{contextField(row, "correlationId")}</td>
                    <td>{contextField(row, "changeId")}<span className="evidence-subvalue">{field(row, "task.id")}</span></td>
                    <td>{contextField(row, "gateRunId")}</td>
                    <td>{contextField(row, "observedAt")}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : <EmptyEvidence text="Refresh after a correlated SDLC trigger to load change and Guardian results." />}
      </div>

      <div className="evidence-table-section">
        <EvidenceHeading
          title="Forward reconciliation history"
          detail="Package history, apply mode, target snapshot, and unresolved drift."
        />
        {ingestRows.length > 0 ? (
          <div className="evidence-table-wrap">
            <table className="evidence-table">
              <thead>
                <tr><th>Time</th><th>Run / package</th><th>State</th><th>Target</th><th>Planned</th><th>Create</th><th>Unchanged</th><th>Drift</th></tr>
              </thead>
              <tbody>
                {ingestRows.slice(0, 10).map((row, index) => (
                  <tr key={`${field(row, "forward.dynatrace.publisher_run_id")}-${index}`}>
                    <td>{field(row, "timestamp")}</td>
                    <td><Strong>{field(row, "forward.dynatrace.run_id")}</Strong><span className="evidence-subvalue">{field(row, "forward.dynatrace.package_id")}</span><span className="evidence-subvalue">{provenanceLabel(row)}</span></td>
                    <td><span className={`evidence-status ${tone(field(row, "forward.dynatrace.import_state"))}`}>{field(row, "forward.dynatrace.import_state")}</span><span className="evidence-subvalue">{field(row, "forward.dynatrace.mode")}</span></td>
                    <td>{field(row, "forward.dynatrace.target.network_id")} / {field(row, "forward.dynatrace.target.snapshot_id")}</td>
                    <td>{field(row, "forward.dynatrace.planned_checks", "0")}</td>
                    <td>{field(row, "forward.dynatrace.count.create", "0")}</td>
                    <td>{field(row, "forward.dynatrace.count.unchanged", "0")}</td>
                    <td><span className={`evidence-status ${driftCount(row) > 0 ? "needs-work" : "ready"}`}>{driftCount(row)}</span></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : <EmptyEvidence text="Refresh to load live Forward reconciliation history." />}
      </div>

      <div className="evidence-table-section">
        <EvidenceHeading
          title="Problem-triggered network evidence"
          detail="Aggregate modeled reachability only; blocked evidence never claims root cause."
        />
        {networkRows.length > 0 ? (
          <div className="evidence-table-wrap">
            <table className="evidence-table">
              <thead>
                <tr><th>Time</th><th>Problem / service</th><th>Assessment</th><th>Target</th><th>Reachable</th><th>Blocked</th><th>Incomplete</th></tr>
              </thead>
              <tbody>
                {networkRows.slice(0, 10).map((row, index) => (
                  <tr key={`${field(row, "forward.dynatrace.evidence_run_id")}-${index}`}>
                    <td>{field(row, "timestamp")}</td>
                    <td><Strong>{field(row, "forward.dynatrace.problem_id")}</Strong><span className="evidence-subvalue">{field(row, "forward.dynatrace.service_entity_id")}</span></td>
                    <td><span className={`evidence-status ${tone(field(row, "forward.dynatrace.network_assessment"))}`}>{field(row, "forward.dynatrace.network_assessment")}</span></td>
                    <td>{field(row, "forward.dynatrace.target.network_id")} / {field(row, "forward.dynatrace.target.snapshot_id")}</td>
                    <td>{field(row, "forward.dynatrace.count.reachable", "0")}</td>
                    <td>{field(row, "forward.dynatrace.count.blocked", "0")}</td>
                    <td>{incompleteCount(row)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : <EmptyEvidence text="Refresh to load live problem evidence." />}
      </div>

      {healthRows.length > 0 && (
        <div className="evidence-table-section">
          <EvidenceHeading
            title="Recent Forward check-health transitions"
            detail="Event-on-transition feedback is deduplicated by stable transition ID."
          />
          <div className="evidence-table-wrap">
            <table className="evidence-table">
              <thead>
                <tr><th>Time</th><th>Transition</th><th>State</th><th>Service / owner</th><th>Network / snapshot</th><th>Provenance</th></tr>
              </thead>
              <tbody>
                {healthRows.slice(0, 10).map((row, index) => (
                  <tr key={`${field(row, "forward.dynatrace.transition_id")}-${index}`}>
                    <td>{field(row, "timestamp")}</td>
                    <td><span className={`evidence-status ${tone(field(row, "forward.dynatrace.transition"))}`}>{field(row, "forward.dynatrace.transition")}</span></td>
                    <td>{field(row, "forward.dynatrace.previous_state")} → {field(row, "forward.dynatrace.current_state")}</td>
                    <td><Strong>{field(row, "forward.dynatrace.service")}</Strong><span className="evidence-subvalue">{field(row, "forward.dynatrace.owner")}</span></td>
                    <td>{field(row, "forward.dynatrace.network_id")} / {field(row, "forward.dynatrace.snapshot_id")}</td>
                    <td>{provenanceLabel(row)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {securityRows.length > 0 && (
        <div className="evidence-table-section">
          <EvidenceHeading
            title="Security exposure investigation queue"
            detail="Observed execution, modeled reachability, and internet addressability remain separate evidence facts."
          />
          <div className="evidence-table-wrap">
            <table className="evidence-table security-evidence-table">
              <thead>
                <tr><th>Time</th><th>Severity</th><th>Disposition</th><th>Evidence IDs</th><th>Confidence / owner</th><th>Facts</th><th>Provenance</th></tr>
              </thead>
              <tbody>
                {securityRows.slice(0, 10).map((row, index) => (
                  <tr key={`${field(row, "forward.dynatrace.correlation_id")}-${index}`}>
                    <td>{field(row, "timestamp")}</td>
                    <td><span className={`evidence-status ${tone(field(row, "severity"))}`}>{field(row, "severity")}</span></td>
                    <td>{field(row, "forward.dynatrace.correlation_disposition")}</td>
                    <td><Strong>DT {field(row, "forward.dynatrace.dynatrace_finding_id")}</Strong><span className="evidence-subvalue">FWD {field(row, "forward.dynatrace.forward_exposure_id")} @ {field(row, "forward.dynatrace.forward_snapshot_id")}</span></td>
                    <td>{field(row, "forward.dynatrace.correlation_confidence")}<span className="evidence-subvalue">{field(row, "forward.dynatrace.owner")}</span></td>
                    <td className="evidence-facts">execution {field(row, "forward.dynatrace.fact.observed_execution")} · reachable {field(row, "forward.dynatrace.fact.modeled_reachability")} · internet {field(row, "forward.dynatrace.fact.internet_addressability")}</td>
                    <td>{provenanceLabel(row)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {errors.length > 0 && (
        <div className="evidence-error">
          {errors.length} live evidence {errors.length === 1 ? "query" : "queries"} failed. The
          remaining evidence views were still refreshed. {errors[0]?.message}
        </div>
      )}
    </section>
  );
};
