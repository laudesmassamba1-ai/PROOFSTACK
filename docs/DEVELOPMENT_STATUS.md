# Development status

Updated: 2026-11-16. This file records what is actually true in the working tree,
verified by running the commands below. It replaces the earlier Phase 0 planner notes.

## How to reproduce the verification

```bash
pnpm install
pnpm lint        # Biome: passes, warnings only
pnpm typecheck   # tsc across 5 build levels: passes
pnpm test        # 14 files, 212 tests: passes
pnpm build       # packages + web bundle: passes (chunk-size warning)
```

Last run: 212/212 tests in ~18 s; web bundle built with a >500 kB chunk warning
(marketing bundle, not a defect).

## Deployed

Verified on 2026-11-16 against the live hosts:

- Web: https://proofstack-iota.vercel.app (Vercel). `/api/*`, `/v1/*` and `/health`
  are proxied to the Worker, so the session cookie is same-origin in the browser.
- API: https://proofstack-api.laudesmassamba1.workers.dev (Cloudflare Worker + D1
  database `proofstack`; migrations `0001_init.sql` and `0002_report_per_run.sql`
  applied).
- `GET /health` returns 200 with `database: ok` on both origins; the JS and CSS assets
  are served with their real content types, and the SPA routes return the app shell.
- A real sign-up → session → overview round trip succeeds through the Vercel origin
  (201 / 200 / 200), so D1 writes, cookie attributes and the proxy all work.
- Payments stay on the deterministic sandbox provider: no SasPay credentials are
  configured, so no live charge or payout is claimed.

## Implemented and tested

### Shared engine and modules

- `packages/engine`: sequential and bounded-parallel execution, per-test timeout,
  retries only for retryable harness errors (never for product failures), cancellation,
  structured logs, status model
  (`PENDING`/`RUNNING`/`PASSED`/`FAILED`/`WARNING`/`SKIPPED`/`ERROR`), findings with
  reproduction instructions, checksummed evidence metadata.
- WORLD: Unicode / combining-character / RTL name handling, phone metadata per region,
  country-specific address structures, ISO currency precision via integer minor units,
  date/time and DST boundaries. Eight documented locale profiles (`en-US`, `en-GB`,
  `fr-FR`, `fr-BJ`, `fr-CG`, `ar-EG`, `ja-JP`, `pt-BR`), versioned and extendable.
- FLOW: HTTP journey and checkout scenarios including sandbox success, decline, cancel,
  timeout, duplicate/out-of-order webhook, refund and inconsistent transaction state.
  Webhook checks cover signature, replay, idempotency, ordering and invalid payloads.
  No real payment provider is ever contacted by module tests.
- EXIT: CSV/JSON/ZIP-with-manifest exports, schema/type/null/encoding checks, referential
  integrity and orphans, SHA-256 file checksums, round-trip comparison.
- `packages/adapters/reporting`: JSON, JUnit XML, standalone HTML and text renderers,
  shared by API and CLI.
- `packages/cli`: `init`, `doctor`, `validate`, `test` (`--module`, `--only`,
  `--profile`, `--json`, JUnit/HTML output), `report`, `projects`, `login`, `logout`,
  `sync`, `ai`. Exit codes are a contract (0 pass, 1 defect, 2 harness error,
  3 cancelled) and are covered by CLI tests.

### SaaS API (`apps/api`)

- Hono application running both as a Cloudflare Worker (`D1`) and on Node 22
  (`node:sqlite`); one SQL surface (`prepare().bind().all()/first()/run()`), versioned
  migrations in `apps/api/migrations/`.
- Auth: email + password, PBKDF2-SHA256 (100k iterations, the Workers WebCrypto
  ceiling), server-side hashed sessions,
  `ps_session` HttpOnly/SameSite=Lax/Secure cookie, origin checking, in-memory
  per-instance rate limits, `Authorization: Bearer psk_...` project tokens.
