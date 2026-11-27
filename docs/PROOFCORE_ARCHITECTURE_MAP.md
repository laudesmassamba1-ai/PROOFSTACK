# PROOFCORE — Carte d'architecture (état vérifié)

## Packages (vérifiés par listage)

| Dossier                                             | Rôle observé                                                                                                                                        |
| --------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------- |
| `apps/web`                                          | Site et application React (pages publiques et `pages/app/*`).                                                                                       |
| `apps/api`                                          | API (routes Hono-style sous `src/routes/`), auth, billing, IA, store.                                                                               |
| `apps/desktop`                                      | Application Electron, sidecar `proofcore serve`.                                                                                                    |
| `packages/cli`                                      | CLI `proofcore` (audit, scan, agent, hub, update, doctor, memory).                                                                                  |
| `packages/core`                                     | Orchestration du scan de page et de site (`page-scan.ts`, `site-audit.ts`, `controls.ts`), qui appelle les modules FAIL et CLEAN.                   |
| `packages/engine`                                   | Runner de tests, contexte, types, empreinte.                                                                                                        |
| `packages/contracts`                                | Vocabulaires partagés (statuts, schémas zod).                                                                                                       |
| `packages/modules/{world,flow,exit,fail,clean}`     | Cinq modules de contrôle. FAIL (`fail/checks.ts`) et CLEAN (`clean/checks.ts`) sont des packages autonomes ; `page-scan.ts` compose leurs constats. |
| `packages/adapters/{ai,browser,payments,reporting}` | Adaptateurs externes.                                                                                                                               |
| `packages/billing`, `packages/config`               | Offres et configuration.                                                                                                                            |
| `tooling/scripts`                                   | Build, installeurs, déploiement Cloudflare, smoke tests.                                                                                            |

## Flux et persistance observés (cartographie du 27 novembre 2026)

```
Web (`apps/web/src/App.tsx`) ──> API Hono (`apps/api/src/app.ts`, `src/routes/*`)
CLI (`packages/cli/src/*`) ─────> API machine / synchronisation analyse
Desktop (Electron) ─────────────> Web locale + sidecar CLI `proofcore serve`
                                  │
                                  ├─> `packages/core` : scan, site audit, capacités,
                                  │   planification, findings, comparaison, FLOW scenario
                                  ├─> `packages/modules/{world,flow,exit,fail,clean}`
                                  ├─> `packages/engine` : exécution de contrôles
                                  └─> D1 / SQLite : workspaces, page_audits, test_runs,
                                      reports, analyses, findings, FLOW scenarios, remediation

IA (`apps/api/src/routes/ai.ts`) ─> policy + outils autorisés ─> services métier existants
```

L'analyse persistante est une identité canonique dans `apps/api/migrations/0021_analyses.sql`.
Les payloads historiques de `page_audits` et `test_runs` sont conservés et reliés via
`analysis_id`; les métadonnées de résultat et preuves restent référencées plutôt que copiées.
Le store d'exécution est défini dans `apps/api/src/store/app-store.ts` et ses implémentations
D1/SQLite dans `apps/api/src/db/`.

## Limites de couverture de la cartographie

- Les routes et écrans sont recensés, mais le graphe exhaustif de chaque appel UI → endpoint
  n'a pas été établi. État : PARTIEL.
- La migration 0021 et les magasins D1/SQLite sont inspectés. Le miroir Neon et la cohérence
  migration par migration restent à vérifier avant production. État : PARTIEL.
- CI distante, service IA de production, registre npm, production web et parcours avec
  navigateur Cloudflare : NON VÉRIFIÉS dans la session du 27 novembre.

## Annexe — inventaire local observé le 27 novembre 2026

- **Routes Web** : les routes publiques, authentification et espaces `/app/*` sont déclarés dans `apps/web/src/App.tsx`; aucune route n'a été rendue en navigateur durant cette session.
- **Routes API** : fichiers sous `apps/api/src/routes/`; analyses, capacités, scénarios FLOW, remédiations et AI sont confirmés par lecture des route handlers. Le total d'endpoints n'est pas recalculé ici.
- **Migrations** : 25 migrations présentes localement (`apps/api/migrations/`), dont `0021_analyses.sql`, `0022_remediations.sql`, `0023_rate_limits.sql`, `0024_workspace_onboarding.sql` et `0025_flow_scenarios.sql`. Schémas historiques conservés et back-reference nullable à `analyses`.
- **Registre de capacités** : `packages/core/src/capabilities.ts`, exposé par `GET /api/v1/capabilities` et plan de profils; le endpoint utilise cette source. L'usage par chaque formulaire Web n'a pas été vérifié.
- **IA** : `apps/api/src/routes/ai.ts` avec politiques d'outils et les services du produit. Le nombre de définitions d'outils n'est pas annoncé comme nombre d'endpoints; l'accès aux fournisseurs externes reste dépendant des credentials.
- **Cinq modules** : packages présents dans `packages/modules/{world,flow,exit,fail,clean}`. `packages/core/src/page-scan.ts` compose certains résultats; chaque module a ses propres tests.
- **Analyse canonique** : création idempotente, cycle de vie, lien à `page_audits`/`test_runs`, historique paginé, recherche, annulation et comparaison dans `apps/api/src/routes/analyses.ts` et `apps/api/src/findings.ts`.
- **FLOW** : validation partagée et CRUD/exécution de scénarios dans `apps/api/src/routes/flow-studio.ts`; la vraie exécution requiert un navigateur compatible, sinon la route retourne un état d'erreur explicite.
- **CLI** : package `packages/cli`, commande `proofcore`; smoke et commandes réelles n'ont pas été exécutés pendant cette session.
- **Tests** : le nombre de cas varie selon fichiers et commit; utiliser les sorties datées dans `docs/PROOFCORE_VERIFICATION_LOG.md`, pas des chiffres permanents.
