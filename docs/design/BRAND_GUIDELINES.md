# Brand guidelines (ProofCore)

Color palette:

- Primary brand: --brand-black, --brand-deep
- Accents: --brand-emerald, --brand-mint, --brand-cyan
- Secondary palette not to be overused in dashboard: purples/pinks used for illustrations only

Typography:

- Heading font: Geist Sans / Inter
- Body: Geist Sans / Inter, mono: JetBrains Mono

Layout and spacing:

- 8pt spacing scale; consistent border radii across surfaces
- Cards: soft shadows, subtle borders

Iconography:

- Use Lucide icons where possible for consistency.

Imagery and visuals:

- Particle system is core identity; avoid busy backgrounds in dashboards.

Accessibility:

- Contrast targets met for text on surfaces; focus states visible.

## Reference adaptation (2026-11, ref_visuelles)

The marketing surfaces now decode the newest reference set (1.jpeg, 2.jpeg, 4.jpeg,
regarde.png, 6.png). The workspace stays Ink & Object; the marketing shell adapts:

- **Dark hero**: deep navy field (`--ref-navy #070b1c`) with violet/indigo nebula
  glows and hairline orbit rings; the particle P speaks violet → indigo → lime.
- **Accent**: fluorescent lime (`--ref-lime #c9f24f`) is the single dark-surface
  CTA colour, always with ink text (black/lime reference). The headline accent
  word is soft violet (`--ref-violet-soft #a78bfa`), echoing the neon object.
- **Light edition**: warm editorial cream (`--lh-paper #f2e4d5`) with burgundy
  ink accents (`--lh-accent #6e2b34`), mono microtext eyebrows and warm hairlines
  (REPORT reference). CTA: burgundy gradient, cream text.
- **Artifacts are pure CSS**: `.halftone` / `.halftone-dark` dot fields,
  `.glow-orb` nebula orbs, `.ring-orbit` hairline ellipses, `.meta-row` mono
  metadata rows. They decorate; they never carry text.
- Workspace semantic colours (world/flow/exit, success/warning/danger) are
  unchanged; yellow stays reserved for EXIT and badges.
