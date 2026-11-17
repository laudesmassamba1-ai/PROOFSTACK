# Workspace visual audit

Audit of the authenticated PROOFSTACK workspace after the Ink & Object redesign.
Screenshots are in `docs/design/screenshots/`.

## Before

The shell was a conventional SaaS dashboard: permanent dark sidebar, white content,
four KPI cards and a bar chart. The brand particle system was a separate marketing
surface. Mobile reduced the same structure rather than composing for the screen. The
workspace did not share the reference DNA of paper, giant type, one tangible object and
small ink characters.

## After — pass 1

First captured screens:

- `dashboard.png` — paper frame, top navigation, state headline, three module objects; final capture reads “P ROOFSTACK” as one wordmark.
- `dashboard-mobile.png` — same content at 390×844.
- `module-world.png` — WORLD workbench with orbit object and evidence table.
- `command-palette.png` — `Ctrl/Cmd+K` palette.
- `cli-onboarding.png` — CLI setup.
- `projects.png`, `billing.png`, `settings.png`, `project-detail.png`.

Findings from pass 1 and fixes:

| Finding | Decision |
| --- | --- |
| Headline wrapped “À” alone at 390px | Reduced mobile display scale and removed the narrow max-width; now breaks as “2 ÉCHEC(S)” / “À EXAMINER.” |
| Command palette opened at the top-left | Native dialog reset the UA margin; added `position: fixed; inset: 0; margin: auto` and a max-height. |
| Status words stayed English in a French shell | `StatusBadge` now reads the centralized workspace dictionary; `FAILED` → `Échec`, `PARTIAL` → `Partiel`. |
| Relative dates stayed English | `format.ts` follows the selected locale via `Intl.RelativeTimeFormat`; “9 min ago” → “il y a 9 minutes”. |
| Lockup read “PPROOFSTACK” | The text beside the P mark is now “ROOFSTACK”; `Wordmark` and the animated hero follow the same rule. The logo itself was not changed. |
| The old KPI row and line chart remained | Removed from Overview. Module totals are read from the latest run; no trend is inferred. |

## After — pass 2 and 3

Re-captured after each fix. No console or page errors were emitted by the capture
script. The final browser checks covered:

| Viewport | Routes checked | Horizontal overflow |
| --- | --- | --- |
| 1920×1080 | Overview, Projects, WORLD, CLI, Billing, Settings | 0 |
| 1440×900 | same | 0 |
| 1366×768 | same | 0 |
| 1024×768 | same | 0 |
| 768×1024 | same | 0 |
| 390×844 | same | 0 |
| 375×812 | same | 0 |

The matrix is 42 route/viewport combinations. Each result was checked for
`document.scrollWidth - innerWidth` and that the display headline’s right edge did not
cross the viewport. `FAILURES=0`.

## The six anti-generic tests

1. **Swap** — the state headline, WORLD/FLOW/EXIT objects and project facts are specific
   to a verification product. A generic SaaS name would not fit the copy.
2. **Squint** — Overview has one focal point: the state headline; module objects are
   the second read.
3. **Type** — display type is the main visual on Overview and module headers, not a
   card label.
4. **Object** — object element counts come from the latest run’s real `passed`,
   `failed` and `total`; no run leaves the object matte, and the text says “not tested”.
5. **Copy** — headline and support line derive from real project/run/finding state;
   counts are not invented.
6. **Reference** — the frame, type weight, material objects and Testers share the
   references’ confidence without copying their compositions.

## Accessibility and motion

- Focus-visible uses the turquoise token; dialog and mobile sheet are keyboard-operable.
- Mobile sheet traps Tab and closes on Escape.
- Objects expose an accessible label with the real passed/failed counts.
- `prefers-reduced-motion` disables orbit rotation, Tester sway, stack settle and sheet
  animation; all state remains readable.
- No WebGL, no new runtime UI dependency; Bricolage Grotesque and the existing Geist /
  JetBrains Mono fonts are self-hosted.
- Route-level code splitting separates marketing, docs, workspace and admin. The
  workspace shell and pages are loaded lazily.

## Remaining limits

- The creator operations console (`/app/admin`) remains English-only operational copy.
  Every customer workspace screen — shell, Overview, Projects, WORLD/FLOW/EXIT, CLI,
  Billing and Settings — follows the FR/EN switch, including nested actions, tables,
  empty states and confirmations.
- The screenshots are representative, not an automated visual-regression suite.
- Browser testing was performed against the local API with a real session and sandbox
  checkout. No production SasPay transaction was executed.
- The audit did not test every hover, focus and screen-reader announcement; it verifies
  layout, copy, primary interactions and reduced motion.
