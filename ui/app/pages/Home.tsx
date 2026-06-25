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
  FlowIcon,
  NetworkIcon,
  PathIcon,
  PlayIcon,
  SyncIcon,
  UploadIcon,
} from "@dynatrace/strato-icons";
import { useAppFunction } from "@dynatrace-sdk/react-hooks";

import type {
  NetworkProofRequest,
  NetworkProofResponse,
} from "../types/network-proof";
import type {
  DependencyCandidate,
  ForwardSyncMode,
  ForwardSyncRequest,
  ForwardSyncResponse,
} from "../types/forward-sync";

import "./Home.css";

const dependencies: DependencyCandidate[] = [
  {
    id: "checkout-orders-db",
    appName: "Checkout",
    environment: "prod",
    serviceEntityId: "SERVICE-1234567890",
    serviceName: "checkout-api",
    source: "checkout-vip",
    destination: "orders-db",
    protocol: "tcp",
    port: "443",
    owner: "commerce-platform",
    criticality: "critical",
    confidence: 98,
    mappingState: "ready",
  },
  {
    id: "checkout-payment",
    appName: "Checkout",
    environment: "prod",
    serviceEntityId: "SERVICE-1234567890",
    serviceName: "checkout-api",
    source: "checkout-vip",
    destination: "payment-gateway",
    protocol: "tcp",
    port: "8443",
    owner: "payments",
    criticality: "critical",
    confidence: 94,
    mappingState: "ready",
  },
  {
    id: "inventory-cache",
    appName: "Inventory",
    environment: "prod",
    serviceEntityId: "SERVICE-0987654321",
    serviceName: "inventory-api",
    source: "inventory-vip",
    destination: "redis-cache",
    protocol: "tcp",
    port: "6379",
    owner: "supply-chain",
    criticality: "high",
    confidence: 87,
    mappingState: "review",
  },
  {
    id: "mobile-auth",
    appName: "Mobile",
    environment: "uat",
    serviceEntityId: "SERVICE-1122334455",
    serviceName: "mobile-bff",
    source: "mobile-bff",
    destination: "identity-api",
    protocol: "tcp",
    port: "443",
    owner: "digital",
    criticality: "medium",
    confidence: 73,
    mappingState: "needs-map",
  },
];

const selectedForSync = dependencies.filter(
  (dependency) => dependency.mappingState !== "needs-map",
);

const statusLabel: Record<DependencyCandidate["mappingState"], string> = {
  ready: "Ready",
  review: "Review",
  "needs-map": "Needs map",
};

const modeLabel: Record<ForwardSyncMode, string> = {
  "data-file": "Data file",
  "data-connector": "Connector",
  "intent-checks": "Intent checks",
};

