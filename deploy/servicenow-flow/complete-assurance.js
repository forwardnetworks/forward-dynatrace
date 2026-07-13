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
  var runId = required(inputs.run_id, "run_id");
  if (!/^fdca-[a-f0-9]{24}$/.test(runId)) {
    throw new Error("run_id is invalid.");
  }
  var context;
  try {
    context = JSON.parse(required(inputs.context_json, "context_json"));
  } catch (error) {
    throw new Error("context_json must be valid JSON.");
  }

  var request = new sn_ws.RESTMessageV2();
  request.setEndpoint(baseUrl + "/v1/servicenow/change-assurance/runs/" + runId + "/complete");
  request.setHttpMethod("post");
  request.setAuthenticationProfile("basic", profileId);
  request.setRequestHeader("Accept", "application/json");
  request.setRequestHeader("Content-Type", "application/json");
  request.setRequestBody(JSON.stringify({ context: context }));
  var response = request.execute();
  var statusCode = response.getStatusCode();
  if (statusCode !== 200 && statusCode !== 202) {
    throw new Error("Change-assurance worker completion failed with HTTP " + statusCode + ".");
  }
  var result = JSON.parse(response.getBody());
  outputs.run_id = required(result.runId, "worker runId");
  outputs.status = required(result.status, "worker status");
  outputs.phase = required(result.phase, "worker phase");
  outputs.decision = result.decision || "";
  outputs.exit_code = result.exitCode === null || result.exitCode === undefined ? "" : String(result.exitCode);
})(inputs, outputs);