- Tenancy: workspaces and members, projects, environments, module activation; every
  read/write is scoped by membership on the server; tenant isolation is covered by
  integration tests.
- Runs and reports: idempotent run ingestion, one report per run (unique index),
  per-run findings, JSON/HTML report download, workspace findings feed, usage metering
  counted once per accepted run.
- API keys: created once, stored hashed, revoked; plan-dependent `api_access`.
- Billing: plans and entitlements come from `packages/billing` (authoritative), checkout
  start, status, sandbox settle, cancel, change-plan, payment history, receipts,
  webhook endpoint with `X-Webhook-Signature`/`X-Webhook-Timestamp` HMAC-SHA256 over the
  raw body, 300 s freshness window, unique event IDs, replay-safe processing.
- Paid access is granted only after `verify`/settle reports a verified `SUCCEEDED`
  transaction; a browser redirect never grants entitlements. Sandbox checkout exposes
  no provider redirect URL.
- 21 integration tests cover tenant isolation, quotas, upload idempotency, payment
  authority, webhook signature/replay.

### Dashboard (`apps/web`)

- Marketing site (dark brand hero, dotted wave, modular illustrations) and the
  authenticated area: Overview, Projects, Project detail, module pages (WORLD/FLOW/EXIT),
  Billing, Settings.
- Session-aware routing, cookie-based API client, exact money formatting, plan change
  flow (upgrade → checkout, downgrade → change-plan), sandbox panel labelled as such,
  usage and entitlement display, receipt download.
- English/French dictionaries for the marketing shell, home, pricing and account forms,
  including validation messages and the selected-plan notice. Long-form technical
  pages and the authenticated dashboard remain English-only by policy, stated in
  Settings rather than silently mixed.
- Creator operations console at `/app/admin`: read-only users, workspaces,
  subscriptions, payments, runs and webhook delivery. Access is re-checked server-side
  against `ADMIN_EMAILS`; an empty list disables the console instead of granting it to
  the first account. No password hash, session token or API key is selected.

## Implemented but not fully verified

- **SasPay live path.** The adapter follows the documented endpoints and is unit
  tested, but no live credential exists in this environment, so signing, payout and
  production webhook behaviour have not been exercised against SasPay.
- **Cloudflare operations.** The Worker, D1 database and migrations are live and a
  smoke path passes, but the free plan has not been exercised under sustained load,
  and Workers WebCrypto caps PBKDF2 at 100 000 iterations (the API now uses that
  ceiling). R2, queues and observability retention have not been evaluated.
- **Module execution targets.** WORLD and FLOW run over HTTP (form `submitUrl`,
  checkout/order/webhook URLs) and EXIT over export files, all covered by fixture-based
  tests. They have not been run end-to-end against a third-party staging application.
- **Email.** No provider is configured, so verification, password reset and invitations
  do not exist. The API states `emailVerification: "not_configured"` instead of
  pretending an email was sent.

## Not implemented

- French translation of the authenticated dashboard and of the long-form technical
  pages (Product, module details, Docs, Security, Changelog). The language setting is
  explicit about the current boundary.
- Email delivery adapter and the flows that depend on it (verification, reset,
  invitations, renewal reminders).
- Database-configured pricing: plans, prices and entitlements live in
  `packages/billing/src/plans.ts`, so changing a price requires a deploy. Annual pricing
  and per-currency price lists are not wired to checkout.
- Protected operator/admin billing console (plan editing, subscription overrides,
  refund states, webhook event browser). Member roles (`owner`/`admin`/`member`) exist
  and privileged routes check them, but no admin UI is exposed.
- Refunds: SasPay exposes no refund endpoint, so refunds are recorded administratively
  and the state machine rejects a refund transition the provider cannot confirm.
- Invoice PDFs: receipts are HTML records with provider reference, plan, amount,
  currency, date and service period. They are payment receipts, not tax invoices.
