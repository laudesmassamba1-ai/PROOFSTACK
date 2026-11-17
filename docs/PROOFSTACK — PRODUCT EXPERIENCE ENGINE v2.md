# PROOFSTACK — PRODUCT EXPERIENCE ENGINE v2

## Direction artistique « Ink & Object » : typographie géante, objets tangibles, personnalité

Script à coller dans l'agent de code. Rédigé en anglais pour l'agent ; les textes d'interface restent en français / anglais selon la règle i18n.

---

# 00 — MISSION AND OPERATING MODE

Transform the **authenticated PROOFSTACK workspace** (the route after login, typically `/app` — follow the real router) into a distinctive, art-directed product that nobody would mistake for a template.

Two mandatory stages:

- **STAGE A — Create a project-specific skill** (`.agents/skills/proofstack-product-experience/SKILL.md`, or the project's existing skill convention).
- **STAGE B — Load it, then execute it** on the real codebase: audit, redesign, implement, screenshot, critique, iterate.

Do not stop after writing documentation. The result must be visible in the running application.

**Honesty rule:** never claim you captured a screenshot, ran a test or verified a screen unless you actually did. If a tool is missing (browser, screenshot), say so and state the limitation.

---

# 01 — REFERENCE DECODING (read before anything else)

Three visual references define the target energy. If the images are attached, study them. If not, this textual decoding is authoritative. Do not copy any of them literally — extract the _principles_.

**REF-1 — « Limitless Design Solutions »**

- Warm off-white page, pure black ink.
- Enormous, ultra-tight, uppercase grotesque headline (line-height ≈ 0.85, negative tracking) that dominates the viewport.
- One tangible hero object: an iridescent, chrome, interlaced ring form (atom-like), with real light, rim, reflection.
- Small stats with `*` / `+` markers and tiny caps captions. Tiny nav text. Rounded cards peeking at the bottom edge.

**REF-2 — « Puffed-up abstract 3D illustrations »**

- Inflated, soft objects: yellow ribbed torus, purple velvet loop, silver foil flower, glass spheres.
- Objects are **cropped by the viewport edges** and **overlap the headline**. Centered type, pill buttons with hairline outlines.
- Materials are the personality: velvet, foil, glass, rubber.

**REF-3 — « Look Out Below »**

- Cream canvas inside a **rounded frame** with a visible border and margin.
- Chunky display lettering with a joke built into it (eyes inside the O's).
- Dozens of tiny ink characters with speech bubbles: humour, scale, life.
- Pill buttons: one filled black, one outlined.

**What the three share (this is the design DNA):**

1. Typography is the main visual, not a label.
2. One tangible, well-lit object per screen instead of a grid of icons.
3. Warm paper + ink, with colour used as material, not as decoration.
4. Objects and type overlap and bleed off the edges — composition is deliberate and asymmetric.
5. Microtext is tiny, uppercase, tracked-out. Buttons are pills.
6. A sense of humour and a point of view.

**What to escape:** the dark-sidebar + white-content + stat-cards + line-chart admin template. It is explicitly forbidden as a starting structure. The Overview must not look like a dashboard kit.

Create `docs/design/REFERENCE_DECODING.md` summarizing this section in your own words, adding concrete measurements you derive (type scale, ratios, margins).

---

# 02 — STAGE A: CREATE THE SKILL

## 2.1 Discover first

- List installed agent skills; read `AGENTS.md` and any project `SKILL.md`.
- Inspect the supported skill format and where skills live.
- Discover what you can really use: browser automation, screenshots, visual analysis, terminal, subagents.
- Do not invent capabilities.

## 2.2 Create the skill

Path: `.agents/skills/proofstack-product-experience/SKILL.md` (or the existing convention).

```yaml
name: proofstack-product-experience
description: >
  Art direction, UX engineering, design system, motion, contextual copywriting
  and visual QA for the authenticated PROOFSTACK workspace. Activate for any
  change to workspace UI, copy, layout, illustration, motion or empty/error states.
```

Identity: **PROOFSTACK Creative Director & Principal Product Experience Engineer.**

The skill must contain, concretely (values, not adjectives):

1. Repository reconnaissance procedure.
2. Product truth (section 03).
3. The Ink & Object art direction (section 04) with real tokens.
4. The module object system (section 05).
5. The Testers illustration system (section 06).
6. Screen-by-screen specs (section 07).
7. Copywriting standard and banned phrases (section 08).
8. Motion rules (section 09).
9. 3D/graphics implementation constraints (section 10).
10. The anti-generic gates (section 11).
11. Responsive, accessibility and performance gates.
12. Visual QA loop (section 13) and non-regression rules.

Also create: `docs/design/PRODUCT_EXPERIENCE.md`, `COPYWRITING_GUIDELINES.md`, `MOTION_GUIDELINES.md`, `WORKSPACE_ARCHITECTURE.md`, `WORKSPACE_VISUAL_AUDIT.md`, `REFERENCE_DECODING.md`, `DESIGN_TOKENS.md`.

## 2.3 Execute it

Read the whole `SKILL.md`, activate it through the supported mechanism (or load it as active instructions), turn it into a checklist, and re-read the relevant section before each major design decision.

---

# 03 — PRODUCT TRUTH

PROOFSTACK is a professional software quality and reliability suite:

- **WORLD** — international compatibility (names, addresses, phone numbers, encodings, formats).
- **FLOW** — reliability of transaction and user journeys (checkout, payment, webhooks, confirmation).
- **EXIT** — data portability and integrity (exports, schemas, round-trips).

Users: independent developers, engineers, SaaS founders, studios, agencies. They come to do technical work.

Before designing, inspect: routes, authenticated layout, navigation, workspace switching, projects, API calls and real responses, WORLD/FLOW/EXIT, reports, billing, settings, components, styles, translations, loading and error handling. Follow the real router. **Never design features that do not exist. Never display routes that do not exist.**

---

# 04 — ART DIRECTION: « INK & OBJECT »

## 4.1 Concept

A printed-paper workspace where **ink typography** states the situation and **one tangible object per module** embodies the data. Calm, warm, confident, a little playful. Not dark-mode neon, not white-admin-grey.

## 4.2 Tokens (starting values — refine visually, then freeze in `DESIGN_TOKENS.md`)

- `--paper: #F3F0E8` (page), `--paper-raised: #FAF8F3` (frame), `--ink: #0A0A0B`, `--ink-soft: #5B5A55`, `--rule: #0A0A0B1F` (hairlines).
- Brand: `--mint: #5CF2C4`, `--turquoise: #0FD9D0` — highlights and the single most important action only.
- Module materials: WORLD = cobalt-to-violet iridescence (`#2F5BFF`); FLOW = mint chrome (`#5CF2C4`); EXIT = amber velvet (`#FFB020`).
- Status colours are a separate muted semantic set, never the module colours, and are **always paired with a text label and a glyph** (never colour alone).
- Optional inverse theme: ink background, paper text, same objects. Secondary priority.
- Radius: frame 28px, cards 20px, controls full pill. Elevation: soft contact shadows under objects, almost none on UI.

## 4.2b Typography

- Display: a variable grotesque with character, self-hosted, open licence (e.g. Bricolage Grotesque or Inter Tight 700–800). Subset Latin + Latin-Extended (French accents mandatory).
- UI: a neutral sans at 14–15px. Identifiers, commands, hashes: a monospace.
- Display rules: tracking −0.04em, line-height 0.85–0.92, uppercase on hero titles, `clamp()` sizes (≈ 3.5rem → 9rem). Giant type only on Overview, module headers and key numerals; dense areas use UI size.
- Microtext: 11px minimum, uppercase, +0.08em tracking, contrast ≥ 4.5:1.

## 4.3 Layout

- The workspace lives inside a **rounded, bordered frame** on the paper page (REF-3), with generous outer margin on desktop and edge-to-edge on mobile.
- Navigation: a slim top bar — circular brand symbol, tiny uppercase links, workspace/project selector as a pill, command palette (⌘K / Ctrl K), account button as a black circle. Group engines (WORLD / FLOW / EXIT) in one control. Final items come from the real routes.
- Mobile menu: full-screen sheet with **giant display links**, focus trap, Escape to close.
- Structure with hairline rules, whitespace and scale contrast instead of boxing everything in cards. Cards only for genuinely separate objects (a run, a scenario).
- Deliberate asymmetry: a 12-column grid, but headline and object may span unevenly, overlap and bleed off the frame edge. Maximum comfortable content width ≈ 1440px.

## 4.4 Components with a point of view

- Primary button: ink pill, paper text. Secondary: 1px ink outline pill. Mint pill: at most one per screen.
- Tables: hairline rows, mono identifiers, status as `glyph + word`. **Row hover inverts** (ink background, paper text) — the signature table interaction. No zebra stripes.
- Key numerals: 96–200px display numerals with a `*` or `+` marker and a tiny caps caption (REF-1 stats). Shown only with real values; with no data show `—` plus the true state (`Non testé`).
- Dialogs: framed paper sheets with a pill close control; same radius language.

---

# 05 — THE MODULE OBJECT SYSTEM (the signature)

Each module has one hero object. **The object is data-bound, not decorative**, which is what makes it original.

**WORLD — the Orbit** Iridescent glass rings around a sphere (REF-1 energy). Each orbiting satellite = one active locale profile. Rings rotate slowly. No profile configured → matte, unlit, still.

**FLOW — the Chain** A puffed chrome-mint chain of linked loops (REF-2 energy) that traces the transaction path. One link per real stage of the last run (cart → payment → webhook → confirmation …). Passed stages are lit, the failed stage is broken or visibly open, untested stages are matte grey.

**EXIT — the Stack** Inflated amber velvet slabs (REF-2) = datasets. After a round-trip comparison, any mismatch shows as a visible seam or misalignment between slabs. No dataset → empty tray outline.

Rules:

- Same design language (lighting, softness, rim light) so they read as a family, but distinct silhouettes and colours.
- Objects overlap and bleed off the module header, with a headline set partly in front of them.
- State is always readable in text too (`3 profils actifs`, `Échec à l'étape webhook`); the object reinforces, never replaces it.
- Brand particles (the geometric P) are reserved for: first-ever workspace intro, module transitions, empty-workspace illustration, a first-success milestone. Never a permanent background.

---

# 06 — THE TESTERS (illustration and humour)

Inspired by REF-3: a cast of tiny ink characters (24–40px, single-weight line, \~8 poses) who carry test objects — a form field, a card, a file, a magnifier — and speak in speech bubbles.

- Used for: empty states, loaders, the 404, the empty report list, the first project.
- Bubbles contain **real, test-like strings**, not jokes about the product: `Zoë-Marie N'Diaye`, `ß ≠ SS ?`, `名前`, `+229 01 97 …`, `Total: 1 234,56 €`, `export_final_v2.csv`.
- Humour is dry and technical. **Never** in errors, billing, payment or destructive confirmations.
- Characters may animate lightly (idle sway, walking across an empty table). Reduced motion → static.
- Draw them as inline SVG components with a shared stroke style. Keep each under \~2KB.

---

# 07 — SCREEN SPECS

## 7.1 Overview — « the situation, stated in giant type »

The giant headline is **generated from the real state**, not a slogan:

| Real state         | Headline (FR)              | Support line                                                                  |
| ------------------ | -------------------------- | ----------------------------------------------------------------------------- |
| No project         | `AUCUN PROJET.`            | Créez un projet pour configurer vos premières vérifications.                  |
| Project, no run    | `AUCUNE EXÉCUTION.`        | Lancez `proofstack test` depuis votre projet. Les résultats apparaîtront ici. |
| Runs with failures | `{n} ÉCHEC(S) À EXAMINER.` | Dernière exécution : {project}, {module}, {time}.                             |
| Runs, no failure   | `AUCUNE ANOMALIE.`         | Sur les {n} dernières exécutions. _(only if real runs support it)_            |

Below the headline: the three module objects with real state and one action each; a recent-runs table (project, module, run, status, duration, time, report link); a next-action strip that adapts (new user: create project → install CLI → configure module → first run; established user: open failure → re-run → open report). No setup steps after setup is done.

Empty workspace and populated workspace must both look intentional — design the empty one first, with the Testers.

## 7.2 Project workspace

Each project is its own environment: identity, base URL, environment, version/commit if available, enabled modules, last run, current findings, project activity, CLI setup, environment config. Project-level navigation. **Never mix workspace-level numbers into a project view.**

## 7.3 Module workbenches

- **WORLD:** locale profiles, test configuration, field validation, input diagnostics, results, failure reproduction, history. Globe/orbit visual only where it carries meaning.
- **FLOW:** scenarios, checkout stages, payment sandbox state, webhook history, confirmation, errors, reproduction. Timelines show real sequence.
- **EXIT:** datasets, formats, schema analysis, relationship validation, file integrity, round-trip comparison, with technical diff visualisations.

Each workbench opens with its object and giant title, then becomes dense and precise below the fold. Density contrast is intentional: expressive header, rigorous body.

## 7.4 Reports, Billing, Settings, Integrations, CLI

Same language, calmer. Reports: readable, shareable, expandable findings. Billing: plain, exact, no pressure copy; **do not alter the real payment architecture**. CLI: command blocks with copy buttons in mono.

## 7.5 Auth and service errors

The previous registration screenshot shows an unreachable `localhost:8787`. Investigate `VITE_API_URL`, production env vars, the Cloudflare Worker URL, CORS and the health endpoint. Never expose internal addresses to users. If the API is unavailable:

- Title: `Service temporairement indisponible`
- Text: `La connexion au serveur n'a pas abouti. Vos données n'ont pas été confirmées.`
- Action: `Réessayer`
- Diagnostics only in development. Never claim success without backend confirmation.

---

# 08 — COPYWRITING STANDARD

Voice: terse, exact, calm, occasionally dry. Every sentence answers one of: what is this / what does it show / what happened / why it matters / what can I do / what happens next.

**Banned inside the workspace:** unlock, supercharge, revolutionize, next level, seamless, empower, journey, endless possibilities, « libérez votre potentiel », « révolutionnez », « passez à la vitesse supérieure », « votre aventure commence ici », « exploitez toute la puissance », « Welcome back 👋 », exclamation marks in status text, emoji as icons.

**Exact statuses only:** Non testé · À configurer · En cours · Réussi · Échec · Avertissement · Incomplet · Indisponible. Never show « Sain », « Sécurisé » or « Vérifié » because nothing failed yet.

**No invented data:** no fake volumes, rates, coverage, activity or charts. Missing data → true empty state. Dev sample data must be visibly labelled and isolated from production.

Examples to adapt (not to copy blindly):

- No projects → `Aucun projet pour le moment` / `Créez un projet pour configurer vos premières vérifications.` / `Créer un projet` + `Installer la CLI`.
- WORLD unconfigured → `Profils non configurés` / `Sélectionnez les environnements et formats internationaux à vérifier.`
- FLOW unconfigured → `Aucun parcours configuré` / `Définissez un scénario pour tester votre parcours de commande ou de paiement.`
- EXIT unconfigured → `Aucun export à vérifier` / `Ajoutez un jeu de données synthétique pour tester l'intégrité de vos exports.`

One centralized i18n system, FR and EN fully covered, never mixed in one screen. Commands and identifiers keep their original form. Document everything in `COPYWRITING_GUIDELINES.md` (terminology, buttons, errors, loading, success, warnings, billing).

---

# 09 — MOTION

Motion explains state; it is never ambient noise.

- Durations: hover 120–160ms, small transitions 160–220ms, dialogs 180–260ms, large transitions 240–400ms. One easing family (e.g. `cubic-bezier(.2,.8,.2,1)`). No bounce on ordinary UI.
- Signature moves: giant headline reveals line by line on first load only; objects settle in with soft inertia; table row inversion; module object state changes animate once when data changes (a link lights up, a ring joins the orbit).
- Loading: the Testers walk, a ring spins — not generic spinners or skeleton shimmer everywhere.
- Everything respects `prefers-reduced-motion` (static equivalents, no information lost). Clean up every animation loop; pause when off-screen or tab hidden (IntersectionObserver, Page Visibility).
- Prefer CSS and lightweight JS; reuse the existing animation library if one exists; no new dependency without justification.

---

# 10 — 3D AND GRAPHICS IMPLEMENTATION

Objects must look **tangible** (highlight, rim light, contact shadow, material). Choose the lightest tier that passes the visual gate:

1. **SVG/CSS materials** (default): layered gradients, conic-gradient iridescence, blend modes, inline SVG. Zero dependency.
2. **Lazy WebGL** only if tier 1 fails the visual gate and no 3D library exists: route-level code split, loaded only on screens showing an object, maximum one WebGL context at a time, transparent canvas, device-pixel-ratio capped at 2, pause off-screen.
3. **Static poster fallback** (SVG/WebP) for no-WebGL, reduced motion, low-power devices and print.

Budget: no regression of first load on `/app`; report bundle size before/after. Objects must never block interaction or data rendering.

---

# 11 — ANTI-GENERIC GATES (a screen fails if any answer is « yes »)

**Visual tells:**

- Purple/blue gradient on white, gradient text, glassmorphism card grid?
- Three identical feature cards with an icon in a coloured rounded square?
- Dark sidebar + white content + KPI row + line chart?
- Centered hero with a « New » pill badge?
- Everything has the same radius, shadow, padding and weight?
- Icon-only decoration with no meaning? Emoji as UI?

**Tests to run on every key screen:**

- **Swap test:** replace PROOFSTACK with another product name — does the screen still work as-is? If yes, it is too generic.
- **Squint test:** blur the screenshot — is there one clear focal point (headline or object)?
- **Type test:** is typography clearly the main visual on Overview and module headers?
- **Object test:** is the module object bound to real state?
- **Copy test:** can every sentence be traced to a real fact or action?
- **Reference test:** side by side with REF-1/2/3 — does it share their confidence without copying any of them?

---

# 12 — FUNCTIONAL INTEGRITY

Every displayed action maps to a real capability. Never replace API data with hardcoded arrays; never simulate success in production. Preserve: authentication, sessions, workspace isolation, projects, test execution, reports, module configuration, billing, SasPay, sandbox payments, webhook security, subscription state machines, entitlements, usage metering, database, API contracts, CLI and SDK. Do not rewrite the app or change frameworks for visual reasons; redesign progressively with reusable components. Run existing tests before and after significant changes.

---

# 13 — VISUAL QA LOOP (mandatory, at least 3 passes)

Run the app. Capture real screenshots and inspect them. Screens: first authenticated visit, empty workspace, workspace with projects, project overview, WORLD, FLOW, EXIT, reports, billing, settings, mobile navigation.

Viewports: 1920×1080, 1440×900, 1366×768, 1024×768, 768×1024, 390×844, 375×812.

Per screen, per pass: hierarchy, copy, spacing, alignment, typography (including giant type wrapping and accents), interaction, motion, responsive behaviour, tokens. Fix, re-capture, compare. Pass 2 and 3 must explicitly run the section 11 tests.

Fix: horizontal overflow, overlapping controls, truncated labels, broken tables, clipped giant type, mobile navigation issues.

Accessibility target: WCAG 2.2 AA — contrast (including microtext over objects), visible focus, keyboard navigation, dialog semantics, form errors, screen-reader names for data-bound objects (text equivalent), reduced motion.

Record before/after in `docs/design/WORKSPACE_VISUAL_AUDIT.md`.

---

# 14 — EXECUTION PLAN

1. **Skill:** create, read, activate, checklist.
2. **Audit:** read routes and real API data, run the app, capture « before » screenshots, document problems.
3. **System:** tokens, fonts, frame, top navigation, buttons, tables, dialogs, empty states, Testers, motion primitives.
4. **Overview:** empty state first, then populated; state-driven headline; module objects.
5. **Project and module workbenches.**
6. **Billing, settings, account, auth and service-error states** without touching payment architecture.
7. **Copy and i18n:** rewrite, centralize, verify FR/EN completeness.
8. **Motion and performance pass.**
9. **Browser audit, section 11 tests, regression tests, fixes.**

---

# 15 — ACCEPTANCE CRITERIA

- [ ] Skill created, read and followed; reference decoding and tokens documented.
- [ ] Authenticated workspace redesigned in the Ink & Object language, not a dashboard template.
- [ ] Giant, state-driven typography is the main visual on Overview and module headers.
- [ ] WORLD, FLOW and EXIT each have a data-bound hero object, distinct but coherent.
- [ ] Testers illustrations used in empty, loading and 404 states, never in errors or billing.
- [ ] Project workspace is isolated and clear.
- [ ] All copy reviewed; banned phrases absent; statuses exact; no fake data.
- [ ] Motion purposeful, reduced-motion supported, no leaks.
- [ ] Responsive at all listed viewports; WCAG 2.2 AA reviewed.
- [ ] `localhost:8787` issue investigated; service-error state implemented.
- [ ] Billing, payments and all backend features verified intact; existing tests pass.
- [ ] Real screenshots inspected; the six tests of section 11 passed and documented.

---

# FINAL DIRECTIVE

Do not build another SaaS dashboard. Build a place with a point of view: giant ink typography that states the truth about the user's software, tangible objects that change when the data changes, small characters carrying real test strings, and a rigorous workbench underneath.

If a screen could belong to any other product, it is not finished.

Create the skill. Follow it. Transform the real application. Do not stop at documentation.
