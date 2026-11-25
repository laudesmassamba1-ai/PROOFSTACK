# DEVELOPMENT STATUS

Status: functional, tested and visually redesigned. The authenticated workspace now
uses the Ink & Object direction; this file records what is true and what remains open.

## Implemented and checked

- Three fixture-driven engine modules (WORLD, FLOW, EXIT) plus two HTTP page-audit
  modules (FAIL, CLEAN). WORLD/FLOW/EXIT engine runs use the shared run/report pipeline.
  FAIL/CLEAN page scans produce measured findings, but the module-copilot live scan path
  records in page-scan history. The module-copilot response returns `auditId`, while
  `runId: null` / `reportId: null` remain correct: page audits are not shared EngineRuns.
  Keep the page-audit and engine-run histories distinct.
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
- `pnpm test`: 811 tests pass (69 files), measured 25 November 2026.
- `pnpm test:e2e`: 36 tests pass, 2 skipped (desktop Chrome + Pixel 7), including the
  HttpOnly session surviving a reload, the mobile sign-up journey and no horizontal
  overflow on any dashboard page.
- `pnpm --filter @proofcore/web build`: passes; route-level chunks replace the previous
  single 554 kB bundle.
- Visual QA: 42 route/viewport combinations from 1920×1080 to 375×812, zero horizontal
  overflow; screenshots generated with no console/page errors.
- `pnpm lint`: clean across 493 files (0 errors, 0 warnings).
- Packaged desktop smoke (Linux): the built app starts its packaged sidecar, serves `resources/web`, redirects to `/app`, shows the site title, reads the account AI model without asking for a second provider setup, and re-reads it before each turn so a profile connected later takes effect without a restart. A Playwright Electron run also opens the Engine panel, enters the integrated IA route, receives a streamed model answer, and verifies that a simulated 503 shows the offline screen with no raw status code and still opens the local agent.

## Known gaps

The following are current limitations, not historical claims. Keep them aligned with
`docs/PROOFCORE_CAPABILITY_MATRIX.md` and the actual code.

### Accounts and identity
- Password recovery, email-verification requests/confirmation, session listing/revocation
  and account deletion are implemented and covered by API tests.
- Email verification is not enforced at sign-in. Sign-up reveals an already-used address
  with HTTP 409; assess and mitigate account enumeration.
- OAuth (Google/GitHub) and MFA/TOTP are absent.
- EmailJS and Resend adapters exist, but no production credentials were supplied.
  Real transactional delivery is **NON VÉRIFIÉ**.

### Product and reports
- Four entitlements remain unimplemented and are labelled "coming": GitHub integration,
  client sharing, advanced reports and priority support.
- The legal routes/templates and their publication readiness must be treated separately:
  required legal entity, jurisdiction and privacy-contact details still need owner/legal
  completion. Do not describe placeholder content as final legal documents.
- JSON, JUnit, HTML and text reports are supported by the engine/CLI. PDF/CSV report
  export and client report sharing are absent.
- Pagination exists (`limit`/`offset` and migration indexes); full-text search is absent.

### Module execution and persistence
- WORLD remains HTTP/fixture based.
- FLOW browser journeys execute locally through Chromium/CDP in the CLI. The Cloudflare
  Worker has no browser, so browser-only journeys are skipped/not runnable there.
- EXIT file and command export sources require the local CLI runtime. The Worker does not
  run those sources.
- FAIL/CLEAN page scans from the AI module-copilot path are persisted as `PageAudit`
  records, and module readiness exposes the latest page audit. They are not converted into
  shared engine runs (`runId` and `reportId` remain null by design). The CLI still has no
  verified `audit --sync` path, so FAIL/CLEAN do not yet share the same EngineRun/RunReport
  history or trend pipeline as WORLD/FLOW/EXIT.
- CLEAN measures server HTML in the current audit path. On client-rendered pages it skips
  DOM-dependent checks and reports `not_measured`; metadata checks may still be measured.
- A simple Start scan is a page-level scan unless an explicit crawl/site scope is selected.
  Never describe a one-page scan as a full-site audit.

### Infrastructure and security
- No retention job and no tested backup/restore procedure.
- No distributed limiter yet for registration and AI calls; per-isolate in-memory limits
  are not global across Workers.
- Account-enumeration timing, PBKDF2 cost review, multi-origin `WEB_ORIGIN` support and
  chunked webhook size enforcement remain review items.
- DNS rebinding and embedded-browser redirect protections require further validation.
- Do not infer production security from local unit tests alone.

### Distribution and external services
- The CLI can be packaged as a self-contained local tarball with `pnpm cli:package`
  / installed with `pnpm cli:install`. The workspace package `@proofcore/cli` is
  private. Registry publication/version parity must be verified independently before
  recommending `npm install -g proofcore`.
- SasPay sandbox is tested. The live path is **NON VÉRIFIÉ** without production
  credentials, webhook secret and any required provider-side allowlisting.
- Windows NSIS packaging is configured, but launching the installer on a Windows runner
  and code signing remain unverified. SmartScreen may warn while the installer is unsigned.
- Desktop auto-update requires a published release with the expected electron-builder
  metadata/assets. Local package creation alone does not verify update delivery.

### Evidence discipline
- The last documented local verification reports 811 Vitest tests, 36 E2E tests with
  2 skipped, lint/typecheck/build success and 42 route/viewport layout checks. These are
  recorded results, not proof that every later commit or the production deployment
  passed again.
- The committed workspace screenshots predate the latest PROOFCORE wordmark correction
  and must be regenerated before being treated as current visual references.
- Real e-mail, SasPay live payment, external-provider AI and production deployment remain
  **NON VÉRIFIÉ** until executed with the required credentials.

## Environment and API

- Local web: `http://localhost:5173`
- Local API: `http://localhost:8787`
- Production web proxies `/api/*`, `/v1/*` and `/health` to the Worker. Without
  `VITE_API_URL`, production now uses the current origin, never `localhost`.
- Auth failure copy no longer prints the internal API address; diagnostics remain
  development-only.