- Playwright browser journeys: no committed E2E suite, no DOM form filling, no
  screenshots-on-failure evidence. WORLD/FLOW targets are HTTP; the dashboard was
  inspected manually in a real browser during this pass. `pnpm test:e2e` is declared in
  the root scripts but has no config or specs behind it yet.
- GitHub App / CI marketplace integration beyond API-key based CLI sync.
- Root `LICENSE` file (manifests declare MPL-2.0; the file is still missing).

## Interface, language and responsiveness pass

Verified in a real browser at 1440×1000 and 390×844, with the API and web dev server
running locally:

- Fixed French strings that were still English: the FLOW module description, the hero
  report caption, pricing limits and flags, navigation and menu labels, footer links,
  auth validation errors and plan notice, and the whole architecture page.
- The architecture page no longer claims Drizzle/Better Auth or browser execution that
  the code does not use; it describes D1 + Node SQLite and HTTP targets accurately.
- Docs and Changelog no longer say the CLI, API and dashboard do not exist; they list
  the delivered surface and the real outstanding limits.
- Responsive: the hero lockup is fluid (`clamp`) and fits a 320 px viewport, the
  desktop nav switches to the menu at `xl` so French labels never collide, dashboard
  navigation wraps instead of hiding items, mobile keeps Sign out reachable, and every
  table scrolls inside its card. The opened marketing menu is opaque, so page content
  no longer shows through it.
- Design tokens: remaining showcase/home hex values moved into the stylesheet, tile
  hover is limited to `hover: hover` devices, and long headings use balanced wrapping.
- Playwright run reported 0 console errors, 0 page errors, 0 failing requests and 0
  horizontal overflow on both viewports; the FR→EN switch and the mobile sign-out were
  asserted.
- CLI: `pnpm cli -- <command>` (and npm's forwarded separator) is now accepted instead
  of being read as a command named `--`; covered by a subprocess regression test.

## Decisions worth knowing

- Raw SQL over Drizzle: Drizzle's D1 driver has no `node:sqlite` counterpart, and the
  tests need the same schema on both runtimes. Rationale is in `docs/ARCHITECTURE.md`.
- First-party auth over Better Auth: Better Auth's D1 adapter would have tied the API to
  one runtime and added a schema we cannot share with `node:sqlite`.
- Sandbox provider is deterministic and explicit; it never claims to have moved money.
- One report per run is enforced by a unique index, not by application logic.
- SQLite statements are split with a comment-aware splitter (a `;` inside a comment
  previously finalized statements early).

## Coordination with concurrent agents

This repository was edited by more than one agent in the same working tree. Resolved
during this pass:

- Duplicate module route: `ModulePage.tsx` kept, the parallel `ModuleView.tsx` removed
  because it registered the same path and its API calls diverged.
- Three separate Billing implementations were merged into one component with a single
  plan-change path.
- Root causes fixed rather than suppressed: SQL statement splitting, duplicate reports
  per run, invalid `runStatus` values, unused imports, dead test variables, Biome config
  keys (`noEval` → `noGlobalEval`, Tailwind directive parsing), accessibility violations
  in `favicon.svg`, `DottedWave.tsx` and `Logo.tsx`, and control-character regexes now
  carry justified `biome-ignore` comments instead of lint failures.
- Repo-wide formatting was applied so `pnpm lint` reflects real problems only.

## Next actions

1. Provision D1, apply `apps/api/migrations/*.sql`, deploy the Worker, then repeat the
   checkout/webhook smoke test against the deployed URL.
2. Configure a transactional email provider behind an adapter interface; then enable
   verification, reset and invitations. Until then the UI must keep saying it is off.
3. Move plans and prices into the database with an operator-only console and audit log.
4. Exercise the SasPay adapter with `sk_test_...` credentials, including a real webhook
   replay and the 429 back-off path.
5. Add the root `LICENSE` and finish the dependency licence audit.
