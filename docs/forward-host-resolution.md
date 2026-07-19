# Forward Host Resolution

The app backend resolves Dynatrace endpoint evidence against the processed Forward snapshot selected for the plan.

For each endpoint it calls the Forward host API using the tenant-managed connection and classifies the result as:

- `resolved`: one eligible Forward host or subnet value;
- `review`: more than one eligible match and operator selection is required;
- `needs-map`: no eligible match.

Only resolved rows are eligible by default. Review rows require an explicit override and may still be rejected by
Forward. Target metadata supplied by the browser is non-authoritative; URL and network come from the selected
connection.

Resolution is read-only for every access profile. The action returns bounded counts and mapping state, not credentials
or a complete Forward inventory.
