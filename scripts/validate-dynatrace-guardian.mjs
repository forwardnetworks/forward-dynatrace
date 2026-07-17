#!/usr/bin/env node

import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const guardianDirectory = path.join(root, "deploy/dynatrace-guardian");
const values = {
  applicationId: "APPLICATION-VALIDATION",
  environmentId: "ENVIRONMENT-VALIDATION",
  owner: "TEAM-VALIDATION",
  criticality: "high",
  serviceEntityId: "SERVICE-VALIDATION",
  scopeMappingId: "SCOPE-MAPPING-VALIDATION",
  guardianid: "GUARDIAN-VALIDATION",
  name: "Forward change validation",
};

const renderMonacoJson = (text) => text.replace(
  /\{\{\s*\.(\w+)\s*\}\}/gu,
  (_match, key) => {
    if (!(key in values)) throw new Error(`Unknown Monaco parameter: ${key}`);
    return values[key];
  },
);

const readRenderedJson = async (name) => JSON.parse(
  renderMonacoJson(await readFile(path.join(guardianDirectory, name), "utf8")),
);

const configs = await readFile(path.join(guardianDirectory, "project/configs.yaml"), "utf8");
for (const expected of [
  "schema: app:dynatrace.site.reliability.guardian:guardians",
  "resource: workflow",
  "template: ../guardian.json",
  "template: ../workflow.json",
  "name: FORWARD_GUARDIAN_APPLICATION_ID",
  "name: FORWARD_GUARDIAN_ENVIRONMENT_ID",
  "name: FORWARD_GUARDIAN_OWNER",
  "name: FORWARD_GUARDIAN_SERVICE_ENTITY_ID",
  "name: FORWARD_GUARDIAN_SCOPE_MAPPING_ID",
]) assert.match(configs, new RegExp(expected.replace(/[.*+?^${}()|[\]\\]/gu, "\\$&"), "u"));

const manifest = await readFile(path.join(guardianDirectory, "manifest.example.yaml"), "utf8");
for (const expected of [
  "manifestVersion: 1.0",
  "name: forward-change-guardian",
  "type: environment",
  "value: DYNATRACE_ENVIRONMENT_URL",
  "platformToken:",
  "name: DYNATRACE_PLATFORM_TOKEN",
]) assert.match(manifest, new RegExp(expected.replace(/[.*+?^${}()|[\]\\]/gu, "\\$&"), "u"));

const guardian = await readRenderedJson("guardian.json");
assert.equal(guardian.eventKind, "SDLC_EVENT");
assert.deepEqual(
  guardian.variables.map((variable) => variable.name).sort(),
  ["ScopeMappingId", "ServiceEntityId"],
);
assert.ok(guardian.tags.includes("integration:forward"));
assert.ok(guardian.objectives.length >= 6);

const objectives = new Map(guardian.objectives.map((objective) => [objective.name, objective]));
const forwardEvidence = objectives.get("Forward validation evidence");
assert.equal(forwardEvidence.comparisonOperator, "GREATER_THAN_OR_EQUAL");
assert.equal(forwardEvidence.target, 1);
assert.match(forwardEvidence.dqlQuery, /event\.kind == "SDLC_EVENT"/u);
assert.match(forwardEvidence.dqlQuery, /forward\.dynatrace\.scope_mapping_id == \$ScopeMappingId/u);
assert.match(forwardEvidence.dqlQuery, /sort timestamp desc/u);
assert.match(forwardEvidence.dqlQuery, /limit 1/u);
assert.match(forwardEvidence.dqlQuery, /forward\.dynatrace\.gate_decision == "pass"/u);

const telemetryPresent = objectives.get("Service telemetry present");
assert.equal(telemetryPresent.target, 1);
assert.match(
  telemetryPresent.dqlQuery,
  /serviceEntityId = toString\(dt\.smartscape\.service\)/u,
);
assert.match(telemetryPresent.dqlQuery, /serviceEntityId == \$ServiceEntityId/u);
assert.match(telemetryPresent.dqlQuery, /span\.kind == "server"/u);
assert.match(telemetryPresent.dqlQuery, /forward\.observation\.method == "instrumented-transaction"/u);

