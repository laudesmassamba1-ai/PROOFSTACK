# PROOFSTACK

**Make software work everywhere.**

PROOFSTACK is an integrated software quality and reliability suite with three
modules that share one execution engine, one report format, one CLI and one
dashboard:

| Module    | Question it answers                                                        |
| --------- | -------------------------------------------------------------------------- |
| **WORLD** | Can users from different countries use the software correctly?             |
| **FLOW**  | Can users complete the critical operations (checkout, payments, webhooks)? |
| **EXIT**  | Can users retrieve their data without losing or corrupting it?             |

The product is a monorepo: checks execute on the developer's machine or in CI against
an HTTP target and synthetic fixtures, while the SaaS layer stores accounts, projects,
reports, usage and billing. Browser (Playwright) automation of customer journeys is
not implemented yet — see the status file.

## Status

Implemented and tested: the shared engine and all three modules, the CLI with JSON/
JUnit/HTML reports, the SaaS API (auth, workspaces, projects, run ingestion, API keys,
billing, webhooks), the authenticated workspace and the terminal console. `pnpm test`
runs 220 tests; `pnpm typecheck` and `pnpm build` pass. Biome still reports pre-existing
diagnostics, so `pnpm lint` is not claimed as clean.

The creator's read-only operations console lives at `/app/admin`: users, workspaces,
subscriptions, payments, runs and webhook delivery. It is gated by the API's
`ADMIN_EMAILS` allowlist, which is empty by default and disables the page.

Live: [proofstack-iota.vercel.app](https://proofstack-iota.vercel.app) for the web app,
with `/api/*`, `/v1/*` and `/health` proxied to the
[Cloudflare Worker](https://proofstack-api.laudesmassamba1.workers.dev) so session
cookies stay same-origin. The Worker uses D1 (`proofstack`), migrations applied.

The marketing shell, home page, pricing and account forms are bilingual. The workspace
shell, Overview, Projects, WORLD/FLOW/EXIT, CLI, Billing and Settings are FR/EN. The
creator operations console (`/app/admin`) keeps English operational copy and is not part
of the customer workspace language switch.

The authenticated workspace uses the Ink & Object design system: paper frame, top
navigation, state-driven display type and one data-bound object per module. Design
records and real captures live under [`docs/design`](docs/design), including
[`WORKSPACE_VISUAL_AUDIT.md`](docs/design/WORKSPACE_VISUAL_AUDIT.md).

Not yet true: no email provider is configured (verification, reset and invitations are
therefore absent), SasPay's live path is untested without credentials, and prices
still require a deploy to change. See
[`docs/DEVELOPMENT_STATUS.md`](docs/DEVELOPMENT_STATUS.md) for the full, unvarnished
list.

## Quick start

```bash
pnpm install

# 1. API on Node 22 (built-in SQLite, zero paid infrastructure)
pnpm api:dev            # http://127.0.0.1:8787

# 2. Web app
pnpm web:dev            # http://localhost:5173
```

Create an account at `/signup`, create a project, then create a project token from
the project page. In your own application repository:

```bash
pnpm cli -- init
pnpm cli -- doctor
pnpm cli -- test --module world,flow,exit
pnpm cli -- sync
```

`@proofstack/cli` is private to this workspace for now; `pnpm cli -- <command>` runs the
built binary. When it is published, the same commands are `proofstack <command>`.

## Terminal console

`pnpm proofstack` opens a full-screen console in a real terminal: Overview, Projects,
Runs, Billing, Admin (when the account is allowlisted) and Help. On Projects, press `n`
to create a project (name, base URL, optional stack, environment). Use arrow keys, Enter
to open a project, `w` to switch workspace, `r` to refresh and `q` to quit.

```bash
pnpm proofstack                              # open the console
pnpm proofstack -- status --json             # scriptable account/workspace summary
pnpm proofstack -- ui --once --screen overview
pnpm proofstack -- login                     # interactive sign-in
pnpm proofstack -- logout                    # remove the stored session
```

`login` stores the HttpOnly session cookie in `~/.config/proofstack/session.json` with
mode `0600`; it never stores the password. Use
`PROOFSTACK_API_URL=http://127.0.0.1:8787` for the local API, or pass `--api` to `login`,
`ui` or `status`. For CI, `PROOFSTACK_SESSION_COOKIE` supplies the cookie without a file.
The default API is the live Vercel deployment. Creating a project is the only mutating
action in the console; test execution and uploads still run locally with
`proofstack test` and `proofstack sync`, and billing/admin stay read-only.

Without `SASPAY_API_KEY` and `SASPAY_WEBHOOK_SECRET`, checkout uses the deterministic
sandbox provider: no money moves, and paid access is still granted only after the
server verifies a `SUCCEEDED` transaction. The dashboard exposes the sandbox outcome
control, labelled as such.

## Commands

| Command             | Purpose                           |
| ------------------- | --------------------------------- |
| `pnpm test`         | unit + integration tests (Vitest) |
| `pnpm typecheck`    | TypeScript across every package   |
| `pnpm lint`         | Biome                             |
| `pnpm build`        | package build + web bundle        |
| `pnpm api:dev`      | API + SQLite on `:8787`           |
| `pnpm web:dev`      | Vite dev server on `:5173`        |
| `pnpm cli -- <cmd>` | run the built CLI                 |
| `pnpm proofstack`   | full-screen terminal console      |

Copy [`.env.example`](.env.example) to `.env.local` for local development. API
environment variables are documented in
[`docs/deployment/ENVIRONMENT_VARIABLES.md`](docs/deployment/ENVIRONMENT_VARIABLES.md).
Runtime and security decisions are in [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md);
SasPay capabilities are in
[`docs/payments/PROVIDER_CAPABILITIES.md`](docs/payments/PROVIDER_CAPABILITIES.md).

## Repository layout

```
apps/web        React/Vite marketing site and dashboard
apps/api        Hono API: Cloudflare Worker (D1) and Node 22 (SQLite)
packages/core   money, text/Unicode, time, hashing, errors
packages/contracts  shared Zod schemas (config, engine, API, billing)
packages/engine shared execution engine and reporting model
packages/modules/world|flow|exit  the three test modules
packages/adapters/payments  SasPay + sandbox provider adapters
packages/adapters/reporting JSON / JUnit / HTML / text renderers
packages/adapters/ai        MCP / AI provider configuration (optional)
packages/billing plans, entitlements, usage, state machines, checkout
packages/cli | sdk | config developer surface
Docs/ + docs/ research, guides and operational documentation
```

## Licensing

The package manifests declare MPL-2.0 and the root `LICENSE` file is present. Audit the
dependency licences before a public distribution.
