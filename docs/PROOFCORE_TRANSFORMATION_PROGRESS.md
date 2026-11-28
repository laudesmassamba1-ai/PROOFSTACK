# PROOFCORE — progression de la transformation

État : 27 novembre 2026. Une étape n'est « terminée » que si son résultat est mesuré.
Les statuts utilisés : **FAIT**, **PARTIEL**, **BLOQUÉ**, **NON COMMENCÉ**.

## Étape A — Stabilisation

| Élément                       | État    | Preuve                                                                                                                                                                                                                       |
| ----------------------------- | ------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Installation reproductible    | FAIT    | `pnpm install`, workspace pnpm                                                                                                                                                                                               |
| Lint                          | FAIT    | 496 fichiers, 0 erreur (21 diagnostics corrigés dans cette passe)                                                                                                                                                            |
| Types                         | FAIT    | `pnpm typecheck` OK                                                                                                                                                                                                          |
| Tests                         | FAIT    | 811 tests, 69 fichiers                                                                                                                                                                                                       |
| Build                         | FAIT    | `pnpm verify` inclut le build web                                                                                                                                                                                            |
| CI                            | FAIT    | `.github/workflows/ci.yml` déclenchée et VERTE sur master (runs 45789093588 et 45795161825, 26 nov.) ; les échecs publics précédents venaient du lint (concaténations, formatage, assertions non-null) — corrigés et rejoués |
| Sécurité du dépôt             | PARTIEL | `.env*` ignoré, `.env.example` sans valeurs ; pas de scan de secrets automatisé                                                                                                                                              |
| Documentation de vérification | FAIT    | ce document + `PROOFCORE_2_0_DELIVERY_REPORT.md`                                                                                                                                                                             |

## Étape B — Cartographie technique

| Élément                   | État | Preuve                                                     |
| ------------------------- | ---- | ---------------------------------------------------------- |
| Architecture apps/paquets | FAIT | `PROOFCORE_ARCHITECTURE_MAP.md`                            |
| Capacités et limites      | FAIT | `PROOFCORE_CAPABILITY_MATRIX.md`                           |
| Contrats et statuts       | FAIT | `packages/contracts`, `PROOFCORE_FINDINGS_ARCHITECTURE.md` |
| Données et migrations     | FAIT | 20 migrations, deux bases documentées                      |
| Cinq moteurs              | FAIT | matrice + tests modules                                    |

## Étape C — Analyse centralisée

| Élément                                                 | État         | Limite                                                                                                                                             |
| ------------------------------------------------------- | ------------ | -------------------------------------------------------------------------------------------------------------------------------------------------- |
| Runs, findings, evidence, historique, rapports          | FAIT         | pipeline commun                                                                                                                                    |
| FAIL/CLEAN alimentés par le web et l'assistant          | FAIT         | —                                                                                                                                                  |
| Upload des audits CLI comme runs                        | FAIT         | `proofcore scan/audit --sync` → `POST /v1/runs` ; test e2e `cli.test.ts` « audit --sync uploads the scan as a run » + reprise idempotente vérifiée |
| Rapport produit (identité, périmètre, méthode, limites) | PARTIEL      | HTML/JSON/CLI ; pas de PDF/CSV                                                                                                                     |
| Partage en lecture seule                                | NON COMMENCÉ | entitlement `client_sharing` marqué « bientôt »                                                                                                    |

## Étape D — Expérience utilisateur

| Élément                                      | État    | Preuve                                          |
| -------------------------------------------- | ------- | ----------------------------------------------- |
| Mode simple (guide, start, scan)             | FAIT    | E2E mobile 19/19                                |
| Mode expert (modules, config, CLI, terminal) | FAIT    | routes + E2E shell                              |
| Onboarding et configurations guidées         | FAIT    | `/app/guide`, `/app/start`                      |
| États vides/erreur/quota honnêtes            | FAIT    | tests + revue de code                           |
| Consentement cookies                         | PARTIEL | carte bloquante sur petit écran ; parcours géré |

## Étape E — Intelligence artificielle

| Élément                                               | État        | Limite                                                                                                         |
| ----------------------------------------------------- | ----------- | -------------------------------------------------------------------------------------------------------------- |
| Routage fournisseur + catalogue                       | FAIT        | tests avec fournisseur simulé                                                                                  |
| Contexte autorisé par workspace                       | FAIT        | tests d'isolation                                                                                              |
| 37 outils, modules lisibles/configurables/exécutables | FAIT        | `routes/ai.ts`, `module-copilot.ts`, `module-copilot.test.ts`, catalogue `GET /api/v1/ai/tools`                |
| Contexte de page (analyse, constat, module, projet)   | FAIT        | `ai-page-context.ts` ; test API 404 cross-tenant ; bannière mobile 320 px                                      |
| Scénario FLOW proposé, validé puis enregistré         | FAIT        | `validate_scenario` → `save_scenario` avec `confirm:true` ; test API réel                                      |
| FLOW navigateur réel                                  | PARTIEL     | Chromium **local** prouvé ; chemin Cloudflare Browser Rendering corrigé (`nodejs_compat`) mais **non déployé** |
| Fencing des contenus non fiables                      | FAIT        | 6 tests dédiés                                                                                                 |
| Mémoire curatée, auditable, supprimable               | FAIT        | API + tests                                                                                                    |
| Appel réel à un fournisseur                           | NON VÉRIFIÉ | aucun credential dans cette passe ; les 42 tests IA utilisent le fournisseur simulé                            |
| Échec d’outil non maquillé                            | FAIT        | un `browser_launch_failed` revient dans la trace et le prompt ; test dédié                                     |
| Effort/sous-agents                                    | PARTIEL     | niveaux côté CLI/api ; preuve de coût non mesurée                                                              |

