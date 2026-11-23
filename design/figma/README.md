# PROOFCORE : kit Figma

Ce dossier contient les fichiers source du design, à importer dans Figma. Il sert de référence pour reproduire le design sur le site.

## Contenu

| Fichier | Rôle |
| --- | --- |
| `tokens.json` | Couleurs, polices et rayons, extraits de `apps/web/src/styles/global.css`. |
| `landing-hero.svg` | Maquette de la page d'accueil (1440 × 900). |
| `pricing-card.svg` | Maquette des plans tarifaires (1200 × 720). |

## Importer dans Figma

1. Ouvrez Figma, créez un fichier « PROOFCORE ».
2. Glissez-déposez chaque `.svg` dans le canevas, ou utilisez `File → Place image`. Figma garde les calques texte modifiables.
3. Pour les tokens : créez une collection de variables, puis ajoutez les couleurs de `tokens.json`. Vous pouvez aussi passer par Tokens Studio.
4. Les polices `Geist`, `JetBrains Mono`, `Instrument Serif` sont gratuites sur Google Fonts ou Fontshare. Installez-les localement pour que le rendu soit fidèle.

## Règles à respecter avant la mise en production

- **Textes** : les titres et leads de `landing-hero.svg` sont des espaces réservés. Le texte final vient des fichiers i18n (`apps/web/src/i18n/`), pas de cette maquette.
- **Prix** : les montants viennent de `packages/billing/src/plans.ts` (USD : Developer 15, Studio 39, Agency 99). Le site les lit depuis le catalogue ; ne les saisissez jamais à la main.
- **Nom** : écrivez toujours PROOFCORE, jamais PROFFCORE ni PROOFSTACK.
