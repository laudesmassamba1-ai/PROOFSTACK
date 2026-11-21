# DEVELOPMENT STATUS

Status: functional, tested and visually redesigned. The authenticated workspace now
uses the Ink & Object direction; this file records what is true and what remains open.

## Implemented and checked

- One engine, three fixture modules (WORLD, FLOW, EXIT) and two HTTP audit modules
  (FAIL, CLEAN) that share the run, finding, report, insight and webhook pipeline.
- CLI commands: init, doctor, validate, test, world/flow/exit, modules, report,
  audit (fail|clean), sync, login/logout (session or device flow), ai, mcp, tools.
  Core modules and the module board run locally; they never open the website.
- Report formats: JSON, JUnit, HTML and text, with stable exit codes (0 pass, 1 defect,
  2 harness error, 3 cancelled).
- SaaS API on Node 22 SQLite and Cloudflare Worker/D1: auth, workspaces, projects, run
  ingestion, reports, API keys, billing, signed webhooks, entitlements and usage.
- Authenticated workspace: paper frame, top navigation, workspace/project selectors,
  command palette, full-screen mobile menu, state-driven Overview, data-bound module
  objects, a local `/app/modules` index and project/module/CLI screens. One IA section
  contains the assistant and its local console (streaming tool calls, approvals, file
  previews); a desktop browser panel embeds Chromium, and an integrated terminal runs
  the user's shell over SSE.
- Empty, loading and 404 states use the inline Testers cast; errors and billing do not.
- Overview, Projects, all five module pages, FAIL/CLEAN audits, Billing, Settings and
  the shell have FR/EN copy.
- Bricolage Grotesque, Geist and JetBrains Mono are bundled locally; no runtime UI
  dependency was added.
- Native desktop package: frameless Electron window with in-app window controls and an Engine panel (local console, tests, doctor, engine update, app update state), no native menu bar, the embedded web build and the same local engine as the CLI. It keeps a login window backed by the site API, an OS-vault session with a seven-day offline grace period, a loopback API proxy, desktop/Start Menu icons and background app/engine update hooks. Last successful GET responses are cached locally so the shell stays navigable offline; server-only actions remain blocked. Linux produces `.deb` + AppImage; the release workflow produces the Windows NSIS `.exe`.
- Marketing, docs, workspace and admin routes are code-split.

## Design records

- `.agents/skills/proofcore-product-experience/SKILL.md`
- `docs/design/REFERENCE_DECODING.md` — includes exact notes on all six images in
  `ref_visuelles/`.
- `docs/design/DESIGN_TOKENS.md`
- `docs/design/PRODUCT_EXPERIENCE.md`
- `docs/design/COPYWRITING_GUIDELINES.md`
- `docs/design/MOTION_GUIDELINES.md`
- `docs/design/WORKSPACE_ARCHITECTURE.md`
- `docs/design/WORKSPACE_VISUAL_AUDIT.md`
- `docs/design/screenshots/` — real captures, not mockups.

## Verification

- `pnpm typecheck`: passes across the workspace.
- `pnpm test`: 534 tests pass (42 files).
- `pnpm test:e2e`: 30 tests pass (desktop + mobile), including the HttpOnly session
  surviving a reload and no horizontal overflow on any dashboard page.
- `pnpm --filter @proofcore/web build`: passes; route-level chunks replace the previous
  single 554 kB bundle.
- Visual QA: 42 route/viewport combinations from 1920×1080 to 375×812, zero horizontal
  overflow; screenshots generated with no console/page errors.
- `pnpm lint`: clean across 362 files (10 warnings, no errors).
- Packaged desktop smoke (Linux): the built app starts its packaged sidecar, serves `resources/web`, redirects to `/app`, shows the site title, reads the account AI model without asking for a second provider setup, and re-reads it before each turn so a profile connected later takes effect without a restart. A Playwright Electron run also opens the Engine panel, enters the integrated IA route, receives a streamed model answer, and verifies that a simulated 503 shows the offline screen with no raw status code and still opens the local agent.

## Known gaps

The full, evidence-based list lives in `docs/AUDIT_2026-11.md`. The short version:

- No password recovery, no email verification and no transactional email provider:
  a user who forgets a password cannot recover the account.
- No OAuth (Google, GitHub) and no two-factor authentication.
- No support channel, no legal pages (terms, privacy, cookies).
- Four sold entitlements have no implementation (GitHub integration, client sharing,
  advanced reports, priority support). The pricing table now labels them "coming".
- FAIL/CLEAN audit results are not yet uploaded as runs, so the two module pages stay
  empty until `proofcore audit --sync` exists.
- CLEAN scores server HTML, which is structurally wrong for client-rendered apps.
- No CI. No tests for the WORLD module or the payment adapters.
- No retention job, no backup procedure, no pagination, no search.
- No email provider: verification, password reset and invitations are absent, not faked.
- The CLI is distributable as a self-contained global tarball (`pnpm cli:install`), but
  `@proofcore/cli` is not published on the npm registry yet.
- SasPay live path is untested without credentials; sandbox payments are tested.
- FLOW browser journeys now run through the local Chromium over CDP (`proofcore test`);
  server-side audits skip them because the Worker has no browser. WORLD remains
  HTTP/fixture based.
- The Windows desktop installer is built by the release workflow and checked for its
  packaged files, not launched on a Windows runner in this environment. It is unsigned,
  so Windows SmartScreen may warn until a code-signing certificate is configured. macOS
  packaging is configured but not part of the requested Windows/Linux matrix.
- Desktop auto-update reads electron-builder's `latest*.yml` assets. It needs a published
  GitHub release with those assets; it is not exercised by the local package build.
  AppImage and NSIS update in place; a `.deb` reports the manual state and links to the
  release page, because the system package manager owns that install.
- The security review items for shared registration limits behind a proxy, the
  per-isolate in-memory rate limiter, account-enumeration timing, PBKDF2 cost, single
  `WEB_ORIGIN` support and chunked webhook size limits remain open. They are backend
  work, not visual claims.
- `.env.example` now exists and is un-ignored. Real values remain local or in the host
  secret store.
- Screenshots are committed for design review; they are not a substitute for visual
  regression tests.

## Environment and API

- Local web: `http://localhost:5173`
- Local API: `http://localhost:8787`
- Production web proxies `/api/*`, `/v1/*` and `/health` to the Worker. Without
  `VITE_API_URL`, production now uses the current origin, never `localhost`.
- Auth failure copy no longer prints the internal API address; diagnostics remain
  development-only.
