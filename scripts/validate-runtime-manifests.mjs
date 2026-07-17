#!/usr/bin/env node

import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const failures = [];
const readText = (relativePath) => readFile(path.join(root, relativePath), "utf8");
const fail = (message) => failures.push(message);

const verifiedImporterImage =
  "ghcr.io/forwardnetworks/forward-dynatrace-importer@sha256:7f884e44a2b54303d7da708bc805f0e16c1d19b192f95a90e94a63aad66bb7c6";

const cronJob = await readText("deploy/kubernetes/forward-dynatrace-connector-cronjob.yaml");
const checkHealthCronJob = await readText(
  "deploy/kubernetes/forward-dynatrace-check-health-cronjob.yaml",
);
const checkHealthConfigMap = await readText(
  "deploy/kubernetes/forward-dynatrace-check-health-config.example.yaml",
);
const statePvc = await readText(
  "deploy/kubernetes/forward-dynatrace-state-pvc.example.yaml",
);
const kubernetesConfigMap = await readText(
  "deploy/kubernetes/forward-dynatrace-configmap.example.yaml",
);
const kubernetesSecret = await readText(
  "deploy/kubernetes/forward-dynatrace-secret.example.yaml",
);
const dockerCompose = await readText("deploy/docker-compose/compose.yaml");
const dockerComposeEnv = await readText("deploy/docker-compose/forward-dynatrace.env.example");
const dockerComposeConfig = JSON.parse(
  await readText("deploy/docker-compose/forward-connector.config.example.json"),
);
const service = await readText("deploy/systemd/forward-dynatrace-connector.service");
const timer = await readText("deploy/systemd/forward-dynatrace-connector.timer");
const envExample = await readText("deploy/systemd/forward-dynatrace.env.example");
const handoffService = await readText("deploy/systemd/forward-dynatrace-handoff.service");
const handoffEnvExample = await readText("deploy/systemd/forward-handoff.env.example");
const checkHealthService = await readText(
  "deploy/systemd/forward-dynatrace-check-health.service",
);
const checkHealthTimer = await readText(
  "deploy/systemd/forward-dynatrace-check-health.timer",
);
const checkHealthEnv = await readText("deploy/systemd/forward-check-health.env.example");
const systemdConfig = JSON.parse(
  await readText("deploy/systemd/forward-connector.config.example.json"),
);
const cronSchedule = await readText("deploy/cron/forward-dynatrace.crontab.example");
const cronEnv = await readText("deploy/cron/forward-dynatrace.env.example");
const cronConfig = JSON.parse(
  await readText("deploy/cron/forward-connector.config.example.json"),
);

const requiredCronJobSnippets = [
  "kind: CronJob",
  "concurrencyPolicy: Forbid",
  "restartPolicy: Never",
  "runAsNonRoot: true",
  "readOnlyRootFilesystem: true",
  "allowPrivilegeEscalation: false",
  "secretKeyRef:",
  "forward-user",
  "forward-password",
  "handoff-read-token",
  "forward-connector.config.json",
  "/etc/forward-dynatrace-secrets",
];

for (const snippet of requiredCronJobSnippets) {
  if (!cronJob.includes(snippet)) {
    fail(`Kubernetes CronJob missing ${snippet}.`);
  }
}

for (const snippet of [
  "kind: CronJob",
  'schedule: "*/5 * * * *"',
  "concurrencyPolicy: Forbid",
  "forward-check-health",
  "--apply",
  "persistentVolumeClaim:",
  "claimName: forward-dynatrace-state",
  "dynatrace-platform-token",
  "runAsNonRoot: true",
  "readOnlyRootFilesystem: true",
  "allowPrivilegeEscalation: false",
]) {
  if (!checkHealthCronJob.includes(snippet)) {
    fail(`Kubernetes check-health CronJob missing ${snippet}.`);
  }
}

