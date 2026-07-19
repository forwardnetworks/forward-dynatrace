# Administrative Operations

Tenant administrators own four durable objects: the installed app version, external-request allowlist, Forward API
connection settings, and Workflow definitions.

- Review connection access quarterly and after incidents.
- Rotate the Forward service password in the secret settings object; do not edit Workflow JSON.
- Use separate Read Only and Network Admin connections.
- Review app and Workflow audit history for connection changes and applies.
- Upgrade only from a verified immutable release.
- Uninstalling the app does not remove Forward intent checks; review managed checks separately.
- Disaster recovery consists of reinstalling the same verified app version, recreating allowlist and settings through
  the tenant's approved secret process, and running plan-only reconciliation before apply.
