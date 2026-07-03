#!/usr/bin/env node

import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const failures = [];

const readText = (relativePath) => readFile(path.join(root, relativePath), "utf8");
const fail = (message) => failures.push(message);

const packageJson = JSON.parse(await readText("package.json"));
const cronJob = await readText("deploy/kubernetes/forward-dynatrace-connector-cronjob.yaml");
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
const systemdConfig = JSON.parse(
  await readText("deploy/systemd/forward-connector.config.example.json"),
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
  "forward-connector.config.json",
];

for (const snippet of requiredCronJobSnippets) {
  if (!cronJob.includes(snippet)) {
    fail(`Kubernetes CronJob missing ${snippet}.`);
  }
}

if (!cronJob.includes(`:${packageJson.version}`)) {
  fail(`Kubernetes CronJob image tag must match package version ${packageJson.version}.`);
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
]) {
  if (!kubernetesSecret.includes(snippet)) {
    fail(`Kubernetes Secret example missing ${snippet}.`);
  }
}

const requiredServiceSnippets = [
  "Type=oneshot",
  "EnvironmentFile=/etc/forward-dynatrace/forward-dynatrace.env",
  "ExecStart=/usr/bin/node /opt/forward-dynatrace/scripts/forward-import-package.mjs --config /etc/forward-dynatrace/forward-connector.config.json",
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

if (!timer.includes("OnUnitActiveSec=15min") || !timer.includes("Persistent=true")) {
  fail("systemd timer must be persistent and run on the expected cadence.");
}

if (!envExample.includes("FORWARD_USER=<user>")) {
  fail("systemd env example must contain a placeholder Forward user.");
}
if (!envExample.includes("FORWARD_PASSWORD=<password-or-token>")) {
  fail("systemd env example must contain a placeholder Forward password.");
}
if (systemdConfig.schemaVersion !== "forward-dynatrace-connector/v1") {
  fail("systemd connector config example must use the connector schema version.");
}
if (systemdConfig.reportPath !== "/var/lib/forward-dynatrace/forward-import-report.json") {
  fail("systemd connector config example must write the report under /var/lib/forward-dynatrace.");
}
if (systemdConfig.apply !== false || systemdConfig.failOnDrift !== true) {
  fail("systemd connector config example must default to dry-run and fail-on-drift.");
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
  "forward-dynatrace-state:",
]) {
  if (!dockerCompose.includes(snippet)) {
    fail(`Docker Compose example missing ${snippet}.`);
  }
}
if (!dockerCompose.includes(`:${packageJson.version}`)) {
  fail(`Docker Compose importer image tag must match package version ${packageJson.version}.`);
}
if (!dockerComposeEnv.includes("FORWARD_USER=<user>")) {
  fail("Docker Compose env example must contain a placeholder Forward user.");
}
if (!dockerComposeEnv.includes("FORWARD_PASSWORD=<password-or-token>")) {
  fail("Docker Compose env example must contain a placeholder Forward password.");
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
  kubernetesConfigMap,
  kubernetesSecret,
  dockerCompose,
  dockerComposeEnv,
  JSON.stringify(dockerComposeConfig),
  service,
  timer,
  envExample,
  JSON.stringify(systemdConfig),
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
