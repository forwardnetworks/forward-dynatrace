# Forward Path Evidence

After endpoint resolution, the app backend can submit the same source, destination, protocol, and port to Forward
`/paths-bulk`. This is a read-only preflight and does not create traffic; Forward evaluates what the modeled network can
forward at the selected snapshot.

The app keeps observed Dynatrace traffic and modeled Forward reachability as separate evidence:

- an observed relationship proves the application emitted traffic;
- a reachable Forward result proves the model can forward the requested headers;
- a blocked result is a modeled network fact, not automatic root cause;
- an ambiguous or unmapped result blocks intent synchronization until resolved.

Detailed hop topology remains in Forward. Dynatrace receives only the bounded path result needed for the application
workflow and correlation.
