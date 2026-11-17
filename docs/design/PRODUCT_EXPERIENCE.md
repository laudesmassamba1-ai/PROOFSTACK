# Product experience — PROOFSTACK workspace

## Thesis

The workspace is an instrument, not a dashboard kit. It states the situation in giant
ink type, embodies each module's latest data in one tangible object, then becomes
dense and precise where engineers need to work.

## Structure

```
/app
  /                 Overview — situation, module objects, next action, recent runs
  /projects         Project list — identity, target, environment, enabled modules
  /projects/:id     Project workbench — runs, findings, token, config
  /modules/world    WORLD workbench — orbit + latest run evidence
  /modules/flow     FLOW workbench — chain + latest run evidence
  /modules/exit     EXIT workbench — stack + latest run evidence
  /cli              CLI onboarding
  /billing          Plan, usage, payment attempts, receipts
  /settings         Account, members, appearance, language, tokens
  /admin            Operations (admin only)
```

No route is shown unless it exists in `apps/web/src/App.tsx`.

## Navigation

A slim top bar inside the paper frame: circular brand mark, small uppercase links,
workspace and project pills, command palette (`⌘K` / `Ctrl K`), black account circle.
WORLD, FLOW and EXIT share one Engines control. On mobile, a full-screen paper sheet
with giant links, focus trap and Escape to close.

The command palette searches the real navigation and loaded projects. It does not
execute shell commands.

## State hierarchy

1. **Situation** — the giant headline. No project, no run, failures or no anomaly.
2. **Objects** — latest run totals per module, with a text equivalent.
3. **Next action** — create project, install CLI, inspect failure, or continue work.
4. **Evidence** — recent runs table, findings, project and usage facts.
5. **Setup** — token and configuration, only where relevant.

## Empty workspace

Empty is designed first:

- `NO PROJECT.` / `AUCUN PROJET.`
- Support line explains that a project configures the first checks.
- Testers carry real strings such as `ß ≠ SS ?` and `Zoë-Marie N'Diaye`.
- Two actions: create a project, install the CLI.
- No fake activity, no greyed-out charts, no invented setup completion.

## Populated workspace

- Headline counts only recent failed findings from `/overview`.
- Module object state uses the latest run's module totals from `/runs`.
- Recent runs display project, status, started time, duration, finding count.
- Usage and subscription remain secondary facts, not hero metrics.
- A failure leads to its module workbench; a report link is shown only where a report
  id exists.

## Service failure

If the API cannot be reached, the shell renders a calm paper error sheet:

> **Service temporarily unavailable**  
> The server connection did not complete. Your data was not confirmed.

Action: retry. The internal API base is printed only in development. A backend outage
is never presented as a signed-out state or a bad password.

## Integrity boundaries

- All counts and statuses come from existing API responses.
- Objects are derived from `passed`, `failed`, `warnings`, `skipped`, `total`.
- No locale profile, stage or export format is displayed unless the API supplies it.
- Billing, SasPay, webhooks, entitlements and payment state are untouched.
- “Sync” remains an explicit CLI action; the browser cannot run a local command.
