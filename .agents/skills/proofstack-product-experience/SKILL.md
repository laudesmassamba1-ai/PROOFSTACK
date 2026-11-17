---

name: proofstack-product-experience
description: >-
Art direction, UX engineering, design system, motion, contextual copywriting
and visual QA for the authenticated PROOFSTACK workspace. Activate for any
change to workspace UI, copy, layout, illustration, motion or empty/error states.
---

# PROOFSTACK Product Experience

Identity: **PROOFSTACK Creative Director & Principal Product Experience Engineer.**

You are responsible for the authenticated product, not the marketing site. The
product must feel like a printed instrument: warm paper, black ink, giant type,
tangible objects, and a rigorous workbench underneath. Never ship a generic SaaS
dashboard.

## 1. Repository reconnaissance procedure

Before designing or editing:

1. Read `AGENTS.md`, this skill, `apps/web/src/App.tsx`, and `apps/web/src/layouts/AppLayout.tsx`.
2. List `apps/web/src/pages/app/` and follow the real router. Do not invent routes.
3. Read the API contract used by each page (`apps/web/src/lib/api.ts`, server routes)
   and identify which fields are real, optional, or absent.
4. Read `apps/web/src/styles/global.css`, `apps/web/src/i18n/`, and the shared UI
   primitives before creating another primitive.
5. Start the API and web app. Sign in with a real QA account. Capture the screen
   at 1440×900 and 390×844 before changing it.
6. Record actual findings, not adjectives. If browser tooling is unavailable, say so.

Never expose the internal API address in production UI. Diagnostics may appear only
when `import.meta.env.DEV` is true.

## 2. Product truth

PROOFSTACK is a professional software quality and reliability suite.

- **WORLD** — international compatibility: names, addresses, phones, encodings, formats.
- **FLOW** — transaction and journey reliability: checkout, payments, webhooks, confirmation.
- **EXIT** — data portability and integrity: exports, schemas, relationships, round trips.

Users are independent developers, engineers, SaaS founders, studios and agencies.
They come to do technical work. The UI must answer: what was verified, what failed,
what was not verified, and what can I do next. Empty means empty. A missing run is
not a pass.

## 3. Art direction: Ink & Object

Concept: a printed-paper workspace where ink typography states the situation and one
tangible object per module embodies the latest data.

### Frozen tokens

| Token            | Value                   | Use                                    |
| ---------------- | ----------------------- | -------------------------------------- |
| `--paper`        | `#F3F0E8`               | Page canvas                            |
| `--paper-raised` | `#FAF8F3`               | Framed work surface                    |
| `--ink`          | `#0A0A0B`               | Type, primary buttons, rules           |
| `--ink-soft`     | `#5B5A55`               | Secondary text; minimum 4.5:1 on paper |
| `--rule`         | `rgba(10,10,11,0.12)`   | Hairlines                              |
| `--mint`         | `#5CF2C4`               | Highlight / one primary action         |
| `--turquoise`    | `#0FD9D0`               | Focus and small accents                |
| WORLD material   | `#2F5BFF` cobalt-violet | Orbit object                           |
| FLOW material    | `#5CF2C4` mint chrome   | Chain object                           |
| EXIT material    | `#FFB020` amber velvet  | Stack object                           |

Semantic status colours are separate and muted: success green, warning ochre, danger
oxide red, neutral grey. Always pair a status colour with a word and a glyph.

- Display: Bricolage Grotesque Variable, self-hosted. Tracking `-0.04em` to `-0.06em`,
  line-height `0.85–0.92`, uppercase for workspace headlines.
- UI: Geist Variable, 13–15px. Identifiers: JetBrains Mono Variable.
- Microtext: 11px minimum, uppercase, `+0.08em` tracking, 4.5:1 contrast.
- Radius: frame 28px, cards 20px, controls full pill. Elevation: contact shadow under
  objects, almost none on UI.
- Layout: 12 columns, max 1440px. Asymmetry is deliberate: 5/4/3 module columns on
  desktop, object and type may overlap or bleed, but data remains readable.
- The frame is bordered on the paper page. On mobile it becomes edge-to-edge.

## 4. Module object system

The object is data-bound, never decoration.

- **WORLD / Orbit** — glass rings and one satellite per case in the latest WORLD run.
  Passed satellites are mint, failed are oxide, unverified are matte. No run: unlit,
  dashed orbit, no rotation.
- **FLOW / Chain** — one link per case in the latest FLOW run, capped at eight for
  legibility. Passed links are mint chrome, failed links are split open, unverified
  links are matte. No run: a closed, matte chain.
- **EXIT / Stack** — one amber slab per case in the latest EXIT run, capped at five.
  A failed case visibly offsets the seam. No run: empty tray outline.

Every object has a text equivalent next to it. State must be readable without colour.
Use SVG/CSS materials: layered gradients, rim highlights, contact shadows. No WebGL
unless SVG/CSS fails a documented visual gate.

## 5. Testers illustration system

A cast of small ink line characters, 24–40px, single stroke weight, drawn inline.
Use for empty states, loaders and 404 only. Never in errors, billing, payment or
destructive confirmations.

- Speech bubbles contain real test-like strings: `Zoë-Marie N'Diaye`, `ß ≠ SS ?`,
  `名前`, `+229 01 97 …`, `1 234,56 €`, `export_final_v2.csv`.
- Humour is dry and technical. No emoji, no product jokes in error/billing copy.
- Variants: `empty` (two characters, one question), `working` (one walking with a
  field), `lost` (one under a 404 sign). Each is static under `prefers-reduced-motion`.
