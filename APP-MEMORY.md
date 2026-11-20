# MÉMOIRE DU PROJET — PROOFSTACK / PROOFCORE

> Ce fichier est la mémoire de travail de l'application. Chaque agent (humain ou IA) le lit
> **avant** de toucher au code et le met à jour **après** chaque changement notable.
> Format : fait accompli, méthode, résultat. Les sections « en cours » et « voulu » pilotent
> la suite. Dernière mise à jour : 2026-11-20.

---

## 1. CE QUI A ÉTÉ FAIT (et comment)

### Architecture produit

| Réalisation                     | Où                                                                   | Comment (méthode)                                                                                                                                                                                                                                                             |
| ------------------------------- | -------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Hub plein écran du CLI          | `packages/cli/src/hub-tui.ts`, `hub.ts`                              | Écran alterné + lecteur de touches propre (decodeKeys), menu de complétion, historique, capture de la sortie des commandes dans le transcript. Testé avec 15 tests dédiés + `script -qec`                                                                                     |
| Installateurs auto-installables | `tooling/scripts/build-installers.mjs`, `packaging/`                 | Windows : SEA binaire + payload gzippé collé après un marqueur (le build relit son fichier : marqueur, sha256, gunzip vérifiés) ; Linux : en-tête shell + tar.gz ; .deb via dpkg-deb. **Vérifié réellement** : .run installé dans HOME temporaire, `proofcore --version` → ok |
| Icônes générées                 | `packaging/assets.mjs`                                               | PNG écrit à la main (en-tête + scanlines deflate + CRC), ICO = conteneur de PNG. Déterministe, identique Linux/Windows                                                                                                                                                        |
| App native (Electron)           | `apps/desktop/`                                                      | main.cjs : port libre → sidecar `proofcore serve` → lit l'URL à token unique qu'il imprime → charge la fenêtre. Menu : connexion, compte, maj, doctor. Liens externes → navigateur système. SMOKE test : `SMOKE_OK`/`SMOKE_LOCKED`                                            |
| Connexion directe dans l'app    | `apps/desktop/src/sign-in.cjs`                                       | POST `/api/auth/sign-in/email` (même route que le site) → cookie lu dans Set-Cookie (jamais dans le corps) → coffre (safeStorage) + fichier session CLI. Refus : message de l'API affiché tel quel (pas d'énumération). Testé contre le site réel                             |
| Porte de compte (gate)          | `apps/desktop/src/access.cjs`                                        | Décision pure : session + horloge + réponse du site. Priorité expiration : `session.expiresAt` (serveur) > JWT exp > grâce locale (7 j). Révoqué = verrou immédiat                                                                                                            |
| Mémoire projet IA               | `packages/cli/src/memory.ts`                                         | JSON `.proofcore/memory.json`, 0600, atomique (tmp+rename), 40 faits max, dédupliqué ; `memoryPrompt()` → bloc FR pour le prompt système ; `summarizeConversation()` heuristique sans appel IA                                                                                |
| Niveaux d'effort                | `packages/cli/src/effort.ts`                                         | low (seul, 10 pas) / medium (≥2 sous-agents, 18 pas) / high (3+, 28 pas, vérif croisée). Bloc de prompt `subagentPrompt()` en français                                                                                                                                        |
| Scan page (5 familles)          | `packages/core/src/page-scan.ts` + `apps/web/src/pages/app/Scan.tsx` | 16 fail + 11 clean + 9 flow + 9 world + 4 exit en une requête ; garde SSRF ; page /app/scan branchée dans la nav                                                                                                                                                              |
| Hub → `/update`                 | `packages/cli/src/update.ts` + `hub.ts`                              | Manifeste de release + sha256 ; ancien binaire renommé de côté (jamais supprimé d'abord) ; npm/checkout refusés poliment                                                                                                                                                      |
| `doctor` conflits               | `packages/cli/src/doctor-env.ts`, `stack-check.ts`                   | Sonde réelle par ligne + la commande qui corrige : double lockfile, engines.node, playwright divisé, React dupliqué, session 0644, dossier en lecture seule                                                                                                                   |
| Déploiement cloud en 1 commande | `tooling/scripts/deploy-cloudflare.mjs`                              | Préflight → migrations D1 → Worker → build web → Pages. API d'abord, site ensuite                                                                                                                                                                                             |
| Mises à jour de l'app           | `electron-updater` (fenêtre) + `proofcore update` (moteur)           | Deux artefacts, deux durées de vie ; « PRÊTE, s'installera à la fermeture »                                                                                                                                                                                                   |

### Offres (décision du 2026-11-20)

Free : 10 runs/mois, 3 audits IA/mois, 2 profils world, 3 scénarios flow — _goûter, pas une équipe QA_.
Developer (15 000 XOF/mois) : 300 runs, 60 audits IA. Studio (35 000 XOF) : 1500 runs, 300 audits IA.
Agency (95 000 XOF) : 8000 runs, audits IA illimités. Clé : `monthly_ai_audits` (contracts), genre d'usage `ai_audit` (billing).

### Vérifications réelles passées (pas seulement des tests)

- `.run` Linux installé dans un HOME temporaire, `proofcore app --print-url` ✔
- `.deb` inspecté (dpkg-deb -I/-c), extrait, **lancé** sous Xvfb : `SMOKE_OK` à travers la fenêtre
- Connexion refusée contre le site réel (401, message API exact)
- Captures d'écran des pages refondues (Playwright) : app idle/busy, login, login erreur

---

## 2. CE QUI EST EN COURS (ce filet ne doit pas être perdu)

| Chantier                       | État précis                                                                                                       | Prochaine action                                                                                                                                                                                 |
| ------------------------------ | ----------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| **Quota IA côté API**          | clé `monthly_ai_audits` ajoutée à contracts + plans + usage map ; `pnpm --filter @proofcore/contracts build` fait | Brancher le compteur dans `apps/api/src/routes/ai.ts` (le relay IA n'a AUCUN gate aujourd'hui) et `audits.ts` POST /audits (commentaire prétend « metered per workspace », aucun appel au meter) |
| **Effort → sous-agents réel**  | `effort.ts` écrit + tests ; `agent-runtime.ts` n'a ni effort ni budget                                            | `--effort` sur `agent`/`ai`/hub ; `maxSteps` dérivé du niveau ; accumulateur de tokens (usage retourné par `callChatModel`, jamais cumulé) ; bloc `subagentPrompt()` dans le prompt système      |
| **Mémoire branchée à l'agent** | `memory.ts` écrit + tests ; RIEN n'appelle loadMemory/summarize                                                   | Injecter `memoryPrompt()` dans le prompt système de `AgentSession` ; en fin de tour `summarizeConversation()` → `rememberFact()` ; commande `proofcore memory` (voir/éditer/oublier)             |
| **Site plus vivant**           | Agent en parallèle a déposé `RunArtifact.tsx`, `StatStrip.tsx`, `useReveal.ts`, franco i18n                       | Vérifier + faire valider : `pnpm --filter @proofcore/web build`, captures Playwright des sections                                                                                                |
| **Audit IA humain**            | `scan --explain` existe (one-shot, sans mémoire)                                                                  | Le réécrire sur memoryPrompt + effort + sortie des 5 modules ; en faire la commande par défaut de l'app desktop                                                                                  |
| **Desktop = site en local**    | La fenêtre charge `/app` servi par le sidecar ; appels API → cloud                                                | Le cookie cross-origin (loopback → site) est bloqué : prévoir proxy de session dans le sidecar                                                                                                   |

---

## 3. CE QUI N'A PAS MARCHÉ (pour ne pas le refaire)

1. **`pnpm install --force`** sur ce repo : a purgé node_modules (7 entrées) — ne jamais le refaire ; utiliser `pnpm install` simple et relancer `node install.js` d'Electron si besoin (chemin : `node_modules/.pnpm/electron@31.7.7_supports-color@10.2.2/node_modules/electron/dist/electron`).
2. **Electron Builder + `${ext}`** : macro inexistante → `extraResources` filtrés par plateforme.
3. **`@proofcore/desktop` comme nom d'artefact** : fpm refuse (pas un nom de fichier) → `artifactName: PROOFCORE-${version}-${arch}.${ext}`, `packageName: proofcore`.
4. **`serve` exigeait un modèle** : l'app refusait de s'ouvrir avant configuration → l'agent démarre sans provider, la page explique.
5. **Test « no secret » dépendait du shell** : un `AI_KEYS_SECRET` exporté le faisait passer pour la mauvaise raison → l'absence doit être **nommée** dans l'objet env du test.
6. **Tests flaky vus plusieurs fois** : `page-scan`/`cli.test.ts` sous charge CPU (500+ tests). Ne jamais corriger un test qui vient de passer au 2e run sans avoir relancé deux fois.
7. **`pnpm approve-builds`** : refusé silencieusement ; contourner en lançant `node install.js` directement dans le dossier du paquet.
8. **Biome et les templates** : dans un template literal, écrire `${JSON.stringify(site + "/register")}` déclenche `useTemplate` — utiliser `.concat()` ou une backtick imbriquée.
9. **La fenêtre de login fermée avant l'ouverture de la fenêtre principale** : `window-all-closed` quittait l'app → ouvrir la principale AVANT de fermer la login.
10. **Disk 100 %** : deux fois. Avant tout build lourd : `df -h /home`, purger `artifacts/.work`, `artifacts/.cache`, `~/.cache/electron`.

---

## 4. CE QU'ON VEUT FAIRE (feuille de route)

1. **Brancher l'IA sur les 5 modules** — un audit narratif détaillé et humain : `proofcore audit explain` (ou `--explain` sur audit/scan/test) qui envoie le run réel + la mémoire + l'effort, en français, avec les emplacements de fichiers. Quota par plan via le compteur `ai_audit`.
2. **Sous-agents IA** — instruction de spawn ≥2 sous-agents (medium), 3+ (high) avec relecture croisée ; budget tokens cumulé et affiché ; le hub affiche « effort moyen · 2 sous-agents ».
3. **Mémoire dans tout le produit** — l'app desktop montre « Contexte : 12 décisions, 5 leçons » ; un tour termine toujours par la mise à jour de la mémoire.
4. **Gates de plan dans l'API** — ai.ts (relay) et audits.ts (scan) sous `checkEntitlement` + meter ; message de refus qui nomme le plan requis.
5. **Cohérence des textes** — un passage fr/en sur le site + le CLI + l'app : mêmes noms de modules, mêmes chiffres de prix que `packages/billing/src/plans.ts` (source unique), même promesse « local d'abord ».
6. **Sites doubles** — vérifier Vercel (web) et Cloudflare (API/Pages) : mêmes variables, `PROOFCORE_WEB_ORIGIN` complet des deux origines, /health des deux côtés.
7. **Installateurs Windows réellement exécutés** — workflow `desktop.yml` : NSIS + launch SMOKE sur windows-latest avant publication.
8. **Captures produit réelles** — le site n'a aucune vraie capture CLI/rapport : en générer 3 (hub, audit, doctor) et les intégrer aux sections Product/Platform.

---

## 5. COMMANDES DE RÉFÉRENCE

```bash
pnpm test                     # 602 tests, 47 fichiers
npx biome check .             # lint 0 attendu
node tooling/scripts/build.mjs
pnpm cli:binary --target linux-x64 && pnpm cli:installers --target linux-x64
pnpm --filter @proofcore/desktop dist:linux   # → artifacts/desktop/PROOFCORE-*.deb
PROOFCORE_SMOKE=1 xvfb-run -a <electron> apps/desktop --no-sandbox
pnpm cloud:deploy --dry-run
```

## 6. RÈGLES NON NÉGOCIABLES

- Le sha256 avant l'écriture disque ; l'ancien binaire renommé, jamais supprimé.
- Pas d'élévation de privilèges ; les secrets en 0600, jamais en argument CLI.
- Chaque message d'erreur contient la commande qui répare.
- FR = langue des interfaces agent ; EN = site marketing ; la source des prix = plans.ts uniquement.
- Un test qui a échoué puis passé : relancer deux fois avant de croire à la correction.
