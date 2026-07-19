# Check-Health Feedback

The app backend can read managed Forward check results and publish bounded transition evidence into Dynatrace. No
separate poller is installed.

Persist only the minimum state needed to detect `previous -> current` transitions. A transition event should contain a
correlation ID, network and snapshot IDs, aggregate counts, current state, previous state, and timestamp. It must not
contain credentials, check names, endpoints, or path topology.

Read Only is sufficient. Transition publication must be idempotent, bounded, and resilient to missing snapshots. A
missing or ambiguous check is `unknown`, not automatically failed.
