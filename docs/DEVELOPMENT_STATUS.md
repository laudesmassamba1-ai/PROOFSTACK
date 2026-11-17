# DEVELOPMENT STATUS

Status: functional, tested and visually redesigned. The authenticated workspace now
uses the Ink & Object direction; this file records what is true and what remains open.

## Implemented and checked

- One engine and three modules: WORLD, FLOW, EXIT.
- CLI with init, doctor, validate, test, sync, JSON/JUnit/HTML/text reports and stable
  exit codes.
- SaaS API on Node 22 SQLite and Cloudflare Worker/D1: auth, workspaces, projects, run
  ingestion, reports, API keys, billing, signed webhooks, entitlements and usage.
- Authenticated workspace: paper frame, top navigation, workspace/project selectors,
  command palette, full-screen mobile menu, state-driven Overview, data-bound module
  objects and project/module/CLI screens.
- Empty, loading and 404 states use the inline Testers cast; errors and billing do not.
- Overview, Projects, WORLD/FLOW/EXIT, CLI and the shell have FR/EN copy.
- Bricolage Grotesque, Geist and JetBrains Mono are bundled locally; no runtime UI
  dependency was added.
- Marketing, docs, workspace and admin routes are code-split.

## Design records

- `.agents/skills/proofstack-product-experience/SKILL.md`
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
- `pnpm test`: 221 tests pass.
- `pnpm --filter @proofstack/web build`: passes; route-level chunks replace the previous
  single 554 kB bundle.
- Visual QA: 42 route/viewport combinations from 1920×1080 to 375×812, zero horizontal
  overflow; screenshots generated with no console/page errors.
- `pnpm lint`: the repository still has pre-existing Biome diagnostics. The visual
  redesign did not claim a clean lint.

## Known gaps

- **The creator operations console (`/app/admin`) is still English.** The customer
  workspace — shell, Overview, Projects, modules, CLI, Billing and Settings — is FR/EN.
  The internal console is explicitly outside the language switch.
- No email provider: verification, password reset and invitations are absent, not faked.
- The CLI is distributable as a self-contained global tarball (`pnpm cli:install`), but
  `@proofstack/cli` is not published on the npm registry yet.
- SasPay live path is untested without credentials; sandbox payments are tested.
- Browser journeys for WORLD/FLOW remain HTTP/fixture based; no Playwright customer
  journey driver.
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
