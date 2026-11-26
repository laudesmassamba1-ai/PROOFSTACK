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

## Flux de données (vérifié dans les noms de fichiers, pas encore tracé de bout en bout)

```
CLI / Web / Desktop
   └── apps/api/src/routes/*  ──>  packages/core (page-scan, site-audit)
                                   packages/modules/{world,flow,exit,fail,clean}
                                   packages/engine (runner)
   └── persistance : D1 (auth, billing, runs) + Neon (intelligence projet, .proofcore/ local)
```

## À compléter (NON VÉRIFIÉ)

- Graphe exact des appels web → routes API : à établir page par page.
- Emplacement des schémas D1 (migrations) et de `apps/api/neon/schema.sql` : à relire.
- Point d'entrée réel de l'assistant IA (`apps/api/src/routes/ai.ts`, 2685 lignes) : à découper.

## Annexe — chiffres vérifiés le 26 novembre 2026

- **Routes web** : 43 chemins dans `apps/web/src/App.tsx` (public, auth, `/app/*`, `*` 404).
- **Routes API** : 15 fichiers de routes, ~106 endpoints (compte par `app.get/post/patch/delete`
  : workspace 28, account 15, ai 16, billing 10, audits 8, project-intelligence 8, auth 4,
  browser 4, device 4, admin 3, notifications 3, releases 3, machine 2, controls 1, webhooks 1).
- **Migrations** : 20 fichiers SQL (`apps/api/migrations/`), SQLite/D1 + miroir Neon
  (`apps/api/neon/schema.sql`). 32 tables, dont `page_audits`, `test_runs`, `findings`,
  `audit_finding_states`, `reports` — le socle de la future ressource canonique Analysis
  (phase 2) : les trois sources de vérité existent déjà séparément.
- **Contrôles** : 59 dans `packages/core/src/controls.ts`.
- **Outils IA** : 19 dans `apps/api/src/routes/ai.ts` (workspace_overview, list_projects,
  module_status, module_config, module_configure, module_run, analyze_run, recent_runs,
  recent_findings, get_report, project_code, fetch_web, fail_scan, clean_audit, site_audit,
  read_repo, browse_url, probe_url, remember).
- **Modules livrés** : cinq packages sous `packages/modules/` — `world`, `flow`, `exit`, `fail`, `clean` (26 nov. 2026). `packages/core/src/page-scan.ts` orchestre la lecture unique de la réponse et appelle `failFindings` / `cleanFindings` ; `site-audit.ts` reste le moteur site (crawl + score). Aucun changement de contrat : `scanPage` renvoie les mêmes identifiants, dans le même ordre.
  `packages/core/src/page-scan.ts` + `site-audit.ts`. Incohérence d'emplacement à
  réconcilier lors de la phase 3 (registre de capacités).
- **Tests** : 69 fichiers Vitest (818 tests, verts ce jour) ; `tests/e2e/` 2 fichiers.
- **CLI** : commandes vérifiées via `--help` (init, doctor, validate, test, world, flow,
  exit, audit, check, module, app, hub, login, logout, memory, mcp, ask/ai, agent, console,
  dashboard, explain, integrate…). Aucune occurrence de `git clone`/`cd PROOFCORE`.
