# Administrative Operations

Tenant administrators own five durable objects: the installed app version, external-request allowlist, Credential
Vault entry, Forward API connection settings, and Workflow definitions.

- Review connection access quarterly and after incidents.
- Rotate the Forward service password in its Credential Vault entry; the connection entity ID and Workflow JSON do not change.
- Use separate Read Only and Network Admin connections.
- Review app and Workflow audit history for connection changes and applies.
- Upgrade only from a verified immutable release.
- Uninstalling the app does not remove Forward intent checks; review managed checks separately.
- Disaster recovery consists of reinstalling the same verified app version, recreating the allowlist, Vault entry, and
  settings through the tenant's approved secret process, and running plan-only reconciliation before apply.
