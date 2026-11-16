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
billing, webhooks) and the authenticated dashboard. `pnpm test` runs 208 tests;
`pnpm typecheck`, `pnpm lint` (warnings only) and `pnpm build` pass.

The creator's read-only operations console lives at `/app/admin`: users, workspaces,
subscriptions, payments, runs and webhook delivery. It is gated by the API's
`ADMIN_EMAILS` allowlist, which is empty by default and disables the page.

Live: [proofstack-iota.vercel.app](https://proofstack-iota.vercel.app) for the web app,
with `/api/*`, `/v1/*` and `/health` proxied to the
[Cloudflare Worker](https://proofstack-api.laudesmassamba1.workers.dev) so session
cookies stay same-origin. The Worker uses D1 (`proofstack`), migrations applied.

The marketing shell, home page, pricing and account forms are bilingual. Long-form
technical pages and the authenticated dashboard are English-only; the Settings page
says so instead of implying a translation that does not exist.

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

API environment variables are documented in
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

The package manifests declare MPL-2.0, but a root `LICENSE` file has not been added
yet. Do not treat the project as formally licensed until that file exists and the
dependency licence audit is complete.
