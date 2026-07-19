# Observability

Monitor the app and Workflow, not a separate runtime.

Key signals:

- action execution count, duration, timeout, retry, and failure status;
- dependency rows, mapping readiness, and rejected rows;
- plan create, unchanged, changed, stale, and collision counts;
- apply created and updated counts plus post-apply verification;
- Forward snapshot age and ID;
- Guardian execution result and reason codes;
- connection authentication and external-request denials.

Never log the Forward username, password, Authorization header, raw failure response, host inventory, check names, or
full path topology. Use correlation IDs, snapshot IDs, plan digests, aggregate counts, and bounded reason codes.
