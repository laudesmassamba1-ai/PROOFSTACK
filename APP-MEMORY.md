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

Free : 5 runs/mois, 3 audits IA/mois, 1 espace/1 projet, 1 profil world, 2 scénarios flow, rétention 7 j, CLI incluse.
Developer 15 USD / 9 000 XOF : 200 runs, 40 audits IA. Studio 39 USD / 24 000 XOF : 1 200 runs, 200 audits IA.
Agency 99 USD / 65 000 XOF : 5 000 runs, 600 audits IA. Clé : `monthly_ai_audits` (contracts), genre d'usage `ai_audit` (billing).
Les prix sont **lus depuis `@proofcore/billing`**, jamais recopiés dans le site ; les tests lisent les limites des entitlements.

### Vérifications réelles passées (pas seulement des tests)

- `.run` Linux installé dans un HOME temporaire, `proofcore app --print-url` ✔
- `.deb` inspecté (dpkg-deb -I/-c), extrait, **lancé** sous Xvfb : `SMOKE_OK` à travers la fenêtre
- Connexion refusée contre le site réel (401, message API exact)
- Captures d'écran des pages refondues (Playwright) : app idle/busy, login, login erreur

---

## 2. CE QUI EST EN COURS (ce filet ne doit pas être perdu)

| Chantier                       | État précis                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                         | Prochaine action                                                                                                                                                                            |
| ------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Quota IA côté API              | **Fait (2026-11-20)** : `apps/api/src/routes/audits.ts` (gate `meter.authorize` quantity 0 avant le scan, `meter` kind `ai_audit` après un scan réussi — un scan en échec n'est pas facturé) ; `apps/api/src/routes/ai.ts` relay gate `monthly_ai_audits` avant le proxy ; helper `apps/api/src/http/entitlement-http.ts` (403 `quota_exhausted` + `requiredPlanKey`) ; correction `usageKindFor` (`packages/billing/src/usage.ts` : monthly_ai_audits → ai_audit, sinon un gate pur lisait used=0) ; tests `apps/api/test/page-audits.test.ts` + `ai.test.ts` ; desktop : `normalizeStoredSession` (`apps/desktop/src/access.cjs`) + typo wordmark splash corrigée | Rien pour le gate ; reste à décider si les outils chat `fail_scan`/`clean_audit` doivent être comptés                                                                                       |
| **Effort → sous-agents réel**  | `effort.ts` écrit + tests ; `agent-runtime.ts` n'a ni effort ni budget                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                              | `--effort` sur `agent`/`ai`/hub ; `maxSteps` dérivé du niveau ; accumulateur de tokens (usage retourné par `callChatModel`, jamais cumulé) ; bloc `subagentPrompt()` dans le prompt système |
| **Mémoire branchée à l'agent** | **Fait (2026-11-20)** : `agent-runtime.ts` injecte `memoryPrompt()` + `extraInstructions` ; l'agent dispose d'un outil `remember` **qu'il appelle de lui-même** (kind + phrase, écrit dans `.proofcore/memory.json`) ; `persistTurnMemory()` reste en filet heuristique ; `proofcore memory [show                                                                                                                                                                                                                                                                                                                                                                   | add                                                                                                                                                                                         | forget]`. Côté API, la mémoire est curatée par un **second appel** (« long-term memory ») qui décide et renvoie `{facts:[…]}`, max 2, `source: assistant`;`POST /api/v1/ai/chat`renvoie`memory.added` et l'UI l'affiche | Rien ; surveiller le coût (1 appel court par tour) |
| **Site plus vivant**           | Agent en parallèle a déposé `RunArtifact.tsx`, `StatStrip.tsx`, `useReveal.ts`, franco i18n                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                         | Vérifier + faire valider : `pnpm --filter @proofcore/web build`, captures Playwright des sections                                                                                           |
| **Audit IA humain**            | `scan --explain` existe (one-shot, sans mémoire)                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                    | Le réécrire sur memoryPrompt + effort + sortie des 5 modules ; en faire la commande par défaut de l'app desktop                                                                             |
| **Desktop = site en local**    | La fenêtre charge `/app` servi par le sidecar ; appels API → cloud                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                  | Le cookie cross-origin (loopback → site) est bloqué : prévoir proxy de session dans le sidecar                                                                                              |

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

### 2026-11-20 (soir) — trois bugs signalés, et une mémoire qui se décide elle-même

| Bug signalé                                                | Cause réelle (vérifiée, pas supposée)                                                                                                                                                                                                                                                                                                  | Correctif                                                                                                                                                                                                                                                                                  |
| ---------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| « Console locale » ouvre une page d'agent IA               | L'action `open-agent` de la fenêtre envoyait `/app/ai/local` ; il n'existait aucune action pour `/app/terminal`. Deux pages, un seul bouton                                                                                                                                                                                            | Nouvelle action `open-console` → `/app/terminal`, libellé « Console locale » ; l'agent devient « Agent IA local ». Clé i18n `ws.service.openLocal` renommée en conséquence                                                                                                                 |
| Changer de modèle IA ne ramène jamais le formulaire de clé | `select value={profile.model}` avec `onChange → setModelDraft` : la valeur affichée ne pouvait pas changer. Et la liste des modèles n'était chargée qu'après un `PUT`, donc une seule option. Le bouton « Connecter un modèle » était de plus **sous la ligne de flottaison** (`height: calc(100vh - 36px)` ignorait 156 px de chrome) | Modèle piloté par `modelDraft`, catalogue lu via `POST /ai/profile/test` à l'ouverture, `applyModel()` garde la boîte ouverte et confirme ; « Remplacer la clé » révèle le champ ; suppression de clé laisse la boîte ouverte ; `.chat-shell` = `calc(100dvh - 156px)` (196 px sur mobile) |
| — (trouvé en chemin)                                       | `callUpstream` **jetait le prompt système** pour les fournisseurs OpenAI quand `system` n'était pas déjà dans `messages` : la passe de curation tournait sans instruction                                                                                                                                                              | Le dialecte OpenAI préfixe le message système s'il manque ; test dédié                                                                                                                                                                                                                     |

**Mémoire auto-dirigée.** Personne ne demande à l'IA de retenir : (1) côté API, après chaque tour, un appel court et séparé relit l'échange, répond `{"facts":[…]}`, max 2, et n'écrit que ce qui sera encore vrai dans un mois (`source: assistant`) — il a le droit de répondre `[]`, et la plupart des tours ne produisent rien ; (2) côté CLI, l'agent a un outil `remember` qu'il appelle seul ; (3) l'UI affiche « Retenu par l'assistant : … » après le tour. Un échec de curation ne fait jamais échouer la réponse.

### 2026-11-20 (nuit) — refonte visuelle « cinema » du site

Direction artistique refaite à partir de six références déposées dans `ref_visuelles/` :
sujet lumineux unique sur anneaux concentriques, titre éditorial surdimensionné avec un mot
en dégradé, rail d'index vertical, cartes bento de tailles inégales, accent acide en
ponctuation. La ligne directrice ne bouge pas : noir `#04070a`, émeraude/mint, mono en
petites capitales, « local d'abord ».

| Fichier                                                | Rôle                                                                                                                                                                                                                                                  |
| ------------------------------------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `apps/web/src/styles/cinema.css`                       | Nouvelle couche, importée **après** `global.css` dans `main.tsx`. Tokens (`--cine-*`), typographie, boutons, bento, section, footer, CTA, primitives de mouvement, `prefers-reduced-motion`. Ne redéfinit que les surfaces marketing.                 |
| `apps/web/src/lib/cinema.ts`                           | Moteur maison (aucune dépendance) : `data-anim` chars/words/fade/mask, `data-scrub` (rotation/parallaxe liée au scroll), `data-magnet` (ressort sous-amorti), `data-spot` (reflet au pointeur). Un seul rAF partagé, arrêté quand l'onglet est caché. |
| `apps/web/src/components/brand/OrbitStage.tsx`         | Le P iridescent du logo sur trois anneaux, chips de preuve flottantes. Décoratif (`aria-hidden`).                                                                                                                                                     |
| `apps/web/src/pages/Home.tsx`                          | Héros deux colonnes, marquee mono, bento des modules, sections numérotées, CTA à anneaux.                                                                                                                                                             |
| `apps/web/src/components/marketing/ModuleShowcase.tsx` | Mur → bento asymétrique (WORLD 4/6, FLOW 2/6, trois audits 2/6, bande moteur 6/6).                                                                                                                                                                    |
| `apps/web/src/layouts/BrandLayout.tsx`                 | `Section`/`SectionHeading` avec index éditorial, mesure 1280 px, `initCinema` par route.                                                                                                                                                              |

Points vérifiés en chemin (bugs réels, pas des préférences) :

1. **Spécificité CSS** : `html.cine-ready [data-anim]` (0,2,1) battait `[data-anim].is-in` (0,2,0) — les sections seraient restées à `opacity: 0`. Les deux côtés portent maintenant la même spécificité, l'état révélé venant en dernier.
2. **`translate` vs `transform`** : le magnet écrit `--magnet-x/y` ; en `transform`, `.btn:hover` l'écrasait. Il utilise `translate`, qui se compose.
3. **Sweep du pseudo-élément** : le reflet de `.btn::after` en `z-index: -1` passait sous le fond du bouton (invisible) ; le dégradé se déplace maintenant dans le fond lui-même.
4. **StrictMode** : le teardown efface les drapeaux `data-*-armed`, sinon la seconde passe du double effet ne ré-armait rien et le héros attendait le filet de 3 s.

Passe suivante — **le workspace** : `.app-shell` garde le papier « Ink & Object » et reçoit la même physique (cadre 26 px avec filet lumineux, surfaces volumétriques, titres en `Bricolage`, pastilles mono à losange, survol ressort des cartes/objets, barres de graphique qui poussent depuis la ligne de base, tableaux à chiffres tabulaires). `AppLayout` monte `initCinema` par route, comme `BrandLayout`. Règles du dossier `anti-ai-design-main/SKILL.md` appliquées : pas de grille 3 colonnes symétrique (bento), hiérarchie typographique modulaire, une seule famille d'icônes (Lucide), ombres teintées multi-couches < 20 px de flou, `transition` toujours propriété par propriété, cibles ≥ 44 px, `prefers-reduced-motion` respecté.

Vérifié : `pnpm --filter @proofcore/web build` vert, `biome check` 0 erreur sur les fichiers touchés.

### Chorégraphie GSAP + Lenis (choix utilisateur, 2026-11)

- Ajouts : `gsap` 3.15.1, `lenis` 1.3.27 dans `apps/web`. Justification écrite dans
  `docs/design/MOTION_GUIDELINES.md` (Performance).
- Code : `lib/choreography.ts` (`startSmoothScroll` pour la coque marketing, `riseWords`
  via `gsap.context`), `components/app/SplitHeadline.tsx` (titre à masques par mot),
  CSS `.split-mask` / `.split-word` en fin de `global.css`.
- Piège : Lenis n'ajoute la classe `lenis` sur `<html>` qu'au premier défilement, pas
  à l'initialisation. Une sonde qui lit la classe sans défiler renvoie faux à tort.
- Vérifié (résultats réels) : `tsc -p apps/web` exit 0 ; `biome check apps/web/src`
  exit 0 (85 fichiers) ; `pnpm test` 47 fichiers / 621 tests passés ; `pnpm --filter
  @proofcore/web build` exit 0 ; sonde Playwright (`artifacts/motion-capture/probe.mjs`) :
  Lenis actif sans mouvement réduit, absent avec mouvement réduit, aucune erreur de page.
- Non vérifié : `/app` redirige vers `/signin` sans session, donc l'Overview n'a pas été
  capturé. Les captures `home`, `product` (desktop et mobile) existent dans
  `artifacts/motion-capture/`. Pas de revue visuelle de l'effet de titre au-delà du rendu.
- Mise à jour (suite) : `choreography.ts` corrigé : `riseWords` ne joue qu'une fois par
  session de page (plus à chaque changement de texte), montée 12 px sans rotation, easing
  `CustomEase` cubic-bezier(.2,.8,.2,1). `revealCards` : y 10, sans scale. Commentaires
  remis en place.
- `/app` capturé avec une session (`artifacts/motion-capture/capture-app.mjs`, compte de
  test local créé dans la base de dev, mot de passe aléatoire non conservé) : desktop et
  mobile, 0 erreur de page, reste sur `/app`. Constat : la zone module sous la tête reste
  vide à la capture (2 s d'attente). Cause non établie : deux moteurs de révélation se
  superposent (`lib/reveal.ts` `data-reveal` et `revealCards` GSAP). Sonde DOM non
  exécutée (refusée par le garde-fou).
- Vérifié : `tsc -p apps/web` exit 0 ; `biome check` sur les fichiers touchés exit 0 ;
  `node tooling/scripts/build.mjs` exit 0. `biome check .` exit 1 : une seule erreur de
  format, dans le tableau d'en-tête de `APP-MEMORY.md` (lignes 92–99, antérieure à ma
  section).
- Trouvé, non traité : environ 300 ternaires `fr ? … : …` restent dans 11 pages de
  `pages/app/` (AiChat, Settings, Scan, Workspace, Billing…).

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

## 2026-11-16 (fin de journée) — déslop visuel et textuel

- RunArtifact (le faux terminal de la landing) supprimé, avec sa grille CSS; le héros n'a plus qu'une colonne.
- Icônes "étoiles IA" (Sparkles, AiMark) supprimées partout : boutons "Interpréter avec l'IA" sans icône, avatar chat = Brain, accueil chat = Terminal, nav IA = Brain. AiMark.tsx supprimé.
- Copy FR/EN réécrite (dictionaries.ts, marketing.ts, workspace.ts, AiChat.tsx) : plus de murs de tirets cadratins, plus de règle de trois, exemples concrets (Abidjan/Paris/Montréal).
- Bug réparé au passage : le dialog IA se bloquait sur `) : null}` orphelin quand replacingKey/état connecté changeait (trou laissé par le thread frère) ; chatModels inutilisé remplacé par profileModels.
- Full suite 620/620 verte, lint 0, build ok. Commit "fix(web): the fake terminal card and the AI starburst are gone...".
- Leçon : quand on supprime une icône d'import, vérifier les JSX conditionnels autour (`note ? (...) : null`) — biome formate mais ne répare pas le JSX.

## 2026-11-20 — audit de prise en main, accessibilité et verrou sandbox

- Parcours nouvel utilisateur : l'Empty de `/app` (aucun espace de travail) n'avait aucune action ; il porte maintenant un `Link` vers `/app/workspace` (`ws.overview.noWorkspace.action`, EN/FR).
- Facturation : le provider sandbox ne peut plus créditer un abonnement en production. `settle` répond 404 hors sandbox, `start` répond 503 `payment_provider_not_configured`, sauf `ALLOW_SANDBOX_BILLING=true`. Couvert par `apps/api/test/billing-sandbox-gate.test.ts` (3 cas).
- Accessibilité : un seul `h1` par page (marketing via `SectionHeading level={1}`), plus aucun saut de niveau — les cartes passent en `h2` quand le groupe suit le `h1` directement, le footer est devenu `<nav aria-label>` + `<p>`, `ModuleShowcase` accepte `headingLevel` (2 sur `/product`, 3 sur l'accueil). Audit Playwright sur 19 routes : `h1: 1`, `jumps: []`, aucune erreur console.
- Contrôles/labels/alt/ids : audit sur 15 routes, aucun nom accessible manquant, aucun `img` sans `alt`, aucun id dupliqué ; menu mobile OK (12 liens, Escape referme).
- `pnpm typecheck` OK, `npx biome check .` OK (389 fichiers), `pnpm test` 624/624 (48 fichiers), `pnpm --filter @proofcore/web build` OK.
- Non vérifié : `/app` derrière authentification n'a pas été audité visuellement ; aucune capture réelle des modules.
