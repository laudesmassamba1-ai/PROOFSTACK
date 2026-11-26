# PROOFCORE

**Make software work everywhere.**

PROOFCORE is an integrated software quality and reliability suite. Five control
families share one execution engine, one report format, one CLI and one dashboard:

| Family    | Question it answers                                                        | What it actually measures                                                          |
| --------- | -------------------------------------------------------------------------- | ---------------------------------------------------------------------------------- |
| **WORLD** | Can users from different countries use the software correctly?             | HTTP and rendered-DOM checks across locales and timezones                          |
| **FLOW**  | Can users complete the critical operations (checkout, payments, webhooks)? | Declared browser journey steps, executed by the CLI's real Chromium                |
| **EXIT**  | Can users retrieve their data without losing or corrupting it?             | Data retrieval and export checks against a configured source                       |
| **FAIL**  | Are the HTTP security settings what they should be?                        | Passive header/configuration checks; no intrusion test                             |
| **CLEAN** | Is the content and structure sound?                                        | Static HTML, or rendered DOM when a browser is available; otherwise `NOT_MEASURED` |

The product is a monorepo: checks execute on the developer's machine or in CI against
an HTTP target and synthetic fixtures, while the SaaS layer stores accounts, projects,
analyses, findings, usage and billing. The assistant drives a real Chromium over the
DevTools Protocol and runs a real terminal. FLOW journeys run in that browser through
the CLI; a server-side run without a browser records every journey as `SKIPPED` with
the reason instead of reporting it as passed.

## Status

Implemented and tested: the shared engine and all five families, the CLI with JSON/
JUnit/HTML reports, the SaaS API (auth, workspaces, projects, run ingestion, API keys,
billing, webhooks), the authenticated workspace and the terminal console. `pnpm test`
runs the full Vitest suite; `pnpm lint`, `pnpm typecheck` and `pnpm build` pass.

The creator's read-only operations console lives at `/app/admin`: users, workspaces,
subscriptions, payments, runs and webhook delivery. It is gated by the API's
`ADMIN_EMAILS` allowlist, which is empty by default and disables the page.

