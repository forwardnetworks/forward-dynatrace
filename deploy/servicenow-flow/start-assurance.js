(function execute(inputs, outputs) {
  function required(value, label) {
    var normalized = String(value || "").trim();
    if (!normalized) throw new Error(label + " is required.");
    return normalized;
  }

  var baseUrl = required(inputs.worker_base_url, "worker_base_url");
  if (!/^https:\/\/[^/]+(?:\/[^?#]*)?$/.test(baseUrl)) {
    throw new Error("worker_base_url must be HTTPS.");
  }
  baseUrl = baseUrl.replace(/\/$/, "");
  var profileId = required(inputs.basic_auth_profile_sys_id, "basic_auth_profile_sys_id");
  if (!/^[a-f0-9]{32}$/i.test(profileId)) {
    throw new Error("basic_auth_profile_sys_id must be a ServiceNow sys_id.");
  }
  var affectedRecords;
  try {
    affectedRecords = JSON.parse(required(inputs.affected_records_json, "affected_records_json"));
  } catch (error) {
    throw new Error("affected_records_json must be valid JSON.");
  }
  if (!Array.isArray(affectedRecords) || affectedRecords.length === 0 || affectedRecords.length > 100) {
    throw new Error("affected_records_json must contain between 1 and 100 records.");
  }
  var normalizedRecords = [];
  var seenRecords = {};
  for (var index = 0; index < affectedRecords.length; index += 1) {
    var record = affectedRecords[index];
    if (!record || typeof record !== "object" || Array.isArray(record)) {
      throw new Error("affected_records_json entries must be objects.");
    }
    var table = required(record.table, "affected record table");
    var sysId = required(record.sysId, "affected record sysId").toLowerCase();
    if (!/^[a-z][a-z0-9_]{0,79}$/.test(table)) throw new Error("affected record table is invalid.");
    if (!/^[0-9a-f]{32}$/.test(sysId)) throw new Error("affected record sysId is invalid.");
    var key = table + ":" + sysId;
    if (seenRecords[key]) throw new Error("affected_records_json must contain unique records.");
    seenRecords[key] = true;
    normalizedRecords.push({ table: table, sysId: sysId });
  }
  var body = {
    changeNumber: required(inputs.change_number, "change_number"),
    deploymentId: required(inputs.deployment_id, "deployment_id"),
    affectedRecords: normalizedRecords
  };
  if (inputs.instance_alias) body.instanceAlias = String(inputs.instance_alias).trim();
  if (String(inputs.retry || "false") === "true") body.retry = true;

  var request = new sn_ws.RESTMessageV2();
  request.setEndpoint(baseUrl + "/v1/servicenow/change-assurance/start");
  request.setHttpMethod("post");
  request.setAuthenticationProfile("basic", profileId);
  request.setRequestHeader("Accept", "application/json");
  request.setRequestHeader("Content-Type", "application/json");
  request.setRequestBody(JSON.stringify(body));
  var response = request.execute();
  var statusCode = response.getStatusCode();
  if (statusCode !== 200 && statusCode !== 202) {
    throw new Error("Change-assurance worker start failed with HTTP " + statusCode + ".");
  }
  var result = JSON.parse(response.getBody());
  outputs.run_id = required(result.runId, "worker runId");
  outputs.status = required(result.status, "worker status");
  outputs.phase = required(result.phase, "worker phase");
  outputs.before_snapshot_id = result.forward && result.forward.beforeSnapshotId || "";
})(inputs, outputs);
