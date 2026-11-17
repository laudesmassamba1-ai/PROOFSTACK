# Reference decoding — Ink & Object

The reference energies are decoded here into principles and measurements. The
product does not copy their compositions, objects or copy.

## Images actually inspected

`ref_visuelles/` contains six files, viewed directly before the final QA pass:

- `z1.png` (405×252) — “Limitless Design Solutions”. White page, tiny top nav, an
  iridescent violet/blue metallic atom-ribbon on the left, and a three-line black
  uppercase headline on the right. Microcopy sits at the left edge; `*300`, `*200`,
  `*100` stats and `REACH OUT ↗` sit at the top right. Two service cards peek from the
  bottom edge. This is the clearest reference for type/object overlap.
- `z2.png` (405×255) — “Puffed-up abstract 3D illustrations”. Warm off-white field,
  yellow ribbed torus cropped at top-left, purple velvet loop at bottom-left, silver
  foil flower at top-right, glass spheres. A centred three-line grotesque headline
  sits over the objects; nav and pill controls are tiny. This is the material language
  behind FLOW and EXIT.
- `z3.png` (402×251) — “Look Out Below”. Cream page inside a thin black rounded frame;
  giant three-line black display type; an angled piano at top-right; dozens of tiny
  ink characters with speech bubbles; one black pill and one outlined pill. This is
  the frame and Tester reference.
- `da1.png` (1364×750) — black field with a mint/teal dot wave sweeping in from the
  right; centred spaced wordmark “CAYLENT” with the A built from three green bars;
  subtitle “Idea to Impact. Faster.” Very high negative space, no cards.
- `da2.png` (1354×753) — blue-to-magenta-to-orange gradient field with floating white
  isometric cards (“User-based improvements”, “Compare Parts”, “Knowledge Spaces”,
  “Smart Publishing”), blue line icons, glossy edges and small 3D objects. This is the
  previous brand-object direction, not the workspace direction.
- `exp2.webp` (1339×768) — dark product screenshot: narrow icon rail, project sidebar,
  large “The only 100% free powerful coding agent” headline with a mint highlight,
  dotted globe and a prompt composer. It confirms the contrast between a dense dark
  admin/product shell and the paper workspace; it is not copied.

What the real images add to the textual brief: `z1` uses much more empty paper than a
normal dashboard; `z2` crops objects aggressively; `z3` makes the frame and characters
part of the composition; `da1` proves that a dot field can carry an entire hero.
The workspace intentionally keeps more data below the fold than `z1`, because
engineers need runs, findings and project facts on the same screen.

## REF-1 — Limitless Design Solutions

- Warm off-white field, black ink, no grey UI chrome.
- A headline that behaves as the image: uppercase, ultra-tight, line-height ≈ 0.86,
  tracking between −0.05em and −0.065em.
- One tangible object with a light source: chrome/iridescent rings, rim light,
  reflected colour, soft contact shadow.
- Tiny statistics with `*` or `+` markers and 11px caps captions.
- Rounded surfaces peek at the bottom edge instead of forming a dashboard grid.

**Extracted measurement:** hero type 88–148px at desktop; object 38–46% of the hero
width; microtext 11px with +0.08em tracking; outer page margin 24–40px.

## REF-2 — Puffed-up abstract 3D illustrations

- Inflated soft objects in velvet, foil, rubber and glass.
- Objects are cropped by the frame and overlap the type.
- Centred type, pill controls with hairline outlines.
- Material, not colour, creates personality.

**Extracted measurement:** object radius to body ratio 0.28–0.36; highlight at 30–35%
from the top-left; shadow at 42–48% opacity with a 24–40px blur; at least one object
crosses a frame edge on desktop.

## REF-3 — Look Out Below

- Cream canvas inside a rounded, bordered frame with a visible outer margin.
- Chunky display letters carry a joke inside their counters.
- Tiny ink characters with speech bubbles create scale and life.
- One filled black pill and one outlined pill; no third button style.

**Extracted measurement:** frame radius 28px, border 1px at 12% ink, margin 16–24px;
characters 24–40px; bubble text 10–12px; primary controls 44px tall.

## Shared DNA

1. Typography is the visual, not a label.
2. One tangible object per screen replaces a grid of icons.
3. Warm paper and ink; colour is a material.
4. Objects and type may overlap and bleed, deliberately and asymmetrically.
5. Microtext is tiny, uppercase, tracked; controls are pills.
6. A point of view and dry humour exist, but never at the expense of truth.

## Translation into PROOFSTACK

| Reference principle | Product decision                                                            |
| ------------------- | --------------------------------------------------------------------------- |
| Giant type          | Overview headline is generated from real workspace state                    |
| Tangible object     | WORLD orbit, FLOW chain, EXIT stack are bound to latest run totals          |
| Paper frame         | `/app` lives in a 28px bordered frame on `#F3F0E8`                          |
| Ink characters      | Testers appear only in empty, loading and 404 states                        |
| Tiny microtext      | Workspace, project and run metadata use 11px caps                           |
| Colour as material  | Module colours belong to objects; semantic status uses a separate muted set |
| Asymmetry           | 5/4/3 module columns and objects that bleed past card edges                 |

## What is explicitly rejected

- Dark sidebar, white content area, four KPI cards and a line chart.
- Purple/blue gradient hero cards, glassmorphism and gradient text.
- Three identical feature cards with icons in coloured rounded squares.
- Centred headline with a `New` badge and generic SaaS copy.
- Any data visual that invents a trend, percentage or volume.
