# Incident Response

1. Stop Network Admin applies; leave Read Only evidence available when safe.
2. Record Workflow execution, plan digest, network, snapshot, profile, counts, and sanitized error class.
3. Rotate the Forward secret connection if credential exposure is suspected.
4. Review Dynatrace app/Workflow audit history and Forward check audit history.
5. For partial mutation, read current Forward state and stage a new plan; never retry the old digest blindly.
6. Resolve collisions or mapping ambiguity without adopting unmanaged checks by name.
7. Confirm stale checks were not deleted.
8. Restore baseline, collect a current snapshot, require post-apply verification and Guardian PASS, then document
   cause, impact, corrective action, and retained evidence.

Do not copy credentials, Authorization headers, raw authenticated bodies, or detailed topology into tickets or public
channels.
