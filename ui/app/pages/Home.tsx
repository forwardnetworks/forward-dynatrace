import React, { useEffect, useMemo, useState } from "react";

import { Button } from "@dynatrace/strato-components/buttons";
import { ProgressCircle } from "@dynatrace/strato-components/content";
import { Flex, TitleBar } from "@dynatrace/strato-components/layouts";
import {
  Switch,
  TextInput,
  ToggleButtonGroup,
} from "@dynatrace/strato-components/forms";
import {
  Heading,
  Paragraph,
  Strong,
} from "@dynatrace/strato-components/typography";
import {
  AutomationEngineIcon,
  CheckmarkIcon,
  DatabaseIcon,
  DownloadIcon,
  FlowIcon,
  NetworkIcon,
  PathIcon,
  SyncIcon,
  UploadIcon,
} from "@dynatrace/strato-icons";
import { useAppFunction, useDql } from "@dynatrace-sdk/react-hooks";

import { CrossDomainEvidence } from "../components/CrossDomainEvidence";
import type {
  DependencyCandidate,
  DependencyDiscoveryResponse,
  ForwardAccessProfile,
  ForwardSyncMode,
  ForwardSyncRequest,
  ForwardSyncResponse,
} from "../types/forward-sync";

import "./Home.css";

const dynatraceLogoUrl = "assets/Dynatrace_Logo.svg";
const forwardLogoUrl = "assets/forward-logo.svg";
const LIVE_INGEST_STATUS_QUERY = `
fetch events, from: -24h
| filter event.type == "forward.dynatrace.ingest.status"
| filter \`forward.dynatrace.synthetic\` == false
| sort timestamp desc
| fields timestamp, \`forward.dynatrace.run_id\`, \`forward.dynatrace.package_id\`,
    \`forward.dynatrace.evidence_source\`, \`forward.dynatrace.mode\`,
    \`forward.dynatrace.access_profile\`,
    \`forward.dynatrace.import_state\`, \`forward.dynatrace.signature_status\`,
    \`forward.dynatrace.target.network_id\`, \`forward.dynatrace.target.snapshot_id\`,
    \`forward.dynatrace.planned_checks\`, \`forward.dynatrace.count.create\`,
    \`forward.dynatrace.count.unchanged\`, \`forward.dynatrace.count.changed\`,
    \`forward.dynatrace.count.stale\`
| limit 1
`;
const LIVE_NETWORK_EVIDENCE_QUERY = `
fetch events, from: -24h
| filter event.type == "forward.dynatrace.network.evidence"
| filter \`forward.dynatrace.synthetic\` == false
| sort timestamp desc
| fields timestamp, \`forward.dynatrace.evidence_run_id\`,
    \`forward.dynatrace.evidence_source\`, \`forward.dynatrace.problem_id\`,
    \`forward.dynatrace.network_assessment\`, \`forward.dynatrace.target.network_id\`,
    \`forward.dynatrace.target.snapshot_id\`, \`forward.dynatrace.count.total\`,
    \`forward.dynatrace.count.queryable\`, \`forward.dynatrace.count.reachable\`,
    \`forward.dynatrace.count.blocked\`, \`forward.dynatrace.count.ambiguous\`,
    \`forward.dynatrace.count.unmapped\`, \`forward.dynatrace.count.failed\`
| limit 1
`;
const DEFAULT_VISIBLE_DEPENDENCIES = 12;

type DynatraceDependencyRow = Record<string, unknown>;

const rowField = (
  row: DynatraceDependencyRow,
  names: string[],
  fallback = "",
): string => {
  for (const name of names) {
    const value = row[name];
    if (
      (typeof value === "string" || typeof value === "number" || typeof value === "boolean") &&
      String(value).trim()
    ) {
      return String(value).trim();
    }
  }
  return fallback;
};

const rowNumber = (row: DynatraceDependencyRow, name: string): number => {
  const parsed = Number(rowField(row, [name], "0"));
  return Number.isFinite(parsed) ? parsed : 0;
};

const selectShowcaseDependencies = (
  candidates: DependencyCandidate[],
): DependencyCandidate[] => {
  const selected: DependencyCandidate[] = [];
  const seenFlows = new Set<string>();

  for (const dependency of candidates) {
    if (!dependency.serviceName || /^[_:]|:\d/u.test(dependency.serviceName)) {
      continue;
    }
    const flowKey = [
      dependency.source,
      dependency.destination,
      dependency.protocol,
      dependency.port,
    ].join("|");
    if (seenFlows.has(flowKey)) {
      continue;
    }
    seenFlows.add(flowKey);
    selected.push(dependency);
    if (selected.length === DEFAULT_VISIBLE_DEPENDENCIES) {
      break;
    }
  }

  return selected;
};

const statusLabel: Record<DependencyCandidate["mappingState"], string> = {
  ready: "Ready",
  review: "Review",
  "needs-map": "Needs map",
};

const accessProfileLabel: Record<ForwardAccessProfile, string> = {
  "read-only": "Read Only",
  "network-operator": "Network Operator",
  "network-admin": "Network Admin",
};

