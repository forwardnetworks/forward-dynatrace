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

import demoForwardStatus from "../../../shared/demo-forward-ingest-status.json";
import customerTrialDependencies from "../../../shared/customer-trial-dependencies.json";
import { CrossDomainEvidence } from "../components/CrossDomainEvidence";
import type {
  NetworkProofRequest,
  NetworkProofResponse,
} from "../types/network-proof";
import type {
  ForwardNqePreviewRequest,
  ForwardNqePreviewResponse,
} from "../types/forward-nqe-preview";
import type {
  DependencyCandidate,
  ForwardSyncMode,
  ForwardSyncRequest,
  ForwardSyncResponse,
} from "../types/forward-sync";
import type {
  ForwardIngestStatusArtifact,
  ForwardStatusRequest,
  ForwardStatusResponse,
} from "../types/forward-status";

import "./Home.css";

const dependencies = customerTrialDependencies as DependencyCandidate[];
const sampleForwardStatus = demoForwardStatus as ForwardIngestStatusArtifact;
const dynatraceLogoUrl = "assets/Dynatrace_Logo.svg";
const forwardLogoUrl = "assets/forward-logo.svg";
const LIVE_DEPENDENCY_QUERY = `
fetch events, from: -24h
| filter event.type == "com.forward.application.dependency"
| sort timestamp desc
| dedup dependency.id
| fields timestamp, \`forward.dynatrace.run_id\`, dependency.id,
    app.name, app.environment, dt.entity.service, service.name,
    network.source, network.destination, network.protocol, network.port,
    owner.team, criticality, dependency.confidence, dependency.mapping_state
| limit 500
`;
const DEFAULT_VISIBLE_DEPENDENCIES = 12;

type DependencySource = "reference" | "live";
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

const dependencySlug = (value: string): string =>
  value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 80);

const normalizeLiveDependencies = (
  rows: DynatraceDependencyRow[],
): DependencyCandidate[] =>
  rows.map((row, index) => {
    const appName = rowField(row, ["app.name", "appName"], "unknown-app");
    const environment = rowField(row, ["app.environment", "environment"], "unknown");
    const serviceEntityId = rowField(row, ["dt.entity.service", "serviceEntityId"]);
    const serviceName = rowField(row, ["service.name", "serviceName"], serviceEntityId);
    const source = rowField(row, ["network.source", "source"]);
    const destination = rowField(row, ["network.destination", "destination"]);
    const rawProtocol = rowField(row, ["network.protocol", "protocol"], "tcp").toLowerCase();
    const protocol: DependencyCandidate["protocol"] = rawProtocol === "udp" ? "udp" : "tcp";
    const port = rowField(row, ["network.port", "port"]);
    const owner = rowField(row, ["owner.team", "owner"], "unknown-owner");
    const rawCriticality = rowField(row, ["criticality"], "medium").toLowerCase();
    const criticality: DependencyCandidate["criticality"] =
      rawCriticality === "critical" || rawCriticality === "high"
        ? rawCriticality
        : "medium";
    const parsedConfidence = Number.parseInt(
      rowField(row, ["dependency.confidence", "confidence"], "0"),
      10,
    );
    const confidence = Number.isFinite(parsedConfidence) ? parsedConfidence : 0;
    const rawMappingState = rowField(
      row,
      ["dependency.mapping_state", "mappingState"],
    ).toLowerCase();
    const mappingState: DependencyCandidate["mappingState"] =
      rawMappingState === "ready" || rawMappingState === "review" || rawMappingState === "needs-map"
        ? rawMappingState
        : !source || !destination || !serviceEntityId || !port
          ? "needs-map"
          : confidence < 90
            ? "review"
            : "ready";
    const id = rowField(
      row,
      ["dependency.id", "id"],
      [
        dependencySlug(appName),
        dependencySlug(environment),
        dependencySlug(serviceEntityId || serviceName),
        dependencySlug(source || `source-${index + 1}`),
        dependencySlug(destination || `destination-${index + 1}`),
        protocol,
        dependencySlug(port || "unknown-port"),
      ]
        .filter(Boolean)
        .join("-"),
    );

    return {
      id,
      appName,
      environment,
      serviceEntityId,
      serviceName,
      source,
      destination,
      protocol,
      port,
      owner,
      criticality,
      confidence,
      mappingState,
    };
  });

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

