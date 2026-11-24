# Design tokens — Ink & Object

The authenticated workspace consumes these tokens. Component files do not introduce
arbitrary hex values. The marketing site keeps its dark brand surfaces.

## Colour

| Token            | Light / paper        | Dark / inverse          | Role                  |
| ---------------- | -------------------- | ----------------------- | --------------------- |
| `--paper`        | `#F3F0E8`            | `#0A0A0B`               | Page canvas           |
| `--paper-raised` | `#FAF8F3`            | `#141412`               | Framed work surface   |
| `--surface-alt`  | `#EAE6DC`            | `#1D1D1A`               | Inputs, quiet fills   |
| `--ink`          | `#0A0A0B`            | `#F3F0E8`               | Primary type          |
| `--ink-soft`     | `#5B5A55`            | `#B8B3A8`               | Secondary type        |
| `--rule`         | `rgba(10,10,11,.12)` | `rgba(243,240,232,.14)` | Hairlines             |
| `--mint`         | `#5CF2C4`            | `#5CF2C4`               | Highlight, one action |
| `--turquoise`    | `#0FD9D0`            | `#0FD9D0`               | Focus ring            |
| `--world`        | `#2F5BFF`            | `#2F5BFF`               | WORLD object          |
| `--flow`         | `#5CF2C4`            | `#5CF2C4`               | FLOW object           |
| `--exit`         | `#FFB020`            | `#FFB020`               | EXIT object           |
| `--success`      | `#177A54`            | `#63D6A2`               | Verified pass         |
| `--warning`      | `#8A5A00`            | `#E9B45A`               | Ran but inconclusive  |
| `--danger`       | `#B62C36`            | `#F07884`               | Product defect        |

Status colour is never the only signal. Every badge carries a word; object states are
also stated in the adjacent sentence.

## Reference adaptation tokens (marketing shell, 2026-11)

| Token              | Value     | Role                                        |
| ------------------ | --------- | ------------------------------------------- |
| `--ref-navy`       | `#070B1C` | Dark marketing field                        |
| `--ref-indigo`     | `#4338CA` | Nebula glow (bottom-left)                   |
| `--ref-violet`     | `#8B5CF6` | Nebula glow, logo layer 1                   |
| `--ref-violet-soft`| `#A78BFA` | Headline accent word                        |
| `--ref-lime`       | `#C9F24F` | Dark-surface primary CTA, logo front plate  |
| `--lh-paper`       | `#F2E4D5` | Light edition field (was `#F7F6F2`)         |
| `--lh-accent`      | `#6E2B34` | Light edition accent (was `#4F46E5`)        |
| `--ref-amber`      | `#FFB612` | Yellow/black pop, badges only               |

## Type

- Display: `"Bricolage Grotesque Variable"`, weight 600–800, line-height 0.86–0.92,
  tracking −0.04em to −0.06em.
- UI: `"Geist Variable"`, 13–15px, weight 400–560.
- Mono: `"JetBrains Mono Variable"`, 11–12px, `font-feature-settings: "zero" 1`.
- Microtext: 11px / 1.4, uppercase, +0.08em.
- Hero workspace: `clamp(3.7rem, 9vw, 8.4rem)`.
- Module title: `clamp(3rem, 7vw, 6.8rem)`.
- Key numeral: `clamp(3.5rem, 8vw, 7rem)`.
- Dense body: 13–14px; tables 12–13px; code 11–12px.

## Geometry

| Token               | Value                   |
| ------------------- | ----------------------- |
| Frame radius        | 28px                    |
| Card radius         | 20px                    |
| Control radius      | 999px                   |
| Hairline            | 1px                     |
| Page margin desktop | 24px                    |
| Page margin mobile  | 0                       |
| Content max width   | 1440px                  |
| Grid                | 12 columns, 16px gutter |

## Elevation

- UI surfaces: `0 1px 0 rgba(10,10,11,.03)` at most.
- Objects: contact shadow `0 22px 38px -24px rgba(10,10,11,.55)`.
- No glass blur, no shadow-heavy cards.

## Motion

- Easing: `cubic-bezier(.2,.8,.2,1)`.
- Hover 120–160ms; small transition 160–220ms; dialog 180–260ms; large 240–400ms.
- Object loops pause off-screen and under `prefers-reduced-motion`.
- Table hover inverts the row to ink with paper text; no zebra stripes.
