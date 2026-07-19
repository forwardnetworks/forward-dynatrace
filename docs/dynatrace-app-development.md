# Dynatrace App Development

This repository contains a Dynatrace App built with the Dynatrace App Toolkit (`dt-app`) and deployed on Dynatrace
AppEngine. The UI uses TypeScript, React, and the Strato Design System; Grail data is queried with DQL.

## Source Map

| Path | Responsibility |
| --- | --- |
| `ui/` | React routes, components, and app-facing data presentation. |
| `api/` | App functions that return sanitized responses to the UI. |
| `actions/` | Custom Dynatrace Workflow action and result widget. |
| `deploy/dynatrace-dql/` | Versioned DQL used by dashboards and live readback. |
| `app.config.json` | App identity, version, environment placeholder, and required scopes. |

## DQL

- Verify syntax and function behavior against the current Dynatrace DQL documentation before adding a query.
- Keep reusable queries in `deploy/dynatrace-dql/` and validate their expected record shape in code or tests.
- Treat observed Dynatrace traffic, Forward modeled reachability, and generated test data as separate provenance classes.
- Fail closed on replay, seeded, fixture, or synthetic dependency evidence in live workflows.
- Bound result sizes, time windows, and aggregation cardinality explicitly.

UI code should normally use `useDql` from `@dynatrace-sdk/react-hooks`. Lower-level query clients are appropriate for
scripts and app functions that require explicit polling or response control.

## Strato UI

Use Strato components and design tokens for native Dynatrace behavior. Import components from their category modules
so the bundle includes only the required code:

```typescript
import { Flex } from "@dynatrace/strato-components/layouts";
import { Heading } from "@dynatrace/strato-components/typography";
import { DataTable } from "@dynatrace/strato-components-preview/tables";
```

Do not import from the package root. Consult the installed `.d.ts` files under
`node_modules/@dynatrace/strato-components*/` when a component API is unclear. Use `DataTable` for interactive tables
and `SimpleTable` for small static presentations.

## Platform Clients

- Prefer React hooks from `@dynatrace-sdk/react-hooks` in UI code.
- Use generated `@dynatrace-sdk/client-*` clients when direct service calls are required.
- Use `@dynatrace-sdk/app-environment` for application and environment context.
- Use `@dynatrace-sdk/user-preferences` for theme, language, locale, and timezone only.
- Store the Forward identity only in the owner-controlled, secret-type app setting; never place it in UI state, source,
  browser storage, Workflow input, or an action result. Only app functions may load it.

## Local Workflow

```bash
npm ci
npm run start
npm run lint
npm run build
npm run ci
```

`npm run start` runs the App Toolkit development server with hot reload. `npm run ci` is the complete local equivalent
of the required GitHub Actions workflow and must pass on Node 24 before handoff.

App deployment and uninstall use checked wrappers so the target environment and application identity are explicit:

```bash
npm run dynatrace:deploy -- \
  --environment-url https://<environment-id>.apps.dynatrace.com/ \
  --app-id my.forward \
  --no-open \
  --non-interactive

npm run dynatrace:uninstall -- \
  --environment-url https://<environment-id>.apps.dynatrace.com/ \
  --app-id my.forward \
  --no-open \
  --non-interactive
```

See [Install](install.md) for scopes and signing, [Workflow](workflow.md) for the product data flow, and
[Validation matrix](validation-matrix.md) for the evidence required when behavior changes.
