# Workspace architecture

## Route ownership

| Route | Component | Data source |
| --- | --- | --- |
| `/app` | `Overview` | `GET /api/v1/overview?workspaceId=` |
| `/app/projects` | `Projects` | `GET/POST /api/v1/projects` |
| `/app/projects/:id` | `ProjectDetail` | project, project runs, project findings, API keys |
| `/app/modules/:module` | `ModulePage` | workspace runs + findings filtered by module |
| `/app/cli` | `Cli` | projects |
| `/app/billing` | `Billing` | billing, plans, checkout, sandbox settle |
| `/app/settings` | `Settings` | workspace, members, API keys |
| `/app/admin` | `Admin` | admin API; server re-checks allowlist |

The app shell is `AppLayout`; it owns session states and navigation only. Pages own
their data fetching and error states.

## Shell

`AppLayout` renders:

1. Loading — Tester working, not a blank page.
2. Signed out — redirect to `/signin?next=…`.
3. API unreachable — paper service sheet with retry; address only in development.
4. Ready — paper frame, top navigation, workspace/project pills, command palette,
   account menu, mobile sheet, and `<Outlet />`.

Workspace switching still uses `SessionProvider.setWorkspaceId`; project switching is
navigation only and never changes workspace scope silently.

## Data rules

- `/overview` is the source for workspace aggregates and usage.
- `/runs` is the source for module object totals. Latest run = first returned item
  whose `totals[module]` exists.
- `/findings` is the source for failure rows. A finding is not invented from a run.
- Objects cap visual elements for legibility but the adjacent sentence includes the
  exact real totals.
- No chart is drawn with fewer than two real runs. The redesigned Overview does not
  extrapolate a trend at all; it lists real runs.

## i18n

Workspace copy is added to the centralized dictionary (`i18n/workspace.ts`, merged by
`i18n/index.tsx`). FR and EN must both exist. Commands, identifiers, status codes and
provider names keep their original form. Long-form billing/settings strings that have
not yet been migrated remain a documented gap rather than a fabricated translation.

## Integrity

Do not change API contracts, authentication, session cookies, workspace isolation,
billing state machines, SasPay integration, webhook verification, entitlements,
usage metering, database schema, CLI or SDK for visual reasons.

## Performance

- No new runtime UI dependency except self-hosted fonts.
- Module objects are inline SVG/CSS; no WebGL.
- Fonts are bundled by Vite.
- The shell adds no polling. Data loads once per page mount and on retry.
- Mobile sheet and command palette are local state only.
