# PROOFCORE refactor — state of the work

This file is the single status page for the refactor. A feature is only listed as
**available** when a reproducible check exercises it. Anything that depends on a secret or
an external account says so.

Last verification: see the `Tests` section at the bottom, filled from the commands actually
run on this checkout.

## Identity

- Public name in the web UI: **PROOFCORE**.
- Technical identifiers (`proofcore`, `@proofcore/*`, `proofcore.*` storage keys, package
  `proofcore`, D1 database `proofcore`) are kept for compatibility. They are not shown as
  the product name.
- The CLI binary is still named `proofcore`; renaming a published binary is a breaking
  change and needs a versioned alias, not a silent rename.
- No legal/trademark clearance has been performed. Before commercial publication, check
  name collisions in the target jurisdictions; this document makes no legal claim.

## Phase 1 — Stabilisation

| Item                                      | State            | Evidence                                                                                                                                                                          |
| ----------------------------------------- | ---------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| CI uses the repository's pnpm version     | Available        | `.github/workflows/ci.yml` no longer pins pnpm 10; `pnpm/action-setup@v4` reads `packageManager` (`pnpm@12.15.0`).                                                                |
| Typecheck from a clean clone              | Available        | `pnpm typecheck` now builds internal packages first, because each package resolves `@proofcore/*` through `dist/*.d.ts`. Verified with every `dist/` removed.                     |
| Download page reads releases from our API | Available        | `GET /api/v1/releases/latest` (`apps/api/src/routes/releases.ts`), cached 5 min, public; `Download.tsx` no longer calls `api.github.com`. Digest shown when GitHub publishes one. |
| README test count / SDK promise           | Fixed            | Test count removed (it drifted); the package table no longer calls the CLI an SDK.                                                                                                |
| MCP documentation contradiction           | Fixed            | The hosted API is not an MCP server; the CLI has an optional local stdio server (`proofcore mcp`). Documented in `Docs/guides/AI_INTEGRATION.md`.                                 |
| Published CLI matches source              | **Not verified** | Requires `pnpm cli:package`, install in a clean directory and a smoke run of the documented commands. Not performed here.                                                         |

## Phase 2 — Experience architecture

| Item                                                              | State     | Evidence                                                                                                                                                                                                                                                                                                                                            |
| ----------------------------------------------------------------- | --------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Simple mode by default                                            | Available | `AppLayout` defaults to simple: Overview, Projects, Start; expert navigation appears in Studio. Stored per browser (`proofcore.ui-mode.v1`); no data or account change.                                                                                                                                                                             |
| Studio mode                                                       | Available | Toggle in the workspace header; restores Workspace, Modules, CLI, AI and the command palette entries.                                                                                                                                                                                                                                               |
| Beginner first screen                                             | Available | When the workspace has no project, Overview asks “Que souhaitez-vous faire aujourd'hui ?” with four real doors; “Analyser mon site” is primary and opens `/app/start`.                                                                                                                                                                              |
| One-address analysis                                              | Available | `/app/start`: one field, real scan, counts, three costliest findings, deterministic summary; AI reading optional and never required.                                                                                                                                                                                                                |
| Reports readable without an AI key                                | Available | The scan page and `/app/start` show verdicts, counts and plain findings without any provider; the AI section explains what is missing instead of blocking the report.                                                                                                                                                                               |
| URL validation and scan limits explained                          | Partial   | The API refuses non-http(s), private and internal hosts (`assertScannableUrl`) with a message; the start page validates the scheme before calling. Per-site allowed-target policy is the existing SSRF guard, not a per-customer allow-list.                                                                                                        |
| Real progress steps (server phases)                               | Available | `POST /api/v1/audits/stream` emits `request`, `fetch`, `verdict` and `save` after each phase has actually started or finished, with its real duration/HTTP result. `/app/scan` renders those events; no timer advances the list.                                                                                                                    |
| Correction tracking (à traiter / en cours / corrigé / à vérifier) | Available | `audit_finding_states` (migration 0017) keyed by `module:id`; `GET/PATCH /api/v1/projects/:id/corrections`; the board merges the latest scan with tracked findings that disappeared, and compares it to the previous scan (resolved / still present / new). A tracked finding that disappears becomes “à vérifier” — never automatically “corrigé”. |
| History filters                                                   | Partial   | `/app/scan` lists scans and the project page shows its own; no cross-project date/site filter yet.                                                                                                                                                                                                                                                  |

