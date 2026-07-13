#!/usr/bin/env node

import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const base = "deploy/servicenow-flow";
const read = (name) => readFile(path.join(root, base, name), "utf8");
const failures = [];
const fail = (message) => failures.push(message);

const blueprint = JSON.parse(await read("forward-change-assurance.flow.example.json"));
if (blueprint.schemaVersion !== "forward-dynatrace-servicenow-flow-blueprint/v1") {
  fail("ServiceNow flow blueprint schemaVersion is invalid.");
}
const expectedScripts = ["start-assurance.js", "get-assurance-status.js", "complete-assurance.js"];
const referencedScripts = new Set(
  blueprint.steps.flatMap((step) => [step.scriptFile, step.pollWith].filter(Boolean)),
);
for (const script of expectedScripts) {
  if (!referencedScripts.has(script)) fail(`ServiceNow flow blueprint does not reference ${script}.`);
  const content = await read(script);
  for (const required of [
    "sn_ws.RESTMessageV2",
    'setAuthenticationProfile("basic", profileId)',
    "worker_base_url must be HTTPS",
    "response.getStatusCode()",
  ]) {
    if (!content.includes(required)) fail(`${script} missing ${required}.`);
  }
  for (const forbidden of ["Authorization", "password", "dt0c01.", "http://"]) {
    if (content.includes(forbidden)) fail(`${script} contains forbidden ${forbidden}.`);
  }
}
const start = await read("start-assurance.js");
if (!start.includes("/v1/servicenow/change-assurance/start")) fail("Start script route is invalid.");
const status = await read("get-assurance-status.js");
if (!status.includes('"/v1/servicenow/change-assurance/runs/" + runId')) {
  fail("Status script route is invalid.");
}
const complete = await read("complete-assurance.js");
if (!complete.includes('runId + "/complete"')) fail("Complete script route is invalid.");

if (failures.length > 0) {
  process.stderr.write("ServiceNow Flow asset validation failed:\n");
  failures.forEach((failure) => process.stderr.write(`- ${failure}\n`));
  process.exit(1);
}
process.stdout.write("ServiceNow Flow assets validated.\n");
