# ServiceNow Flow Designer Blueprint

These instance-neutral assets build the customer-owned Flow Designer orchestration around the authenticated
change-assurance worker. ServiceNow owns the trigger and deployment transition; this integration owns only evidence
collection and the deterministic gate.

## Build

1. Create a Basic Auth Profile for the dedicated worker credential.
2. Allow the exact worker HTTPS origin. Never use a static `Authorization` header in a script.
3. Create three core Script steps from:
   - `start-assurance.js`
   - `get-assurance-status.js`
   - `complete-assurance.js`
4. Use `forward-change-assurance.flow.example.json` as the step/condition contract.
5. After start, poll status with a bounded wait until `baseline-captured` or `failed`.
6. Run the existing customer deployment step.
7. Build `forward-change-context/v1` from the trusted deployment/Dynatrace evidence path.
8. Submit completion, then poll until `completed` or `failed`.
9. Continue only when `decision == pass` and `exit_code == 0`. `warn`, `fail`, timeout, or worker error block.

## Required Inputs

- `worker_base_url`: exact customer TLS ingress origin.
- `basic_auth_profile_sys_id`: ServiceNow credential profile sys_id.
- `change_number`, `deployment_id`, `forward_network_id`.
- `service_entity_ids_json`: non-empty JSON string array.
- `context_json`: fresh `forward-dynatrace-change-context/v1` JSON for completion.

Scripts return only bounded run state, decision, exit code, and snapshot IDs. They do not return credentials,
dependencies, local paths, or Forward topology.
