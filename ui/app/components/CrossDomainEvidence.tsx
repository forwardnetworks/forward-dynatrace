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

type CaptureEvidence = {
  ingestRows: EvidenceRecord[];
  networkRows: EvidenceRecord[];
  healthRows: EvidenceRecord[];
  securityRows: EvidenceRecord[];
};

declare global {
  var __FORWARD_DYNATRACE_CAPTURE_EVIDENCE__: CaptureEvidence | undefined;
}

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
  "| limit 50",
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

const latest = (records: EvidenceRecord[] | undefined) => records?.[0];
const evidenceClassLabel = (record: EvidenceRecord | undefined) => {
  const value = record?.["forward.dynatrace.synthetic"];
  if (value === true) return "SYNTHETIC DEMO";
  if (value === false) return "LIVE";
  const changeId = record?.["forward.dynatrace.change_id"];
  if (typeof changeId === "string" && changeId.toUpperCase().includes("DEMO")) {
    return "SYNTHETIC DEMO · LEGACY ID";
  }
  return "PROVENANCE UNSPECIFIED";
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
  const captureEvidence = globalThis.__FORWARD_DYNATRACE_CAPTURE_EVIDENCE__;
  const ingest = useDql<EvidenceRecord>(
    { query: INGEST_QUERY, maxResultRecords: 20 },
    { enabled: !captureEvidence, staleTime: 0 },
  );
  const network = useDql<EvidenceRecord>(
    { query: NETWORK_EVIDENCE_QUERY, maxResultRecords: 20 },
    { enabled: !captureEvidence, staleTime: 0 },
  );
  const health = useDql<EvidenceRecord>(
    { query: CHECK_HEALTH_QUERY, maxResultRecords: 50 },
    { enabled: !captureEvidence, staleTime: 0 },
  );
  const security = useDql<EvidenceRecord>(
    { query: SECURITY_QUERY, maxResultRecords: 50 },
    { enabled: !captureEvidence, staleTime: 0 },
  );

  const ingestRows = captureEvidence?.ingestRows || ingest.data?.records || [];
  const networkRows = captureEvidence?.networkRows || network.data?.records || [];
  const healthRows = captureEvidence?.healthRows || health.data?.records || [];
  const securityRows = captureEvidence?.securityRows || security.data?.records || [];
  const ingestLatest = latest(ingestRows);
  const networkLatest = latest(networkRows);
  const healthLatest = latest(healthRows);
  const securityLatest = latest(securityRows);
  const isFetching = !captureEvidence && (
    ingest.isFetching ||
    network.isFetching ||
    health.isFetching ||
    security.isFetching
  );
  const errors = captureEvidence
    ? []
    : [ingest.error, network.error, health.error, security.error].filter(Boolean);

  const refresh = async () => {
    await Promise.allSettled([
      ingest.forceRefetch(),
      network.forceRefetch(),
      health.forceRefetch(),
      security.forceRefetch(),
    ]);
  };

  return (
    <section className="panel cross-domain-panel" aria-label="Forward and Dynatrace live evidence">
      <div className="cross-domain-header">
        <div>
          <p className="eyebrow">
            {captureEvidence ? "Synthetic rehearsal evidence" : "Live Grail network evidence"}
          </p>
          <Heading level={2}>Live intent and modeled-network evidence</Heading>
          <span>
            {captureEvidence
              ? "Checked safe/regression artifacts rendered in the real app. No external system was contacted."
              : "Sanitized Forward-controlled events with traceable runs and snapshots. No Forward credentials, endpoints, devices, or path topology enter Dynatrace."}
          </span>
        </div>
        <div className="source-actions">
          {isFetching && <ProgressCircle aria-label="Loading cross-domain evidence" />}
          {captureEvidence ? (
            <span className="evidence-status controlled">SYNTHETIC DEMO REHEARSAL</span>
          ) : (
            <Button color="primary" variant="accent" onClick={() => void refresh()}>
              <Button.Prefix>
                <SyncIcon />
              </Button.Prefix>
              Refresh live evidence
            </Button>
          )}
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
            { label: "Live events", value: String(ingestRows.length + networkRows.length) },
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

      {(ingestLatest || networkLatest) && (
        <div className="live-binding-grid" aria-label="Live evidence identity binding">
          <div><span>Network</span><Strong>{field(networkLatest, "forward.dynatrace.target.network_id", field(ingestLatest, "forward.dynatrace.target.network_id"))}</Strong></div>
          <div><span>Snapshot</span><Strong>{field(networkLatest, "forward.dynatrace.target.snapshot_id", field(ingestLatest, "forward.dynatrace.target.snapshot_id"))}</Strong></div>
          <div><span>Package</span><Strong>{field(ingestLatest, "forward.dynatrace.package_id")}</Strong></div>
          <div><span>Reconciliation run</span><Strong>{field(ingestLatest, "forward.dynatrace.run_id")}</Strong></div>
          <div><span>Evidence run</span><Strong>{field(networkLatest, "forward.dynatrace.evidence_run_id")}</Strong></div>
          <div><span>Problem</span><Strong>{field(networkLatest, "forward.dynatrace.problem_id")}</Strong></div>
        </div>
      )}

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
