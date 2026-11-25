# PROOFCORE — règles responsive

État : 25 novembre 2026. Ce document sépare ce qui est **mesuré** de ce qui reste à
mesurer.

## 1. Principe

Un écran mobile est conçu pour le mobile, pas compressé depuis le desktop. La hiérarchie
change : la phrase de situation reste, les colonnes deviennent des piles, les actions
principales restent atteignables au pouce, les tableaux deviennent des listes ou
défilent avec une affordance visible.

## 2. Seuils utilisés

| Seuil                    | Usage                                                        |
| ------------------------ | ------------------------------------------------------------ |
| `max-width: 1200px`      | largeur de lecture du site marketing                         |
| `max-width: 960px`       | passage en une colonne des blocs denses (situation, modules) |
| `max-width: 767px`       | barre de navigation mobile, menus plein écran                |
| `max-width: 640px`       | titres, marges, tableaux, formulaires                        |
| `prefers-reduced-motion` | suppression des ressorts, parallaxe et boucles               |

Ces seuils sont ceux du CSS livré, pas une théorie.

## 3. Règles par composant

- **Navigation** : la topbar garde marque, notifications, recherche et menu. Le menu
  plein écran contient toutes les sections ; le mode expert s'y active.
- **Tableaux** : jamais de colonnes écrasées ; défilement horizontal avec indicateur,
  ou liste de lignes en dessous de 640 px.
- **Graphiques** : largeur 100 %, hauteur bornée, axes lisibles ; pas de canvas
  débordant.
- **Dialogues** : largeur `min(100% - 32px, …)`, boutons empilés si besoin, fermeture
  accessible.
- **Formulaires** : un champ par ligne sur téléphone, libellé au-dessus, erreur sous le
  champ, cible tactile ≥ 44 px.
- **Assistant IA** : plein écran sur mobile, composer ancré, panneau d'outils en
  superposition, pas de double défilement.
- **FLOW** : étapes en liste verticale, identifiant d'étape et assertion visibles.
- **Terminal** : défilement interne, police mono, pas de débordement de la page.
- **Rapports** : document en une colonne, en-tête compact, constats empilés.

## 4. Ce qui a réellement été exécuté

| Projet Playwright             | Viewport   | Résultat                    |
| ----------------------------- | ---------- | --------------------------- |
| `desktop` (Desktop Chrome)    | 1280 × 800 | 17 passés, 2 sautés         |
| `mobile` (Pixel 7, DPR 2.625) | 412 × 915  | 19 passés                   |
| scénarios mobiles             | 390 × 844  | inclus dans la suite mobile |

Le test « no dashboard page overflows horizontally » vérifie plusieurs routes de
l'espace (`overflow = scrollWidth - clientWidth ≤ 2`) et passe sur les deux projets.

Le parcours débutant mobile a aussi été vérifié : inscription, consentement, guide,
adresse, résultat, rapport complet, sans débordement.

## 5. Défauts trouvés et corrigés

- **Inscription mobile** : le fond WebGL au DPR complet saturait le thread principal et
  la requête était abandonnée après 6 s. Plafond à 1,5 ; le test mobile passe.
- **Consentement cookies** : la carte recouvrait l'action « Voir le résultat » sur un
  premier passage. Le parcours de test ferme désormais la carte comme un utilisateur.
  La taille de la carte sur petit écran reste à revoir (risque UX ouvert).

## 6. Matrice cible non encore rejouée

Les tailles suivantes doivent être capturées et comparées avant de revendiquer un
responsive complet :

`320×700`, `360×800`, `375×812`, `390×844`, `430×932`, `768×1024`, `820×1180`,
`1024×768`, `1280×800`, `1366×768`, `1440×900`, `1600×900`, `1920×1080`,
`2560×1440`.

Statut : **PARTIEL**. Deux projets réels (desktop + Pixel 7) sont prouvés ; la matrice
complète ne l'est pas. Les scripts `qa-*.mjs` existent mais n'ont pas été réexécutés
dans cette passe.

## 7. Accessibilité liée au responsive

- Focus visible conservé ; aucun `outline: none` global.
- `prefers-reduced-motion` respecté par les composants de mouvement.
- Les canvas décoratifs sont sans nom accessible (pas de contenu annoncé à tort).
- Aucun audit axe-core ni parcours clavier exhaustif n'a été exécuté : ne pas déclarer
  WCAG 2.2 AA.