Live: [proofcore-iota.vercel.app](https://proofcore-iota.vercel.app) for the web app,
with `/api/*`, `/v1/*` and `/health` proxied to the
[Cloudflare Worker](https://proofcore-api.laudesmassamba1.workers.dev) so session
cookies stay same-origin. The Worker uses D1 (`proofcore`), migrations applied.

The marketing shell, home page, pricing and account forms are bilingual. The workspace
shell, Overview, Projects, WORLD/FLOW/EXIT, CLI, Billing and Settings are FR/EN. The
creator operations console (`/app/admin`) keeps English operational copy and is not part
of the customer workspace language switch.

The authenticated workspace uses the Ink & Object design system: paper frame, top
navigation, state-driven display type and one data-bound object per module. Design
records and real captures live under [`docs/design`](docs/design), including
[`WORKSPACE_VISUAL_AUDIT.md`](docs/design/WORKSPACE_VISUAL_AUDIT.md).

Not yet true: email verification and password recovery are absent; transactional email
has EmailJS and Resend adapters but no production credentials were supplied, so delivery
is unverified. SasPay's live path is untested without credentials, and prices still
require a deploy to change. See
[`docs/DEVELOPMENT_STATUS.md`](docs/DEVELOPMENT_STATUS.md) for the full, unvarnished
list.

## Deploy

```bash
pnpm cloud:deploy        # API + D1 migrations, then Pages — ends with the smoke check
pnpm cloud:deploy --skip-smoke   # the same, without the post-deploy verification
pnpm smoke:deploy        # check production without deploying (API, Vercel, Pages)
```

`cloud:deploy` fails when the release it just published does not answer: `/health` must
report `status: ok` and `database: ok`, each web origin must be allowed to read it with
credentials, and `/`, `/product`, `/pricing`, `/download` and `/signin` must serve the
bundle the HTML references. The smoke check targets the Worker's own `API_ORIGIN` and the
production Pages host, both read from `apps/api/wrangler.toml`; `PROOFCORE_API_URL`,
`PROOFCORE_PAGES_URL` and `PROOFCORE_SMOKE_WEB` override them. Vercel publishes from the
same commit, so run `pnpm smoke:deploy` after a Vercel production deploy to verify both
surfaces at once.

## Quick start

```bash
pnpm install

# 1. API on Node 22 (built-in SQLite, zero paid infrastructure)
pnpm api:dev            # http://127.0.0.1:8787

# 2. Web app
pnpm web:dev            # http://localhost:5173
```

Create an account at `/signup`, create a project, then create a project token from
the project page. From the **PROOFCORE repository root**:

```bash
pnpm proofcore                              # open the terminal console
pnpm proofcore -- doctor                    # verify node, config and module wiring
pnpm proofcore -- test --module world,flow,exit
pnpm proofcore -- report text
pnpm proofcore -- sync
pnpm proofcore -- audit fail https://site.example --sync
```

## Install the CLI globally

The CLI is published on npm as the unscoped package `proofcore` — a self-contained
bundle with **no runtime npm dependencies**:

```bash
npm install -g proofcore
proofcore --version
```

To build the tarball locally instead (same bytes, no registry needed):

```bash
pnpm cli:package
npm install -g ./artifacts/proofcore-<version>.tgz
proofcore --version
```

To publish a new version (reads the npm token from `NPM_TOKEN` or a hidden prompt,
accepts `-- --otp=123456` for 2FA-enforced accounts):

```bash
pnpm cli:publish
```

Or build, install and check the global binary in one command:

```bash
pnpm cli:install
```

Then open a terminal in the application you want to test and run it there:

```bash
cd /path/to/your/app   # replace with a real, existing directory
proofcore init
proofcore doctor
proofcore modules          # local wiring, with the command for each module
proofcore flow             # run FLOW locally (also world / exit)
proofcore test --module world,flow,exit
```

`init` writes the config in the current directory; it does not create the directory.
`--cwd /path/to/your/app` is also supported, but the path must already exist.

The package is not yet on the npm registry. Once npm authentication and ownership of
the `@proofcore` scope are configured, the generated release is publishable:

```bash
npm publish ./packages/cli/release --access public
```

`pnpm proofcore` remains the in-repo command. `pnpm cli` from an unrelated application
still resolves nothing; use the generated global binary instead.

## Install the desktop app

The native app is a packaged Electron window around the same React interface and the
same local engine as the CLI. It is not a browser shortcut: the web bundle, the engine,
the icons and the launch metadata travel inside the installer. The window has no native
menu bar: local tools, updates and the code agent live in the interface, and the last
synced workspace stays readable while the site is unreachable.

```bash
pnpm app:dist          # this machine (Linux builds .deb + AppImage, Windows builds NSIS .exe)
```

Local Linux artifacts:

```text
artifacts/desktop/PROOFCORE-0.3.0-amd64.deb
artifacts/desktop/PROOFCORE-0.3.0-x86_64.AppImage
```

Install the `.deb` with `sudo dpkg -i`, or make the AppImage executable and run it. The
Windows installer is one `.exe`; it creates the Start Menu entry, the desktop shortcut and
an uninstaller for the current user. The AppImage is the single-file Linux build.

What runs where:

- The interface is the built `apps/web` application, served by the local engine on
  `127.0.0.1` inside the window. It is the same UI as the site, not a copy.
- The local engine is the same self-contained `proofcore` binary the CLI installers ship.
  It executes the agent, audits, sandbox and index on this machine.
- The site is used for the account check, projects, reports, billing, AI model and explicit
  sync. The local engine proxies those API calls with the HttpOnly session cookie;
  JavaScript never receives the cookie. The AI model saved on the account is picked up at
  sign-in and at engine startup, so the same model works in the window without asking for
  its key again. The key stays on the server; local calls go through the authenticated
  relay.
- The session is kept in the OS vault when available (DPAPI, Keychain, libsecret/kwallet),
  with a `0600` file fallback on Linux machines without a keyring. A confirmed session
  keeps the local tools usable for seven offline days; a revoked session locks them.
- Closing and reopening works from the icon. A second launch focuses the existing window.
- The in-app **Moteur / Engine** panel opens the local code agent, runs local tests, opens
  the site, checks `doctor`, reports app-update state and installs engine updates. The
  native OS menu bar is not used.
- The Agent route streams tool calls and file previews in the workspace shell. Writing
  tools stop for an explicit approval unless the engine was started with `--yes`; a small
  context panel shows the repository, model, account and write policy.

The site is not a single cross-platform executable: no installer format can install both
a Linux `.deb` and a Windows `.exe`. Each OS gets one package from the release workflow,
and Linux additionally gets the portable AppImage.

## Terminal console

`pnpm proofcore` opens a full-screen console in a real terminal: Overview, Projects,
Runs, Billing, Admin (when the account is allowlisted) and Help. On Projects, press `n`
to create a project (name, base URL, optional stack, environment). Use arrow keys, Enter
to open a project, `w` to switch workspace, `r` to refresh and `q` to quit.

```bash
pnpm proofcore                              # open the console
pnpm proofcore -- status --json             # scriptable account/workspace summary
pnpm proofcore -- ui --once --screen overview
pnpm proofcore -- login                     # interactive sign-in
pnpm proofcore -- logout                    # remove the stored session
```

Real one-shot rendering of the console (session credentials removed):

```text
PROOFCORE · terminal console
design.qa.20261117@example.com · localhost:8787
 1 Overview   2 Projects   3 Runs   4 Billing   5 Admin   6 Help
──────────────────────────────────────────────────────────────
Design QA Shop (owner)
plan       Developer · ACTIVE
projects   2
usage      2 / 1000 test runs this period

Projects
  Storefront         local      world,flow,exi http://localhost:3000
  Checkout API       staging    flow           https://staging.example.test

Recent runs
  FAILED Storefront           2026-11-17 02:56 8.3s     6 finding(s)
  COMPLETED Storefront        2026-11-17 01:34 8.3s     0 finding(s)

Recent failures
  CRITICAL Duplicate webhook confirms the order twice
  HIGH Accented surname rejected at checkout

workspace: Design QA Shop
1-6 screens · ↑/↓ select · Enter open · w workspace · r refresh · ? help · q quit
```

`login` stores the HttpOnly session cookie in `~/.config/proofcore/session.json` with
mode `0600`; it never stores the password. Use
`PROOFCORE_API_URL=http://127.0.0.1:8787` for the local API, or pass `--api` to `login`,
`ui` or `status`. For CI, `PROOFCORE_SESSION_COOKIE` supplies the cookie without a file.
The default API is the live Vercel deployment. Creating a project is the only mutating
action in the console; test execution and uploads still run locally with
`proofcore test` and `proofcore sync` — or one command, with
`proofcore scan <url> --sync` — and billing/admin stay read-only.

Without `SASPAY_API_KEY` and `SASPAY_WEBHOOK_SECRET`, checkout uses the deterministic
sandbox provider: no money moves, and paid access is still granted only after the
server verifies a `SUCCEEDED` transaction. The dashboard exposes the sandbox outcome
control, labelled as such.

## Commands

| Command             | Purpose                                |
| ------------------- | -------------------------------------- |
| `pnpm test`         | unit + integration tests (Vitest)      |
| `pnpm typecheck`    | TypeScript across every package        |
| `pnpm lint`         | Biome                                  |
| `pnpm build`        | package build + web bundle             |
| `pnpm api:dev`      | API + SQLite on `:8787`                |
| `pnpm web:dev`      | Vite dev server on `:5173`             |
| `pnpm cli -- <cmd>` | run the built CLI                      |
| `pnpm proofcore`    | full-screen terminal console           |
| `pnpm cli:package`  | build the standalone global tarball    |
| `pnpm cli:install`  | build and install `proofcore` globally |

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
packages/cli | cli | developer surface (no SDK package is published)
Docs/ + docs/ research, guides and operational documentation
```

## Licensing

The package manifests declare MPL-2.0 and the root `LICENSE` file is present. Audit the
dependency licences before a public distribution.
