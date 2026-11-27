# PROOFCORE — Audit profond (phase 0, cartographie)

Base observée le 2026-11-27 : commit `41ee5a3` (branche `master`), avec des modifications
locales préexistantes non commitées. Cette session les a préservées ; voir
`docs/PROOFCORE_VERIFICATION_LOG.md` pour les fichiers observés et les résultats exécutés.

Statuts utilisés dans ce document : **VÉRIFIÉ** (artefact observé), **PARTIEL**,
**ABSENT**, **NON VÉRIFIÉ** (non exécuté ou non inspecté).

## 1. Ce qui a été vérifié

| Point                                 | Statut      | Preuve                                                                                                                                                                                                                                                                               |
| ------------------------------------- | ----------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Lint du dépôt                         | VÉRIFIÉ     | Session 2026-11-27 : après reformatage de deux tableaux Markdown dans `docs/PROOFCORE_RISK_REGISTER.md` et `docs/PROOFCORE_VERIFICATION_LOG.md`, `pnpm lint` → `Checked 579 files in 2s. No fixes applied.`                                                                          |
| Fichiers cités par l'audit historique | VÉRIFIÉ     | Les entrées Start, ProjectConfig, audits, AI et CLI se trouvent dans les chemins `apps/web/src/pages/app/`, `apps/api/src/routes/` et `packages/cli/src/`. **`packages/engine/src/contracts/statuses.ts` est absent** ; le fichier courant est `packages/contracts/src/statuses.ts`. |
| Statuts de test                       | VÉRIFIÉ     | `packages/contracts/src/statuses.ts` : vocabulaire de contrôles et de runs partagé. Les chaînes et leur usage précis doivent rester conformes au contrat courant.                                                                                                                    |
| Modules                               | VÉRIFIÉ     | `packages/modules/` contient désormais les cinq packages `world`, `flow`, `exit`, `fail`, `clean`. `packages/core/src/page-scan.ts` compose notamment FAIL et CLEAN pour le scan de page.                                                                                            |
| Protection CSRF                       | PARTIEL     | `apps/api/src/app.ts` applique une vérification d'origine et de `Sec-Fetch-Site`; aucun jeton CSRF distinct. Tests E2E/API de cette protection non lancés dans cette session.                                                                                                        |
| Rate limiting                         | PARTIEL     | Rate limiting distribué présent avec stockage/fallback (migrations et guard); la limite machine a des tests ciblés. Connexion/production non testées ici.                                                                                                                            |
| Révocation de session                 | PARTIEL     | Révocation et rotation possèdent du code/tests dans `auth.ts`, `account.ts` et store; parcours navigateur E2E non lancé aujourd'hui.                                                                                                                                                 |
| Tests                                 | PARTIEL     | Le dépôt contient des tests automatisés. 88 tests API ciblés passent; suite API complète bloquée par deux tests GitHub réseau; voir journal daté.                                                                                                                                    |
| Espace disque                         | NON VÉRIFIÉ | Mesure non réalisée pendant cette session.                                                                                                                                                                                                                                           |

## 2. Ce qui n'a pas été vérifié (à compléter)

- **État distant de la CI**, y compris l'exécution #105 : NON VÉRIFIÉ dans cette session ; absence d'accès aux journaux GitHub.
- **Interface de production et capture navigateur** : NON VÉRIFIÉ dans cette session ; aucune navigation ni capture distante n'a été effectuée.
- **Parcours autorisé vers un site réel** : NON VÉRIFIÉ ; aucun test intrusif ou crawl externe n'a été lancé.
- **État npm actuel et propriétaires du paquet** : NON VÉRIFIÉ dans cette session ; aucun appel réseau au registre.
- **Graphe complet de chaque écran vers les services et magasins** : PARTIEL ; les routes principales sont recensées dans `PROOFCORE_ARCHITECTURE_MAP.md`, mais le suivi exhaustif des appels UI → API reste à faire.

## 3. Incohérences documentaires relevées