for (const snippet of [
  "Type=simple",
  "EnvironmentFile=/etc/forward-dynatrace/forward-handoff.env",
  "ExecStart=/usr/bin/node /opt/forward-dynatrace/scripts/forward-handoff-server.mjs",
  "Restart=on-failure",
  "NoNewPrivileges=true",
  "ProtectSystem=strict",
  "ReadWritePaths=/var/lib/forward-dynatrace /var/log/forward-dynatrace",
  "UMask=0077",
]) {
  if (!handoffService.includes(snippet)) {
    fail(`Handoff systemd service missing ${snippet}.`);
  }
}
if (!checkHealthCronJob.includes("<forward-dynatrace-importer-image@sha256:digest>")) {
  fail("Kubernetes check-health CronJob must require a digest-pinned importer image.");
}
for (const snippet of [
  "kind: ConfigMap",
  "forward-base-url:",
  "forward-network-id:",
  "dynatrace-environment-url:",
]) {
  if (!checkHealthConfigMap.includes(snippet)) {
    fail(`Kubernetes check-health ConfigMap missing ${snippet}.`);
  }
}
for (const snippet of [
  "FORWARD_HANDOFF_ROOT=/var/lib/forward-dynatrace/handoff",
  "FORWARD_HANDOFF_PUBLIC_BASE_URL=https://handoff.example.com",
  "FORWARD_HANDOFF_RETENTION_CLASS=nonproduction-30d",
  "FORWARD_HANDOFF_WRITE_TOKEN_FILE=/etc/forward-dynatrace/handoff-write-token",
  "FORWARD_HANDOFF_READ_TOKEN_FILE=/etc/forward-dynatrace/handoff-read-token",
  "FORWARD_HANDOFF_ALLOW_ENV_TOKENS=0",
  "FORWARD_HANDOFF_HOST=127.0.0.1",
  "FORWARD_HANDOFF_ACCESS_LOG=/var/log/forward-dynatrace/handoff-access.jsonl",
]) {
  if (!handoffEnvExample.includes(snippet)) {
    fail(`Handoff systemd env example missing ${snippet}.`);
  }
}
if (/^FORWARD_HANDOFF_(?:WRITE|READ)_TOKEN=/mu.test(handoffEnvExample)) {
  fail("Handoff systemd env example must use protected token files, not inline tokens.");
}
for (const snippet of [
  "kind: PersistentVolumeClaim",
  "name: forward-dynatrace-state",
  "ReadWriteOnce",
  "storage: 1Gi",
]) {
  if (!statePvc.includes(snippet)) {
    fail(`Kubernetes state PVC missing ${snippet}.`);
  }
}

if (!cronJob.includes(verifiedImporterImage)) {
  fail("Kubernetes CronJob must default to the verified digest-pinned GHCR importer image.");
}

for (const forbidden of [
  /FORWARD_PASSWORD:\s*["'][^"']+["']/,
  /FORWARD_PASSWORD=\S+/,
  /password:\s*(?!forward-password\b)\S+/i,
  /token:\s*\S+/i,
]) {
  if (forbidden.test(cronJob)) {
    fail("Kubernetes CronJob must not contain inline Forward credentials.");
  }
}

