# DESIGN SYSTEM — PROOFCORE

Source de vérité du code : `apps/web/src/styles/global.css` (bloc tokens `:root`
en tête de fichier). Ce document décrit ce qui existe dans le code, pas une intention.

## 1. Tokens

### Couleurs (extraites du code)

| Token                           | Valeur                                                    | Usage                                |
| ------------------------------- | --------------------------------------------------------- | ------------------------------------ |
| `--brand-black`                 | `#050708`                                                 | Fond du site public                  |
| `--brand-deep`                  | `#0a1014`                                                 | Bandes « deeper »                    |
| `--brand-mint`                  | `#78e3cb`                                                 | Accent primaire du site              |
| `--brand-emerald`               | `#73d68b`                                                 | Accent secondaire (statut positif)   |
| `--brand-cyan`                  | `#70c9db`                                                 | Profondeur de la vague de particules |
| `--paper` / `--paper-raised`    | `#f3f0e8` / `#faf8f3`                                     | Fonds de l'espace de travail         |
| `--ink` / `--ink-soft`          | `#0a0a0b` / `#5b5a55`                                     | Texte app / texte secondaire         |
| `--mint` / `--turquoise`        | `#5cf2c4` / `#0fd9d0`                                     | Accents app                          |
| `--world` / `--flow` / `--exit` | `#2f5bff` / `#5cf2c4` / `#ffb020`                         | Couleurs par module                  |
| Statuts                         | PASS vert, WARN ambre, FAIL rouge, SKIPPED gris + libellé | Toujours couleur **et** texte        |

Règle : `≥3 teintes` par vue, la couleur ne code jamais seule une information.

### Typographie (3 familles, rôles exclusifs)

| Rôle                | Famille                      | Notes                                            |
| ------------------- | ---------------------------- | ------------------------------------------------ |
| Display / titres    | Bricolage Grotesque Variable | tracking serré négatif, jamais le corps de texte |
| Texte courant       | Geist Variable               | longues lectures, interfaces                     |
| Données / technique | JetBrains Mono Variable      | commandes, ids, tokens, chiffres de table        |

Échelle : héro `clamp(2rem, 5.4vw, 4.6rem)` ; h2 section `1.9 → 2.4rem` ;
corps `0.84–1rem` ; légendes/mono `0.6–0.76rem`. Pas de 16px uniforme.

### Espacement, rayons, profondeur

- Espacement : échelle 8pt (`--space-1…--space-24`), rythme de section 14/20.
- Rayons : `--radius-sm` 6 (chips), `--radius` 10 (contrôles), `--radius-lg` 16
  (panneaux), pilules 999 (CTA). Une surface nichée dans une surface prend le
  rayon inférieur.
- Profondeur : `--spot-card` (filet interne + ombre teintée sous l'objet),
  ombres ≤ 20px de flou ; `data-tilt` pour la profondeur interactive.

### Mouvement

| Token               | Valeur                              | Usage            |
| ------------------- | ----------------------------------- | ---------------- |
| `--ease-anticipate` | `cubic-bezier(0.76, 0, 0.24, 1)`    | entrées masquées |
| `--ease-spring`     | `cubic-bezier(0.25, 1, 0.5, 1)`     | hover/press      |
| `--ease-overshoot`  | `cubic-bezier(0.34, 1.56, 0.64, 1)` | rebond maîtrisé  |
| `--ease-drift`      | `cubic-bezier(0.22, 0.61, 0.21, 1)` | dérive, couleur  |

Moteur : `apps/web/src/lib/motion.ts` — attributs `data-motion="words|mask"`,
`data-tilt`, `data-magnet`, `data-parallax="vitesse"`. Tout échoue ouvert
(sans JS tout est visible) et est coupé par `prefers-reduced-motion`.

## 2. Composants (inventaire vivant)

| Famille    | Composants (fichiers)                                                                                                                             |
| ---------- | ------------------------------------------------------------------------------------------------------------------------------------------------- |
| Navigation | `Nav` (flyout modules, FR/EN), `AppLayout` (topbar, palette ⌘K, sidebars), `Footer`                                                               |
| Surfaces   | `brand-panel`, `spot-card`, `module-panel`, `app-workbench`, `engine-frame`                                                                       |
| Contrôles  | `btn` (primary/ghost/solid + magnet), `field`, `app-select`, `app-toggle`                                                                         |
| États      | `Empty`/`TesterScene` (figure par cas), `ErrorState`, `Loading`, `StatusBadge`, `app-badge`                                                       |
| Données    | `app-table`, `RunsTrend`, `SeverityBreakdown`, `ModulePassRates`, `stat-strip`, `ModuleObject` (objets 3D SVG par module)                         |
| Feedback   | `chat-status`, toasts de facturation, `aria-busy` sur CTA de téléchargement                                                                       |
| IA         | `chat-*` (conversations, relecteurs `chat-review`, mémoire `chat-memory`), dialogue de connexion provider (`chat-connected`, `chat-model-picker`) |
| Preuve     | `ai-sample` (lecture IA enregistrée), `wall-state-*` (légende d'états), `module-panel-tokens`                                                     |

Chaque composant porte ses états interactifs (hover/active/focus-visible) dans
`global.css` ; les variantes sont contrôlées par classes (`is-*`, `module-*`).

## 3. Règles de composition

1. Une page = une question principale en tête, la réponse en dessous.
2. Les grilles sont asymétriques quand l'information l'est (5 modules + 1 moteur,
   `app-object-grid` 1.12fr/0.94fr/0.94fr).
3. Pas de carte sans information actionnable ou décisionnelle.
4. Le mono ne sert que le technique ; le display jamais pour des libellés.
5. Toute démonstration est étiquetée ; tout chiffre est vérifiable dans le code.