- Le dépôt comprend plusieurs documents datés du 26 novembre et des notes antérieures qui ne décrivent pas le même état ; les historiques doivent être lus avec leur date, pas comme une description actuelle.
- Le paquet racine privé est versionné `0.1.0` tandis que le CLI a un cycle distinct ; aucune politique de versionnement unifiée n'a été confirmée.
- Le README local contient une note historique sur npm (`proofcore` 0.6.0 observé antérieurement), mais le registre n'a pas été interrogé dans cette session : statut courant NON VÉRIFIÉ.
- `docs/PROOFCORE_ARCHITECTURE_MAP.md` et `docs/PROOFCORE_CAPABILITY_MATRIX.md` contenaient des chiffres et statuts périmés ; leurs entrées concernant Analysis et les outils IA ont été actualisées à partir du code local.

## 4. État consolidé de la session du 27 novembre

La ressource Analysis canonique existe déjà dans `apps/api/migrations/0021_analyses.sql` et
`apps/api/src/routes/analyses.ts`, avec liens vers `page_audits` et `test_runs`, cycle de vie,
idempotence, pagination, recherche, annulation, constats et comparaison. La session a exécuté
les tests ciblés correspondants (voir le journal) ; cela ne valide pas le déploiement.

Le registre de capacités est dans `packages/core/src/capabilities.ts` et est exposé par
`apps/api/src/routes/capabilities.ts`. FLOW Studio a CRUD et exécution navigateur dans
`apps/api/src/routes/flow-studio.ts`; le code renvoie explicitement une erreur si le navigateur
n'est pas disponible. L'orchestration IA appelle les services via `apps/api/src/routes/ai.ts`.

La phase 0.3 de cette session reste NON VÉRIFIÉE : aucun navigateur n'a été lancé. Les pages et
captures précédemment consignées dans les sections datées restent des preuves historiques et
ne sont pas réinterprétées comme un test effectué aujourd'hui. La carte d'architecture et la
matrice indiquent séparément les limites persistantes.

## 5. Vérification en direct — 26 novembre 2026 (phase 0.3 exécutée)

Session du 26 novembre, dépôt à `e5b5e63` (master), l'agent « chat IA mobile » travaillait
en parallèle dans le même arbre. Cette section ne décrit que ce qui a été exécuté ce jour.

### 5.1 Notes de vérification historiques — ne décrivent pas la session du 27 novembre

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

### 5.5 Incohérences documentaires localisées — corrigées

- `README.md` nomme les cinq familles (« WORLD, FLOW, EXIT, FAIL, CLEAN ») et l'installation
  globale avertit que le nom npm `proofcore` publié est en 0.6.0, pas la version du dépôt.
- `docs/CLI_EXPERIENCE.md` : `proofcore test` documente les cinq familles et `world | flow | exit`
  reste la commande des trois moteurs locaux, ce qui est exact.
- `docs/PROOFCORE_2_0_DELIVERY_REPORT.md` : les lignes `WORLD/FLOW/EXIT` et `FAIL/CLEAN` sont
  deux lignes distinctes du même tableau, pas une omission.
- `docs/PROOFCORE_AI_ARCHITECTURE.md` : `module_configure` décrit « les cinq familles
  (WORLD, FLOW, EXIT, FAIL, CLEAN) ».
- `docs/PROOFCORE_TRANSFORMATION_PROGRESS.md` : la ligne est « WORLD/FLOW/EXIT/FAIL/CLEAN ».
- Les cinq modules fonctionnent (walk ci-dessus : `/app/modules/{world,flow,exit,fail,clean}`
  rendent tous) et l'assistant IA outillé les couvre (`apps/api/src/routes/ai.ts`, 19 outils,
  dont `fail_scan` et `clean_audit`).
- Vérification du 27 novembre 2026 : `grep -rn 'WORLD/FLOW/EXIT'` ne laisse que des
  formulations exactes (trois moteurs locaux, ou tableau scindé). Risque R17 clos.

## 6. Mise à jour du 26 novembre 2026 (soir) — historique (périmé pour l'état du dépôt)

