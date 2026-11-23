# RAPPORT QA VISUEL — passe du 2026-11-21

Portée : site public + espace de travail, viewports 1440×900 et 390×844, produit
rendu local (API SQLite + Vite), session de test réelle avec un projet.

## Résultat

| Vérification                                                        | Avant                                          | Après                                                                   | Preuve                                                      |
| ------------------------------------------------------------------- | ---------------------------------------------- | ----------------------------------------------------------------------- | ----------------------------------------------------------- |
| `/download` @390 — défilement horizontal de page                    | OUI (grille poussée par les empreintes sha256) | NON — page `scrollWidth == clientWidth`                                 | `_download-fixed-390.png`                                   |
| `/app` @1440 — demi-page de graphiques vides avant la 1ʳᵉ exécution | 476 px de panneaux « … »                       | Section absente tant qu'aucune exécution                                | `_app-fixed-1440.png`, mesures de sections (ga 33/30/16 px) |
| `/app` @1440 — panneau d'usage en anglais dans l'interface FR       | « 5 run(s) left… », « View plans »             | « 5 exécution(s) restante(s)… », « Voir les offres »                    | `_app-fixed-1440.png`                                       |
| `/app/billing` @390 — colonne « Traitement » coupée sans signal     | Coupure muette                                 | Défilement contrôlé avec fondu de bord + snap                           | `_app_billing-fixed-390.png`                                |
| État vide « Échecs ouverts » répétant le titre du panneau           | Titre ×2                                       | Titre ×1                                                                | `_app-fixed-1440.png`                                       |
| Chorégraphie des titres (site)                                      | Blocs figés                                    | Mots levés hors masque, décalage asymétrique, accent menthe sur le héro | `home-after-hero.png`                                       |
| `prefers-reduced-motion` sur les mots masqués                       | —                                              | transform:none, opacité 1 (rendu statique immédiat)                     | harnais qa-motion                                           |
| Focus clavier (chaîne de tabulation)                                | —                                              | contour solide 2px sur les liens interactifs                            | harnais qa-motion                                           |
| `h1` sur les 7 routes marketing                                     | absent                                         | présent (`SectionHeading as="h1"`)                                      | capture `pricing-scroll.png`                                |
| `/app/scan` sans configuration                                      | ~60 % de page vide                             | prévisualisation des 5 lectures sous la barre                           | `_app_scan-fixed-1440.png`                                  |
| Descriptions d'offres en anglais sur la page FR                     | anglaises                                      | mappées en FR via i18n, repli sur la chaîne serveur                     | commit `bb3241b`                                            |
| Erreurs console (35 pages × 2 viewports)                            | 0                                              | 0                                                                       | journal du harnais d'audit                                  |

## Tests suite complète

`pnpm test` : **653 tests, 0 échec** (après les correctifs). `pnpm typecheck` : OK.
Biome : 0 erreur sur les fichiers modifiés. Build web : OK.

## Captures

- Référence (avant) : `docs/design/audit-2026-11-21/*-1440x900.png`, `*-390x844.png`
- Après correctifs : `docs/design/audit-2026-11-21/_*-fixed-*.png`, `home-after-hero.png`

## Ce qui n'a pas pu être vérifié

- Le mode Studio complet avec données d'exécution réelles (pas d'abonnement payant
  sur le compte de test ; les graphiques à zéro sont désormais masqués, donc les
  panneaux de tendance restent à valider avec des runs).
- Les viewports 768/820/1600/2560 sur les pages modifiées (priorité passe suivante).
- La mise en production n'a pas été redéployée dans cette passe (déploiements
  précédents : Vercel `proofstack-iota`, Pages `proofstack-01z`).
