# PROOFCORE — Matrice des capacités

Légende : **VÉRIFIÉ** = artefact observé ; **PARTIEL** = existe mais incomplet ;
**ABSENT** = non trouvé dans le code ; **NON VÉRIFIÉ** = non exécuté ou non inspecté.

Format demandé par la règle de livraison :

| Fonction                                                                 | Code présent                     | Test exécuté                                         | Test réussi            | Parcours vérifié | Production vérifiée    |
| ------------------------------------------------------------------------ | -------------------------------- | ---------------------------------------------------- | ---------------------- | ---------------- | ---------------------- |
| Modules WORLD / FLOW / EXIT (`packages/modules/*`)                       | VÉRIFIÉ                          | NON VÉRIFIÉ (session)                                | NON VÉRIFIÉ            | NON VÉRIFIÉ      | NON VÉRIFIÉ            |
| Modules FAIL / CLEAN (`packages/core/src/page-scan.ts`, `site-audit.ts`) | VÉRIFIÉ                          | NON VÉRIFIÉ                                          | NON VÉRIFIÉ            | NON VÉRIFIÉ      | NON VÉRIFIÉ            |
| Statuts de test partagés (`packages/contracts/src/statuses.ts`)          | VÉRIFIÉ                          | NON VÉRIFIÉ                                          | NON VÉRIFIÉ            | —                | —                      |
| Limitation de tentatives de connexion (`RateLimiter`)                    | VÉRIFIÉ (mémoire, par processus) | NON VÉRIFIÉ                                          | NON VÉRIFIÉ            | NON VÉRIFIÉ      | ABSENT (non distribué) |
| Protection CSRF                                                          | ABSENT                           | —                                                    | —                      | —                | —                      |
| Rotation de session                                                      | NON VÉRIFIÉ                      | NON VÉRIFIÉ                                          | —                      | —                | —                      |
| Audit IA de code (`apps/api/src/routes/project-intelligence.ts`)         | VÉRIFIÉ (code)                   | PARTIEL (faux fournisseur local, d'après APP-MEMORY) | NON VÉRIFIÉ en session | NON VÉRIFIÉ      | NON VÉRIFIÉ            |
| E-mail EmailJS (`apps/api/src/email.ts`)                                 | VÉRIFIÉ (code)                   | ABSENT (aucun identifiant fourni)                    | —                      | NON VÉRIFIÉ      | NON VÉRIFIÉ            |
| Analyse persistante unifiée (Analysis canonique)                         | ABSENT                           | —                                                    | —                      | —                | —                      |
| Assistant IA outillé sur les cinq modules                                | PARTIEL (commit `ab64664`)       | NON VÉRIFIÉ                                          | NON VÉRIFIÉ            | NON VÉRIFIÉ      | NON VÉRIFIÉ            |
| Fournisseur IA géré par PROOFCORE                                        | ABSENT                           | —                                                    | —                      | —                | —                      |
| Remédiation et vérification technique                                    | ABSENT                           | —                                                    | —                      | —                | —                      |
| Interface Simple / Studio unifiée                                        | NON VÉRIFIÉ                      | —                                                    | —                      | NON VÉRIFIÉ      | NON VÉRIFIÉ            |

## Ce qui ne doit pas être présenté comme opérationnel

- Toute ligne « Analyse persistante unifiée », « Fournisseur IA géré », « Remédiation » : ABSENT.
- Protection CSRF : ABSENT.
- Tout ce qui est NON VÉRIFIÉ n'est pas une fonction validée, quel que soit le nombre de fichiers présents.

> **Cette consigne est levée pour cinq lignes.** Le tableau du début date du 26 novembre
> 2026 au matin. Depuis, le CSRF, la limitation distribuée, la ressource Analysis canonique,
> la remédiation vérifiée et le fournisseur IA géré existent dans le code et sont couverts
> par des tests qui passent. Le tableau de fin de document les remplace ; ne pas s'appuyer
> sur le tableau historique pour affirmer qu'une de ces capacités est absente.

## Mise à jour 26 novembre 2026 (vérification exécutée ce jour)

| Fonction                                                                                                                                                                                                                               | Test exécuté               | Test réussi                                                                                         | Parcours vérifié                                            | Production vérifiée                                      |
| -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------- | --------------------------------------------------------------------------------------------------- | ----------------------------------------------------------- | -------------------------------------------------------- |
| Suite de tests complète (69 fichiers)                                                                                                                                                                                                  | OUI (`pnpm test`)          | OUI — 818/818                                                                                       | —                                                           | —                                                        |
| Typecheck + build                                                                                                                                                                                                                      | OUI                        | OUI (0 erreur TS)                                                                                   | —                                                           | —                                                        |
| Pages publiques : /, /download, /pricing, /docs, /changelog, /security, /signin                                                                                                                                                        | OUI (Playwright, 1440×900) | OUI — 0 erreur console, 0 réponse ≥ 400                                                             | OUI                                                         | OUI (Vercel + Pages, déploiements du jour)               |
| Espace de travail : /app, /app/projects, /app/modules, /app/modules/{world,flow,exit,fail,clean}, /app/scan, /app/start, /app/billing, /app/settings, /app/workspace, /app/cli, /app/interact, /app/ai, /app/guide, /app/notifications | OUI (compte jetable réel)  | OUI                                                                                                 | OUI                                                         | OUI (déployé et vérifié le jour même sur les deux hôtes) |
| Pile dépliable des cinq questions (`CardStack`, `expandable`) — clic sur la pile déplie les cinq cartes, chacune cliquable et nommée                                                                                                   | OUI (local + production)   | OUI — navigation vers `/app/modules/exit` vérifiée, repli par carte du dessus / clic dehors / Échap | OUI                                                         | OUI (Vercel + Pages)                                     |
| Pile de projets (`FolderFloat`, matter-js) sur la vue d'ensemble                                                                                                                                                                       | OUI (local + production)   | OUI — physique, drag, navigation vers un projet                                                     | OUI                                                         | OUI                                                      |
| Install switch Uiverse sur les cartes desktop de /download                                                                                                                                                                             | OUI (local + production)   | OUI — téléchargement réel + état « Installée »                                                      | OUI                                                         | OUI                                                      |
| Assistant IA outillé (26 outils, `apps/api/src/routes/ai.ts`)                                                                                                                                                                          | OUI (localement)           | OUI (parcours navigateur `/app/ai`)                                                                 | PARTIEL (pas de vérification production end-to-end ce jour) | NON VÉRIFIÉ                                              |
| `/app/terminal`                                                                                                                                                                                                                        | OUI                        | NON — 404 sur `/api/terminal/start` (instance locale)                                               | NON                                                         | NON VÉRIFIÉ                                              |
| `/app/admin`                                                                                                                                                                                                                           | OUI                        | NON — 503 sur `/api/v1/admin/overview` (ADMIN_EMAILS vide)                                          | NON                                                         | NON VÉRIFIÉ                                              |
| npm `proofcore` 0.6.3                                                                                                                                                                                                                  | OUI (`npm view`)           | NON — registre à 0.6.0 (secret `NPM_TOKEN` manquant)                                                | —                                                           | NON                                                      |

## Tableau de remplacement — 26 novembre 2026 (soir)

| Fonction | Code présent | Tests exécutés | Résultat | Parcours vérifié | Production |
| --- | --- | --- | --- | --- | --- |
| Cinq familles (WORLD, FLOW, EXIT, FAIL, CLEAN) | VÉRIFIÉ (`packages/modules/*`, `packages/core/src/page-scan.ts`) | OUI (suite complète) | OUI, 955/955 | OUI (26 nov., `/app/modules/*`) | NON VÉRIFIÉ pour les écrans neufs |
| Analysis canonique (cycle de vie, annulation, pagination) | VÉRIFIÉ (`0021_analyses.sql`, `routes/analyses.ts`) | OUI (`apps/api/test/analyses.test.ts`, 10 cas) | OUI | OUI (`/app/analyses`, 26 nov.) | NON VÉRIFIÉ |
| Remédiation vérifiée par seconde mesure | VÉRIFIÉ (`0022`, `routes/remediations.ts`, `core/remediation.ts`) | OUI (`remediations.test.ts`, 9 cas) | OUI | OUI (26 nov. : `verified` et `inconclusive` obtenus à l'écran) | NON VÉRIFIÉ |
| Onboarding quatre questions + recommandation du registre | VÉRIFIÉ (`0024`, `routes/onboarding.ts`, page `Onboarding.tsx`) | OUI (`onboarding.test.ts`, 5 cas) | OUI | OUI (26 nov. : site → profil `security`, API → refus honnête) | NON VÉRIFIÉ |
| FLOW : validation d'un scénario par l'assistant | VÉRIFIÉ (`validate_scenario`, classe `read`) | OUI (test de boucle d'outil avec fournisseur simulé) | OUI, 1 test | NON VÉRIFIÉ sur `/app/ai` (demande une clé) | NON VÉRIFIÉ |
| FLOW Studio (éditeur, validation partagée, exécution) | VÉRIFIÉ (définition, validation, CRUD, exécution locale) | OUI — 7 tests validateur `scenario-spec` + 6 tests API `flow-studio` + 3 tests exécution locale | OUI (9/9 API, 7/7 core) | OUI (26 nov. : scénario créé, rechargé, lancé depuis `/app/flow` sur Chromium local → `PASS` et Analysis `WORKFLOW` `completed`, supprimé) | REFUSÉ sans navigateur (503) et sans Chromium local ; chemin Cloudflare `BROWSER` du Worker non exécuté ici |
| Cinq cibles de départ + pages lues / non suivies | VÉRIFIÉ (`Start.tsx`, `App.tsx` ; crawl `audits.ts`) | NON — pas de harnais DOM dans `apps/web` | — | OUI (26 nov. : site `www.w3.org`, 2 pages sur 5, 3 adresses non suivies avec raison ; « Un parcours » mène à FLOW) | NON VÉRIFIÉ |
| File de remédiations (filtres, étape suivante, liens) | VÉRIFIÉ (`Remediations.tsx`) | NON — pas de harnais DOM dans `apps/web` | — | OUI (26 nov., filtre et lien profond cliqués) | NON VÉRIFIÉ |
| CSRF (origine + `Sec-Fetch-Site`) | VÉRIFIÉ (`app.ts`) | OUI (`security.test.ts`) | OUI | — | NON VÉRIFIÉ |
| Rate limiting distribué | VÉRIFIÉ (`0023_rate_limits.sql`, `hitRateLimit`) | OUI (suite complète) | OUI | — | NON VÉRIFIÉ |
| Sessions : liste, révocation, révocation des autres sessions au changement de mot de passe | VÉRIFIÉ (`routes/account.ts`) | OUI (`account-selfservice.test.ts`) | OUI | — | NON VÉRIFIÉ |
| Fournisseur IA géré + priorité du profil personnel | VÉRIFIÉ (`env.ts`, `routes/ai.ts`) | OUI (`ai-managed.test.ts`, 4 cas) | OUI | — | NON VÉRIFIÉ |
| CLEAN honnête : coquille rendue côté client → `SKIPPED` + verdict `not_measured` | VÉRIFIÉ (`page-scan.ts`) | OUI (`packages/core/test/page-scan.test.ts`) | OUI | — | — |
| Suite complète | — | OUI (`npx vitest run`, 26 nov. soir) | OUI — 90 fichiers, 958 tests, `EXIT:0` | — | — |
| Matrice 13 viewports | — | NON | — | NON | NON |

Le tableau du début et la section « Ce qui ne doit pas être présenté comme opérationnel »
restent lisibles comme l'état du matin du 26 novembre ; ce tableau-ci est l'état du soir.