if (!kubernetesConfigMap.includes("kind: ConfigMap")) {
  fail("Kubernetes config example must be a ConfigMap.");
}
if (!kubernetesConfigMap.includes("forward-connector.config.json: |")) {
  fail("Kubernetes config example must contain forward-connector.config.json.");
}
if (!kubernetesConfigMap.includes("schemaVersion")) {
  fail("Kubernetes config example must include the connector schema version.");
}
if (!kubernetesConfigMap.includes("/var/lib/forward-dynatrace/forward-import-report.json")) {
  fail("Kubernetes config example must write reports to the mounted output directory.");
}
if (!/forward-password:\s*["']?<password-or-token>["']?/i.test(kubernetesSecret)) {
  fail("Kubernetes Secret example must not contain a concrete Forward password.");
}
for (const snippet of [
  "kind: Secret",
  "name: forward-dynatrace-credentials",
  'forward-user: "<user>"',
  'forward-password: "<password-or-token>"',
  'handoff-read-token: "<dedicated-handoff-read-token>"',
  'dynatrace-platform-token: "<platform-token>"',
]) {
  if (!kubernetesSecret.includes(snippet)) {
    fail(`Kubernetes Secret example missing ${snippet}.`);
  }
}

const requiredServiceSnippets = [
  "Type=oneshot",
  "EnvironmentFile=/etc/forward-dynatrace/forward-dynatrace.env",
  "ExecStart=/usr/bin/node /opt/forward-dynatrace/scripts/forward-import-package.mjs --config /etc/forward-dynatrace/forward-connector.config.json",
  "ExecStartPost=/usr/bin/node /opt/forward-dynatrace/scripts/publish-forward-status.mjs",
  "ExecStartPost=/usr/bin/node /opt/forward-dynatrace/scripts/publish-dynatrace-status-event.mjs",
  "--token-file /etc/forward-dynatrace/dynatrace-platform.token --apply",
  "ReadOnlyPaths=/etc/forward-dynatrace/handoff-read-token /etc/forward-dynatrace/dynatrace-platform.token",
  "NoNewPrivileges=true",
  "ProtectSystem=strict",
  "ReadWritePaths=/var/lib/forward-dynatrace /var/log/forward-dynatrace",
  "UMask=0077",
];

for (const snippet of requiredServiceSnippets) {
  if (!service.includes(snippet)) {
    fail(`systemd service missing ${snippet}.`);
  }
}

for (const snippet of [
  "Type=oneshot",
  "EnvironmentFile=/etc/forward-dynatrace/forward-check-health.env",
  "scripts/forward-check-health-transitions.mjs",
  "--state /var/lib/forward-dynatrace/check-health-state.json",
  "--apply",
  "--token-file /etc/forward-dynatrace/dynatrace-platform.token",
  "NoNewPrivileges=true",
  "ProtectSystem=strict",
  "UMask=0077",
]) {
  if (!checkHealthService.includes(snippet)) {
    fail(`Check-health systemd service missing ${snippet}.`);
  }
}
if (
  !checkHealthTimer.includes("OnUnitActiveSec=5min") ||
  !checkHealthTimer.includes("Persistent=true")
) {
  fail("Check-health systemd timer must be persistent and run every 5 minutes.");
}
for (const snippet of [
  "FORWARD_BASE_URL=https://forward.example.com",
  "FORWARD_NETWORK_ID=<network-id>",
  "FORWARD_USER=<user>",
  "FORWARD_PASSWORD=<password-or-token>",
  "DYNATRACE_ENVIRONMENT_URL=https://your-environment-id.apps.dynatrace.com/",
]) {
  if (!checkHealthEnv.includes(snippet)) {
    fail(`Check-health systemd env example missing ${snippet}.`);
  }
}
if (!timer.includes("OnUnitActiveSec=15min") || !timer.includes("Persistent=true")) {
  fail("systemd timer must be persistent and run on the expected cadence.");
}

if (!envExample.includes("FORWARD_USER=<user>")) {
  fail("systemd env example must contain a placeholder Forward user.");
}
if (!envExample.includes("FORWARD_PASSWORD=<password-or-token>")) {
  fail("systemd env example must contain a placeholder Forward password.");
}
if (!envExample.includes("DYNATRACE_ENVIRONMENT_URL=https://your-environment-id.apps.dynatrace.com/")) {
  fail("systemd env example must contain the Dynatrace environment placeholder.");
}
if (systemdConfig.schemaVersion !== "forward-dynatrace-connector/v1") {
  fail("systemd connector config example must use the connector schema version.");
}
if (systemdConfig.reportPath !== "/var/lib/forward-dynatrace/forward-import-report.json") {
  fail("systemd connector config example must write the report under /var/lib/forward-dynatrace.");
}
if (systemdConfig.packageTokenFile !== "/etc/forward-dynatrace/handoff-read-token") {
  fail("systemd connector config must use the protected handoff read-token file.");
}
if (systemdConfig.apply !== false || systemdConfig.failOnDrift !== true) {
  fail("systemd connector config example must default to dry-run and fail-on-drift.");
}

for (const snippet of [
  "*/15 * * * *",
  "set -a",
  ". /etc/forward-dynatrace/forward-dynatrace.env",
  "/opt/forward-dynatrace/scripts/forward-cron-import.mjs",
  "--config /etc/forward-dynatrace/forward-connector.config.json",
  "--state-dir /var/lib/forward-dynatrace",
  "--log-dir /var/log/forward-dynatrace",
]) {
  if (!cronSchedule.includes(snippet)) {
    fail(`cron schedule missing ${snippet}.`);
  }
}
if (cronSchedule.includes("--allow-apply")) {
  fail("cron schedule must not enable Forward apply by default.");
}
if (!cronEnv.includes("FORWARD_USER=<user>")) {
  fail("cron env example must contain a placeholder Forward user.");
}
if (!cronEnv.includes("FORWARD_PASSWORD=<password-or-token>")) {
  fail("cron env example must contain a placeholder Forward password.");
}
if (cronConfig.schemaVersion !== "forward-dynatrace-connector/v1") {
  fail("cron connector config example must use the connector schema version.");
}
if (
  cronConfig.apply !== false ||
  cronConfig.applyUpdates !== false ||
  cronConfig.deactivateStale !== false ||
  cronConfig.failOnDrift !== true
) {
  fail("cron connector config must default to dry-run, fail-on-drift, and no update/stale mutations.");
}
if (
  cronConfig.reportPath !== "/var/lib/forward-dynatrace/forward-import-report.json" ||
  cronConfig.statusArtifactPath !== "/var/lib/forward-dynatrace/forward-ingest-status.json"
) {
  fail("cron connector config must write report and status under the state directory.");
}
if (cronConfig.packageTokenFile !== "/etc/forward-dynatrace/handoff-read-token") {
  fail("cron connector config must use the protected handoff read-token file.");
}

for (const snippet of [
  "services:",
  "forward-dynatrace-importer:",
  "Dockerfile.forward-importer",
  "FORWARD_USER:",
  "FORWARD_PASSWORD:",
  "read_only: true",
  "cap_drop:",
  "no-new-privileges:true",
  "/config/forward-connector.config.json:ro",
  "handoff-read-token:",
  "FORWARD_HANDOFF_READ_TOKEN_FILE",
  "forward-dynatrace-state:",
]) {
  if (!dockerCompose.includes(snippet)) {
    fail(`Docker Compose example missing ${snippet}.`);
  }
}
if (!dockerCompose.includes(verifiedImporterImage)) {
  fail("Docker Compose must default to the verified digest-pinned GHCR importer image.");
}
if (!dockerComposeEnv.includes("FORWARD_USER=<user>")) {
  fail("Docker Compose env example must contain a placeholder Forward user.");
}
if (!dockerComposeEnv.includes("FORWARD_PASSWORD=<password-or-token>")) {
  fail("Docker Compose env example must contain a placeholder Forward password.");
}
if (!dockerComposeEnv.includes("FORWARD_HANDOFF_READ_TOKEN_FILE=/secure/path/handoff-read-token")) {
  fail("Docker Compose env example must point to the protected handoff read-token file.");
}
if (dockerComposeConfig.schemaVersion !== "forward-dynatrace-connector/v1") {
  fail("Docker Compose connector config example must use the connector schema version.");
}
if (
  dockerComposeConfig.reportPath !==
  "/var/lib/forward-dynatrace/forward-import-report.json"
) {
  fail("Docker Compose connector config example must write the report under /var/lib/forward-dynatrace.");
}
if (dockerComposeConfig.packageTokenFile !== "/run/secrets/handoff-read-token") {
  fail("Docker Compose connector config must consume the handoff read token as a secret file.");
}
if (
  dockerComposeConfig.apply !== false ||
  dockerComposeConfig.applyUpdates !== false ||
  dockerComposeConfig.deactivateStale !== false ||
  dockerComposeConfig.failOnDrift !== true
) {
  fail("Docker Compose connector config example must default to dry-run, fail-on-drift, and no update/stale mutations.");
}

for (const content of [
  cronJob,
  checkHealthCronJob,
  checkHealthConfigMap,
  statePvc,
  kubernetesConfigMap,
  kubernetesSecret,
  dockerCompose,
  dockerComposeEnv,
  JSON.stringify(dockerComposeConfig),
  service,
  timer,
  envExample,
  handoffService,
  handoffEnvExample,
  checkHealthService,
  checkHealthTimer,
  checkHealthEnv,
  JSON.stringify(systemdConfig),
  cronSchedule,
  cronEnv,
  JSON.stringify(cronConfig),
]) {
  if (/dt0[a-z0-9]{2,}\.[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{20,}/i.test(content)) {
    fail("Runtime manifests must not contain Dynatrace token-shaped secrets.");
  }
  if (/FORWARD_PASSWORD=(?!<password-or-token>)[^\s]+/.test(content)) {
    fail("Runtime manifests must not contain concrete Forward passwords.");
  }
}

if (failures.length > 0) {
  process.stderr.write("Runtime manifest validation failed:\n");
  for (const failure of failures) {
    process.stderr.write(`- ${failure}\n`);
  }
  process.exit(1);
}

process.stdout.write("Runtime manifest validation passed.\n");
