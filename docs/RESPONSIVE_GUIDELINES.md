# RESPONSIVE — RÈGLES ET VÉRIFICATIONS

## 1. Viewports de référence (testés ou à tester)

| Classe | Viewports | État |
|--------|-----------|------|
| Téléphone | 320×700, 360×800, 375×812, 390×844, 430×932 | 390×844 testé sur 35 pages (audit 2026-11-21) |
| Tablette | 768×1024, 820×1180 | Partiels : app AI + chat vérifiés en session précédente |
| Laptop | 1024×768, 1280×800, 1366×768, 1440×900 | 1440×900 testé sur 35 pages |
| Desktop | 1600×900, 1920×1080, 2560×1440 | 1920 vérifié en session précédente (site marketing) |

## 2. Règles structurelles (déjà en place)

1. **Grilles, pas de maths de flex** : `app-object-grid`, `module-wall-grid`,
   grilles Tailwind (`lg:grid-cols-…`) ; flexbox pour l'alignement local seulement.
2. **`clamp()` sur les titres** — jamais de saut brutal de taille.
3. **Tableaux** : conteneur `.overflow-x-auto` avec affordance de bord (fondu),
   `scroll-snap` par cellule, padding réduit et `min-width` abaissée sous 640px.
   La page ne défile jamais horizontalement.
4. **Chat IA** : sidebar 288px repliable ; sous 768px le shell passe plein écran
   avec la chrome soustraite (`calc(100dvh - 196px)`).
5. **Zéro hover-dépendance** : toute action critique est accessible au tap.
6. **Cibles tactiles ≥ 44px** sur les contrôles mobiles (CTA, onglets).
7. **Débordements** : `minmax(0,1fr)` dès qu'une chaîne mono insecable peut
   pousser une colonne (leçon du correctif `/download`).

## 3. Défauts ouverts (issus de VISUAL_AUDIT)

- `/app/scan` sans configuration : composer un état d'entrée utile sous la barre
  d'adresse (prévisualisation des 5 lectures) au lieu du vide actuel.
- Vérifier les vues tablette des pages modules (`/app/modules/:module`) et du
  constructeur FLOW — non couvertes par les captures de cette passe.
- `h1` manquants sur 7 pages marketing (accessibilité, pas responsive).

## 4. Méthode de vérification

Le harnais Playwright du projet (`@playwright/test` présent) mesure par page :
`scrollWidth vs clientWidth`, éléments hors écran hors conteneurs scrollables,
longueur de texte minimale, présence de `h1`. Captures horodatées dans
`docs/design/audit-2026-11-21/`. Toute correction responsive est re-capturée
aux mêmes viewports avant commit.
