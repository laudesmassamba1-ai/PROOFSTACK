# PROOFCORE — Matrice des capacités

Légende : **VÉRIFIÉ** = artefact observé ; **PARTIEL** = existe mais incomplet ;
**ABSENT** = non trouvé dans le code ; **NON VÉRIFIÉ** = non exécuté ou non inspecté.

Format demandé par la règle de livraison :

| Fonction | Code présent | Test exécuté | Test réussi | Parcours vérifié | Production vérifiée |
| -------- | ------------ | ------------ | ----------- | ---------------- | ------------------- |
| Modules WORLD / FLOW / EXIT (`packages/modules/*`) | VÉRIFIÉ | NON VÉRIFIÉ (session) | NON VÉRIFIÉ | NON VÉRIFIÉ | NON VÉRIFIÉ |
| Modules FAIL / CLEAN (`packages/core/src/page-scan.ts`, `site-audit.ts`) | VÉRIFIÉ | NON VÉRIFIÉ | NON VÉRIFIÉ | NON VÉRIFIÉ | NON VÉRIFIÉ |
| Statuts de test partagés (`packages/contracts/src/statuses.ts`) | VÉRIFIÉ | NON VÉRIFIÉ | NON VÉRIFIÉ | — | — |
| Limitation de tentatives de connexion (`RateLimiter`) | VÉRIFIÉ (mémoire, par processus) | NON VÉRIFIÉ | NON VÉRIFIÉ | NON VÉRIFIÉ | ABSENT (non distribué) |
| Protection CSRF | ABSENT | — | — | — | — |
| Rotation de session | NON VÉRIFIÉ | NON VÉRIFIÉ | — | — | — |
| Audit IA de code (`apps/api/src/routes/project-intelligence.ts`) | VÉRIFIÉ (code) | PARTIEL (faux fournisseur local, d'après APP-MEMORY) | NON VÉRIFIÉ en session | NON VÉRIFIÉ | NON VÉRIFIÉ |
| E-mail EmailJS (`apps/api/src/email.ts`) | VÉRIFIÉ (code) | ABSENT (aucun identifiant fourni) | — | NON VÉRIFIÉ | NON VÉRIFIÉ |
| Analyse persistante unifiée (Analysis canonique) | ABSENT | — | — | — | — |
| Assistant IA outillé sur les cinq modules | PARTIEL (commit `ab64664`) | NON VÉRIFIÉ | NON VÉRIFIÉ | NON VÉRIFIÉ | NON VÉRIFIÉ |
| Fournisseur IA géré par PROOFCORE | ABSENT | — | — | — | — |
| Remédiation et vérification technique | ABSENT | — | — | — | — |
| Interface Simple / Studio unifiée | NON VÉRIFIÉ | — | — | NON VÉRIFIÉ | NON VÉRIFIÉ |

## Ce qui ne doit pas être présenté comme opérationnel

- Toute ligne « Analyse persistante unifiée », « Fournisseur IA géré », « Remédiation » : ABSENT.
- Protection CSRF : ABSENT.
- Tout ce qui est NON VÉRIFIÉ n'est pas une fonction validée, quel que soit le nombre de fichiers présents.

## Mise à jour 26 novembre 2026 (vérification exécutée ce jour)

| Fonction | Test exécuté | Test réussi | Parcours vérifié | Production vérifiée |
| -------- | ------------ | ----------- | ---------------- | ------------------- |
| Suite de tests complète (69 fichiers) | OUI (`pnpm test`) | OUI — 818/818 | — | — |
| Typecheck + build | OUI | OUI (0 erreur TS) | — | — |
| Pages publiques : /, /download, /pricing, /docs, /changelog, /security, /signin | OUI (Playwright, 1440×900) | OUI — 0 erreur console, 0 réponse ≥ 400 | OUI | OUI (Vercel + Pages, déploiements du jour) |
| Espace de travail : /app, /app/projects, /app/modules, /app/modules/{world,flow,exit,fail,clean}, /app/scan, /app/start, /app/billing, /app/settings, /app/workspace, /app/cli, /app/interact, /app/ai, /app/guide, /app/notifications | OUI (compte jetable réel) | OUI | OUI | OUI (déployé et vérifié le jour même sur les deux hôtes) |
| Pile dépliable des cinq questions (`CardStack`, `expandable`) — clic sur la pile déplie les cinq cartes, chacune cliquable et nommée | OUI (local + production) | OUI — navigation vers `/app/modules/exit` vérifiée, repli par carte du dessus / clic dehors / Échap | OUI | OUI (Vercel + Pages) |
| Pile de projets (`FolderFloat`, matter-js) sur la vue d'ensemble | OUI (local + production) | OUI — physique, drag, navigation vers un projet | OUI | OUI |
| Install switch Uiverse sur les cartes desktop de /download | OUI (local + production) | OUI — téléchargement réel + état « Installée » | OUI | OUI |
| Assistant IA outillé (19 outils, `apps/api/src/routes/ai.ts`) | OUI (localement) | OUI (parcours navigateur `/app/ai`) | PARTIEL (pas de vérification production end-to-end ce jour) | NON VÉRIFIÉ |
| `/app/terminal` | OUI | NON — 404 sur `/api/terminal/start` (instance locale) | NON | NON VÉRIFIÉ |
| `/app/admin` | OUI | NON — 503 sur `/api/v1/admin/overview` (ADMIN_EMAILS vide) | NON | NON VÉRIFIÉ |
| npm `proofcore` 0.6.3 | OUI (`npm view`) | NON — registre à 0.6.0 (secret `NPM_TOKEN` manquant) | — | NON |
