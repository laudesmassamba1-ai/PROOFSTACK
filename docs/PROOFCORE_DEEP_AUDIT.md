# PROOFCORE — Audit profond (phase 0, cartographie)

Base : commit `85e27a2` (branche `master`), dépôt de travail avec modifications non commitées
(`apps/web/src/pages/app/{AiChat,Billing,ModulePage,Settings}.tsx`, `AppLayout.tsx`,
`global.css`, `packages/cli/src/index.ts`, `packages/cli/test/cli.test.ts`) et trois fichiers
de débogage non suivis à la racine (`mobile-*.tmp.mjs`, `visual-audit.tmp.mjs` est suivi).

Statuts utilisés dans ce document : **VÉRIFIÉ** (artefact observé), **PARTIEL**,
**ABSENT**, **NON VÉRIFIÉ** (non exécuté ou non inspecté).

## 1. Ce qui a été vérifié

| Point                                 | Statut  | Preuve                                                                                                                                                                                                                                                                                                                                |
| ------------------------------------- | ------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Lint du dépôt suivi par Git           | PARTIEL | `pnpm lint` échoue uniquement à cause de trois fichiers `*.tmp.mjs` non suivis à la racine (erreurs `useDomNodeTextContent`, format). Le code produit n'est pas en cause ; la CI repart d'un checkout et ne les voit pas.                                                                                                             |
| Fichiers cités par l'audit historique | PARTIEL | `apps/web/src/pages/app/Start.tsx` (389 l.), `ProjectConfig.tsx` (1067 l.), `apps/api/src/routes/audits.ts` (1172 l.), `apps/api/src/routes/ai.ts` (2685 l.), `packages/cli/src/audit.ts` (495 l.) existent. **`packages/engine/src/contracts/statuses.ts` est absent** : les statuts sont dans `packages/contracts/src/statuses.ts`. |
| Statuts de test                       | VÉRIFIÉ | `packages/contracts/src/statuses.ts` : PENDING, RUNNING, PASSED, FAILED, WARNING, SKIPPED, ERROR, BLOCKED, NOT_APPLICABLE, NOT_CONFIGURED. Statuts de run : PENDING, RUNNING, COMPLETED, PARTIAL, FAILED, ERROR, CANCELLED, NOTHING_VERIFIED.                                                                                         |
| Modules                               | VÉRIFIÉ | `packages/modules/` contient `world`, `flow`, `exit` uniquement. FAIL et CLEAN sont dans `packages/core/src/page-scan.ts` (`ScanModule = "fail" \| "clean" \| "flow" \| "world" \| "exit"`) et `packages/cli/src/audit.ts` (`kind: "fail"` / `"clean"`).                                                                              |
| Protection CSRF                       | ABSENT  | Aucune occurrence de `csrf` dans `apps/api/src`.                                                                                                                                                                                                                                                                                      |
| Rate limiting                         | PARTIEL | `RateLimiter` (`apps/api/src/http/errors.ts:133`) : compteur en `Map` mémoire, par processus/isolat. Non distribué. Utilisé par `auth.ts` (connexion 10 / 5 min, inscription configurable).                                                                                                                                           |
| Révocation de session                 | PARTIEL | Révocation présente dans `auth.ts`, `device.ts`, `account.ts`, `machine.ts`, `billing.ts`, `workspace.ts`, `store/app-store.ts`. Rotation : NON VÉRIFIÉ.                                                                                                                                                                              |
| Tests                                 | VÉRIFIÉ | 69 fichiers `*.test.*` / `*.spec.*` hors `node_modules` et `dist`.                                                                                                                                                                                                                                                                    |
| Espace disque                         | VÉRIFIÉ | 5,2 Go libres sur 232 Go (98 % utilisé). Les builds et installations lourdes sont à risque.                                                                                                                                                                                                                                           |

## 2. Ce qui n'a pas été vérifié (à compléter)

