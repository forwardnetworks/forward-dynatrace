# Security Exposure Correlation

This optional read-only workflow joins explicit evidence references from Dynatrace, Forward, and a customer-approved
identity mapping. It produces a ranked investigation queue. Raw vendor findings remain in their source systems.

Inputs are JSON arrays:

- Dynatrace findings: `findingId`, `observedAt`, `severity`, and `activeExecution`.
- Forward exposures: `exposureId`, `snapshotId`, `observedAt`, `modeledReachable`, `internetAddressable`, and
  `policyFinding`.
- Identity mappings: `mappingId`, `findingId`, `exposureId`, `confidence`, and optional `owner`.

```bash
npm run security:correlate -- \
  --dynatrace-findings dynatrace-findings.json \
  --forward-exposures forward-exposures.json \
  --identity-mappings approved-identity-mappings.json \
  --evidence-source customer-approved-export \
  --output security-correlation.json
```

The correlator rejects duplicate evidence IDs, invalid timestamps, weakly typed booleans, unsupported severities, and
invalid mapping confidence before it builds the queue. Use `--synthetic` only for explicitly labeled trial/demo
evidence; the provenance label and synthetic flag are retained in every published Dynatrace event and shown in the
portal.

Each result retains exact evidence IDs and timestamps. Observed execution, vulnerability, modeled reachability,
internet addressability, and policy findings remain separate facts. A low-confidence identity mapping is capped at
medium severity and requires identity review. Modeled reachability is not interpreted as desired policy. The artifact
does not trigger remediation; security and network owners control investigation, approval, retention, and response.