export const Home = () => {
  const [activeDependencyId, setActiveDependencyId] = useState(dependencies[0].id);
  const activeDependency =
    dependencies.find((dependency) => dependency.id === activeDependencyId) ||
    dependencies[0];

  const [problemId, setProblemId] = useState("P-000000");
  const [forwardBaseUrl, setForwardBaseUrl] = useState("");
  const [forwardNetworkId, setForwardNetworkId] = useState("");
  const [dataFileName, setDataFileName] = useState(
    "dynatrace_service_dependencies.csv",
  );
  const [syncMode, setSyncMode] = useState<ForwardSyncMode>("data-file");
  const [includeInNetwork, setIncludeInNetwork] = useState(true);
  const [triggerCollection, setTriggerCollection] = useState(false);
  const [createVerifications, setCreateVerifications] = useState(true);
  const [proofRequest, setProofRequest] = useState<
    NetworkProofRequest | undefined
  >();
  const [syncRequest, setSyncRequest] = useState<
    ForwardSyncRequest | undefined
  >();

  const proof = useAppFunction<NetworkProofResponse>({
    name: "network-proof",
    data: proofRequest,
  }, { autoFetch: false, autoFetchOnUpdate: true });
  const sync = useAppFunction<ForwardSyncResponse>({
    name: "forward-sync",
    data: syncRequest,
  }, { autoFetch: false, autoFetchOnUpdate: true });

  const readiness = useMemo(() => {
    const readyRows = dependencies.filter(
      (dependency) => dependency.mappingState === "ready",
    ).length;
    return Math.round((readyRows / dependencies.length) * 100);
  }, []);

  function runProof(dependency = activeDependency) {
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
  }

  function syncToForward() {
    setSyncRequest({
      forwardBaseUrl,
      forwardNetworkId,
      dataFileName,
      syncMode,
      includeInNetwork,
      triggerCollection,
      createVerifications,
      dependencies: selectedForSync,
    });
  }

  return (
    <Flex className="page" flexDirection="column" gap={24}>
      <TitleBar>
        <TitleBar.Title>Forward Network Proof</TitleBar.Title>
      </TitleBar>

      <section className="hero-band">
        <div className="hero-copy">
          <p className="eyebrow">Dynatrace application mapping to Forward intent</p>
          <Heading level={1}>Fill Forward intent checks from app dependencies</Heading>
          <Paragraph>
            Art-of-the-possible demo for turning Dynatrace dependency maps into
            Forward Data Files and persistent Verify checks.
          </Paragraph>
        </div>
        <div className="hero-actions">
          <Button color="primary" variant="emphasized" onClick={() => runProof()}>
            <Button.Prefix>
              <PlayIcon />
            </Button.Prefix>
            Run proof
          </Button>
          <Button color="primary" variant="emphasized" onClick={syncToForward}>
            <Button.Prefix>
              <SyncIcon />
            </Button.Prefix>
            Sync to Forward
          </Button>
        </div>
      </section>

      <section className="demo-callout">
        <Strong>Demo guardrail</Strong>
        <span>
          This app builds Forward-ready artifacts and a production API plan. Live
          Forward mutation stays disabled until server-side credentials,
          allow-listing, and dedupe execution are wired.
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
                          runProof(dependency);
                        }}
                      >
                        <Button.Prefix>
                          <PathIcon />
                        </Button.Prefix>
                        Prove
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
          title="Forward Automation"
          detail="Standard Data File + Verify workflow"
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
              <span>Forward base URL</span>
              <TextInput
                value={forwardBaseUrl}
                onChange={setForwardBaseUrl}
                placeholder="https://fwd.example.com"
              />
            </label>
            <label>
              <span>Network ID</span>
              <TextInput
                value={forwardNetworkId}
                onChange={setForwardNetworkId}
                placeholder="123"
              />
            </label>
            <label className="wide-field">
              <span>Data file</span>
              <TextInput value={dataFileName} onChange={setDataFileName} />
            </label>
          </div>

          <div className="mode-control">
            <span>Sync target</span>
            <ToggleButtonGroup
              value={syncMode}
              onChange={(value) => setSyncMode(value as ForwardSyncMode)}
            >
              <ToggleButtonGroup.Item value="data-file">
                Data file
              </ToggleButtonGroup.Item>
              <ToggleButtonGroup.Item value="data-connector">
                Connector
              </ToggleButtonGroup.Item>
              <ToggleButtonGroup.Item value="intent-checks">
                Checks
              </ToggleButtonGroup.Item>
            </ToggleButtonGroup>
          </div>

          <div className="switch-stack">
            <ToggleRow
              checked={includeInNetwork}
              label="Enable file on network"
              onChange={setIncludeInNetwork}
            />
            <ToggleRow
              checked={createVerifications}
              label="Stage intent checks"
              onChange={setCreateVerifications}
            />
            <ToggleRow
              checked={triggerCollection}
              label="Trigger snapshot after sync"
              onChange={setTriggerCollection}
            />
          </div>

          <Button color="primary" variant="accent" onClick={syncToForward}>
            <Button.Prefix>
              <SyncIcon />
            </Button.Prefix>
            Build sync plan
          </Button>
        </section>
      </main>

      <section className="panel">
        <PanelHeader
          icon={<NetworkIcon />}
          title="Proof Result"
          detail={activeDependency.serviceName}
        />
        {proof.isLoading && <ProgressCircle aria-label="Loading proof" />}
        {proof.data ? (
          <ResultBody
            status={proof.data.status}
            summary={proof.data.summary}
            rows={proof.data.evidence}
            nextSteps={proof.data.nextSteps}
          />
        ) : (
          <EmptyState text="No proof result yet." />
        )}
        {proof.error && <Paragraph>{proof.error.message}</Paragraph>}
      </section>

      <section className="panel">
        <PanelHeader
          icon={<AutomationEngineIcon />}
          title="Automatic Forward Ingest"
          detail="Use Dynatrace mapping to fill Forward checks"
        />
        {sync.isLoading && <ProgressCircle aria-label="Loading sync plan" />}
        {sync.data ? (
          <div className="sync-result">
            <ResultBody
              status={sync.data.status}
              summary={sync.data.summary}
              rows={[
                { label: "Data file", value: sync.data.dataFileName },
                { label: "Intent checks", value: `${sync.data.intentCheckCount}` },
                { label: "Rejected rows", value: `${sync.data.rejectedDependencyCount}` },
                { label: "Generated", value: sync.data.generatedAt },
              ]}
              nextSteps={sync.data.nextSteps}
            />
            <p className="result-disclaimer">{sync.data.disclaimer}</p>
            <div className="readiness-grid" aria-label="Production readiness gates">
              {sync.data.readinessChecks.map((check) => (
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
                <Heading level={5}>Forward API sequence</Heading>
                <ol className="action-list">
                  {sync.data.actions.map((action) => (
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
                <Heading level={5}>Data File request</Heading>
                <pre className="json-preview compact">
                  {sync.data.dataFileRequestPreview}
                </pre>
                <Heading level={5}>CSV preview</Heading>
                <pre className="csv-preview">{sync.data.csvPreview}</pre>
              </div>
            </div>
            <div className="intent-preview">
              <Heading level={5}>Intent check payload preview</Heading>
              <pre className="json-preview">{sync.data.intentChecksPreview}</pre>
            </div>
          </div>
        ) : (
          <div className="automation-flow">
            <FlowStep icon={<FlowIcon />} title="Discover" text="Services and dependencies" />
            <FlowStep icon={<DatabaseIcon />} title="Normalize" text="App, endpoint, protocol, owner" />
            <FlowStep icon={<UploadIcon />} title="Publish" text="Forward Data File" />
            <FlowStep icon={<CheckmarkIcon />} title="Verify" text="NQE and intent checks" />
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

const ToggleRow = ({
  checked,
  label,
  onChange,
}: {
  checked: boolean;
  label: string;
  onChange: (checked: boolean) => void;
}) => (
  <label className="toggle-row">
    <input
      checked={checked}
      onChange={(event) => onChange(event.target.checked)}
      type="checkbox"
    />
    <span className="toggle-track" aria-hidden>
      <span />
    </span>
    <span className="toggle-label">{label}</span>
  </label>
);