for (const name of ["Request availability", "Request performance"]) {
  const objective = objectives.get(name);
  assert.equal(objective.comparisonOperator, "GREATER_THAN_OR_EQUAL");
  assert.equal(typeof objective.target, "number");
  assert.equal(typeof objective.warning, "number");
  assert.match(
    objective.dqlQuery,
    /serviceEntityId = toString\(dt\.smartscape\.service\)/u,
  );
  assert.match(objective.dqlQuery, /serviceEntityId == \$ServiceEntityId/u);
  assert.match(objective.dqlQuery, /span\.kind == "server"/u);
  assert.match(objective.dqlQuery, /forward\.observation\.method == "instrumented-transaction"/u);
}
assert.match(
  objectives.get("Request availability").dqlQuery,
  /countIf\(isNull\(span\.status_code\) or span\.status_code != "error"\)/u,
);
for (const name of ["Request volume", "Error log count"]) {
  const objective = objectives.get(name);
  assert.equal(objective.target, undefined);
  assert.equal(objective.warning, undefined);
}
assert.match(
  objectives.get("Request volume").dqlQuery,
  /serviceEntityId = toString\(dt\.smartscape\.service\)/u,
);
assert.match(
  objectives.get("Request volume").dqlQuery,
  /serviceEntityId == \$ServiceEntityId/u,
);
for (const objective of guardian.objectives) {
  assert.equal(objective.objectiveType, "DQL");
  assert.deepEqual(objective.segments, []);
  assert.deepEqual(objective.links, []);
}

const workflow = await readRenderedJson("workflow.json");
const eventTrigger = workflow.trigger.eventTrigger;
assert.equal(workflow.triggerType, "Event");
assert.equal(eventTrigger.triggerConfiguration.type, "event");
assert.equal(eventTrigger.triggerConfiguration.value.eventType, "events");
for (const term of [
  'event.kind == "SDLC_EVENT"',
  'event.type == "forward.dynatrace.change.validation"',
  `forward.dynatrace.scope_mapping_id == "${values.scopeMappingId}"`,
]) {
  assert.match(eventTrigger.filterQuery, new RegExp(term.replace(/[.*+?^${}()|[\]\\]/gu, "\\$&"), "u"));
  assert.match(
    eventTrigger.triggerConfiguration.value.query,
    new RegExp(term.replace(/[.*+?^${}()|[\]\\]/gu, "\\$&"), "u"),
  );
}
const validationTask = workflow.tasks.run_validation;
assert.equal(
  validationTask.action,
  "dynatrace.site.reliability.guardian:validate-guardian-action",
);
assert.equal(validationTask.input.objectId, values.guardianid);
assert.equal(validationTask.input.timeframeInputType, "timeframeSelector");
assert.deepEqual(validationTask.input.timeframeSelector, { from: "now-30m", to: "now" });
assert.equal(validationTask.waitBefore, 30);

const readback = await readFile(
  path.join(root, "deploy/dynatrace-dql/forward-guardian-validation-latest.dql"),
  "utf8",
);
for (const term of [
  'event.kind == "SDLC_EVENT"',
  'event.provider == "dynatrace.site.reliability.guardian"',
  'event.type == "validation"',
  'event.status == "finished"',
  "validation.result",
  "execution_context",
]) assert.ok(readback.includes(term), `Guardian readback DQL must include ${term}`);

const automationReadback = await readFile(
  path.join(root, "scripts/query-dynatrace-guardian-execution.mjs"),
  "utf8",
);
for (const term of [
  "/platform/automation/v1/workflows",
  "/platform/automation/v1/executions",
  "execution_context",
  "validation_status",
  "correlationId",
]) assert.ok(automationReadback.includes(term), `Guardian Automation readback must include ${term}`);

const publicPackage = `${manifest}\n${configs}\n${JSON.stringify(guardian)}\n${JSON.stringify(workflow)}\n${readback}\n${automationReadback}`;
assert.doesNotMatch(
  publicPackage,
  /(?:dt0[a-z0-9]{2,}\.[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{20,}|Authorization\s*[:=]|https:\/\/fwd\.app)/iu,
);
assert.doesNotMatch(publicPackage, /(?:createNetworkCheck|\/api\/networks\/[^\s]+\/checks)/iu);
assert.doesNotMatch(publicPackage, /(?:APPLICATION-PLACEHOLDER|SERVICE-PLACEHOLDER|SCOPE-MAPPING-PLACEHOLDER)/u);

process.stdout.write(`${JSON.stringify({
  status: "ok",
  guardianType: guardian.eventKind,
  objectives: guardian.objectives.length,
  workflowAction: validationTask.action,
  eventStream: eventTrigger.triggerConfiguration.value.eventType,
}, null, 2)}\n`);