## Phase 3 — Modules without code

| Item                                                           | State                                         | Evidence                                                                                                                                                                                                                                               |
| -------------------------------------------------------------- | --------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Shared configuration UI for WORLD/FLOW/EXIT                    | Available for every field the engine executes | `/app/projects/:id/config` plus `GET`/`PUT /api/v1/projects/:id/config`; FLOW journeys and their steps are editable and saved with the project.                                                                                                        |
| FLOW scenario builder                                          | **Available (local runs)**                    | `/app/projects/:id/config` composes journeys; `proofcore test --module flow` executes them in the local browser. A server-side audit skips them with a reason, because it has no browser.                                                              |
| FAIL/CLEAN results explained                                   | Partial                                       | Findings carry `id`, `observed`, `why`; the scan page groups them and writes a plain summary. Per-finding fix instructions and documentation links are not generated.                                                                                  |
| Distinct PASS / FAIL / SKIP / BLOCKED / NOT CONFIGURED / ERROR | Available for the pre-check                   | `GET /projects/:id/config` returns `precheck: NOT_CONFIGURED \| BLOCKED \| READY`; the project page shows a distinct banner for an unconfigured project and for a saved-but-refused configuration. Module verdicts remain PASS/WARN/FAIL/not measured. |

## Phase 4 — Advanced surfaces

| Item                             | State                                                                                  |
| -------------------------------- | -------------------------------------------------------------------------------------- |
| AI agent and integrated terminal | Available with configuration (provider key or local agent); not reworked in this pass. |
| Interactive CLI / command groups | Available                                                                              | `proofcore` with no command still opens the hub; help is grouped (Start here, Modules and scans, Account and cloud, Ad-hoc scans, Local tools and agent, Integrations); `init` asks modules and targets; `--login-password` is refused (env or hidden prompt); `config pull` downloads the saved JSON. |
| Desktop parity                   | Not re-verified in this pass; it loads the same web Studio build and the same API.     |
| MCP                              | Local stdio server exists in the CLI; no protocol tests added here.                    |

## Phase 5 — Production

| Item               | State                                                                                                                                                                                                                                                                   |
| ------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| E-mail (Resend)    | Implemented with `RESEND_API_KEY` / `MAIL_FROM`; delivery not tested here (no key).                                                                                                                                                                                     |
| Support workflow   | Available on the customer side                                                                                                                                                                                                                                          | A message keeps its reference; `GET /account/support/:reference?email=` returns status and reply only when the address matches. The admin console lists the queue and stores a reply; e-mail delivery itself is still untested without a provider key. |
| Payments           | Sandbox implemented; production requires SasPay credentials and IP allow-listing. No real payment was validated.                                                                                                                                                        |
| Legal pages        | Templates still contain product copy; legal identity, address and jurisdiction are **not** invented. Required before publication: legal entity, registered address, jurisdiction, contact e-mail, VAT/registration numbers, data-retention periods, subprocessors list. |
| Repository hygiene | `.perch/mcp.json` and generated indexes were already removed/ignored earlier; `ref_visuelles/` remains as design references and is committed intentionally.                                                                                                             |

## Phase 6 — Validation

Run on 2026-11-21, from this checkout:

- `npx biome check .` — 0 error, 394 files checked.
- `pnpm typecheck` — passed after deleting every `dist/` and every `*.tsbuildinfo`, which
  proves the typecheck no longer depends on a previous build.
- `pnpm test` — 51 files, 643 tests passed (including four release-proxy tests and one
  integration test proving the release endpoint is reachable without a session).
- `pnpm --filter @proofcore/web build` — passed.
- Browser (Chrome, 1440×950): new account lands on the four-choice first screen; Simple
  navigation is Overview/Projects/Start; Studio toggle reveals Workspace/Modules/CLI/AI
  and survives a reload; `/app/start` still scans `https://example.com`, shows verdicts and
  the no-AI-key message without leaving the page; `/download` makes **zero** requests to
  `api.github.com`.

Not run here: desktop installers, npm publish, real e-mail delivery, live payment.

## Known blockers that require a human decision or a secret

1. Module configuration UI: needs an agreed persisted schema per project (the engine schema
   is the source of truth) before a form can be built. Do not fake it with local storage.
