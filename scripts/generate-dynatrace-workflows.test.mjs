import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { test } from "node:test";

import {
  buildWorkflowTemplates,
  generateWorkflowTemplates,
  validateWorkflowQuery,
} from "./generate-dynatrace-workflows.mjs";

const sha256 = (value) => createHash("sha256").update(value).digest("hex");
const projection = (prefix = "fetch events") => `${prefix}
| fields
    id = dependency.id,
    appName = app.name,
    environment = app.environment,
    serviceEntityId = dt.entity.service,
    serviceName = service.name,
    source = network.source,
    destination = network.destination,
    protocol = network.protocol,
    port = network.port,
    owner = owner.team,
    criticality = criticality,
    confidence = dependency.confidence,
    mappingState = dependency.mapping_state
| limit 100
`;

test("builds environment-agnostic on-demand, schedule, and problem templates", () => {
  const templates = buildWorkflowTemplates({
    appConfig: { app: { id: "com.forward.dynatrace", version: "1.2.0" } },
    sourceInstanceId: "dt-test-environment",
    scheduleQuery: projection(),
    problemQuery: projection('data json:"""{{ event()|to_json }}"""'),
  });
  assert.deepEqual(Object.keys(templates), [
    "forward-sync-on-demand.template.json",
    "forward-sync-schedule.template.json",
    "forward-sync-problem.template.json",
  ]);
  const schedule = templates["forward-sync-schedule.template.json"];
  assert.equal(schedule.metadata.version, "1.0.0");
  assert.deepEqual(schedule.metadata.inputs, [{
    type: "connection",
    schema: "app:com.forward.dynatrace:forward-api-connection",
    targets: ["tasks.sync_forward_intent_checks.connectionId"],
  }]);
  assert.equal(
    schedule.workflow.tasks.sync_forward_intent_checks.action,
    "com.forward.dynatrace:sync-forward-intent-checks",
  );
  assert.match(schedule.workflow.tasks.sync_forward_intent_checks.input.request, /result\("query_dependencies"\)/u);
  assert.match(
    schedule.workflow.tasks.sync_forward_intent_checks.input.request,
    /"sourceInstanceId": "dt-test-environment"/u,
  );
  assert.match(schedule.workflow.tasks.sync_forward_intent_checks.input.request, /"syncMode": "direct-api"/u);
  assert.match(schedule.workflow.tasks.sync_forward_intent_checks.input.request, /"operation": "plan"/u);
  assert.match(schedule.workflow.tasks.sync_forward_intent_checks.input.request, /"runPathPreflight": true/u);
  assert.equal(schedule.workflow.trigger.schedule.trigger.intervalMinutes, 15);
  assert.equal(
    templates["forward-sync-on-demand.template.json"].workflow.trigger,
    undefined,
  );
  assert.equal(
    templates["forward-sync-problem.template.json"].workflow.trigger
      .eventTrigger.triggerConfiguration.type,
    "davis-problem",
  );
});

test("fails closed when a query omits normalized fields or problem identity", () => {
  assert.throws(() => validateWorkflowQuery("fetch events | fields id = dependency.id"), /appName/);
  assert.throws(
    () => validateWorkflowQuery(projection(), { problem: true }),
    /must bind the triggering problem through event\(\)/,
  );
  assert.throws(
    () => validateWorkflowQuery(
      `fetch events\n${projection().split("\n").slice(1).map((line) => `// ${line}`).join("\n")}`,
    ),
    /id/,
  );
  assert.throws(
    () => validateWorkflowQuery(`${projection()}\n// {{ event() }}`, { problem: true }),
    /must bind the triggering problem through event\(\)/,
  );
});

test("writes deterministic templates and checksum manifest without connection IDs", async () => {
  const directory = await mkdtemp(path.join(tmpdir(), "forward-workflow-generator-"));
  const scheduleQueryPath = path.join(directory, "schedule.dql");
  const problemQueryPath = path.join(directory, "problem.dql");
  const outputDir = path.join(directory, "output");
  await writeFile(scheduleQueryPath, projection());
  await writeFile(problemQueryPath, projection('data json:"""{{ event()|to_json }}"""'));
  const manifest = await generateWorkflowTemplates({
    scheduleQueryPath,
    problemQueryPath,
    sourceInstanceId: "dt-test-environment",
    outputDir,
  });
  assert.equal(manifest.schemaVersion, "forward-dynatrace-workflow-template-set/v1");
  assert.equal(manifest.artifacts.length, 3);
  for (const artifact of manifest.artifacts) {
    const text = await readFile(path.join(outputDir, artifact.name), "utf8");
    assert.equal(sha256(text), artifact.sha256);
    assert.equal(text.includes("connection-1"), false);
    assert.equal(JSON.parse(text).workflow.tasks.sync_forward_intent_checks.input.connectionId, "");
  }
  assert.deepEqual(
    JSON.parse(await readFile(path.join(outputDir, "forward-workflow-templates.manifest.json"), "utf8")),
    manifest,
  );
});