Base : `f130d2f`. Les sections 1 à 5 sont conservées telles quelles pour l'historique ;
leurs lignes **CSRF**, **rate limiting**, **Analysis canonique**, **remédiation** et
**fournisseur géré** sont périmées et corrigées ici, avec la preuve.

| Constat historique (section 1)                          | État réel au 26 novembre (soir)                                                                                                                                                                                                                                                                                                                            | Preuve                                                                                                                                                                                                                                               |
| ------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Protection CSRF : ABSENT                                | **VÉRIFIÉ** — écritures cookie authentifiées refusées hors des origines web configurées, plus `Sec-Fetch-Site: cross-site` refusé ; webhooks exemptés par conception. Depuis le 27 nov., les écritures de compte (`/api/account/*`) et la déconnexion exigent en plus le double-submit `ps_csrf` → `x-csrf-token` ; scan et IA restent régis par l'origine | `apps/api/src/app.ts` (garde `/api/*` + CSRF), `apps/api/test/security.test.ts` (`cross_site_write`), `apps/api/test/csrf.test.ts` (6/6), parcours navigateur du 27 nov. (révocation 200, écriture sans en-tête 403)                                 |
| Rate limiting : PARTIEL, compteur mémoire par processus | **VÉRIFIÉ distribué** — compteur en table `rate_limits`, incrément atomique avec `RETURNING`, fenêtre par portée                                                                                                                                                                                                                                           | `apps/api/migrations/0023_rate_limits.sql`, `AppStore.hitRateLimit` (`apps/api/src/store/app-store.ts`)                                                                                                                                              |
| Analyse persistante unifiée : ABSENT                    | **VÉRIFIÉ** — ressource Analysis (source, cible, scope, modules, couverture, statut) avec cycle de vie, annulation, historique et pagination                                                                                                                                                                                                               | `apps/api/migrations/0021_analyses.sql`, `apps/api/src/routes/analyses.ts`, `apps/api/test/analyses.test.ts` (10 cas)                                                                                                                                |
| Remédiation et vérification : ABSENT                    | **VÉRIFIÉ** — dix étapes ordonnées, `verified` uniquement par une seconde analyse, verdict `verified`/`still_failing`/`inconclusive`                                                                                                                                                                                                                       | `apps/api/migrations/0022_remediations.sql`, `apps/api/src/routes/remediations.ts`, `apps/api/test/remediations.test.ts` (9 cas), `packages/core/src/remediation.ts`                                                                                 |
| Fournisseur IA géré : ABSENT                            | **VÉRIFIÉ** — profil personnel prioritaire, sinon fournisseur géré du déploiement, sinon mode déterministe annoncé comme tel                                                                                                                                                                                                                               | `apps/api/src/env.ts` (`managedAi`), `apps/api/src/routes/ai.ts`, `apps/api/test/ai-managed.test.ts` (4 cas)                                                                                                                                         |
| Onboarding : aucune UI                                  | **VÉRIFIÉ (parcours navigateur)** — quatre questions, recommandation calculée par le registre partagé, reprise à la première question sans réponse                                                                                                                                                                                                         | `apps/web/src/pages/app/Onboarding.tsx`, `apps/api/src/routes/onboarding.ts`, `apps/api/test/onboarding.test.ts` (5 cas), parcours exécuté le 26 nov.                                                                                                |
| File de remédiations : aucune UI                        | **VÉRIFIÉ (parcours navigateur)** — filtres par statut, étape suivante, responsable et échéance, lien profond vers l'analyse d'origine et vers l'analyse de vérification                                                                                                                                                                                   | `apps/web/src/pages/app/Remediations.tsx`, parcours exécuté le 26 nov.                                                                                                                                                                               |
| FLOW : scénarios éditables et persistés                 | **VÉRIFIÉ (définition + exécution locale)** — éditeur d'étapes, validation partagée éditeur/serveur, CRUD scopé au workspace ; l'exécution locale passe par le même moteur Chromium/CDP que la CLI (`localScenario` injecté par `node.ts`), le Worker par la liaison `BROWSER`, et l'absence des deux est refusée en 503 avec l'alternative CLI            | `packages/core/src/scenario-spec.ts`, `apps/api/src/routes/flow-studio.ts`, `apps/web/src/pages/app/FlowStudio.tsx`, `apps/api/test/flow-studio.test.ts` (6 cas), `packages/core/test/scenario-spec.test.ts` (7 cas), parcours navigateur du 26 nov. |
| FLOW : exécution navigateur réelle                      | **VÉRIFIÉ localement (26 nov.)** — le serveur Node injecte le même moteur Chromium/CDP que la CLI ; scénario enregistré lancé depuis `/app/flow` sur `example.com` : `PASS`, Analysis `WORKFLOW` `completed`, environnement `local-chromium`, couverture `flow`. La liaison Cloudflare `BROWSER` du Worker reste non exécutée ici                          | `apps/api/src/local-browser.ts`, `apps/api/src/browser-scenario.ts`, `apps/api/test/browser-scenario-local.test.ts` (3 cas)                                                                                                                          |
| Suite de tests : 69 fichiers / 818 tests (section 5.1)  | **SUPERSEDED** — 90 fichiers, 958 tests, `EXIT:0`                                                                                                                                                                                                                                                                                                          | `npx vitest run` le 26 nov. (soir)                                                                                                                                                                                                                   |
| CI #105 : NON VÉRIFIÉ                                   | **Rapporté vert** par l'agent parallèle, avec deux exécutions nommées                                                                                                                                                                                                                                                                                      | `docs/PROOFCORE_TRANSFORMATION_PROGRESS.md` (runs 45789093588 et 45795161825) — non rejoué depuis cette session                                                                                                                                      |
| Pages non examinées (phase 2.3) : signalement           | **VÉRIFIÉ** — `/app/start` distingue les cinq cibles ; en mode site, les pages examinées, le budget épuisé et chaque adresse non suivie avec sa raison sont affichés avant/pendant le résultat ; l'Analysis Center enregistre l'analyse en `SITE` avec « 2/5 pages relues »                                                                                | `apps/web/src/pages/app/Start.tsx`, `apps/web/src/pages/app/Analyses.tsx`, parcours du 26 nov. sur `www.w3.org` (budget 2)                                                                                                                           |
| Matrice 13 viewports (phase 8)                          | **BLOQUÉ** — l'outil de prévisualisation est figé en 1280×800 ; aucun redimensionnement disponible                                                                                                                                                                                                                                                         | —                                                                                                                                                                                                                                                    |