2. E-mail delivery: `RESEND_API_KEY` and a verified `MAIL_FROM` domain.
3. Real payments: SasPay live keys plus the server IP allow-list.
4. Legal pages: legal entity and address.
5. npm publication / package ownership: `npm whoami`, then `pnpm cli:publish` with the
   owner's explicit approval.

## Update — 2026-11-21, release feed hardening

The public release endpoint is now deterministic on a cold Worker. It still prefers the
live GitHub call (with an optional server-side `GITHUB_TOKEN`), then a per-isolate cached
answer, then the deploy-time snapshot in `apps/api/src/release-manifest.ts`, marked
`x-release-cache: manifest`. `pnpm cloud:deploy` refreshes that snapshot from GitHub; a
failed refresh keeps the previous real release rather than inventing one. The page now
says “versions momentanément indisponibles” during an outage instead of “aucune version
publiée”.

Verified after deployment: `GET /api/v1/releases/latest` answers 200 without a session on
both hosts (see the deployment section of the final report).

## Update — 2026-11-21, module configuration without code

WORLD, FLOW and EXIT now have a configuration that is edited in the web, validated with
the same schema as the CLI, and persisted per project:

- `projects.module_config` (migration `0016_project_module_config.sql`), exposed by
  `GET`/`PUT /api/v1/projects/:id/config`. The GET returns a complete `ProofCoreConfig`
  built from the project's own fields plus the saved module subtree.
- A save that would let a real charge or an unacknowledged production export run is
  refused with `422 config_unsafe`, carrying the exact issue paths. Ordinary advice (for
  example “WORLD has no target yet”) is returned with the saved configuration instead of
  being hidden.
- The editor at `/app/projects/:id/config` only offers fields the engine reads: WORLD
  profiles/categories/HTTP target/token variable, FLOW payment mode/scenarios/base and
  webhook URLs, EXIT formats/data type/export source/max records/round-trip. It shows the
  validation warnings, saves, and downloads `proofcore.config.json` — no TypeScript file.
- CORS now allows `PUT`; without it every save was blocked by the browser as a fake
  “API unreachable” error.

**Explicit limits.** FLOW step-by-step `journeys` are composed in the editor and executed
by the local CLI browser; the server-side audit cannot run a browser and reports them as
skipped. There is no `proofcore config pull` command yet: the user downloads the JSON and
places it at the repository root, then runs `proofcore test`. The editor does not store
secrets; tokens stay in environment variables.

Verified in Chrome: project page → “Configurer sans code” → change profiles and WORLD
submit URL → save → reload → values persist → download contains the same values; server
`GET` reports `source: "saved"` and zero issues. API suite covers default config, save/read
round trip, live-charge refusal, malformed URL, unknown project and the CORS preflight.

## Update — 2026-11-21, corrections, real phases and support

- **Corrections**: four workflow states per finding (`todo`, `in_progress`, `fixed`,
  `verify`), stored by `module:id` in `audit_finding_states` (migration 0017). The board
  shows the latest scan plus tracked findings that disappeared since the previous one, and
  the comparison counts resolved / persisting / new. A tracked finding that disappears is
  moved to `verify`, never declared fixed by the tool.
- **Real scan phases**: `POST /api/v1/audits/stream` is an SSE route. It emits each phase
  only when that phase is actually running or done, with the real HTTP result, byte count,
  duration, verdict counts and comparison. `/app/scan` renders the server's events; the
  regular POST stays for scripts and tests.
- **Pre-check**: the project page distinguishes `NOT_CONFIGURED` (nothing saved yet) from
  `BLOCKED` (saved but refused by the engine). `config pull` prints the same state.
- **CLI**: grouped help, guided `init`, `config pull`, and no password in argv — the value
  comes from `PROOFCORE_LOGIN_PASSWORD` or a hidden prompt, and `--login-password` is
  refused with that instruction.
- **Support**: reference + writing address reveals status and reply; the operator console
  lists messages and stores the answer. E-mail delivery remains dependent on
  `RESEND_API_KEY` and was not tested here.
- **Identity**: the product is called **PROOFCORE** everywhere in the web UI again. The
  GitHub repository slug and the existing deployment hostnames keep their historical
  `PROOFSTACK` spelling: renaming those would break releases, links and CORS.