- **Exécution réelle des tests** : `pnpm test`, `pnpm typecheck`, `pnpm build`, E2E — NON VÉRIFIÉ dans cette session (disque presque plein ; lancer après libération d'espace).
- **État réel de la CI** sur GitHub (exécution #105 citée) : NON VÉRIFIÉ, aucun accès aux journaux distants n'a été tenté.
- **Pages rendues dans un navigateur** (phase 0.3) : NON VÉRIFIÉ.
- **Cartographie complète des routes et des appels web → API** : tentée via sous-agent, interrompue par la limite d'étapes. À refaire par lots (voir `PROOFCORE_ARCHITECTURE_MAP.md`, section « à compléter »).
- **Schéma de persistance d'analyse commune** : NON VÉRIFIÉ ; les tables D1 et le schéma Neon (`apps/api/neon/schema.sql`) doivent être lus avant toute migration.

## 3. Incohérences documentaires relevées

- `package.json` racine : `"name": "proofcore"`, `"description"` décrit trois moteurs (WORLD, FLOW, EXIT) alors que le produit en documente cinq. Le README et le statut en parlent aussi différemment.
- Version racine `0.1.0` ; version CLI `@proofcore/cli` `0.6.3`. Pas de règle de versionnement documentée (à vérifier dans `README.md` et `docs/`).
- `APP-MEMORY.md` indique « Dernière mise à jour : 2026-11-21 » et des chantiers « en cours » qui peuvent être dépassés.
- Le sous-agent a signalé des chemins de documentation contradictoires ; à réconcilier dans la phase 1.4.

## 4. Décision de cette session

La phase 0 complète (cartographie de toutes les routes, pages et composants, tests navigateur)
dépasse une seule session. Les trois autres documents (`CAPABILITY_MATRIX`, `ARCHITECTURE_MAP`,
`RISK_REGISTER`) ne contiennent que ce qui est vérifié ci-dessus. Les lignes marquées NON VÉRIFIÉ
ne doivent pas être lues comme des fonctions opérationnelles.

## 5. Vérification en direct — 26 novembre 2026 (phase 0.3 exécutée)

Session du 26 novembre, dépôt à `e5b5e63` (master), l'agent « chat IA mobile » travaillait
en parallèle dans le même arbre. Cette section ne décrit que ce qui a été exécuté ce jour.

### 5.1 Suite de tests exécutée (comble la section 2.1 ci-dessus)

- `pnpm test` : **69 fichiers, 818 tests, 0 échec** (Vitest, local).
- `pnpm typecheck` : 0 erreur (`apps/web`, exécuté à chaque passe du jour).
- `pnpm build` : succès (racine, deux fois ce jour).

### 5.2 Pages rendues dans un navigateur (Playwright, 1440×900 ; app connectée avec

un compte jetable réel ; API locale `:8787` en vie)

| Route                                                                                                                                                    | H1 rendu             | Anomalies                                                                                                                                                                                             |
| -------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `/`, `/download`, `/pricing`, `/docs`, `/changelog`, `/security`, `/signin`                                                                              | correctes            | aucune ; 0 erreur console, 0 réponse ≥ 400                                                                                                                                                            |
| `/legal`                                                                                                                                                 | « Page introuvable » | les routes existantes sont `/legal/terms`, `/legal/privacy`, `/legal/cookies` — pas de raccourci `/legal`                                                                                             |
| `/app`, `/app/projects`, `/app/modules`, `/app/modules/{world,flow,exit,fail,clean}`                                                                     | correctes            | aucune                                                                                                                                                                                                |
| `/app/scan`, `/app/start`, `/app/billing`, `/app/settings`, `/app/workspace`, `/app/cli`, `/app/interact`, `/app/ai`, `/app/guide`, `/app/notifications` | correctes            | aucune                                                                                                                                                                                                |
| `/app/terminal`                                                                                                                                          | Terminal             | **404 sur `/api/terminal/start`** (le démarrage du terminal local n'est pas servi par cette instance API locale)                                                                                      |
| `/app/admin`                                                                                                                                             | Opérations           | **503 sur `/api/v1/admin/overview`** (instance locale ; ADMIN_EMAILS vide par défaut)                                                                                                                 |
| `/app/account`, `/app/local-agent`                                                                                                                       | « Page introuvable » | URL saisies à la main : les vraies routes sont `/app/settings` (Account.tsx est rendu ailleurs) et `/app/agent`. Aucun lien de navigation ne pointe vers ces 404 — URLs mortes, pas de parcours cassé |

### 5.3 CI observée via `gh` (comble la section 2.2 ci-dessus)

| Run                      | Commit    | Résultat                                                                                         |
| ------------------------ | --------- | ------------------------------------------------------------------------------------------------ |
| 45600283899 (antérieure) | —         | échec smoke CLI — cause corrigée (`asksHelp`), voir R5 du registre                               |
| 45755203107              | `8f5e61c` | **failure** au smoke CLI : `--version` OK (0.6.3), `--help` sort 2, aucune trace d'erreur au log |
| 45756582954              | `e5b5e63` | en cours au moment de la vérification                                                            |
| 45755203107 · e2e        | `8f5e61c` | **success** (desktop + mobile)                                                                   |

Reproduction locale : clone propre `/tmp/ci-repro` au commit exact `8f5e61c`, `pnpm
install --frozen-lockfile`, `pnpm build`, les trois commandes du smoke test avec
`env -i` (HOME neuf, sans TTY, `CI=true`) — **les trois sortent 0**. L'échec du run
45755203107 n'est donc pas reproductible au commit exact dans un environnement
isolé ; il est transitoire ou spécifique au runner (à confirmer par le run en cours).
Hypothèse éliminée : un état du poste (config, session, `.git`) — le clone n'en a aucune.

### 5.4 Registre npm (comble la section 3 ci-dessus)

- `npm view proofcore version` → **0.6.0** ; `packages/cli/package.json` → **0.6.3**.
- Le paquet publié n'existe pas sous `@proofcore/cli` (privé) ; le README documente
  `npm install -g proofcore` — l'écart npm (0.6.0 → 0.6.3) attend le secret
  `NPM_TOKEN` (voir `docs/deployment/CONNECTIONS.md`). La publication CLI vers npm
  est branchée dans le workflow release mais saute sans le secret.
- Décalage `git clone …/PROOFSTACK.git` / `cd PROOFCORE` cité par l'audit historique :
  **plus aucune occurrence** dans le dépôt (README, docs, CLI) — réglé.

### 5.5 Nouvelles incohérences documentaires localisées (complète la section 3)

- `README.md:38` : « Overview, Projects, WORLD/FLOW/EXIT » — il y a cinq modules.
- `docs/CLI_EXPERIENCE.md:26` : « Run the enabled modules (WORLD/FLOW/EXIT) ».
- `docs/PROOFCORE_2_0_DELIVERY_REPORT.md:261` : ligne de tableau WORLD/FLOW/EXIT.
- `docs/PROOFCORE_AI_ARCHITECTURE.md:53` : `module_configure` « WORLD/FLOW/EXIT ».
- `docs/PROOFCORE_TRANSFORMATION_PROGRESS.md:120` : « WORLD/FLOW/EXIT PARTIEL ».
- Les cinq modules fonctionnent (walk ci-dessus : `/app/modules/{world,flow,exit,fail,clean}`
  rendent tous) et l'assistant IA outillé les couvre (`apps/api/src/routes/ai.ts`, 19 outils,
  dont `fail_scan` et `clean_audit`).

## 6. Mise à jour du 26 novembre 2026 (soir) — ce que l'audit ci-dessus ne savait pas encore

Base : `f130d2f`. Les sections 1 à 5 sont conservées telles quelles pour l'historique ;
leurs lignes **CSRF**, **rate limiting**, **Analysis canonique**, **remédiation** et
**fournisseur géré** sont périmées et corrigées ici, avec la preuve.

| Constat historique (section 1)                                     | État réel au 26 novembre (soir)                                                                                                                                        | Preuve                                                                                                                                                                                       |
| ------------------------------------------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Protection CSRF : ABSENT                                           | **VÉRIFIÉ** — écritures cookie authentifiées refusées hors des origines web configurées, plus `Sec-Fetch-Site: cross-site` refusé ; webhooks exemptés par conception | `apps/api/src/app.ts` (garde `/api/*`), `apps/api/test/security.test.ts` (assertion `cross_site_write`)                                                                                 |
| Rate limiting : PARTIEL, compteur mémoire par processus            | **VÉRIFIÉ distribué** — compteur en table `rate_limits`, incrément atomique avec `RETURNING`, fenêtre par portée                                                                                                                      | `apps/api/migrations/0023_rate_limits.sql`, `AppStore.hitRateLimit` (`apps/api/src/store/app-store.ts`)                                                                                     |
| Analyse persistante unifiée : ABSENT                               | **VÉRIFIÉ** — ressource Analysis (source, cible, scope, modules, couverture, statut) avec cycle de vie, annulation, historique et pagination                            | `apps/api/migrations/0021_analyses.sql`, `apps/api/src/routes/analyses.ts`, `apps/api/test/analyses.test.ts` (10 cas)                                                                       |
| Remédiation et vérification : ABSENT                               | **VÉRIFIÉ** — dix étapes ordonnées, `verified` uniquement par une seconde analyse, verdict `verified`/`still_failing`/`inconclusive`                                 | `apps/api/migrations/0022_remediations.sql`, `apps/api/src/routes/remediations.ts`, `apps/api/test/remediations.test.ts` (9 cas), `packages/core/src/remediation.ts`                        |
| Fournisseur IA géré : ABSENT                                       | **VÉRIFIÉ** — profil personnel prioritaire, sinon fournisseur géré du déploiement, sinon mode déterministe annoncé comme tel                                             | `apps/api/src/env.ts` (`managedAi`), `apps/api/src/routes/ai.ts`, `apps/api/test/ai-managed.test.ts` (4 cas)                                                                               |
| Onboarding : aucune UI                                             | **VÉRIFIÉ (parcours navigateur)** — quatre questions, recommandation calculée par le registre partagé, reprise à la première question sans réponse                        | `apps/web/src/pages/app/Onboarding.tsx`, `apps/api/src/routes/onboarding.ts`, `apps/api/test/onboarding.test.ts` (5 cas), parcours exécuté le 26 nov.                                      |
| File de remédiations : aucune UI                                   | **VÉRIFIÉ (parcours navigateur)** — filtres par statut, étape suivante, responsable et échéance, lien profond vers l'analyse d'origine et vers l'analyse de vérification | `apps/web/src/pages/app/Remediations.tsx`, parcours exécuté le 26 nov.                                                                                                                       |
| FLOW : scénarios éditables et persistés              | **VÉRIFIÉ (définition + exécution locale)** — éditeur d'étapes, validation partagée éditeur/serveur, CRUD scopé au workspace ; l'exécution locale passe par le même moteur Chromium/CDP que la CLI (`localScenario` injecté par `node.ts`), le Worker par la liaison `BROWSER`, et l'absence des deux est refusée en 503 avec l'alternative CLI | `packages/core/src/scenario-spec.ts`, `apps/api/src/routes/flow-studio.ts`, `apps/web/src/pages/app/FlowStudio.tsx`, `apps/api/test/flow-studio.test.ts` (6 cas), `packages/core/test/scenario-spec.test.ts` (7 cas), parcours navigateur du 26 nov. |
| FLOW : exécution navigateur réelle                   | **VÉRIFIÉ localement (26 nov.)** — le serveur Node injecte le même moteur Chromium/CDP que la CLI ; scénario enregistré lancé depuis `/app/flow` sur `example.com` : `PASS`, Analysis `WORKFLOW` `completed`, environnement `local-chromium`, couverture `flow`. La liaison Cloudflare `BROWSER` du Worker reste non exécutée ici | `apps/api/src/local-browser.ts`, `apps/api/src/browser-scenario.ts`, `apps/api/test/browser-scenario-local.test.ts` (3 cas) |
| Suite de tests : 69 fichiers / 818 tests (section 5.1)             | **SUPERSEDED** — 90 fichiers, 958 tests, `EXIT:0`                                                                                                                     | `npx vitest run` le 26 nov. (soir)                                                                                                                                                          |
| CI #105 : NON VÉRIFIÉ                                              | **Rapporté vert** par l'agent parallèle, avec deux exécutions nommées                                                                                                   | `docs/PROOFCORE_TRANSFORMATION_PROGRESS.md` (runs 45789093588 et 45795161825) — non rejoué depuis cette session                                                                              |
| Pages non examinées (phase 2.3) : signalement                      | **VÉRIFIÉ** — `/app/start` distingue les cinq cibles ; en mode site, les pages examinées, le budget épuisé et chaque adresse non suivie avec sa raison sont affichés avant/pendant le résultat ; l'Analysis Center enregistre l'analyse en `SITE` avec « 2/5 pages relues » | `apps/web/src/pages/app/Start.tsx`, `apps/web/src/pages/app/Analyses.tsx`, parcours du 26 nov. sur `www.w3.org` (budget 2) |
| Matrice 13 viewports (phase 8)                                     | **BLOQUÉ** — l'outil de prévisualisation est figé en 1280×800 ; aucun redimensionnement disponible                                                                      | —                                                                                                                                                                                             |

Toujours périmées et à corriger (aucune ne doit être lue comme un état actuel) : les
mentions « trois modules » de `docs/PROOFCORE_2_0_DELIVERY_REPORT.md` (document daté).
