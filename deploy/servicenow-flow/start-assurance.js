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
  var serviceEntityIds;
  try {
    serviceEntityIds = JSON.parse(required(inputs.service_entity_ids_json, "service_entity_ids_json"));
  } catch (error) {
    throw new Error("service_entity_ids_json must be valid JSON.");
  }
  if (!Array.isArray(serviceEntityIds) || serviceEntityIds.length === 0) {
    throw new Error("service_entity_ids_json must contain at least one service entity ID.");
  }

  var body = {
    changeNumber: required(inputs.change_number, "change_number"),
    deploymentId: required(inputs.deployment_id, "deployment_id"),
    forwardNetworkId: required(inputs.forward_network_id, "forward_network_id"),
    serviceEntityIds: serviceEntityIds
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

