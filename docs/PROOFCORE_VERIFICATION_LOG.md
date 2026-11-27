# PROOFCORE — Journal de vérification

Ce journal consigne les commandes exécutées, leur date et leur résultat. Les chiffres
ci-dessous ne sont pas recopiés d'une documentation : ils proviennent de la session
indiquée. Ils deviennent obsolètes à chaque modification du dépôt.

## Session du 2026-11-27 (UTC 09:09 pour le premier relevé)

Commit de base : `41ee5a3`, branche `master`. Le dépôt contenait déjà des modifications
non commitées de travaux en cours ; elles n'ont pas été réécrites.

| Commande                                    | Résultat observé                                                                                                                                                                                                                                                                     |
| ------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `pnpm lint` (`biome check .`)               | Échec initial : 3 fichiers Markdown non formatés (`APP-MEMORY.md`, `docs/PROOFCORE_AI_ARCHITECTURE.md`, `docs/PROOFCORE_CAPABILITY_MATRIX.md`). Corrigé par `biome format --write` sur ces trois fichiers, sans changement de contenu. Relance : `Checked 577 files`, aucune erreur. |
| `pnpm typecheck`                            | Réussi : `build:packages` puis passe `noEmit` sur les 16 paquets et les deux applications (web, api).                                                                                                                                                                                |
| `pnpm test` (vitest)                        | Réussi : 99 fichiers de test, 1025 tests, 0 échec. Durée 110 s.                                                                                                                                                                                                                      |
| `pnpm build`                                | Réussi (`✓ built`). Avertissement Vite : des chunks dépassent 500 kB (non bloquant).                                                                                                                                                                                                 |
| `node packages/cli/dist/index.js --version` | `0.6.3`                                                                                                                                                                                                                                                                              |
| `… doctor`                                  | 9 contrôles ok, 1 avertissement (pas de couleur en mode pipe), 0 échec.                                                                                                                                                                                                              |
| `… validate`                                | Configuration valide ; avertissement : WORLD activé sans cible produit ni formulaire.                                                                                                                                                                                                |
| `… test` (sur le dépôt lui-même)            | **Aucun cas vérifié** : 189 cas, 177 ignorés, 12 « non configurés ». La CLI l'annonce explicitement.                                                                                                                                                                                 |

## Registre npm (lecture seule, `npm view`)

| Nom              | Résultat                                                                                                                                   |
| ---------------- | ------------------------------------------------------------------------------------------------------------------------------------------ |
| `proofcore`      | Existe : version **0.6.0**, dépôt pointant vers ce projet, mainteneur `joelakichof67`. Propriété à confirmer par le responsable du projet. |
| `@proofcore/cli` | **404** : absent du registre.                                                                                                              |

Aucune publication n'a été faite. Le README a été corrigé pour ne plus affirmer que la
version 0.6.3 est publiée.

## Limites de cette session

- Les phases 2 à 9 de la mission (Analysis canonique, Capability Registry, Findings
  Engine, refonte d'interface, IA orchestratrice, remédiation, sécurité) ne sont pas
  livrées ici. Elles demandent des chantiers séparés, dont chacun doit produire un test
  qui échoue sans le correctif.
- Test navigateur : `pnpm test:e2e` lancé le 2026-11-27 (09:15 à 09:30 UTC environ,
  Chromium, projets desktop et mobile) : **46 réussis, 4 ignorés, 0 échec** (14,7 min).
  Les 4 ignorés sont des `test.skip` volontaires par projet d'appareil (`a11y`,
  `app-mobile`, `viewports`) et non des cas masqués. Le code de sortie final n'a pas été
  capturé dans le journal ; le compte de réussite est celui affiché par Playwright.

## Revue des routes API non auditées (lecture seule, 2026-11-27)