const modeLabel: Record<ForwardSyncMode, string> = {
  "manual-import": "Manual import",
  "data-connector": "Connector pull",
  "intent-package": "Bulk checks JSON",
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
  const captureMode = Boolean(globalThis.__FORWARD_DYNATRACE_CAPTURE_EVIDENCE__);
  const [activeDependencyId, setActiveDependencyId] = useState(dependencies[0].id);
  const [dependencySource, setDependencySource] = useState<DependencySource>(
    captureMode ? "reference" : "live",
  );
  const [showcaseMode, setShowcaseMode] = useState(false);
  const [showAllDependencies, setShowAllDependencies] = useState(false);
  const [problemId, setProblemId] = useState("P-000000");
  const [forwardBaseUrl, setForwardBaseUrl] = useState("");
  const [forwardNetworkId, setForwardNetworkId] = useState("");
  const [endpointQueryId, setEndpointQueryId] = useState("");
  const [includeReviewRows, setIncludeReviewRows] = useState(false);
  const [mappingOverrides, setMappingOverrides] = useState<
    Record<string, DependencyCandidate["mappingState"]>
  >({});
  const [nqePreviewDependencyId, setNqePreviewDependencyId] = useState<string>();
  const [syncMode, setSyncMode] = useState<ForwardSyncMode>("manual-import");
  const [proofRequest, setProofRequest] = useState<
    NetworkProofRequest | undefined
  >();
  const [nqePreviewRequest, setNqePreviewRequest] = useState<
    ForwardNqePreviewRequest | undefined
  >();
  const [syncRequest, setSyncRequest] = useState<
    ForwardSyncRequest | undefined
  >();
  const [statusRequest, setStatusRequest] = useState<
    ForwardStatusRequest | undefined
  >();

  const liveDependencyQuery = useDql<DynatraceDependencyRow>(
    {
      query: LIVE_DEPENDENCY_QUERY,
      maxResultRecords: 500,
    },
    { enabled: !captureMode, staleTime: 0 },
  );
  const liveDependencies = useMemo(
    () => normalizeLiveDependencies(liveDependencyQuery.data?.records || []),
    [liveDependencyQuery.data?.records],
  );
  const isLiveSource = dependencySource === "live" && liveDependencies.length > 0;
  const sourceDependencies =
    isLiveSource
      ? liveDependencies
      : dependencies;
  const liveRunId = rowField(
    liveDependencyQuery.data?.records?.[0] || {},
    ["forward.dynatrace.run_id"],
    "unknown run",
  );

  const proof = useAppFunction<NetworkProofResponse>({
    name: "network-proof",
    data: proofRequest,
  }, { autoFetch: false, autoFetchOnUpdate: true });
  const nqePreview = useAppFunction<ForwardNqePreviewResponse>({
    name: "forward-nqe-preview",
    data: nqePreviewRequest,
  }, { autoFetch: false, autoFetchOnUpdate: true });
  const sync = useAppFunction<ForwardSyncResponse>({
    name: "forward-sync",
    data: syncRequest,
  }, { autoFetch: false, autoFetchOnUpdate: true });
  const forwardStatus = useAppFunction<ForwardStatusResponse>({
    name: "forward-status",
    data: statusRequest,
  }, { autoFetch: false, autoFetchOnUpdate: true });

  const effectiveDependencies = useMemo(
    () =>
      sourceDependencies.map((dependency) => ({
        ...dependency,
        mappingState: mappingOverrides[dependency.id] || dependency.mappingState,
      })),
    [mappingOverrides, sourceDependencies],
  );
  const activeDependency =
    effectiveDependencies.find((dependency) => dependency.id === activeDependencyId) ||
    effectiveDependencies[0];

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
    return Math.round((readyRows / effectiveDependencies.length) * 100);
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
      title: "Dynatrace app map",
      value: `${effectiveDependencies.length}`,
      detail: isLiveSource ? "live Grail dependency rows" : "saved dependency rows",
      tone: "ready",
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
      value: "optional",
      detail: "Forward /paths-bulk preflight",
      tone: "controlled",
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
      label: "Import",
      title: "Forward-side workflow",
      value: modeLabel[syncMode],
      detail: "validate, dry-run, apply outside Dynatrace",
      tone: "controlled",
    },
    {
      icon: <CheckmarkIcon />,
      label: "Reconcile",
      title: "Forward status feedback",
      value: "Live Grail",
      detail: "sanitized reconciliation events",
      tone: "controlled",
    },
  ];

  useEffect(() => {
    const endpointResolution = nqePreview.data?.endpointResolution;
    if (!endpointResolution || !nqePreviewDependencyId) {
      return;
    }
    setMappingOverrides((current) => ({
      ...current,
      [nqePreviewDependencyId]: endpointResolution.mappingState,
    }));
  }, [nqePreview.data, nqePreviewDependencyId]);

  useEffect(() => {
    if (!effectiveDependencies.some((dependency) => dependency.id === activeDependencyId)) {
      setActiveDependencyId(effectiveDependencies[0]?.id || "");
    }
  }, [activeDependencyId, effectiveDependencies]);

  async function loadLiveDependencies() {
    const result = await liveDependencyQuery.forceRefetch();
    const normalized = normalizeLiveDependencies(result.data?.records || []);
    if (normalized.length > 0) {
      setDependencySource("live");
      setActiveDependencyId(normalized[0].id);
      setShowAllDependencies(false);
    }
  }

  function runPreview(dependency = activeDependency) {
    setProofRequest({
      serviceEntityId: dependency.serviceEntityId,
      problemId,
      source: dependency.source,
      destination: dependency.destination,
      port: dependency.port,
      protocol: dependency.protocol,
      forwardBaseUrl,
      forwardNetworkId,
      appName: dependency.appName,
      environment: dependency.environment,
      owner: dependency.owner,
      criticality: dependency.criticality,
    });
    setNqePreviewRequest({
      forwardBaseUrl,
      forwardNetworkId,
      templateId: "endpoint-inventory-smoke",
      maxRows: 25,
      execute: false,
      dependency: {
        appName: dependency.appName,
        environment: dependency.environment,
        serviceEntityId: dependency.serviceEntityId,
        serviceName: dependency.serviceName,
        source: dependency.source,
        destination: dependency.destination,
        protocol: dependency.protocol,
        port: dependency.port,
        owner: dependency.owner,
      },
    });
  }

  function checkEndpointMapping(dependency = activeDependency) {
    setActiveDependencyId(dependency.id);
    setNqePreviewDependencyId(dependency.id);
    setNqePreviewRequest({
      forwardBaseUrl,
      forwardNetworkId,
      templateId: "approved-endpoint-resolution",
      queryId: endpointQueryId,
      maxRows: 25,
      execute: true,
      dependency: {
        appName: dependency.appName,
        environment: dependency.environment,
        serviceEntityId: dependency.serviceEntityId,
        serviceName: dependency.serviceName,
        source: dependency.source,
        destination: dependency.destination,
        protocol: dependency.protocol,
        port: dependency.port,
        owner: dependency.owner,
      },
    });
  }

  function buildExportPackage() {
    setSyncRequest({
      forwardBaseUrl,
      forwardNetworkId,
      syncMode,
      includeReviewRows,
      dependencies: showcaseMode ? showcaseDependencies : effectiveDependencies,
    });
  }

  function loadForwardStatus() {
    setStatusRequest({
      statusArtifact: sampleForwardStatus,
    });
  }

  function showChangeAssurance() {
    document.querySelector(".change-comparison-section")?.scrollIntoView({
      behavior: "smooth",
      block: "start",
    });
  }

  return (
    <Flex className="page" flexDirection="column" gap={24}>
      <TitleBar>
        <TitleBar.Title>forward.dynatrace</TitleBar.Title>
      </TitleBar>

      <section className="hero-band">
        <div className="hero-copy">
          <div className="brand-lockup" aria-label="ServiceNow to Forward to Dynatrace assurance">
            <span className="brand-node servicenow-brand">
              <CheckmarkIcon />
              <span>ServiceNow change</span>
            </span>
            <span className="brand-arrow" aria-hidden="true">→</span>
            <span className="brand-node forward-brand">
              <img src={forwardLogoUrl} alt="Forward" />
            </span>
            <span className="brand-arrow" aria-hidden="true">→</span>
            <span className="brand-node dynatrace-brand">
              <img src={dynatraceLogoUrl} alt="" aria-hidden="true" />
              <span>Dynatrace</span>
            </span>
          </div>
          <p className="eyebrow">Checksummed cross-domain change assurance</p>
          <Heading level={1}>Assure ServiceNow changes with Forward and Dynatrace evidence</Heading>
          <Paragraph>
            Bind one approved change to exact pre/post Forward reachability, Dynatrace deployment
            health, intent drift, and explicit gate reasons without moving Forward credentials into Dynatrace.
          </Paragraph>
          <div className="workflow-strip" aria-label="ServiceNow, Forward, and Dynatrace assurance workflow">
            <div>
              <Strong>ServiceNow governs</Strong>
              <span>Approval, scope, audit record</span>
            </div>
            <div>
              <Strong>Forward verifies</Strong>
              <span>Paths, checks, exposure</span>
            </div>
            <div>
              <Strong>Dynatrace observes</Strong>
              <span>Deployment, service health, Grail</span>
            </div>
          </div>
        </div>
        <div className="hero-actions">
          <Button color="primary" variant="emphasized" onClick={showChangeAssurance}>
            <Button.Prefix>
              <CheckmarkIcon />
            </Button.Prefix>
            Review change assurance
          </Button>
          <Button color="primary" variant="emphasized" onClick={buildExportPackage}>
            <Button.Prefix>
              <SyncIcon />
            </Button.Prefix>
            Build package
          </Button>
          <Button color="primary" variant="emphasized" onClick={() => checkEndpointMapping()}>
            <Button.Prefix>
              <NetworkIcon />
            </Button.Prefix>
            Check mapping
          </Button>
        </div>
      </section>

      <section className="boundary-callout">
        <Strong>Integration boundary</Strong>
        <span>
          ServiceNow remains the approval and audit record. This integration does not deploy or roll back;
          it never writes to Forward. Forward imports the bulk checks JSON manually, or a Forward-side
          connector pulls the package.
        </span>
      </section>

      <section className={`source-banner ${isLiveSource ? "live" : "reference"}`} aria-label="Dynatrace data source">
        <div>
          <Strong>
            {captureMode
              ? "Checked replay dependency data"
              : isLiveSource
                ? "Live Dynatrace Grail data"
                : "Saved dependency data"}
          </Strong>
          <span>
            {captureMode
              ? `${dependencies.length} saved rows for the credential-free rehearsal; live Grail remains the production source.`
              : isLiveSource
              ? `${liveDependencies.length} deduplicated rows from ${liveRunId}`
              : "Local fallback while live Grail dependency evidence is unavailable."}
          </span>
        </div>
        <div className="source-actions">
          {captureMode ? (
            <span className="evidence-status controlled">SYNTHETIC DEMO REHEARSAL</span>
          ) : (
            <>
              {liveDependencyQuery.isFetching && <ProgressCircle aria-label="Loading live Dynatrace data" />}
              <Button
                color="primary"
                variant="accent"
                onClick={() => {
                  void loadLiveDependencies();
                }}
              >
                Load live Dynatrace data
              </Button>
              <Button
                color="primary"
                onClick={() => {
                  setDependencySource("reference");
                  setActiveDependencyId(dependencies[0].id);
                  setShowAllDependencies(false);
                }}
              >
                Use saved dependencies
              </Button>
            </>
          )}
        </div>
        {!captureMode && liveDependencyQuery.error && (
          <Paragraph>Live query failed: {liveDependencyQuery.error.message}</Paragraph>
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
            Dynatrace supplies dependency evidence. Forward owns host resolution,
            optional path evidence, validation, dry-run, apply, and reconciliation.
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
            <Strong>Dynatrace side</Strong>
            <span>Discover, normalize, and export dependency candidates.</span>
          </div>
          <div>
            <Strong>Forward side</Strong>
            <span>Resolve hosts, run optional path evidence, dry-run, then apply under policy.</span>
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
          label="Forward mode"
          value={modeLabel[syncMode]}
          detail={forwardNetworkId || "network pending"}
        />
        <MetricCard
          icon={<AutomationEngineIcon />}
          label="Intent checks"
          value={`${selectedForSync.length}`}
          detail="persistent candidates"
        />
        <MetricCard
          icon={<CheckmarkIcon />}
          label="Forward status"
          value="Live evidence"
          detail="Refresh the assurance portal above"
        />
      </section>

      <main className="work-grid">
        <section className="panel dependency-panel">
          <PanelHeader
            icon={<DatabaseIcon />}
            title="Service Dependencies"
            detail="Dynatrace rows normalized for Forward"
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
                        {dependency.source}
                        <span aria-hidden>→</span>
                        {dependency.destination}
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
                      <div className="row-actions">
                        <Button
                          color="primary"
                          size="condensed"
                          onClick={() => {
                            setActiveDependencyId(dependency.id);
                            runPreview(dependency);
                          }}
                        >
                          <Button.Prefix>
                            <PathIcon />
                          </Button.Prefix>
                          Preview
                        </Button>
                        <Button
                          color="primary"
                          size="condensed"
                          onClick={() => {
                            checkEndpointMapping(dependency);
                          }}
                        >
                          <Button.Prefix>
                            <NetworkIcon />
                          </Button.Prefix>
                          Check
                        </Button>
                      </div>
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
            title="Forward Package Inputs"
            detail="Dependency candidates and package metadata"
          />
          <div className="field-grid">
            <label>
              <span>Dynatrace problem</span>
              <TextInput
                value={problemId}
                onChange={setProblemId}
                placeholder="P-000000"
              />
            </label>
            <label>
              <span>Forward URL metadata</span>
              <TextInput
                value={forwardBaseUrl}
                onChange={setForwardBaseUrl}
                placeholder="https://fwd.example.com"
              />
            </label>
            <label>
              <span>Network ID metadata</span>
              <TextInput
                value={forwardNetworkId}
                onChange={setForwardNetworkId}
                placeholder="123"
              />
            </label>
            <label>
              <span>Endpoint NQE query ID</span>
              <TextInput
                value={endpointQueryId}
                onChange={setEndpointQueryId}
                placeholder="FQ_..."
              />
            </label>
          </div>

          <div className="mode-control">
            <span>Ingest path</span>
            <ToggleButtonGroup
              value={syncMode}
              onChange={(value) => setSyncMode(value as ForwardSyncMode)}
            >
              <ToggleButtonGroup.Item value="manual-import">
                Manual import
              </ToggleButtonGroup.Item>
              <ToggleButtonGroup.Item value="data-connector">
                Connector pull
              </ToggleButtonGroup.Item>
              <ToggleButtonGroup.Item value="intent-package">
                Bulk checks JSON
              </ToggleButtonGroup.Item>
            </ToggleButtonGroup>
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

          <Button color="primary" variant="accent" onClick={buildExportPackage}>
            <Button.Prefix>
              <SyncIcon />
            </Button.Prefix>
            Build resolved package
          </Button>
          <Button color="primary" variant="accent" onClick={() => checkEndpointMapping()}>
            <Button.Prefix>
              <NetworkIcon />
            </Button.Prefix>
            Check endpoint mapping
          </Button>
        </section>
      </main>

      <section className="panel">
        <PanelHeader
          icon={<NetworkIcon />}
          title="Path Context Plan"
          detail={activeDependency.serviceName}
        />
        {proof.isLoading && <ProgressCircle aria-label="Loading preview" />}
        {proof.data ? (
          <ResultBody
            status={proof.data.status}
            summary={proof.data.summary}
            rows={proof.data.evidence}
            nextSteps={proof.data.nextSteps}
          />
        ) : (
          <EmptyState text="No preview result yet." />
        )}
        {proof.error && <Paragraph>{proof.error.message}</Paragraph>}
      </section>

      <section className="panel">
        <PanelHeader
          icon={<PathIcon />}
          title="Forward Host Resolution And Path Evidence"
          detail="Read-only preflight before intent creation"
        />
        {nqePreview.isLoading && <ProgressCircle aria-label="Loading NQE preview" />}
        {nqePreview.data ? (
          <div className="nqe-preview-result">
            <ResultBody
              status={nqePreview.data.status}
              summary={nqePreview.data.summary}
              rows={nqePreview.data.evidence}
              nextSteps={nqePreview.data.nextSteps}
            />
            <div className="sync-grid">
              <div>
                <Heading level={5}>Production preflight sequence</Heading>
                <ol className="action-list">
                  <li>
                    <code>GET</code>{" "}
                    <span>/api/networks/{forwardNetworkId || "{networkId}"}/hosts/{`{hostSpecifier}`}?snapshotId={`{snapshotId}`}</span>
                    <p>
                      Resolve Dynatrace names, aliases, host IDs, IPs, and MACs
                      through Forward snapshot inventory.
                    </p>
                  </li>
                  <li>
                    <code>POST</code>{" "}
                    <span>/api/networks/{forwardNetworkId || "{networkId}"}/paths-bulk?snapshotId={`{snapshotId}`}</span>
                    <p>
                      Optional read-only path evidence uses the same resolved
                      endpoint values before intent-check import.
                    </p>
                  </li>
                  <li>
                    <code>{nqePreview.data.requestPreview.method}</code>{" "}
                    <span>{nqePreview.data.requestPreview.path}</span>
                    <p>
                      Optional NQE evidence can add confidence. Persistent
                      Forward writes still happen only in Forward-side ingest.
                    </p>
                  </li>
                </ol>
              </div>
              <div>
                <Heading level={5}>Request body</Heading>
                <pre className="json-preview compact">
                  {JSON.stringify(nqePreview.data.requestPreview.body, null, 2)}
                </pre>
              </div>
            </div>
            {nqePreview.data.result && (
              <div className="evidence-grid">
                <div>
                  <span>Rows</span>
                  <Strong>{String(nqePreview.data.result.totalRows)}</Strong>
                </div>
                <div>
                  <span>Returned</span>
                  <Strong>{String(nqePreview.data.result.returnedRows)}</Strong>
                </div>
                <div>
                  <span>Columns</span>
                  <Strong>{nqePreview.data.result.columns.join(", ") || "none"}</Strong>
                </div>
              </div>
            )}
            {nqePreview.data.endpointResolution && (
              <div className="endpoint-resolution-grid">
                <ResolutionCard
                  label="Source"
                  endpoint={nqePreview.data.endpointResolution.source}
                />
                <ResolutionCard
                  label="Destination"
                  endpoint={nqePreview.data.endpointResolution.destination}
                />
                <div className={`resolution-card ${nqePreview.data.endpointResolution.mappingState}`}>
                  <span>Export state</span>
                  <Strong>{statusLabel[nqePreview.data.endpointResolution.mappingState]}</Strong>
                  <small>{nqePreview.data.endpointResolution.summary}</small>
                </div>
              </div>
            )}
          </div>
        ) : (
          <EmptyState text="No NQE preview planned yet." />
        )}
        {nqePreview.error && <Paragraph>{nqePreview.error.message}</Paragraph>}
      </section>

      <section className="panel">
        <PanelHeader
          icon={<CheckmarkIcon />}
          title="Forward Ingest Status"
          detail="Read-only status from Forward-side runtime"
        />
        <div className="status-actions">
          <Button color="primary" variant="accent" onClick={loadForwardStatus}>
            <Button.Prefix>
              <DownloadIcon />
            </Button.Prefix>
            Load saved status artifact
          </Button>
          <span>
            Forward-side connector publishes aggregate status only. No Forward
            credentials, hostnames, check names, or API bodies are shown here.
          </span>
        </div>
        {forwardStatus.isLoading && <ProgressCircle aria-label="Loading Forward status" />}
        {forwardStatus.data ? (
          <ResultBody
            status={forwardStatus.data.status}
            summary={forwardStatus.data.summary}
            rows={forwardStatus.data.rows}
            nextSteps={forwardStatus.data.nextSteps}
          />
        ) : (
          <EmptyState text="No Forward ingest status loaded yet." />
        )}
        {forwardStatus.error && <Paragraph>{forwardStatus.error.message}</Paragraph>}
      </section>

      <section className="panel">
        <PanelHeader
          icon={<AutomationEngineIcon />}
          title="Forward-Centric Ingest Package"
          detail="Built after Forward host resolution"
        />
        {sync.isLoading && <ProgressCircle aria-label="Loading export package" />}
        {sync.data ? (() => {
          const syncData = sync.data;
          const intentChecks = JSON.parse(syncData.intentChecksPreview) as unknown[];
          const intentCheckSample = JSON.stringify(intentChecks.slice(0, 3), null, 2);
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
                  <Heading level={5}>Forward-side ingest sequence</Heading>
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
                <Heading level={5}>Bulk intent check payload sample</Heading>
                <Paragraph>
                  Showing 3 of {syncData.intentCheckCount}; the downloaded artifact contains the full package.
                </Paragraph>
                <pre className="json-preview">{intentCheckSample}</pre>
              </div>
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
}: {
  icon: React.ReactNode;
  title: string;
  detail: string;
}) => (
  <header className="panel-header">
    <div className="panel-title">
      <span className="panel-icon">{icon}</span>
      <Heading level={4}>{title}</Heading>
    </div>
    <span>{detail}</span>
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

const ResolutionCard = ({
  label,
  endpoint,
}: {
  label: string;
  endpoint: {
    value: string;
    status: string;
    matchCount: number | null;
    detail: string;
  };
}) => (
  <div className={`resolution-card ${endpoint.status}`}>
    <span>{label}</span>
    <Strong>{endpoint.value}</Strong>
    <small>{endpoint.detail}</small>
    <small>
      {endpoint.matchCount === null ? endpoint.status : `${endpoint.matchCount} ${endpoint.status}`}
    </small>
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
