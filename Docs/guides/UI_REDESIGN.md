# UI redesign guidelines

Plan: harmonize landing and app DA using shared tokens and typography, with a progressive patch path.

1. Palette and tokens

- Brand tokens (defined in CSS):
  - --brand-black, --brand-deep, --brand-emerald, --brand-mint, --brand-cyan
  - --surface, --surface-alt, --text-primary, --text-secondary, --border
  - --primary, --accent, --success, --warning, --danger
- Ensure landing and app reuse these tokens via CSS variables for consistent theming.

2. Typography

- font-sans: Geist Variable
- font-mono: JetBrains Mono Variable
- Headings should scale consistently: h1 ~ 2.2rem to 4rem; body ~1rem; code/mono ~0.78rem

3. Spacing and layout

- 8pt scale: space-1 (0.25rem) to space-24 (6rem)
- Cards/sections share border-radius and shadows to maintain depth consistency

4. Components

- Buttons: .btn, .btn-primary, .btn-ghost; ensure hover/focus contrast
- Nav: .app-nav-link with active state styling
- Cards/Surfaces: .app-card, .brand-panel
- Forms: .field, .app-input, .focus outlines

5. Landing vs App rules

- Visual hierarchy should feel continuous between landing and app: same typography, same color tokens, same radii, same shadows.
- Accessibility: ensure sufficient contrast and keyboard focus indicators on all interactive elements.

6. Exemples de pages

- Landing/Home.tsx: CTA buttons using btn-primary; hero surface aligned with brand-panel
- App Dashboard: cards and surfaces using the same tokens and radii

7. Prochain pas

- Créer UI_REDESIGN.md dans Docs/guides (ce fichier est maintenant ajouté avec ce contenu de base)\n\n8) Patch cadence et gouvernance\n- Démos et PRs succincts; patchs minimaux; tests visuels\n- Planifier sprints UI et patch diffs