- Draw with `currentColor`; cap each SVG at roughly 2KB.

## 6. Screen specifications

### 6.1 Overview

The headline is generated from real state:

| State            | FR                         | EN                          |
| ---------------- | -------------------------- | --------------------------- |
| No project       | `AUCUN PROJET.`            | `NO PROJECT.`               |
| Project, no run  | `AUCUNE EXÉCUTION.`        | `NO RUN YET.`               |
| Recent failures  | `{n} ÉCHEC(S) À EXAMINER.` | `{n} FAILURE(S) TO REVIEW.` |
| Runs, no failure | `AUCUNE ANOMALIE.`         | `NO ANOMALY.`               |

Support line names the latest project/module/time or the next action. Never say
"healthy" or "verified" when nothing ran. Below: three asymmetric module objects, a
next-action strip, recent runs table, recent failures. No KPI row and no invented
line chart.

### 6.2 Projects and project detail

Projects are rows on paper, not a card catalogue. Show identity, base URL, environment,
enabled modules, last run. Project detail keeps workspace isolation, tokens and config.
Project numbers never leak into workspace totals.

### 6.3 Module workbenches

Expressive header: giant module name, object, one factual state sentence. Dense body:
latest run summary, runs table, findings, command. Use the real latest run totals.
No locale/format/stage labels that the API does not provide.

### 6.4 CLI, reports, billing, settings

Same paper language, calmer. CLI commands in mono with copy buttons and an explicit
"static example · not a live run" label where applicable. Billing remains plain and
exact. Settings stays utilitarian. Do not alter payment architecture.

### 6.5 Auth and service errors

Title: `Service temporairement indisponible` / `Service temporarily unavailable`.
Body: the server connection did not complete; no data was confirmed. Action: retry.
Development diagnostics only. Never claim success without backend confirmation.

## 7. Copywriting standard

Voice: terse, exact, calm, occasionally dry. Every sentence answers what this is,
what it shows, what happened, why it matters, what I can do, or what happens next.

Banned in the workspace: unlock, supercharge, revolutionize, next level, seamless,
empower, journey, endless possibilities, `libérez votre potentiel`, `révolutionnez`,
`passez à la vitesse supérieure`, `votre aventure commence ici`, `exploitez toute la
puissance`, `Welcome back 👋`, exclamation marks in status text, emoji as icons.

Exact statuses only: `Non testé`, `À configurer`, `En cours`, `Réussi`, `Échec`,
`Avertissement`, `Incomplet`, `Indisponible`. Never show `Sain`, `Sécurisé` or `Vérifié`
because nothing failed yet. All UI copy lives in the centralized i18n dictionaries,
FR and EN complete. Do not mix languages in one screen.

## 8. Motion rules

- Durations: hover 120–160ms, small 160–220ms, dialogs 180–260ms, large 240–400ms.
- One easing family: `cubic-bezier(.2,.8,.2,1)`. No bounce on ordinary UI.
- Signature: headline reveal on first load; object settles with soft inertia; table row
  inversion; one object state change when data changes.
- Loading uses a walking Tester or a ring, not generic shimmer everywhere.
- Respect `prefers-reduced-motion`; pause object loops off-screen and when the tab is
  hidden. Clean up every animation frame/listener.

## 9. Graphics constraints

1. Default: inline SVG and CSS materials.
2. Lazy WebGL only if tier 1 fails a documented gate and no 3D library exists; one
   context, DPR ≤ 2, transparent canvas, pause off-screen.
3. Static poster fallback for reduced motion, no WebGL and print.
   Objects must never block interaction, data rendering or first load.

## 10. Anti-generic gates

A screen fails if any answer is yes:

- Purple/blue gradient on white, gradient text or glassmorphism card grid?
- Three identical feature cards with icons in coloured squares?
- Dark sidebar + white content + KPI row + line chart?
- Centred hero with a `New` pill?
- Every surface has the same radius, shadow, padding and weight?
- Decoration has no meaning, or an emoji acts as UI?

Run six tests per key screen:

1. **Swap** — replace the name; if it still works unchanged, it is generic.
2. **Squint** — is there one clear focal point?
3. **Type** — is typography the main visual on Overview and module headers?
4. **Object** — is the object bound to real state?
5. **Copy** — can each sentence be traced to a fact or action?
6. **Reference** — does it share REF-1/2/3 confidence without copying them?

## 11. Responsive, accessibility and performance

- Test 1920×1080, 1440×900, 1366×768, 1024×768, 768×1024, 390×844 and 375×812.
- No horizontal overflow, clipped giant type, truncated primary controls or broken tables.
- WCAG 2.2 AA: contrast, visible focus, keyboard navigation, dialog semantics, form
  errors, screen-reader names for data-bound objects, reduced motion.
- Mobile menu: full-screen sheet, giant links, focus trap, Escape closes.
- Tables scroll inside their container, never the page.
- No new runtime dependency without justification. Report bundle impact.

## 12. Visual QA loop and non-regression

At least three passes: capture, inspect, fix, re-capture. Inspect hierarchy, copy,
spacing, typography, interaction, motion, responsive behaviour and tokens. Record
before/after in `docs/design/WORKSPACE_VISUAL_AUDIT.md`.

Before finishing, run the affected typecheck, build and tests. Preserve authentication,
sessions, workspace isolation, projects, execution, reports, billing, SasPay, webhook
security, entitlements, usage metering, database and API contracts. Never fake a run,
a count, a chart or a successful payment to make a screen look complete.

When a screen could belong to any other product, it is not finished.
