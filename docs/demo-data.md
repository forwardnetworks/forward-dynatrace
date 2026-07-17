# Demo Data

Checked demo data exists only for credential-free development, tests, and screenshot generation. Normal app runtime queries explicit live Grail rows and does not fall back to these fixtures.

## Package Rehearsal

```bash
npm run demo:rehearsal
```

This normalizes the checked dependency fixture, builds a Forward intent package, validates it, and performs zero external reads or writes. Every row and artifact is marked synthetic.

## App Capture

```bash
npm run demo:capture
```

The capture harness injects synthetic Forward reconciliation, modeled-network evidence, check-health transitions, and security correlation into the built app. Live DQL remains disabled only inside that harness.

## Live Use

Use `npm run dynatrace:query` with a customer-owned DQL query and protected Platform Token. Live events must carry an explicit false synthetic marker. Do not use replay data as customer acceptance evidence.
