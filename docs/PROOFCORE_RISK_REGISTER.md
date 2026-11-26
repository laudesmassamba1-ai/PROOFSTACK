# PROOFCORE — Registre des risques

Mise à jour après vérification (2026-11-25). Chaque statut renvoie à une preuve observée.
Statuts : VÉRIFIÉ, PARTIEL, ABSENT, NON VÉRIFIÉ.

| ID | Risque | Preuve | Gravité | Statut |
| -- | ------ | ------ | ------- | ------ |
| R1 | Protection CSRF de l'API | `apps/api/src/app.ts:107-131` contrôle `Origin` sur les écritures `/api/*` (hors webhooks) ; cookie `SameSite=Lax` (`apps/api/src/auth.ts:146`). Pas de jeton CSRF. Requêtes sans `Origin` non refusées. | Élevée | PARTIEL |
| R2 | Limitation de tentatives non distribuée (mémoire par processus) | `apps/api/src/http/errors.ts:133`, utilisée dans `routes/auth.ts` | Moyenne | PARTIEL |
| R3 | `pnpm lint` racine en échec | `/tmp/lint-root.log` (2026-11-25) : seules erreurs dans `mobile-audit.tmp.mjs`, `mobile-signup-debug.tmp.mjs`, `mobile-marketing-debug.tmp.mjs` (non suivis). Code produit non touché. | Faible (CI non concernée) | PARTIEL — à corriger après accord de suppression |
| R4 | Espace disque presque plein | `artifacts/.work` et `artifacts/.cache` supprimés (≈1,4 Go, autorisé). `~/.cache/electron` refusé par le garde-fou. `~/.cache/ms-playwright` (2,9 Go) reste. | Élevée pour les builds | PARTIEL |
| R5 | Statut de la CI non vérifié | Run 45600283899 : échec au smoke CLI (`audit --help` renvoyait 2). Correctif dans `packages/cli/src/index.ts` (`asksHelp`), test `cli.test.ts` échoue sans le correctif (`expected 2 to be +0`). Run #105 non identifié. | Élevée | PARTIEL (cause locale corrigée, run #105 NON VÉRIFIÉ) |
| R6 | Documentation contradictoire (moteurs, versions) | `README.md` ligne 100 : `npm install -g proofcore` ; `packages/cli/package.json` : `@proofcore/cli` 0.6.3, `"private": true` | Moyenne | ABSENT (le paquet publié n'existe pas) |
| R7 | Chemin cité par l'audit inexistant (`packages/engine/src/contracts/statuses.ts`) | Fichier absent ; le vrai chemin est `packages/contracts/src/statuses.ts` | Faible | Documenter le vrai chemin |
| R8 | Modifications non commitées dans des pages produit | `git status` ; fichiers de tiers listés dans le journal de session | Moyenne | Ouvert — à trancher avant commit |
| R9 | Rotation de session | `apps/api/src/auth.ts:104` crée un jeton et son hash ; la rotation à la connexion n'est pas démontrée | Moyenne | NON VÉRIFIÉ |
| R10 | Tests instables sous charge (`page-scan`, `cli.test.ts`) | Suite complète 2026-11-25 : 69 fichiers, 818 tests réussis | Moyenne | PARTIEL — non reproduit ce jour, assertions inchangées |
| R11 | Clés fournisseur IA stockées chiffrées en base | `apps/api/src/routes/ai.ts` : `apiKeyEncrypted` écrit ~1028 et ~1075, déchiffré ~933, 1030, 1121, 1243. Contredit AGENTS.md (clé dans l'environnement). | Élevée | ABSENT (conformité AGENTS.md) — décision de l'utilisateur requise |
| R12 | Serveur MCP exposé alors que AGENTS.md dit « PROOFCORE n'est pas un serveur MCP » | `packages/cli/src/mcp-server.ts` : outils avec `destructiveHint: true` | Élevée (contrat) | ABSENT — décision produit requise |
| R13 | Autorisation des routes IA | `apps/api/test/tenant-isolation.test.ts` : 5/5 réussis (404 inter-comptes, refus sans session) ; `module-copilot.test.ts` 5/5 ; `webhook-guard.test.ts` 31/31 | Élevée | VÉRIFIÉ (tests API) — parcours navigateur réel NON VÉRIFIÉ en production |

Aucun risque n'est déclaré résolu dans ce registre. Les statuts VÉRIFIÉ ne s'appuient que
sur les artefacts cités.

## Ajouts du 26 novembre 2026 (vérification en direct)

| ID | Risque | Preuve | Gravité | Statut |
| -- | ------ | ------ | ------- | ------ |
| R14 | CI : échec smoke CLI — cause trouvée, correctif commité | Runs 45755203107 + 45756582954 (`8f5e61c`, `e5b5e63`) : `audit --help` sort 2 sur le runner. Reproduit au commit exact dans le clone `/tmp/ci-repro`. **Cause réelle** : le correctif `asksHelp` (`packages/cli/src/index.ts`) et ses deux tests existaient uniquement dans l'arbre de travail, jamais commités — le clone au HEAD sortait 2, le même clone patché sort 0. Commit `54fdbbe` avec les deux fichiers exacts. | Élevée | CORRIGÉ (commit `54fdbbe`, run de vérification à confirmer) |
| R15 | URLs mortes atteignables au clavier | `/legal` → 404 (les vraies routes sont `/legal/{terms,privacy,cookies}`), `/app/account` → 404, `/app/local-agent` → 404 (la vraie route est `/app/agent`). Aucun lien de navigation ne pointe vers ces 404. | Faible | OUVERT — redirections à ajouter (phase 8), pas de parcours cassé |
| R16 | npm en retard sur les releases | `npm view proofcore version` → 0.6.0 ; dépôt 0.6.3 ; publication branchée au secret `NPM_TOKEN` (absent). | Moyenne | OUVERT — action propriétaire (`gh secret set NPM_TOKEN`) puis re-run du dernier run release |
| R17 | Documentations contradictoires localisées | `README.md:38`, `docs/CLI_EXPERIENCE.md:26`, `docs/PROOFCORE_2_0_DELIVERY_REPORT.md:261`, `docs/PROOFCORE_AI_ARCHITECTURE.md:53`, `docs/PROOFCORE_TRANSFORMATION_PROGRESS.md:120` — « WORLD/FLOW/EXIT » alors que les cinq modules sont livrés et vérifiés (walk du jour). | Faible | OUVERT — correction mécanique en phase 1.4 |
| R18 | Fail/CLEAN vivent hors de `packages/modules/` | `packages/modules/` = {world,flow,exit} ; fail/clean dans `packages/core/src/page-scan.ts` + `site-audit.ts` | Faible (structurel) | OUVERT — à réconcilier avec le registre de capacités (phase 3.1) |