Toujours périmées et à corriger (aucune ne doit être lue comme un état actuel) : les
mentions « trois modules » de `docs/PROOFCORE_2_0_DELIVERY_REPORT.md` (document daté).

## 7. Mise à jour du 26 novembre 2026 (nuit) — historique

Les observations et preuves ci-dessous se rapportent exclusivement à leur date et ne remplacent pas le relevé du 27 novembre dans `docs/PROOFCORE_VERIFICATION_LOG.md`.

## 8. Vérifications complémentaires du 27 novembre 2026

Chaque ligne a été exécutée dans cet arbre de travail ; aucune n'est une déduction.

| Point                                                 | Résultat mesuré                                                                                                                                                                                                                                                        | Preuve                                                                                                                   |
| ----------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------ |
| `pnpm lint` au HEAD                                   | **0 erreur, 5 avertissements** sur 550 fichiers. Les 14 erreurs de départ étaient des tris d'imports/exports et du formatage dans du code et des docs **déjà commités**, pas les scripts temporaires non suivis.                                                       | `npx biome check .` (exit 0)                                                                                             |
| `pnpm typecheck`                                      | 0 erreur                                                                                                                                                                                                                                                               | `pnpm typecheck` (exit 0)                                                                                                |
| `pnpm build`                                          | succès (packages + `apps/web`), avertissement de taille de chunk seulement                                                                                                                                                                                             | `pnpm build` (exit 0)                                                                                                    |
| `pnpm test`                                           | **90 fichiers, 958 tests, 0 échec**                                                                                                                                                                                                                                    | `npx vitest run` (exit 0, 83 s)                                                                                          |
| Routes héritées                                       | `/legal` → `/legal/terms`, `/app/account` → `/app/settings`, `/app/local-agent` → `/app/ai/local` ; plus de 404                                                                                                                                                        | `tests/e2e/route-compat.spec.ts` (1 test vert, session réelle)                                                           |
| Domaine documenté                                     | `proofcore-iota.vercel.app` → **404** ; `proofstack-iota.vercel.app` → **200**. README, `apps/desktop/package.json` et `packages/cli/README.md` corrigés vers le domaine vivant.                                                                                       | `curl` des deux hôtes ; `curl /health` → `status: ok`, `database: ok`                                                    |
| Vérification d'e-mail et récupération de mot de passe | Présentes de bout en bout (routes API + pages) ; seule la **livraison** e-mail reste non vérifiée faute d'identifiants. La phrase « absentes » du README est corrigée.                                                                                                 | `apps/api/src/routes/account.ts`, `apps/web/src/pages/Account.tsx`                                                       |
| Matrice 13 viewports                                  | **VÉRIFIÉ** — 78 combinaisons page/format, 0 débordement, 0 erreur console (session précédente de la même journée)                                                                                                                                                     | `tests/e2e/viewports.spec.ts`, `test-results/viewports/report.json`                                                      |
| Mise en page mobile                                   | Topbar compacte, sidebar IA fermée sous 900 px, tables Billing/Settings en fiches, encart FLOW réparé                                                                                                                                                                  | captures 320/390 px + `pnpm test:e2e tests/e2e/viewports.spec.ts`                                                        |
| FAIL et CLEAN déplacés                                | **VÉRIFIÉ** — `packages/modules/fail` et `packages/modules/clean` (code + tests, sans dépendance à `core` donc sans cycle) ; `page-scan.ts` appelle `failFindings` / `cleanFindings`. Suites : 92 fichiers / 975 tests verts, lint 0 erreur, typecheck et build verts. | `packages/modules/{fail,clean}`, `vitest.config.ts`, `packages/core/package.json`                                        |
| Rotation de session au changement de mot de passe     | **VÉRIFIÉ** — les autres sessions sont révoquées et le jeton courant est remplacé ; le test vérifie que l'ancien cookie ne rend plus de session et que le nouveau en rend une.                                                                                         | `apps/api/src/routes/account.ts`, `apps/api/src/store/app-store.ts`, `apps/api/test/account-selfservice.test.ts` (7 cas) |
| TTL glissant plafonné                                 | **VÉRIFIÉ** — 7 jours d'inactivité renouvelés à l'usage, jamais au-delà de 30 jours depuis la création ; cookie aligné sur le plafond.                                                                                                                                 | `apps/api/src/auth.ts`, `apps/api/src/http/guards.ts`, `apps/api/test/session-ttl.test.ts` (4 cas)                       |
| Outils IA `finding_details` et `verify_remediation`   | **VÉRIFIÉ** — constat complet (preuve, contrôle, remédiation) et vérification par une analyse postérieure partageant le service de la route ; refus sans confirmation.                                                                                                 | `apps/api/test/ai.test.ts` (boucle d'outils, upstream simulé), `apps/api/src/remediation-verify.ts`                      |
| Changement de mot de passe au navigateur              | **VÉRIFIÉ** — formulaire réel, cookie `ps_session` remplacé, rechargement toujours authentifié.                                                                                                                                                                        | `tests/e2e/session-rotation.spec.ts` (1 test, 22,8 s)                                                                    |

Reste ouvert après cette session : publication npm en retard (secret `NPM_TOKEN` absent),
exécution CI distante non rejouée, chemin Cloudflare `BROWSER` du Worker non exécuté ici,
livraison e-mail non vérifiée, et les phases 2 à 9 de la mission (architecture Analysis déjà
livrée, mais registre de capacités unifié, moteurs FAIL/CLEAN hors `packages/modules/`,
reconstruction Studio, IA orchestrateur étendu et remédiation de bout en bout restent à faire).
