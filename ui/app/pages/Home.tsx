import React, { useMemo, useState } from "react";

import { Button } from "@dynatrace/strato-components/buttons";
import { ProgressCircle } from "@dynatrace/strato-components/content";
import { Flex, TitleBar } from "@dynatrace/strato-components/layouts";
import { TextInput, ToggleButtonGroup } from "@dynatrace/strato-components/forms";
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
  PlayIcon,
  SyncIcon,
  UploadIcon,
} from "@dynatrace/strato-icons";
import { useAppFunction } from "@dynatrace-sdk/react-hooks";

import demoForwardStatus from "../../../shared/demo-forward-ingest-status.json";
import syntheticDependencies from "../../../shared/demo-dependencies.json";
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

const dependencies = syntheticDependencies as DependencyCandidate[];
const sampleForwardStatus = demoForwardStatus as ForwardIngestStatusArtifact;
const sampleForwardStatusCounts = sampleForwardStatus.counts ?? {};
const dynatraceLogoUrl = "assets/Dynatrace_Logo.svg";
const forwardLogoUrl = "assets/forward-logo.svg";

const selectedForSync = dependencies.filter(
  (dependency) => dependency.mappingState !== "needs-map",
);

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
  const [activeDependencyId, setActiveDependencyId] = useState(dependencies[0].id);
  const activeDependency =
    dependencies.find((dependency) => dependency.id === activeDependencyId) ||
    dependencies[0];

  const [problemId, setProblemId] = useState("P-000000");
  const [forwardBaseUrl, setForwardBaseUrl] = useState("");
  const [forwardNetworkId, setForwardNetworkId] = useState("");
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

  const readiness = useMemo(() => {
    const readyRows = dependencies.filter(
      (dependency) => dependency.mappingState === "ready",
    ).length;
    return Math.round((readyRows / dependencies.length) * 100);
  }, []);

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

  function buildExportPackage() {
    setSyncRequest({
      forwardBaseUrl,
      forwardNetworkId,
      syncMode,
      dependencies: selectedForSync,
    });
  }

  function loadForwardStatus() {
    setStatusRequest({
      statusArtifact: sampleForwardStatus,
    });
  }

  return (
    <Flex className="page" flexDirection="column" gap={24}>
      <TitleBar>
        <TitleBar.Title>Forward Intent Check Export</TitleBar.Title>
      </TitleBar>

      <section className="hero-band">
        <div className="hero-copy">
          <div className="brand-lockup" aria-label="Dynatrace to Forward">
            <span className="brand-node dynatrace-brand">
              <img src={dynatraceLogoUrl} alt="" aria-hidden="true" />
              <span>Dynatrace</span>
            </span>
            <span className="brand-arrow" aria-hidden="true">→</span>
            <span className="brand-node forward-brand">
              <img src={forwardLogoUrl} alt="Forward Networks" />
            </span>
          </div>
          <p className="eyebrow">Dynatrace application mapping to Forward intent</p>
          <Heading level={1}>Fill Forward intent checks from app dependencies</Heading>
          <Paragraph>
            Forward Field Integration reference for turning Dynatrace dependency
            maps into Forward bulk intent-check JSON.
          </Paragraph>
          <div className="workflow-strip" aria-label="Forward ingestion workflow">
            <div>
              <Strong>Dynatrace maps</Strong>
              <span>Service dependencies</span>
            </div>
            <div>
              <Strong>Export package</Strong>
              <span>Bulk intent JSON</span>
            </div>
            <div>
              <Strong>Forward imports</Strong>
              <span>Manual import or connector pull</span>
            </div>
          </div>
        </div>
        <div className="hero-actions">
          <Button color="primary" variant="emphasized" onClick={() => runPreview()}>
            <Button.Prefix>
              <PlayIcon />
            </Button.Prefix>
            Run preview
          </Button>
          <Button color="primary" variant="emphasized" onClick={buildExportPackage}>
            <Button.Prefix>
              <SyncIcon />
            </Button.Prefix>
            Build package
          </Button>
        </div>
      </section>

      <section className="boundary-callout">
        <Strong>Integration boundary</Strong>
        <span>
          This app builds Forward-ready artifacts. It never writes to Forward.
          Forward imports the bulk checks JSON manually, or a Forward-side
          connector pulls the package.
        </span>
      </section>

      <section className="metric-grid" aria-label="Integration status">
        <MetricCard
          icon={<FlowIcon />}
          label="Dependencies"
          value={`${dependencies.length}`}
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
          label="Last ingest"
          value={sampleForwardStatus.importState ?? "unknown"}
          detail={`${sampleForwardStatusCounts.changed ?? 0} changed / ${sampleForwardStatusCounts.stale ?? 0} stale`}
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
                {dependencies.map((dependency) => (
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
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>

        <section className="panel">
          <PanelHeader
            icon={<UploadIcon />}
            title="Forward Export Package"
            detail="Bulk checks JSON and manifest"
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

          <Button color="primary" variant="accent" onClick={buildExportPackage}>
            <Button.Prefix>
              <SyncIcon />
            </Button.Prefix>
            Build export package
          </Button>
        </section>
      </main>

      <section className="panel">
        <PanelHeader
          icon={<NetworkIcon />}
          title="Path Context"
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
          title="Read-Only NQE Preview"
          detail="Plan approved Forward evidence queries"
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
                <Heading level={5}>Forward NQE request</Heading>
                <ol className="action-list">
                  <li>
                    <code>{nqePreview.data.requestPreview.method}</code>{" "}
                    <span>{nqePreview.data.requestPreview.path}</span>
                    <p>
                      Read-only NQE execution. This app does not create, update,
                      or delete Forward checks.
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
            Load status artifact
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
          detail="Forward imports or pulls the package"
        />
        {sync.isLoading && <ProgressCircle aria-label="Loading export package" />}
        {sync.data ? (() => {
          const syncData = sync.data;
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
                <Heading level={5}>Bulk intent check payload preview</Heading>
                <pre className="json-preview">{syncData.intentChecksPreview}</pre>
              </div>
            </div>
          );
        })() : (
          <div className="automation-flow">
            <FlowStep icon={<FlowIcon />} title="Discover" text="Services and dependencies" />
            <FlowStep icon={<DatabaseIcon />} title="Normalize" text="App, endpoint, protocol, owner" />
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