## Étape F — Moteurs

| Moteur | État    | Limite                                                           |
| ------ | ------- | ---------------------------------------------------------------- |
| WORLD  | FAIT    | fixtures ; sans cible → SKIPPED                                  |
| FLOW   | PARTIEL | complet en CLI avec Chromium ; serveur sans navigateur → SKIPPED |
| EXIT   | FAIT    | source requise                                                   |
| FAIL   | FAIT    | 15 contrôles HTTP observables, pas une certification             |
| CLEAN  | PARTIEL | HTML serveur ; page client-rendue → `not_measured`               |

## Étape G — Interface

| Élément               | État | Limite                                                                                             |
| --------------------- | ---- | -------------------------------------------------------------------------------------------------- |
| Ink & Object conservé | FAIT | aucune refonte                                                                                     |
| Marque PROOFCORE      | FAIT | textes et coquille                                                                                 |
| Anti-AI design        | FAIT | règles écrites, pas de fausses métriques                                                           |
| Responsive            | FAIT | matrice 13 tailles × 7 routes verte (27 nov.) ; assistant 320×700 rejoué après le contexte de page |
| Accessibilité         | FAIT | axe-core WCAG 2.2 AA sur 8 routes, dont l’assistant : 1/1 ; parcours clavier exhaustif non refait  |
| Défaut mobile corrigé | FAIT | DPR du fond WebGL plafonné, E2E mobile vert                                                        |

## Étape H — Commercial

| Élément                | État         | Limite                               |
| ---------------------- | ------------ | ------------------------------------ |
| Plans et matrice       | FAIT         | `packages/billing/plans.ts`          |
| Quotas et consommation | FAIT         | gate + compteurs                     |
| Paiement sandbox       | FAIT         | E2E checkout/settle                  |
| Paiement live          | NON VÉRIFIÉ  | credentials absents                  |
| Factures/reçus         | FAIT         | reçus, pas de facture fiscale        |
| E-mails                | NON VÉRIFIÉ  | fournisseur absent ; journal honnête |
| Notifications          | FAIT         | in-app, lues/non lues                |
| Support                | FAIT         | référence, réponse, historique       |
| Export premium         | NON COMMENCÉ | pas de PDF/CSV                       |
| Partage client         | NON COMMENCÉ | marqué « bientôt »                   |

## Étape I — Production

| Élément                 | État        | Limite                                                                                                                                                                                                                                                                                                                                         |
| ----------------------- | ----------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Isolation multi-comptes | FAIT        | 30 assertions inter-comptes                                                                                                                                                                                                                                                                                                                    |
| Anti-SSRF webhooks      | FAIT        | 31 tests                                                                                                                                                                                                                                                                                                                                       |
| Rate limiting           | PARTIEL     | durable pour l'auth, local pour le reste                                                                                                                                                                                                                                                                                                       |
| Secrets                 | PARTIEL     | clés IA chiffrées ; webhooks/e-mails en clair                                                                                                                                                                                                                                                                                                  |
| Webhooks paiement       | FAIT        | signature, anti-rejeu, vérification serveur                                                                                                                                                                                                                                                                                                    |
| Observabilité           | PARTIEL     | request-id + logs 5xx, pas de métriques                                                                                                                                                                                                                                                                                                        |
| Sauvegarde/restauration | PARTIEL     | `pnpm db:backup` / `db:restore` + manifeste SHA-256 et compteurs ; exercice local réel réussi (38 tables, 30 lignes, refus d'un dump altéré et d'une cible non vide) ; export et restauration **distants NON VÉRIFIÉS** (aucun credential) ; procédure `docs/PROOFCORE_BACKUP_RESTORE.md` ; workflow quotidien ajouté mais échoue sans secrets |
| Rétention               | FAIT        | purge paresseuse à la lecture + balayage planifié (cron 03:17 UTC) + clés d'idempotence 30 j ; 4 tests (`retention.test.ts`) ; la réponse d'upload donne la date d'expiration                                                                                                                                                                  |
| Déploiement             | NON EXÉCUTÉ | non demandé dans cette passe                                                                                                                                                                                                                                                                                                                   |

## Étape J — Recette

| Parcours                   | État             | Preuve                                                                      |
| -------------------------- | ---------------- | --------------------------------------------------------------------------- |
| Débutant (web mobile)      | FAIT             | E2E `app-mobile.spec.ts`                                                    |
| Compte/session/facturation | FAIT             | E2E `journey.spec.ts`                                                       |
| IA contextuelle            | FAIT (hors prod) | contexte analyse/constat/module/projet ; 404 cross-tenant ; bannière 320 px |
| IA ↔ modules               | FAIT (hors prod) | config → run → historique → analyse, 5 tests                                |
| WORLD/FLOW/EXIT/FAIL/CLEAN | PARTIEL          | tests des cinq familles ; parcours navigateur CLI non rejoué                |
| FAIL/CLEAN                 | FAIT             | tests page-scan + audits                                                    |
| Sécurité multi-comptes     | FAIT             | `tenant-isolation.test.ts`                                                  |
| Responsive                 | FAIT             | 13 viewports (320→2560), 78 combinaisons, 0 débordement                     |
| Production readiness       | BLOQUÉ           | sauvegarde distante/Neon non exercées + credentials externes                |

## Ce qui change le verdict

Trois preuves manquent pour passer de « démontrable » à « exploitable » :

1. une restauration **distante** réellement exécutée (l'exercice local D1 est fait) ;
2. un envoi e-mail réellement accepté ;
3. un paiement live réellement vérifié par webhook.

Tant que ces trois artefacts n'existent pas, le produit reste **PARTIEL** en production,
quel que soit le nombre de tests unitaires au vert.