- `workspace.ts`, `notifications.ts`, `onboarding.ts`, `remediations.ts`,
  `project-intelligence.ts` : chaque handler appelle `requireWorkspace` (rôles
  demandés selon l'action) ; `project-intelligence` ajoute `requireProject`.
  `workspace.ts` valide les entrées par zod `.strict()`.
- `machine.ts` : authentifiée par jeton de projet `psk_…` (`Authorization: Bearer`),
  hachage du jeton avant recherche (`findApiKeyByTokenHash`). Pas de garde de
  workspace : c'est le modèle voulu, à documenter.
- `releases.ts` : routes GET publiques par conception ; le nom d'asset est filtré par
  regex `^[A-Za-z0-9._+-]{1,160}$` (pas de traversée de chemin).
- `project-intelligence.ts:117` : la sortie IA est analysée par `JSON.parse` dans un
  `try` ; un échec renvoie un résumé tronqué sans lever d'erreur.
- Non confirmé dans cette passe : la validation des corps de `remediations.ts` et
  `onboarding.ts` (non lus en détail) et les adaptateurs `packages/adapters/*`.
- Le test CLI n'a pas été exécuté contre une cible réelle : aucun site n'a été analysé
  sans autorisation explicite.

## Phase 9 — limitation de débit de l'API machine (2026-11-27)

Commandes et résultats (depuis la racine du dépôt) :

- `npx vitest run apps/api/test/machine-rate-limit.test.ts` **avant correctif** :
  3 échecs (200 au lieu de 429 ; 401 au lieu de 429).
- Même commande **après correctif** : 3/3 réussis (295 ms).
- `npx vitest run apps/api/test` : 48 fichiers, 377 tests, tous réussis.
- `npx tsc -p tsconfig.json --noEmit` dans `apps/api` : sortie 0.
- `npx biome check` sur les 4 fichiers touchés : aucune correction.

Fichiers : `apps/api/src/env.ts`, `apps/api/src/routes/machine.ts`,
`apps/api/test/harness.ts` (surcharges d'environnement, comportement par défaut inchangé),
`apps/api/test/machine-rate-limit.test.ts` (nouveau).

Tableau de statut :

| Fonction                                       | Code présent  | Test exécuté | Test réussi | Parcours vérifié                                                   | Production vérifiée |
| ---------------------------------------------- | ------------- | ------------ | ----------- | ------------------------------------------------------------------ | ------------------- |
| Limite par clé `psk_` (`/v1/*`)                | oui (serveur) | oui          | oui         | PARTIEL : API via `app.request` du harnais, pas de client CLI réel | NON VÉRIFIÉ         |
| Limite d'échecs d'authentification par adresse | oui (serveur) | oui          | oui         | PARTIEL : `x-forwarded-for` simulé                                 | NON VÉRIFIÉ         |

Limites : aucun client client-side pour ces limites ; la sortie de la CLI face à un 429
n'a pas été testée. Les valeurs par défaut (120 et 20 par minute) sont des choix non
validés par le produit. Les budgets dépendent de la base distribuée ; en mode dégradé
(repli mémoire), ils sont par processus.

## Session complémentaire — 2026-11-27

Dépôt local observé sur `master`, HEAD `41ee5a3`. Les modifications locales préexistantes
n'ont pas été réinitialisées. `pnpm` affiche un avertissement indiquant qu'il utilise son
fallback Node.js car son binaire natif n'a pas été installé (scripts de build ignorés).

| Commande                                                                                                                                                                                                                                                                                                                                                               | Résultat constaté                                                                                                                                                                                                                                                  |
| ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `pnpm lint`                                                                                                                                                                                                                                                                                                                                                            | Échec initial sur les tableaux non formatés dans plusieurs documents d'audit. Après formatage : `pnpm lint` → `Checked 579 files in 2s. No fixes applied.`; relance après mise à jour de la matrice également réussie.                                             |
| `pnpm exec tsc -p apps/api/tsconfig.json --noEmit`                                                                                                                                                                                                                                                                                                                     | Sortie 0 (réussi).                                                                                                                                                                                                                                                 |
| `pnpm exec vitest run apps/api/test/analyses.test.ts apps/api/test/ai.test.ts apps/api/test/ai-tools.test.ts apps/api/test/machine-rate-limit.test.ts apps/api/test/remediations.test.ts apps/api/test/code-patch.test.ts apps/api/test/finding-patch.test.ts apps/api/test/remediation-plan.test.ts apps/api/test/verify-patch.test.ts --maxWorkers=1 --minWorkers=1` | 9 fichiers, 88 tests réussis, 0 échec; relance confirmée, 19,62 s.                                                                                                                                                                                                 |
| `pnpm exec vitest run apps/api/test --maxWorkers=1 --minWorkers=1`                                                                                                                                                                                                                                                                                                     | Échec : `apps/api/test/read-repo.test.ts` contient 2 tests qui requièrent GitHub; les deux échouent avec `fetch failed` (réseau sortant indisponible). Les autres tests poursuivaient; aucun résultat final complet n'a été capturé. Cas non remplacés ni ignorés. |
| `pnpm typecheck`                                                                                                                                                                                                                                                                                                                                                       | Dépassement du délai terminal (120 s). La sortie montre le build des packages et le build web terminé, puis le script enchaînait le typecheck `--noEmit`; bilan final non capturé.                                                                                 |
| `pnpm build` (lancé au sein de `pnpm typecheck`)                                                                                                                                                                                                                                                                                                                       | Sortie atteignant `✔ build complete`; avertissements Vite sur chunks >500 kB. Code de sortie indépendant non capturé : PARTIEL.                                                                                                                                    |
| `pnpm exec playwright test --config tests/playwright.config.ts --list`                                                                                                                                                                                                                                                                                                 | Inventaire réussi : 50 tests dans 8 fichiers, projets desktop/mobile. Aucun navigateur lancé par cette commande.                                                                                                                                                   |
| `git diff --check`                                                                                                                                                                                                                                                                                                                                                     | Réussi après les modifications documentaires finales.                                                                                                                                                                                                              |

Aucune requête n'a été envoyée à GitHub, au registre npm, à la production ni à un site cible.
Aucune publication ou opération de déploiement n'a été effectuée. Le parcours réel de production
et les captures navigateur restent **NON VÉRIFIÉS**.

| Fonction                                     | Code présent | Test exécuté | Test réussi                   | Parcours vérifié                                                        | Production vérifiée |
| -------------------------------------------- | ------------ | ------------ | ----------------------------- | ----------------------------------------------------------------------- | ------------------- |
| Lint                                         | oui          | oui          | oui                           | —                                                                       | —                   |
| Typecheck API                                | oui          | oui          | oui                           | tests compilés, pas de parcours utilisateur                             | NON VÉRIFIÉ         |
| Analysis canonique et contrôles API associés | oui          | oui, ciblé   | oui, 88 tests ciblés combinés | PARTIEL : routes exercées dans harnais; pas de navigateur cette session | NON VÉRIFIÉ         |
| Tous tests API (incluant read_repo externe)  | oui          | oui          | NON : 2 échecs réseau GitHub  | NON VÉRIFIÉ                                                             | NON VÉRIFIÉ         |
| UI responsive / parcours web réel            | oui          | non          | NON VÉRIFIÉ                   | NON VÉRIFIÉ                                                             | NON VÉRIFIÉ         |

## Phase 9 — renforcement des écritures cross-site (session du 27 novembre)

Changement local : `apps/api/src/app.ts` refuse les mutations `/api/*` portant un cookie
lorsque `Sec-Fetch-Site: cross-site`; le contrôle `Origin` autorisé/non autorisé est
conservé. Les appels CLI/API sans Fetch Metadata ne sont pas refusés par défaut, afin de
préserver leur contrat. La route signup et les webhooks restent compatibles. Le client Web
central `apps/web/src/lib/api.ts` ajoute `Origin` et `Sec-Fetch-Site: same-origin` sur les
mutations passant par `apiFetch`.

Périmètre non couvert : les appels directs `fetch` dans des pages (notamment certains
chemins scan/IA/terminal) n'utilisent pas forcément `apiFetch`. Les contrôles qui exigeraient
la présence absolue de ces en-têtes ont été essayés puis retirés après régression des tests
server-to-server/intégration. Le contrôle CSRF n'est donc pas déclaré exhaustif.

| Commande                                                                                                                                                                    | Résultat constaté                                                                                                                              |
| --------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------- |
| `pnpm exec vitest run apps/api/test/security.test.ts apps/api/test/origin.test.ts apps/api/test/pagination-and-guards.test.ts --maxWorkers=1 --minWorkers=1`                | 3 fichiers, 26 tests réussis, 0 échec.                                                                                                         |
| `pnpm exec vitest run apps/api/test --exclude apps/api/test/read-repo.test.ts --maxWorkers=1 --minWorkers=1`                                                                | 47 fichiers, 375 tests réussis, 0 échec, 85,47 s. `read-repo.test.ts` conservé; non exécuté dans cette suite car il requiert le réseau GitHub. |
| `pnpm exec tsc -p apps/api/tsconfig.json --noEmit`                                                                                                                          | Sortie 0.                                                                                                                                      |
| `pnpm --filter @proofcore/web build`                                                                                                                                        | Réussi (`✓ built`), avertissement Vite sur chunks >500 kB.                                                                                     |
| `pnpm exec biome check apps/api/src/app.ts apps/api/test/security.test.ts apps/api/test/origin.test.ts apps/api/test/pagination-and-guards.test.ts apps/web/src/lib/api.ts` | Réussi : 5 fichiers, aucune correction.                                                                                                        |
| `git diff --check`                                                                                                                                                          | Réussi.                                                                                                                                        |

| Fonction                                                      | Code présent | Test exécuté         | Test réussi | Parcours vérifié                                              | Production vérifiée |
| ------------------------------------------------------------- | ------------ | -------------------- | ----------- | ------------------------------------------------------------- | ------------------- |
| Refus `Sec-Fetch-Site: cross-site` pour écriture avec cookie  | oui          | oui, sécurité/origin | oui         | PARTIEL : routes via `app.request`, navigateur réel non lancé | NON VÉRIFIÉ         |
| CORS/origin allowlist                                         | oui          | oui, origin.test     | oui         | PARTIEL : harnais HTTP, pas de production                     | NON VÉRIFIÉ         |
| Couverture de tous les appels Web et tous endpoints sensibles | partielle    | non exhaustif        | NON VÉRIFIÉ | NON VÉRIFIÉ                                                   | NON VÉRIFIÉ         |

## QA interface / mobile — session du 2026-11-27

Le parcours ciblé du menu mobile et de la bascule Simple/Studio a été exercé sur le
stack local Playwright ; le scan public du second test mobile n'a pas été lancé. La passe
WCAG 2.2 AA axe-core a été exécutée sur les pages publiques et les écrans app listés dans
le test. Le balayage visuel/overflow a couvert les 13 tailles (320×700 à 2560×1440) et
six routes ; une première exécution a fini en erreur de fermeture Playwright (`ENOENT`)
après génération du rapport. Relance identique : réussite.

| Commande                                                                                                                             | Résultat constaté                                                                                                                                   |
| ------------------------------------------------------------------------------------------------------------------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------- |
| `pnpm exec playwright test --config tests/playwright.config.ts --project=mobile tests/e2e/app-mobile.spec.ts -g "mobile menu opens"` | Réussi : 1 test, menu mobile, navigation Guide en français et bascule mode expert.                                                                  |
| `pnpm exec playwright test --config tests/playwright.config.ts --project=desktop tests/e2e/a11y.spec.ts`                             | Réussi : 1 test axe-core, WCAG 2.2 AA sur 7 routes; aucune violation détectée par axe. Cette passe n'est pas une certification WCAG complète.       |
| `pnpm exec playwright test --config tests/playwright.config.ts --project=desktop tests/e2e/viewports.spec.ts`                        | Réussi : 1 test, 78 combinaisons route/taille, zéro overflow horizontal et zéro erreur console. Captures et rapport sous `test-results/viewports/`. |
| `pnpm typecheck`                                                                                                                     | Réussi : build/typecheck des paquets, desktop et web.                                                                                               |
| `pnpm lint`                                                                                                                          | Réussi : `Checked 579 files`, aucune correction.                                                                                                    |
| `pnpm --filter @proofcore/web build`                                                                                                 | Réussi ; avertissements non bloquants pour le chunk Auth >500 kB et l'option Vite `advancedChunks` dépréciée.                                       |
| `pnpm exec vitest run apps/api/test/security.test.ts apps/api/test/origin.test.ts --maxWorkers=1 --minWorkers=1`                     | Réussi : 2 fichiers, 16 tests.                                                                                                                      |
| `git diff --check`                                                                                                                   | Réussi.                                                                                                                                             |

Une injection manuelle de `Origin` et `Sec-Fetch-Site` dans le `fetch` client a été
retirée de `apps/web/src/lib/api.ts` : le code Web ne peut pas définir ces en-têtes
contrôlés par le navigateur. La défense actuelle reste fondée sur l'allowlist `Origin`
quand l'en-tête est présent et sur `Sec-Fetch-Site: cross-site` pour les mutations avec
cookie. La couverture des appels directs et des clients sans Fetch Metadata reste
partielle.

| Fonction                                                    | Code présent | Test exécuté              | Test réussi   | Parcours vérifié                                                  | Production vérifiée |
| ----------------------------------------------------------- | ------------ | ------------------------- | ------------- | ----------------------------------------------------------------- | ------------------- |
| Menu mobile / parcours guide                                | oui          | Playwright mobile, ciblé  | oui           | VÉRIFIÉ sur stack local uniquement                                | NON VÉRIFIÉ         |
| Layout responsive, 13 tailles × 7 routes (dont l'assistant) | oui          | Playwright Chromium       | oui           | VÉRIFIÉ sur stack local; les captures sont des artefacts de test  | NON VÉRIFIÉ         |
| Axe-core WCAG 2.2 AA                                        | oui          | Playwright + axe          | oui, 8 routes | PARTIEL : audit automatisé, clavier/lecteur d'écran non certifiés | NON VÉRIFIÉ         |
| Contrôle cross-site des mutations                           | oui          | 16 tests unitaires ciblés | oui           | PARTIEL : harnais API, pas un navigateur réel                     | NON VÉRIFIÉ         |

## Assistant : navigateur piloté, jetons réels et mobile 320 px — 2026-11-27

- **Quatre outils navigateur** : `browser_open`, `browser_read`, `browser_act`,
  `browser_close`. Le Worker ouvre une session Cloudflare Browser Rendering et stocke
  son propriétaire en D1 ; le serveur Node ouvre le Chromium de la machine via
  `packages/adapters/browser`. Même interface, mêmes sélecteurs, même capture. Une
  session locale expire après dix minutes d'inactivité et vérifie le propriétaire.
- **Jetons** : le budget de contexte est appliqué avant l'appel (16 k/32 k/64 k/96 k
  selon l'effort), l'historique est coupé par messages entiers, et chaque `usage`
  fournisseur (réponse, lentilles, synthèse, curateur) est additionné. `/chat` renvoie
  `usage.context` et persiste `usage` sur le message assistant.
- **Interface** : compteur de contexte avec `role="progressbar"`, coût entrée/sortie par
  message, catalogue chargé depuis `GET /api/v1/ai/tools` (36 outils, classes de
  permission affichées) au lieu d'une liste codée en dur. Sous 560 px, le texte de
  « burn » de l'effort disparaît pour laisser chaque contrôle cliquable ; vérifié à
  320×700.
- **Preuves** :

| Commande                                                                                 | Résultat constaté                                                                                                                                                          |
| ---------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `npx vitest run apps/api/test/local-browser-agent.test.ts`                               | 1/1 : Chromium local réel, ouverture, clic, saisie, relecture, refus d'un autre propriétaire, fermeture.                                                                   |
| `npx vitest run apps/api/test/ai.test.ts apps/api/test/ai-tools.test.ts`                 | 39/39 : usage fournisseur sommé et persisté, boucle `browser_open → browser_act → browser_close` sur agent injecté, refus honnête `browser_unavailable`, catalogue classé. |
| `npx tsc --noEmit -p apps/api` et `-p apps/web`                                          | Sortie 0.                                                                                                                                                                  |
| `pnpm --filter @proofcore/web build`                                                     | Réussi.                                                                                                                                                                    |
| `npx playwright test ... tests/e2e/app-mobile.spec.ts --project=mobile -g "320px phone"` | 1/1 : assistant à 320×700, jauge visible, `browser_open`/`browser_act` dans le dialogue, zéro overflow.                                                                    |

- **Passe visuelle et accessibilité (même arbre)** :
  `npx playwright test ... tests/e2e/viewports.spec.ts --project=desktop --timeout=600000`
  → 1/1, 13 tailles × 7 routes (dont `/app/ai`), 6,0 min, zéro overflow et zéro
  erreur console ;
  `npx playwright test ... tests/e2e/a11y.spec.ts --project=desktop` → 1/1, 8 pages
  (dont `/app/ai`), aucune violation WCAG 2.2 AA après remontée du contraste des
  compteurs `/ 32k` et `0 tok` à `--ink-soft`.

- **Limites** : le chemin Cloudflare `BROWSER` est implémenté mais n'a pas été exécuté
  dans le harnais local (aucune liaison `browser` sur cette machine) ; il reste
  NON VÉRIFIÉ en production. Le test Chromium local est réel, pas un stub.