const accessProfileDetail: Record<ForwardAccessProfile, string> = {
  "read-only": "Resolve hosts, evaluate paths, and reconcile checks without intent-check writes.",
  "network-operator": "The same plan-only synchronization; the bundled NQE action may run reviewed arbitrary queries.",
  "network-admin": "Plan, create, and exact-approved update managed intent checks through the app backend.",
};

type WorkflowStageTone = "ready" | "needs-work" | "controlled";

interface WorkflowStageDefinition {
  icon: React.ReactNode;
  label: string;
  title: string;
  value: string;
  detail: string;
  tone: WorkflowStageTone;
}

const downloadTextFile = (fileName: string, text: string, type: string) => {
  const blob = new Blob([text], { type });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = fileName;
  anchor.click();
  URL.revokeObjectURL(url);
};

export const Home = () => {
  const [activeDependencyId, setActiveDependencyId] = useState("");
  const [showcaseMode, setShowcaseMode] = useState(false);
  const [showAllDependencies, setShowAllDependencies] = useState(false);
  const [problemId, setProblemId] = useState("P-000000");
  const [sourceInstanceId, setSourceInstanceId] = useState("");
  const [selectedDiscoveryProfileId, setSelectedDiscoveryProfileId] = useState("");
  const [forwardBaseUrl, setForwardBaseUrl] = useState("");
  const [forwardNetworkId, setForwardNetworkId] = useState("");
  const [includeReviewRows, setIncludeReviewRows] = useState(false);
  const [enablePerformanceMonitoring, setEnablePerformanceMonitoring] = useState(false);
  const syncMode: ForwardSyncMode = "direct-api";
  const [forwardAccessProfile, setForwardAccessProfile] =
    useState<ForwardAccessProfile>("read-only");
  const [syncRequest, setSyncRequest] = useState<
    ForwardSyncRequest | undefined
  >();
  const dependencyDiscovery = useAppFunction<DependencyDiscoveryResponse>(
    {
      name: "dependency-discovery",
      data: selectedDiscoveryProfileId
        ? { profileId: selectedDiscoveryProfileId }
        : {},
    },
    { autoFetch: true, autoFetchOnUpdate: true },
  );
  const liveIngestStatusQuery = useDql<DynatraceDependencyRow>(
    {
      query: LIVE_INGEST_STATUS_QUERY,
      maxResultRecords: 1,
    },
    { staleTime: 0 },
  );
  const liveNetworkEvidenceQuery = useDql<DynatraceDependencyRow>(
    {
      query: LIVE_NETWORK_EVIDENCE_QUERY,
      maxResultRecords: 1,
    },
    { staleTime: 0 },
  );
  const liveDependencies = dependencyDiscovery.data?.dependencies || [];
  const isLiveSource = dependencyDiscovery.data?.status === "ready" && liveDependencies.length > 0;
  const sourceDependencies = liveDependencies;
  const liveStatusRow = liveIngestStatusQuery.data?.records?.[0];
  const liveNetworkRow = liveNetworkEvidenceQuery.data?.records?.[0];
  const liveRunId = dependencyDiscovery.data?.evidence?.runIds.join(", ") || "tenant query";
  const liveEvidenceSource = dependencyDiscovery.data?.evidence?.sources.join(", ") || "dynatrace-live-spans";
  const liveEvidenceLabel = "Live Dynatrace span dependencies";
  const liveNetworkId = rowField(
    liveNetworkRow || liveStatusRow || {},
    ["forward.dynatrace.target.network_id"],
  );
  const liveSnapshotId = rowField(
    liveNetworkRow || liveStatusRow || {},
    ["forward.dynatrace.target.snapshot_id"],
  );
  const liveProblemId = rowField(
    liveNetworkRow || {},
    ["forward.dynatrace.problem_id"],
  );
  const liveImportState = rowField(
    liveStatusRow || {},
    ["forward.dynatrace.import_state"],
    "not loaded",
  );
  const livePlannedChecks = rowNumber(
    liveStatusRow || {},
    "forward.dynatrace.planned_checks",
  );
  const liveUnchangedChecks = rowNumber(
    liveStatusRow || {},
    "forward.dynatrace.count.unchanged",
  );
  const liveDriftChecks = rowNumber(
    liveStatusRow || {},
    "forward.dynatrace.count.changed",
  ) + rowNumber(liveStatusRow || {}, "forward.dynatrace.count.stale");
  const liveReachablePaths = rowNumber(
    liveNetworkRow || {},
    "forward.dynatrace.count.reachable",
  );
  const liveTotalPaths = rowNumber(
    liveNetworkRow || {},
    "forward.dynatrace.count.total",
  );
  const liveIncompletePaths = rowNumber(
    liveNetworkRow || {},
    "forward.dynatrace.count.ambiguous",
  ) + rowNumber(liveNetworkRow || {}, "forward.dynatrace.count.unmapped") +
    rowNumber(liveNetworkRow || {}, "forward.dynatrace.count.failed");

  const sync = useAppFunction<ForwardSyncResponse>({
    name: "forward-sync",
    data: syncRequest,
  }, { autoFetch: false, autoFetchOnUpdate: true });
  const effectiveDependencies = sourceDependencies;

  const showcaseDependencies = useMemo(
    () => selectShowcaseDependencies(effectiveDependencies),
    [effectiveDependencies],
  );
  const selectedForSync = useMemo(() => {
    const eligible = effectiveDependencies.filter((dependency) =>
        dependency.mappingState === "ready" ||
        (includeReviewRows && dependency.mappingState === "review"));
    if (!showcaseMode) {
      return eligible;
    }
    const showcaseIds = new Set(showcaseDependencies.map((dependency) => dependency.id));
    return eligible.filter((dependency) => showcaseIds.has(dependency.id));
  }, [effectiveDependencies, includeReviewRows, showcaseDependencies, showcaseMode]);
  const displayedDependencies = showAllDependencies
    ? effectiveDependencies
    : showcaseMode
      ? showcaseDependencies
      : effectiveDependencies.slice(0, DEFAULT_VISIBLE_DEPENDENCIES);

  const readiness = useMemo(() => {
    const readyRows = effectiveDependencies.filter(
      (dependency) => dependency.mappingState === "ready",
    ).length;
    return effectiveDependencies.length === 0
      ? 0
      : Math.round((readyRows / effectiveDependencies.length) * 100);
  }, [effectiveDependencies]);
  const mappingCounts = useMemo(
    () =>
      effectiveDependencies.reduce<Record<DependencyCandidate["mappingState"], number>>(
        (counts, dependency) => ({
          ...counts,
          [dependency.mappingState]: counts[dependency.mappingState] + 1,
        }),
        { ready: 0, review: 0, "needs-map": 0 },
      ),
    [effectiveDependencies],
  );
  const workflowStages: WorkflowStageDefinition[] = [
    {
      icon: <FlowIcon />,
      label: "Observe",
      title: "Dynatrace application evidence",
      value: `${effectiveDependencies.length}`,
      detail: `${liveEvidenceSource} · explicit live Grail rows`,
      tone: effectiveDependencies.length > 0 ? "ready" : "needs-work",
    },
    {
      icon: <NetworkIcon />,
      label: "Resolve",
      title: "Endpoint eligibility",
      value: `${mappingCounts.ready}`,
      detail: `${mappingCounts.review} review / ${mappingCounts["needs-map"]} unmapped`,
      tone:
        mappingCounts.ready === effectiveDependencies.length
          ? "ready"
          : "needs-work",
    },
    {
      icon: <PathIcon />,
      label: "Evidence",
      title: "Path evidence",
      value: liveNetworkRow ? `${liveReachablePaths}/${liveTotalPaths}` : "not loaded",
      detail: liveNetworkRow
        ? `Forward /paths-bulk · ${liveIncompletePaths} incomplete`
        : "Forward /paths-bulk preflight",
      tone: liveNetworkRow && liveIncompletePaths === 0 ? "ready" : "controlled",
    },
    {
      icon: <UploadIcon />,
      label: "Package",
      title: "Intent package",
      value: `${selectedForSync.length}`,
      detail: "bulk NewNetworkCheck JSON",
      tone: selectedForSync.length > 0 ? "ready" : "needs-work",
    },
    {
      icon: <AutomationEngineIcon />,
      label: "Synchronize",
      title: "Direct Forward API",
      value: accessProfileLabel[forwardAccessProfile],
      detail: "Tenant-managed connection · capability enforced by profile",
      tone: "controlled",
    },
    {
      icon: <CheckmarkIcon />,
      label: "Reconcile",
      title: "Forward status feedback",
      value: liveImportState,
      detail: liveStatusRow
        ? `${liveUnchangedChecks} unchanged / ${liveDriftChecks} drift`
        : "sanitized reconciliation events",
      tone: liveImportState === "reconciled" && liveDriftChecks === 0
        ? "ready"
        : "controlled",
    },
  ];

  useEffect(() => {
    if (!effectiveDependencies.some((dependency) => dependency.id === activeDependencyId)) {
      setActiveDependencyId(effectiveDependencies[0]?.id || "");
    }
  }, [activeDependencyId, effectiveDependencies]);

  useEffect(() => {
    if (!isLiveSource) return;
    if (liveProblemId) {
      setProblemId((current) => current === "P-000000" ? liveProblemId : current);
    }
    if (liveNetworkId) {
      setForwardNetworkId((current) => current || liveNetworkId);
    }
  }, [isLiveSource, liveNetworkId, liveProblemId]);

  useEffect(() => {
    if (
      !isLiveSource ||
      syncRequest ||
      !sourceInstanceId ||
      !forwardNetworkId ||
      effectiveDependencies.length === 0
    ) {
      return;
    }
    setSyncRequest({
      sourceInstanceId,
      forwardBaseUrl,
      forwardNetworkId,
      syncMode: "direct-api",
      forwardAccessProfile,
      includeReviewRows: false,
      enablePerformanceMonitoring,
      dependencies: effectiveDependencies,
    });
  }, [
    effectiveDependencies,
    enablePerformanceMonitoring,
    forwardBaseUrl,
    forwardAccessProfile,
    forwardNetworkId,
    isLiveSource,
    sourceInstanceId,
    syncRequest,
  ]);

  async function loadLiveDependencies() {
    const [result] = await Promise.all([
      dependencyDiscovery.refetch(),
      liveIngestStatusQuery.forceRefetch(),
      liveNetworkEvidenceQuery.forceRefetch(),
    ]);
    if (result.dependencies?.length) {
      setActiveDependencyId(result.dependencies[0].id);
      setShowAllDependencies(false);
    }
  }

  function buildExportPackage() {
    setSyncRequest({
      sourceInstanceId,
      forwardBaseUrl,
      forwardNetworkId,
      syncMode,
      forwardAccessProfile,
      includeReviewRows,
      enablePerformanceMonitoring,
      dependencies: showcaseMode ? showcaseDependencies : effectiveDependencies,
    });
  }

  return (
    <Flex className="page" flexDirection="column" gap={24}>
      <TitleBar>
        <TitleBar.Title>Forward</TitleBar.Title>
      </TitleBar>

      <section className="hero-band">
        <div className="hero-copy">
          <div className="brand-lockup" aria-label="Dynatrace and Forward closed-loop integration">
            <span className="brand-node dynatrace-brand">
              <img src={dynatraceLogoUrl} alt="" aria-hidden="true" />
              <span>Dynatrace</span>
            </span>
            <span className="brand-arrow" aria-hidden="true">⇄</span>
            <span className="brand-node forward-brand">
              <img src={forwardLogoUrl} alt="Forward" />
            </span>
          </div>
          <p className="eyebrow">Application-aware network intent</p>
          <Heading level={1}>Turn Dynatrace dependencies into Forward network evidence</Heading>
          <Paragraph>
            Use live Dynatrace application evidence to define network intent, then show sanitized
            Forward reachability and reconciliation results against exact network snapshots.
          </Paragraph>
          <div className="workflow-strip" aria-label="Dynatrace and Forward evidence workflow">
            <div>
              <Strong>Dynatrace observes</Strong>
              <span>Applications, services, dependencies</span>
            </div>
            <div>
              <Strong>Forward verifies and reports</Strong>
              <span>Paths, intent checks, exact snapshots back to Grail</span>
            </div>
          </div>
        </div>
        <div className="hero-actions">
          <Button
            color="primary"
            variant="emphasized"
            disabled={!sourceInstanceId.trim()}
            onClick={buildExportPackage}
          >
            <Button.Prefix>
              <SyncIcon />
            </Button.Prefix>
            Build plan preview
          </Button>
        </div>
      </section>

      <section className="boundary-callout">
        <Strong>Integration boundary</Strong>
        <span>
          The Dynatrace app is the only installable. Its backend calls Forward APIs through a
          tenant-managed secret connection. Read Only and Network Operator are plan-only; Network Admin
          creates or exact-approved updates managed checks. Credentials never enter the browser.
        </span>
      </section>

      <section className={`source-banner ${isLiveSource ? "live" : "reference"}`} aria-label="Dynatrace data source">
        <div>
          <Strong>{isLiveSource ? liveEvidenceLabel : dependencyDiscovery.data?.summary || "Configure dependency discovery"}</Strong>
          <span>
            {isLiveSource
              ? `${liveDependencies.length} current rows from ${dependencyDiscovery.data?.selectedProfile?.name || "the selected tenant profile"}; run ${liveRunId}; source ${liveEvidenceSource}.`
              : "Create or select a tenant-owned spans-only profile. The app has no seeded or replay fallback."}
          </span>
          {dependencyDiscovery.data?.evidence?.rejectedRows ? (
            <span>{dependencyDiscovery.data.evidence.rejectedRows} rows failed closed during evidence validation.</span>
          ) : null}
          {!isLiveSource && dependencyDiscovery.data?.rejectedRows.length ? (
            <details className="discovery-rejections">
              <summary>Review fail-closed reasons</summary>
              <ul>
                {[...new Set(dependencyDiscovery.data.rejectedRows.map(({ reason }) => reason))]
                  .slice(0, 5)
                  .map((reason) => <li key={reason}>{reason}</li>)}
              </ul>
            </details>
          ) : null}
        </div>
        <div className="source-actions">
          <label className="discovery-profile-control">
            <span>Discovery profile</span>
            <select
              aria-label="Dependency discovery profile"
              value={selectedDiscoveryProfileId || dependencyDiscovery.data?.selectedProfile?.id || ""}
              onChange={(event) => setSelectedDiscoveryProfileId(event.target.value)}
            >
              <option value="">Tenant default</option>
              {(dependencyDiscovery.data?.profiles || []).map((profile) => (
                <option key={profile.id} value={profile.id}>
                  {profile.name}{profile.isDefault ? " (default)" : ""}
                </option>
              ))}
            </select>
          </label>
          {dependencyDiscovery.isLoading && <ProgressCircle aria-label="Loading live Dynatrace data" />}
          <Button
            color="primary"
            variant="accent"
            onClick={() => {
              void loadLiveDependencies();
            }}
          >
            Refresh closed-loop evidence
          </Button>
        </div>
        {dependencyDiscovery.error && (
          <Paragraph>Live query failed: {dependencyDiscovery.error.message}</Paragraph>
        )}
      </section>

      <CrossDomainEvidence />

      <section className="workflow-board" aria-label="Forward intent ingestion workflow">
        <div className="workflow-board-header">
          <div>
            <p className="eyebrow">Exposure-style workflow</p>
            <Heading level={2}>Dependency evidence to Forward intent checks</Heading>
          </div>
          <span>
            Dynatrace supplies live dependency evidence. The app backend asks Forward to resolve hosts,
            verify modeled paths, and reconcile managed checks through direct APIs.
          </span>
        </div>
        <div className="workflow-stage-grid">
          {workflowStages.map((stage) => (
            <WorkflowStage
              key={stage.label}
              icon={stage.icon}
              label={stage.label}
              title={stage.title}
              value={stage.value}
              detail={stage.detail}
              tone={stage.tone}
            />
          ))}
        </div>
        <div className="workflow-rule">
          <div>
            <Strong>Dynatrace UI</Strong>
            <span>Discover, normalize, review, and approve dependency candidates.</span>
          </div>
          <div>
            <Strong>App backend and Forward APIs</Strong>
            <span>Use the secret connection to resolve paths, plan changes, apply policy, and verify readback.</span>
          </div>
        </div>
      </section>

      <section className="metric-grid" aria-label="Integration status">
        <MetricCard
          icon={<FlowIcon />}
          label="Dependencies"
          value={`${effectiveDependencies.length}`}
          detail={`${selectedForSync.length} exportable`}
        />
        <MetricCard
          icon={<CheckmarkIcon />}
          label="Mapping readiness"
          value={`${readiness}%`}
          detail="host/IP correlation"
        />
        <MetricCard
          icon={<NetworkIcon />}
          label="Evidence target"
          value={liveNetworkId || forwardNetworkId || "Not loaded"}
          detail={liveSnapshotId ? `snapshot ${liveSnapshotId}` : "snapshot pending"}
        />
        <MetricCard
          icon={<AutomationEngineIcon />}
          label="Intent checks"
          value={`${livePlannedChecks || selectedForSync.length}`}
          detail={liveStatusRow ? `${liveUnchangedChecks} reconciled unchanged` : "persistent candidates"}
        />
        <MetricCard
          icon={<CheckmarkIcon />}
          label="Forward status"
          value={liveImportState}
          detail={liveStatusRow ? `${liveDriftChecks} unresolved drift` : "live Grail readback pending"}
        />
      </section>

      <main className="work-grid">
        <section className="panel dependency-panel">
          <PanelHeader
            icon={<DatabaseIcon />}
            title="Service Dependencies"
            detail="Current tenant-owned span rows normalized for Forward"
          />
          <div className="dependency-table-wrap">
            <table className="dependency-table">
              <thead>
                <tr>
                  <th>Service</th>
                  <th>Path</th>
                  <th>Port</th>
                  <th>Owner</th>
                  <th>Fit</th>
                  <th>Status</th>
                  <th aria-label="Actions" />
                </tr>
              </thead>
              <tbody>
                {displayedDependencies.map((dependency) => (
                  <tr
                    key={dependency.id}
                    className={
                      dependency.id === activeDependencyId ? "selected-row" : ""
                    }
                  >
                    <td>
                      <Strong>{dependency.serviceName}</Strong>
                      <span className="muted">
                        {dependency.appName} / {dependency.environment}
                      </span>
                    </td>
                    <td>
                      <span className="path-cell">
                        <span>
                          {dependency.sourceLabel && <span className="muted">{dependency.sourceLabel}<br /></span>}
                          {dependency.source}
                        </span>
                        <span aria-hidden>→</span>
                        <span>
                          {dependency.destinationLabel && <span className="muted">{dependency.destinationLabel}<br /></span>}
                          {dependency.destination}
                        </span>
                      </span>
                    </td>
                    <td>
                      {dependency.protocol}/{dependency.port}
                    </td>
                    <td>{dependency.owner}</td>
                    <td>{dependency.confidence}%</td>
                    <td>
                      <span className={`chip ${dependency.mappingState}`}>
                        {statusLabel[dependency.mappingState]}
                      </span>
                    </td>
                    <td>
                      <Button
                        color="primary"
                        size="condensed"
                        onClick={() => setActiveDependencyId(dependency.id)}
                      >
                        Review
                      </Button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {effectiveDependencies.length > DEFAULT_VISIBLE_DEPENDENCIES && (
            <div className="table-footer">
              <span>
                Showing {displayedDependencies.length} of {effectiveDependencies.length} rows.
              </span>
              <Button
                color="primary"
                size="condensed"
                onClick={() => setShowAllDependencies((current) => !current)}
              >
                {showAllDependencies ? "Show first 12" : "Show all rows"}
              </Button>
            </div>
          )}
        </section>

        <section className="panel">
          <PanelHeader
            icon={<UploadIcon />}
            title="Forward Plan Inputs"
            detail="Dependency candidates and non-authoritative preview metadata"
          />
          <div className="field-grid">
            <label>
              <span>Source instance ID</span>
              <TextInput
                value={sourceInstanceId}
                onChange={setSourceInstanceId}
                placeholder="dt-production-us"
              />
              <small>
                Required. Use one stable opaque ID for this Dynatrace source; do not use a run ID.
              </small>
            </label>
            <label>
              <span>Dynatrace problem</span>
              <TextInput
                value={problemId}
                onChange={setProblemId}
                placeholder="P-000000"
              />
            </label>
            <label>
              <span>Forward URL preview metadata</span>
              <TextInput
                value={forwardBaseUrl}
                onChange={setForwardBaseUrl}
                placeholder="Authoritative URL comes from the selected secret connection"
              />
            </label>
            <label>
              <span>Network ID preview metadata</span>
              <TextInput
                value={forwardNetworkId}
                onChange={setForwardNetworkId}
                placeholder="123"
              />
            </label>
          </div>

          <div className="mode-control">
            <span>Forward access profile</span>
            <ToggleButtonGroup
              value={forwardAccessProfile}
              onChange={(value) => setForwardAccessProfile(value as ForwardAccessProfile)}
            >
              <ToggleButtonGroup.Item value="read-only">
                Read Only
              </ToggleButtonGroup.Item>
              <ToggleButtonGroup.Item value="network-operator">
                Network Operator
              </ToggleButtonGroup.Item>
              <ToggleButtonGroup.Item value="network-admin">
                Network Admin
              </ToggleButtonGroup.Item>
            </ToggleButtonGroup>
            <small>{accessProfileDetail[forwardAccessProfile]}</small>
          </div>

          <div className="override-control">
            <Switch
              name="focused-scope"
              value={showcaseMode}
              onChange={(value) => {
                setShowcaseMode(value);
                setShowAllDependencies(false);
              }}
            >
              Focused change scope
            </Switch>
            <small>
              Limit the package to 12 unique flows for focused review. Turn off for the full discovered scope.
            </small>
          </div>

          <div className="override-control">
            <Switch
              name="enable-performance-monitoring"
              value={enablePerformanceMonitoring}
              onChange={setEnablePerformanceMonitoring}
            >
              Enable Forward path health monitoring
            </Switch>
            <small>
              Opt in only when Forward performance collection is configured for the modeled path devices.
            </small>
          </div>

          <div className="override-control">
            <Switch
              name="include-review-rows"
              value={includeReviewRows}
              onChange={setIncludeReviewRows}
            >
              Force include review rows
            </Switch>
            <small>
              Override only after operator review. Default export requires Forward-resolved endpoints.
            </small>
          </div>

          <Button
            color="primary"
            variant="accent"
            disabled={!sourceInstanceId.trim()}
            onClick={buildExportPackage}
          >
            <Button.Prefix>
              <SyncIcon />
            </Button.Prefix>
            Build resolved plan
          </Button>
        </section>
      </main>

      <section className="panel">
        <PanelHeader
          icon={<PathIcon />}
          title="Forward Host Resolution And Path Evidence"
          detail="Read-only preflight before intent creation"
        />
        {liveNetworkRow ? (
          <ResultBody
            status={liveIncompletePaths === 0 ? "ready" : "blocked"}
            summary={`Live Forward /paths-bulk evidence is bound to network ${liveNetworkId}, snapshot ${liveSnapshotId}.`}
            rows={[
              { label: "Assessment", value: rowField(liveNetworkRow, ["forward.dynatrace.network_assessment"]) },
              { label: "Queryable", value: rowField(liveNetworkRow, ["forward.dynatrace.count.queryable"], "0") },
              { label: "Reachable", value: `${liveReachablePaths} / ${liveTotalPaths}` },
              { label: "Blocked", value: rowField(liveNetworkRow, ["forward.dynatrace.count.blocked"], "0") },
              { label: "Incomplete", value: `${liveIncompletePaths}` },
              { label: "Evidence source", value: rowField(liveNetworkRow, ["forward.dynatrace.evidence_source"]) },
            ]}
            nextSteps={[]}
          />
        ) : (
          <EmptyState text="No live Forward path evidence loaded. The app backend uses Forward host and /paths-bulk APIs; no custom NQE is required." />
        )}
        <div className="sync-grid">
          <div>
            <Heading level={5}>Production preflight sequence</Heading>
            <ol className="action-list">
              <li>
                <code>GET</code>{" "}
                <span>/api/networks/{forwardNetworkId || "{networkId}"}/hosts/{`{hostSpecifier}`}?snapshotId={`{snapshotId}`}</span>
                <p>Resolve each observed endpoint against the selected Forward snapshot.</p>
              </li>
              <li>
                <code>POST</code>{" "}
                <span>/api/networks/{forwardNetworkId || "{networkId}"}/paths-bulk?snapshotId={`{snapshotId}`}</span>
                <p>Evaluate the resolved source, destination, protocol, and port before intent-check import.</p>
              </li>
            </ol>
          </div>
          <div>
            <Heading level={5}>NQE extension boundary</Heading>
            <Paragraph>
              Custom NQE is optional and customer-owned. The bundled NQE action executes allowlisted Library queries
              under Read Only or reviewed arbitrary queries under Network Operator or Network Admin, returning only
              sanitized aggregate evidence.
            </Paragraph>
          </div>
        </div>
      </section>

      <section className="panel">
        <PanelHeader
          icon={<CheckmarkIcon />}
          title="Forward Synchronization Status"
          detail="Sanitized closed-loop status from the app backend"
        />
        <div className="status-actions">
          <span>
            Forward publishes aggregate status back to Grail. No Forward
            credentials, hostnames, check names, or API bodies are shown here.
          </span>
        </div>
        {liveIngestStatusQuery.isFetching && (
          <ProgressCircle aria-label="Loading Forward status" />
        )}
        {liveStatusRow ? (
          <ResultBody
            status={liveImportState === "reconciled" && liveDriftChecks === 0 ? "ready" : "blocked"}
            summary={`Forward reconciliation ${liveImportState} package ${rowField(liveStatusRow, ["forward.dynatrace.package_id"])} against snapshot ${liveSnapshotId}.`}
            rows={[
              { label: "Planned", value: `${livePlannedChecks}` },
              { label: "Create", value: rowField(liveStatusRow, ["forward.dynatrace.count.create"], "0") },
              { label: "Unchanged", value: `${liveUnchangedChecks}` },
              { label: "Drift", value: `${liveDriftChecks}` },
              { label: "Signature", value: rowField(liveStatusRow, ["forward.dynatrace.signature_status"]) },
              { label: "Mode", value: rowField(liveStatusRow, ["forward.dynatrace.mode"]) },
              { label: "Forward profile", value: rowField(liveStatusRow, ["forward.dynatrace.access_profile"], "unknown") },
            ]}
            nextSteps={liveDriftChecks === 0
              ? ["No unresolved drift; the current package and Forward snapshot are reconciled."]
              : ["Review changed and stale checks, then stage a new exact plan approval."]}
          />
        ) : (
          <EmptyState text="No live Forward ingest status loaded yet." />
        )}
        {liveIngestStatusQuery.error && (
          <Paragraph>{liveIngestStatusQuery.error.message}</Paragraph>
        )}
      </section>

      <section className="panel">
        <PanelHeader
          icon={<AutomationEngineIcon />}
          title="Forward Synchronization Plan"
          detail="Built after Forward host resolution"
        />
        {sync.isLoading && <ProgressCircle aria-label="Loading Forward synchronization plan" />}
        {sync.data ? (() => {
          const syncData = sync.data;
          const hasArtifactPayload =
            syncData.status === "ready" &&
            Boolean(syncData.intentChecksPreview.trim()) &&
            Boolean(syncData.exportManifestPreview.trim());
          let intentCheckSample = "";
          let artifactPayloadError = "";
          if (hasArtifactPayload) {
            try {
              const intentChecks = JSON.parse(syncData.intentChecksPreview) as unknown;
              if (!Array.isArray(intentChecks)) {
                throw new Error("Intent-check preview is not an array.");
              }
              intentCheckSample = JSON.stringify(intentChecks.slice(0, 3), null, 2);
            } catch {
              artifactPayloadError =
                "The preview did not contain a valid intent-check array. Rebuild the plan before continuing.";
            }
          }
          return (
            <div className="sync-result">
              <ResultBody
                status={syncData.status}
                summary={syncData.summary}
                rows={[
                  { label: "Bulk checks", value: `${syncData.intentCheckCount}` },
                  { label: "Rejected rows", value: `${syncData.rejectedDependencyCount}` },
                  { label: "Generated", value: syncData.generatedAt },
                ]}
                nextSteps={syncData.nextSteps}
              />
              <p className="result-disclaimer">{syncData.disclaimer}</p>
              {artifactPayloadError && <Paragraph>{artifactPayloadError}</Paragraph>}
              {hasArtifactPayload && !artifactPayloadError && (
                <>
                  <div className="artifact-actions" aria-label="Export artifacts">
                <Button
                  color="primary"
                  size="condensed"
                  onClick={() =>
                    downloadTextFile(
                      "forward-dynatrace-manifest.json",
                      syncData.exportManifestPreview,
                      "application/json",
                    )
                  }
                >
                  <Button.Prefix>
                    <DownloadIcon />
                  </Button.Prefix>
                  Manifest
                </Button>
                <Button
                  color="primary"
                  size="condensed"
                  onClick={() =>
                    downloadTextFile(
                      "forward-intent-checks.json",
                      syncData.intentChecksPreview,
                      "application/json",
                    )
                  }
                >
                  <Button.Prefix>
                    <DownloadIcon />
                  </Button.Prefix>
                  Bulk checks JSON
                </Button>
                  </div>
                  <div className="readiness-grid" aria-label="Production readiness gates">
                    {syncData.readinessChecks.map((check) => (
                      <div className="readiness-item" key={check.label}>
                        <span className={`readiness-dot ${check.status}`} />
                        <div>
                          <Strong>{check.label}</Strong>
                          <small>{check.detail}</small>
                        </div>
                      </div>
                    ))}
                  </div>
                  <div className="sync-grid">
                    <div>
                      <Heading level={5}>Direct Forward API sequence</Heading>
                      <ol className="action-list">
                        {syncData.actions.map((action) => (
                          <li key={`${action.method}-${action.path}`}>
                            <code>{action.method}</code> <span>{action.path}</span>
                            <p>{action.purpose}</p>
                            {action.bodyPreview && <small>{action.bodyPreview}</small>}
                            {action.idempotencyKey && (
                              <small>Idempotency: {action.idempotencyKey}</small>
                            )}
                          </li>
                        ))}
                      </ol>
                    </div>
                    <div>
                      <Heading level={5}>Manifest</Heading>
                      <pre className="json-preview compact">
                        {syncData.exportManifestPreview}
                      </pre>
                    </div>
                  </div>
                  <div className="intent-preview">
                    <div className="intent-preview-heading">
                      <Heading level={5}>Bulk intent check payload sample</Heading>
                    </div>
                    <Paragraph>
                      Showing 3 of {syncData.intentCheckCount}; the downloaded artifact contains the full package.
                    </Paragraph>
                    <pre className="json-preview">{intentCheckSample}</pre>
                  </div>
                </>
              )}
            </div>
          );
        })() : (
          <div className="automation-flow">
            <FlowStep icon={<FlowIcon />} title="Discover" text="Services and dependencies" />
            <FlowStep icon={<DatabaseIcon />} title="Normalize" text="App, endpoint, protocol, owner" />
            <FlowStep icon={<NetworkIcon />} title="Resolve" text="Forward host inventory" />
            <FlowStep icon={<PathIcon />} title="Evidence" text="Optional /paths-bulk" />
            <FlowStep icon={<UploadIcon />} title="Package" text="NewNetworkCheck[] JSON" />
            <FlowStep icon={<CheckmarkIcon />} title="Import" text="Forward /checks?bulk" />
          </div>
        )}
        {sync.error && <Paragraph>{sync.error.message}</Paragraph>}
      </section>
    </Flex>
  );
};

const MetricCard = ({
  icon,
  label,
  value,
  detail,
}: {
  icon: React.ReactNode;
  label: string;
  value: string;
  detail: string;
}) => (
  <div className="metric-card">
    <div className="metric-icon">{icon}</div>
    <span>{label}</span>
    <Strong>{value}</Strong>
    <small>{detail}</small>
  </div>
);

const PanelHeader = ({
  icon,
  title,
  detail,
  badge,
}: {
  icon: React.ReactNode;
  title: string;
  detail: string;
  badge?: string;
}) => (
  <header className="panel-header">
    <div className="panel-title">
      <span className="panel-icon">{icon}</span>
      <Heading level={4}>{title}</Heading>
    </div>
    <div className="panel-header-meta">
      <span>{detail}</span>
      {badge && <span className="evidence-status controlled">{badge}</span>}
    </div>
  </header>
);

const ResultBody = ({
  status,
  summary,
  rows,
  nextSteps,
}: {
  status: string;
  summary: string;
  rows: { label: string; value: string }[];
  nextSteps: string[];
}) => (
  <div className="result-body">
    <span className={`result-status ${status}`}>{status}</span>
    <Paragraph>{summary}</Paragraph>
    <div className="evidence-grid">
      {rows.map((row) => (
        <div key={row.label}>
          <span>{row.label}</span>
          <Strong>{row.value}</Strong>
        </div>
      ))}
    </div>
    <ul className="next-list">
      {nextSteps.map((step) => (
        <li key={step}>{step}</li>
      ))}
    </ul>
  </div>
);

const EmptyState = ({ text }: { text: string }) => (
  <div className="empty-state">
    <Paragraph>{text}</Paragraph>
  </div>
);

const WorkflowStage = ({
  icon,
  label,
  title,
  value,
  detail,
  tone,
}: {
  icon: React.ReactNode;
  label: string;
  title: string;
  value: string;
  detail: string;
  tone: WorkflowStageTone;
}) => (
  <div className={`workflow-stage ${tone}`}>
    <div className="workflow-stage-top">
      <span className="workflow-stage-icon">{icon}</span>
      <span className="workflow-stage-label">{label}</span>
    </div>
    <Strong>{title}</Strong>
    <span className="workflow-stage-value">{value}</span>
    <small>{detail}</small>
  </div>
);

const FlowStep = ({
  icon,
  title,
  text,
}: {
  icon: React.ReactNode;
  title: string;
  text: string;
}) => (
  <div className="flow-step">
    <span>{icon}</span>
    <Strong>{title}</Strong>
    <small>{text}</small>
  </div>
);
