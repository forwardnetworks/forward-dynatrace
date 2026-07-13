import assert from "node:assert/strict";
import { test } from "node:test";

import {
  buildServiceNowChangePreflight,
  fetchServiceNowChange,
  parseArgs,
} from "./servicenow-change-preflight.mjs";

const field = (value, display) => ({ value, display_value: display });
const record = (overrides = {}) => ({
  sys_id: field("0123456789abcdef0123456789abcdef", "0123456789abcdef0123456789abcdef"),
  number: field("CHG0042187", "CHG0042187"),
  approval: field("approved", "Approved"),
  state: field("-2", "Scheduled"),
  risk: field("3", "Moderate"),
  start_date: field("2026-07-15 18:00:00", "2026-07-15 18:00:00"),
  end_date: field("2026-07-15 20:00:00", "2026-07-15 20:00:00"),
  assignment_group: field("89abcdef0123456789abcdef01234567", "Commerce Platform"),
  ...overrides,
});

const context = {
  observedAt: "2026-07-15T18:30:00.000Z",
  instanceAlias: "production-itsm",
  deploymentId: "checkout-api-2026.07.15.3",
  networkId: "network-production",
  serviceEntityIds: ["SERVICE-PAYMENTS-API", "SERVICE-CHECKOUT-API"],
};

test("parses repeated ServiceNow preflight options", () => {
  const args = parseArgs([
    "--change-number", "CHG0042187",
    "--service-entity-id", "SERVICE-A",
    "--service-entity-id", "SERVICE-B",
    "--eligible-state", "-2",
    "--eligible-state", "-1",
    "--fail-on-blocked",
  ]);
  assert.deepEqual(args["service-entity-id"], ["SERVICE-A", "SERVICE-B"]);
  assert.deepEqual(args["eligible-state"], ["-2", "-1"]);
  assert.equal(args["fail-on-blocked"], true);
});

test("reads exactly one authoritative ServiceNow change record", async () => {
  let requestUrl;
  let authorization;
  const result = await fetchServiceNowChange({
    baseUrl: "https://servicenow.example.com/",
    user: "reader",
    password: "runtime-only",
    changeNumber: "CHG0042187",
    fetchImpl: async (url, options) => {
      requestUrl = new URL(url);
      authorization = options.headers.Authorization;
      return new Response(JSON.stringify({ result: [record()] }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      });
    },
  });
  assert.equal(requestUrl.pathname, "/api/now/table/change_request");
  assert.equal(requestUrl.searchParams.get("sysparm_query"), "number=CHG0042187");
  assert.equal(requestUrl.searchParams.get("sysparm_limit"), "2");
  assert.match(authorization, /^Basic /);
  assert.equal(result.number.value, "CHG0042187");
});

test("builds an eligible read-only ServiceNow preflight inside the approved window", () => {
  const artifact = buildServiceNowChangePreflight({ record: record(), ...context });
  assert.equal(artifact.authorization.status, "eligible");
  assert.deepEqual(artifact.authorization.reasons, []);
  assert.equal(artifact.mode, "read-only");
  assert.equal(artifact.source.authoritativeRead, true);
  assert.deepEqual(artifact.scope.serviceEntityIds, [
    "SERVICE-CHECKOUT-API",
    "SERVICE-PAYMENTS-API",
  ]);
  assert.equal(artifact.change.window.startsAt, "2026-07-15T18:00:00.000Z");
  assert.equal(JSON.stringify(artifact).includes("runtime-only"), false);
});

test("fails closed for unapproved or non-executable ServiceNow state", () => {
  const artifact = buildServiceNowChangePreflight({
    record: record({
      approval: field("requested", "Requested"),
      state: field("-3", "Authorize"),
    }),
    ...context,
  });
  assert.equal(artifact.authorization.status, "blocked");
  assert.deepEqual(
    artifact.authorization.reasons.map((reason) => reason.code),
    ["SERVICENOW_NOT_APPROVED", "SERVICENOW_STATE_NOT_EXECUTABLE"],
  );
});

test("fails closed outside the authoritative ServiceNow change window", () => {
  const artifact = buildServiceNowChangePreflight({
    record: record(),
    ...context,
    observedAt: "2026-07-15T21:00:00.000Z",
  });
  assert.equal(artifact.authorization.status, "blocked");
  assert.equal(artifact.authorization.reasons[0].code, "OUTSIDE_CHANGE_WINDOW");
});

test("fails closed when ServiceNow planned dates are missing", () => {
  const artifact = buildServiceNowChangePreflight({
    record: record({ start_date: field("", ""), end_date: field("", "") }),
    ...context,
  });
  assert.equal(artifact.authorization.status, "blocked");
  assert.equal(artifact.authorization.reasons[0].code, "SERVICENOW_WINDOW_MISSING");
});

test("rejects ambiguous ServiceNow change lookup", async () => {
  await assert.rejects(
    fetchServiceNowChange({
      baseUrl: "https://servicenow.example.com",
      user: "reader",
      password: "runtime-only",
      changeNumber: "CHG0042187",
      fetchImpl: async () => new Response(JSON.stringify({ result: [record(), record()] }), {
        status: 200,
      }),
    }),
    /returned 2 records/,
  );
});

test("refuses to send Basic credentials to a non-TLS ServiceNow origin", async () => {
  await assert.rejects(
    fetchServiceNowChange({
      baseUrl: "http://servicenow.example.com",
      user: "reader",
      password: "runtime-only",
      changeNumber: "CHG0042187",
      fetchImpl: async () => { throw new Error("must not fetch"); },
    }),
    /must use HTTPS/,
  );
});
