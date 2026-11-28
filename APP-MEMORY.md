# MÉMOIRE DU PROJET — PROOFCORE / PROOFCORE

> Ce fichier est la mémoire de travail de l'application. Chaque agent (humain ou IA) le lit
> **avant** de toucher au code et le met à jour **après** chaque changement notable.
> Format : fait accompli, méthode, résultat. Les sections « en cours » et « voulu » pilotent
> la suite. Dernière mise à jour : 2026-11-27.

---

## 1. CE QUI A ÉTÉ FAIT (et comment)

### Architecture produit

| Réalisation                     | Où                                                                          | Comment (méthode)                                                                                                                                                                                                                                                                                                                                     |
| ------------------------------- | --------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Hub plein écran du CLI          | `packages/cli/src/hub-tui.ts`, `hub.ts`                                     | Écran alterné + lecteur de touches propre (decodeKeys), menu de complétion, historique, capture de la sortie des commandes dans le transcript. Testé avec 15 tests dédiés + `script -qec`                                                                                                                                                             |
| Installateurs auto-installables | `tooling/scripts/build-installers.mjs`, `packaging/`                        | Windows : SEA binaire + payload gzippé collé après un marqueur (le build relit son fichier : marqueur, sha256, gunzip vérifiés) ; Linux : en-tête shell + tar.gz ; .deb via dpkg-deb. **Vérifié réellement** : .run installé dans HOME temporaire, `proofcore --version` → ok                                                                         |
| Icônes générées                 | `packaging/assets.mjs`                                                      | PNG écrit à la main (en-tête + scanlines deflate + CRC), ICO = conteneur de PNG. Déterministe, identique Linux/Windows                                                                                                                                                                                                                                |
| App native (Electron)           | `apps/desktop/`                                                             | main.cjs : port libre → sidecar `proofcore serve` → lit l'URL à token unique qu'il imprime → charge la fenêtre. Menu : connexion, compte, maj, doctor. Liens externes → navigateur système. SMOKE test : `SMOKE_OK`/`SMOKE_LOCKED`                                                                                                                    |
| Connexion directe dans l'app    | `apps/desktop/src/sign-in.cjs`                                              | POST `/api/auth/sign-in/email` (même route que le site) → cookie lu dans Set-Cookie (jamais dans le corps) → coffre (safeStorage) + fichier session CLI. Refus : message de l'API affiché tel quel (pas d'énumération). Testé contre le site réel                                                                                                     |
| Porte de compte (gate)          | `apps/desktop/src/access.cjs`                                               | Décision pure : session + horloge + réponse du site. Priorité expiration : `session.expiresAt` (serveur) > JWT exp > grâce locale (7 j). Révoqué = verrou immédiat                                                                                                                                                                                    |
| Mémoire projet IA               | `packages/cli/src/memory.ts`                                                | JSON `.proofcore/memory.json`, 0600, atomique (tmp+rename), 40 faits max, dédupliqué ; `memoryPrompt()` → bloc FR pour le prompt système ; `summarizeConversation()` heuristique sans appel IA                                                                                                                                                        |
| Niveaux d'effort                | `packages/cli/src/effort.ts`                                                | low (seul, 10 pas) / medium (≥2 sous-agents, 18 pas) / high (3+, 28 pas, vérif croisée). Bloc de prompt `subagentPrompt()` en français                                                                                                                                                                                                                |
| Scan page (5 familles)          | `packages/core/src/page-scan.ts` + `apps/web/src/pages/app/Scan.tsx`        | 16 fail + 11 clean + 9 flow + 9 world + 4 exit en une requête ; garde SSRF ; page /app/scan branchée dans la nav                                                                                                                                                                                                                                      |
| Hub → `/update`                 | `packages/cli/src/update.ts` + `hub.ts`                                     | Manifeste de release + sha256 ; ancien binaire renommé de côté (jamais supprimé d'abord) ; npm/checkout refusés poliment                                                                                                                                                                                                                              |
| `doctor` conflits               | `packages/cli/src/doctor-env.ts`, `stack-check.ts`                          | Sonde réelle par ligne + la commande qui corrige : double lockfile, engines.node, playwright divisé, React dupliqué, session 0644, dossier en lecture seule                                                                                                                                                                                           |
| Déploiement cloud en 1 commande | `tooling/scripts/deploy-cloudflare.mjs`                                     | Préflight → migrations D1 → Worker → build web → Pages. API d'abord, site ensuite                                                                                                                                                                                                                                                                     |
| Mises à jour de l'app           | `electron-updater` (fenêtre) + `proofcore update` (moteur)                  | Deux artefacts, deux durées de vie ; « PRÊTE, s'installera à la fermeture »                                                                                                                                                                                                                                                                           |
| Intelligence projet (Neon)      | `apps/api/neon/schema.sql`, `src/project-knowledge.ts`                      | Projet Neon `proofcore` (`lively-queen-66947281`, aws-us-east-2). Import de dossiers/fichiers, stockage texte, audits IA de code et métriques ; D1 reste la vérité auth/billing/runs. Testé réellement : import 2 fichiers, audit JSON, score 42, 2 constats, historique et métriques relus                                                           |
| Audit IA de code                | `src/routes/project-intelligence.ts`, `ProjectIntelligence.tsx`             | Vrai appel au fournisseur configuré (pas une relecture des modules), lots de 45 k caractères, citations fichier:ligne, corrections, portée projet/dossier/fichier, un crédit `monthly_ai_audits`. Vérifié avec un faux fournisseur local et la base Neon réelle                                                                                       |
| E-mail EmailJS                  | `apps/api/src/email.ts`                                                     | EmailJS prioritaire (service, template, clés publique/privée), Resend en repli, `unconfigured` journalisé sinon. Aucun identifiant EmailJS fourni : envoi réel non testé                                                                                                                                                                              |
| Interface projet simplifiée     | `src/pages/app/ProjectDetail.tsx`                                           | Trois onglets Audit IA / Métriques / Exécutions, détails repliés, CTA IA depuis les modules, graphique de score dès le premier audit. Revu en captures 1440 px et mobile                                                                                                                                                                              |
| Patch de constat (Finding)      | `apps/api/src/routes/ai.ts`, `apps/web/src/components/app/FindingPatch.tsx` | `POST /api/v1/ai/patch` : `prepare_code_patch` localise, le modèle répond un JSON strict, l'outil vérifie le bloc `before` et rend le diff ; refus honnêtes (`model_refused`, `before_not_found`, `no_candidate_file`), rien n'est écrit. Preuve : 5 tests API + E2E `finding-patch` 2/2 (desktop/mobile, fournisseur mocké) avec presse-papiers relu |
| Remédiation complète (outil IA) | `apps/api/src/remediation-plan.ts`, `apps/api/src/routes/ai.ts`             | `generate_remediation` (lecture) : correctif + vérification du registre, chaîne en 10 étapes (3 prouvées), exemples, extraits de code classés ; refuse un constat non défectueux, nomme `missing`, n'écrit rien. Preuve : 6 tests `remediation-plan` (dont une boucle `/ai/chat` avec upstream simulé) + catalogue/classification `ai-tools`          |

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

### 2026-11-21 (nuit) — audit visuel complet + direction artistique figée

La reconstruction visuelle demandée a été exécutée en trois commits (`61b9ce8`, `05f4a0f`, `bb3241b`),
avec audit d'abord (35 pages capturées à 1440 et 390, dossier `docs/design/audit-2026-11-21/`) puis correctifs.
Les six documents obligatoires existent : `docs/VISUAL_AUDIT.md`, `VISUAL_DIRECTION.md`, `DESIGN_SYSTEM.md`,
`UX_ARCHITECTURE.md`, `RESPONSIVE_GUIDELINES.md`, `VISUAL_QA_REPORT.md`.

Corrigé et vérifié par re-capture : débordement `/download` à 390 (empreintes sha256) ; panneau d'usage
de l'Overview en anglais codé en dur (8 clés i18n) ; section graphiques vides avant la première exécution ;
tableaux app à 390 (affordance de scroll) ; état vide dupliquant son titre ; h1 manquants sur 7 routes
marketing ; `/app/scan` nu (prévisualisation des 5 lectures) ; descriptions d'offres anglaises en page FR.
Mouvement : moteur `lib/motion.ts` (ressorts, tilt spéculaire, CTA magnétiques, parallaxe) + `SplitWords`
**rendu par React** (un splitter impératif désynchronise au changement de langue — leçon conservée).
653 tests au vert. Reste : #9 (autres états vides), vues tablette modules/FLOW, redeploy éventuel.

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

## 2026-11-20 (nuit) — les modules se lancent depuis l'interface

- Page projet : bouton « Lancer les modules » (en-tête et état vide des runs). Il envoie `POST /api/v1/audits` avec l'URL du projet, puis ouvre `/app/scan?audit=<id>&explain=1` : le résultat arrive avec un résumé en clair (compteurs + trois premiers constats bloquants) et l'interprétation IA déjà demandée.
- `/app/scan` accepte `?audit=` (ouvre cet audit plutôt que le dernier) et `?explain=1` (une interprétation par audit, garde `useRef`) ; `explain` et `reportForModel` passés en `useCallback` pour que l'effet ne rejoue pas.
- Pages module : CTA « Lancer sans installer » vers le scan ; la configuration CLI reste mais devient explicitement facultative (« Automatiser (optionnel) », « CLI (facultatif) »).
- Bug corrigé : la config générée émettait `exit` trois fois (FAIL et CLEAN retombaient sur la branche `exit`). Table `moduleBlocks` explicite ; FAIL/CLEAN n'ont pas de bloc de config.
- Limites assumées : l'interprétation IA exige une clé fournisseur dans `/app/ai` (message + lien si absente) ; le résumé en clair ne dépend d'aucun modèle. L'audit reste au niveau de l'espace, non rattaché au projet (pas de colonne `project_id`).
- Vérifié : `biome check .` 0, `pnpm typecheck` 0, `pnpm --filter @proofcore/web build` 0, `pnpm test` 624/624 ; parcours Playwright : clic → 201 audit → `/app/scan?audit=…` → résumé + appel IA (`ai_not_configured` affiché proprement).

## 2026-11-20 (nuit) — scan rattaché au projet, premier parcours guidé

- Migration `0015_audit_project.sql` : `page_audits.project_id` (nullable) + index `(workspace_id, project_id, created_at DESC)`. `createPageAudit` l'écrit, `listPageAudits` filtre dessus sans changer le comportement des lignes antérieures.
- `POST /api/v1/audits` accepte `projectId` : projet inconnu ou d'un autre espace → 404 `project_not_found` **avant** le scan, donc aucun quota consommé. `GET /audits?projectId=` filtre, et répond 404 pour un projet absent plutôt qu'une liste vide trompeuse.
- Page projet : « Lancer les modules » envoie le `projectId` ; nouvelle carte « Scans de ce site » (10 derniers, lien vers `/app/scan?audit=…&explain=1`).
- Nouvelle page `/app/start` : un seul champ (l'adresse) → scan + verdicts + résumé + lecture IA sur le même écran, sans navigation. Entrée depuis l'état vide de la vue d'ensemble (« Analyser mon site maintenant »).
- Vérifié : biome 0, typecheck 0, build 0, `pnpm test` 625/625 (nouveau test : rattachement, filtre, 404 pour projet inconnu et pour projet d'un autre espace) ; Playwright local : projet → scan → la carte liste l'audit créé ; `/app/start` reste sur la même page et affiche verdicts, résumé et message IA sans clé.

## 2026-11-21 — passe de refonte (phase 1 + début phase 2)

- Identité : le web parle de **PROOFCORE** (le nom public), les identifiants `proofcore` restent techniques. Pas de validation juridique effectuée.
- Téléchargements : `GET /api/v1/releases/latest` (proxy GitHub côté Worker, cache 5 min, digest quand publié) remplace l'appel navigateur à `api.github.com` — bloqué par la CSP. Monté **avant** `workspaceRoutes`, dont le garde `*` renvoyait 401 aux visiteurs anonymes (couvert par un test d'intégration).
- CI/typecheck : CI ne fige plus pnpm 10 (lit `packageManager`), `pnpm typecheck` construit les paquets internes avant le check. Vérifié en supprimant tous les `dist/` et `*.tsbuildinfo` : 0 erreur.
- UX : mode Simple par défaut (Vue d'ensemble, Projets, Démarrer) ; bascule Studio dans l'en-tête, persistée par navigateur (`proofcore.ui-mode.v1`) sans toucher aux données. Accueil sans projet : « Que souhaitez-vous faire aujourd'hui ? » avec 4 portes réelles.
- Docs : compte de tests figé retiré du README, promesse SDK retirée, contradiction MCP résolue (API hébergée ≠ serveur MCP ; `proofcore mcp` est un serveur stdio local). `docs/REFACTOR_PROGRESS.md` liste honnêtement ce qui reste.
- Vérifié : biome 0 (389 fichiers), typecheck propre 0, tests 49 fichiers / 630, build web 0 ; Chrome : accueil 4 choix, bascule Simple/Studio persistante, `/app/start` OK, `/download` sans appel GitHub.

## 2026-11-21 (suite) — configuration des modules sans TypeScript

- `projects.module_config` (migration 0016) + `GET/PUT /api/v1/projects/:id/config`. Validation avec les schémas `@proofcore/contracts` ; `422 config_unsafe` pour `live_charge` et export production non acquitté. Les avertissements ordinaires sont renvoyés avec la config enregistrée.
- Page `/app/projects/:id/config` : WORLD (profils, catégories, cible HTTP, variable de jeton), FLOW (mode de paiement, scénarios, URLs), EXIT (formats, type de données, source, max, aller-retour), avertissements, sauvegarde, téléchargement `proofcore.config.json`.
- CORS : `PUT` manquait dans `Access-Control-Allow-Methods`, ce qui faisait passer chaque sauvegarde pour une API injoignable ; corrigé et couvert par un test de préflight.
- Les `journeys` FLOW sont désormais exécutés par `proofcore test` via Chromium local (`packages/cli/src/journey-runner.ts`) et éditables dans la page de configuration. Un audit serveur les marque `SKIPPED` (pas de navigateur), jamais PASS. Pas de `config pull` : l'utilisateur télécharge le JSON, le place à la racine et lance `proofcore test`. Aucun secret stocké.
- Vérifié : biome 0, typecheck 0, tests 50 fichiers / 639, build web 0 ; Chrome : sauvegarde, rechargement, téléchargement et lecture serveur cohérents.

## 2026-11-21 (corrections, progression, support, identité)

- Identité : **PROOFCORE** partout dans le web. Les noms techniques historiques restent : dépôt GitHub `PROOFSTACK`, domaines `proofstack-*`, projet Cloudflare `proofstack`. Les renommer casserait releases, liens et CORS.
- Corrections : migration `0017_corrections_and_support.sql`, table `audit_finding_states` (workspace, projet, clé `module:id`, état `todo|in_progress|fixed|verify`). `GET/PATCH /api/v1/projects/:id/corrections` ; le board fusionne le dernier scan et les constats suivis disparus ; comparaison avec le scan précédent (résolus / persistants / nouveaux). Un constat suivi qui disparaît passe à `verify`, jamais à `fixed` automatiquement.
- Progression réelle : `POST /api/v1/audits/stream` (SSE) émet `request`, `fetch`, `verdict`, `save` au moment où chaque phase s'exécute, avec durée/HTTP réels et comparaison. `/app/scan` affiche ces événements, sans animation. POST classique conservé.
- Pré-contrôle : `GET /projects/:id/config` renvoie `precheck` = `NOT_CONFIGURED` / `BLOCKED` / `READY` ; la page projet affiche deux bannières distinctes.
- CLI : aide groupée, `init` guidé (modules + cibles WORLD/FLOW/EXIT), `config pull`, mot de passe refusé en argument (`PROOFCORE_LOGIN_PASSWORD` ou saisie masquée).
- Support : `GET /api/account/support/:reference?email=` renvoie statut + réponse seulement si l'adresse correspond ; file opérateur `GET/POST /api/v1/admin/support` avec réponse.
- Vérifié : biome 0 (394 fichiers), typecheck 0, 51 fichiers / 643 tests, build web 0. E2E local : SSE 200 avec 8 événements et 4 étapes réelles, 43 constats, `precheck=NOT_CONFIGURED`, PATCH `in_progress` persisté, support 200.

## 2026-11-21 (audit sécurité, journeys FLOW, double scan production)

- Audit écrit dans `Docs/security/AUDIT_2026-11-21.md`. Corrigés : escalade opérateur `@proofcore.dev` sur `/delivery-status` (allow-list seule), upload machine sans limite (413 via `readBody`), SSRF des redirections IA et des bases fournisseur, disjonction de contrôle d'hôte dans `fail_scan`. La note d'un constat est préservée lors du passage automatique à `verify`.
- FLOW : `packages/modules/flow/src/journeys.ts` exécute réellement les étapes ; `packages/cli/src/journey-runner.ts` les pilote avec Chromium local ; l'éditeur `/app/projects/:id/config` compose parcours et étapes. Un audit serveur les marque `SKIPPED` (pas de navigateur), jamais PASS.
- Production, compte QA neuf : deux scans de la page donnent 43 constats identiques (comparaison stable). Puis scan HTML (43) → PATCH `clean:headings` en `in_progress` → scan non-HTML (1 constat) : 43 résolus, le constat suivi devient `verify` avec `present:false`. Le 4ᵉ scan d'un compte gratuit répond 403 quota, comportement attendu.
- Vérifié localement : suite complète 51 fichiers / 647 tests, typecheck 14 paquets + apps, Biome 0 sur les fichiers touchés.
- **Déployé le 21/11** : API Worker version `d5fa4eb6-7eda-4961-8f4b-8dc25f4ad20b`, Cloudflare Pages `3ecab3f3.proofstack-01z.pages.dev`, Vercel `proofstack-8wtq30mc7`. `ADMIN_EMAILS` est un secret Worker, plus une variable du dépôt.
- Production vérifiée : smoke API + Vercel + Pages 15/15 ; session `Max-Age=604800` (7 jours, expiration 2026-11-28) ; compte auto-inscrit `@proofcore.dev` → `/delivery-status` **403** ; base fournisseur `http://127.0.0.1` → **400 `insecure_base_url`** ; fournisseur public OpenAI avec fausse clé → **401** propre, sans suivi de redirection ; bundles FLOW Pages et Vercel contiennent « Ajouter un parcours » et « Ajouter une étape ».
- Régression trouvée en production et corrigée (commit `6c4bd2a`) : les Workers refusent `redirect: "error"`. `fetchCatalogue` utilise `redirect: "manual"` et traite tout 3xx comme un échec, sans suivre la redirection.
- Limites restantes, documentées sans faux correctif : PBKDF2 plafonné à 100 000 par WebCrypto Workers ; rebinding DNS faute de proxy de sortie avec épinglage d'IP ; limiteurs scan/device/IA encore par isolate (quotas de plan en base en backstop) ; vérification d'e-mail impossible sans fournisseur d'e-mail configuré.

## 2026-11-21 (mission PROOFSTACK 2.0 — matrice + deux correctifs, commit b0e43e6)

- `docs/PRODUCT_CAPABILITY_MATRIX.md` livrée : les 46 contrôles réels par module, les limites nommées (FLOW `SKIPPED` sans navigateur côté Worker, CLEAN sur HTML serveur), les surfaces UI/API/CLI/tests et la maturité. FAIL et CLEAN n'ont **pas** de paquet dans `packages/modules/` : leurs contrôles vivent dans `packages/core/src/page-scan.ts`, c'est un écart de structure, pas de capacité.
- `docs/PROOFSTACK_2_0_DELIVERY_REPORT.md` : état des phases 1-8, des 10 tests de validation, et les trois décisions qui appartiennent au propriétaire (clé IA imposée, cinq modules, fournisseur d'e-mail absent).
- Correctif 1 — `/app/billing` mappait les lignes d'usage en comparant des libellés anglais (`counter.label === "Projects"`), donc `monthly_ai_audits` s'affichait en anglais dans la page française. Table `USAGE_COPY` par clé, deux langues, repli sur les mots de l'API pour un compteur inconnu. Vérifié au navigateur : plus aucune des quatre chaînes anglaises dans le DOM.
- Correctif 2 — l'audit IA de code encadrait chaque fichier par `--- FILE:` fixe, forgeable par le fichier analysé pour se faire passer pour un autre. Clôture à nonce aléatoire par appel, toute séquence `<<<…>>>` du contenu neutralisée, règle ajoutée au prompt système (`AUDIT_UNTRUSTED_RULE`). 6 tests dans `apps/api/test/untrusted-file-content.test.ts`. Le nonce utilise le `crypto` global : **jamais `node:crypto`** dans `apps/api/src`, aucun drapeau `nodejs_compat` n'est activé sur le Worker.
- Fichiers générés retirés du suivi : `.proofcore/semantic-index.json` (1,3 Mo + chemin absolu local, ajouté de force malgré `.gitignore`) et `.perch/mcp.json` (chemin propre à la machine). `.perch/` est ignoré. Les deux restent sur le disque, seul le suivi change.
- Vérifié : 52 fichiers / 653 tests, Biome 0, typecheck web+API 0, `node tooling/scripts/build.mjs` complet.

## 2026-11-22 (quatre tranches : explications, registre, statuts, vérification)

- **Explications déterministes.** `packages/core/src/controls.ts` : 46 contrôles, chacun avec objectif, conséquence, correctif, vérification et exemples par pile (Nginx, Apache, helmet, Laravel, Django, PHP, React, Next.js, WordPress, Stripe, Paystack), en FR et EN. Rendus dans la page de scan, dans `GET /api/v1/controls` (public, cache 1 jour) et dans `proofcore explain [contrôle]`. Aucun modèle, aucune clé.
- **Registre = source unique.** `controlFor(module, id)` et `explain(module, id, locale)`. `clickjacking_frame_headers` est marqué `aliasOf: frame_ancestors` : il reste rapporté (historique) mais `summarise` compte la question **une seule fois**. Un test compare un scan réel hostile au registre, id par id ; un contrôle non enregistré ne peut pas passer inaperçu.
- **Statuts.** `BLOCKED`, `NOT_APPLICABLE`, `NOT_CONFIGURED` ajoutés au contrat avec `default(0)` dans les totaux (les runs déjà stockés se relisent). `aggregateStatus` : seuls PASSED/FAILED/WARNING comptent comme réponse, donc un run fait de ces trois-là vaut `NOTHING_VERIFIED`, et un run qui a aussi jugé vaut `PARTIAL`, jamais `COMPLETED`. JUnit les rend en `<skipped>` avec le statut dans le message (jamais en `<failure>` ni en pass). `exitCodeFor` renvoie 2 si un cas est bloqué ou non configuré.
- FLOW : pas de cible → `NOT_CONFIGURED` ; produit sans checkout/readback/webhook/refund → `NOT_APPLICABLE`. EXIT : pas de source, de schéma, de relations ou de contraintes → `NOT_CONFIGURED` ; export illisible → `NOT_APPLICABLE`.
- **Vérification.** `POST /projects/:id/corrections/:key/verify` : relit la page, isole le même `module:id`, enregistre avant/après et un verdict (`fixed`, `still_present`, `worse`, `not_checked`, `inconclusive`). Migration `0018` (colonnes `verified_*`). Pas de ligne d'audit donc pas de quota ; même limiteur qu'un scan. Un site illisible donne `inconclusive`, jamais « toujours présent ». Un contrôle déjà `PASS` est refusé (409 `nothing_to_verify`). Seul un `fixed` déplace l'état de travail.
- Le scanner est **injecté** via `Services.scan` (comme `fetchImpl` dans `scanPage`) : tout le chemin HTTP de vérification est testé sans réseau.
- Piège rencontré : `migrationFiles()` dans `db/node-sqlite.ts` liste les migrations **à la main** — ajouter un fichier SQL ne suffit pas, il faut l'ajouter au tableau.
- Vérifié : 55 fichiers / 674 tests, Biome 0, typecheck web+API+CLI 0, build complet. Contre un vrai site : `still_present` sur `example.com` (pas de HSTS), et dans l'interface `tls` → « Corrigé », `hsts` → « Toujours présent ».

## 2026-11-22 (le site, pas la page : session réelle, crawl borné, note calculée)

- **Connexion réelle** (`packages/core/src/session.ts`). L'ancien `performLogin` de `page-scan.ts` postait des identifiants et appelait « connecté » tout cookie reçu : un mot de passe refusé passait pour une session. Remplacé par `signIn` : lecture de la page, découverte du formulaire, de son `action`, de ses champs et de son champ caché anti-CSRF, jar de cookies avec règles de chemin/domaine/`Secure`/expiration, envoi avec `Origin` et `Referer` corrects, suivi manuel des redirections pour que chaque saut garde ses cookies, puis **preuve de la session sur une page qui l'exige**. Un refus est rapporté avec la phrase du site ; un mur MFA est dit MFA ; un jeton bearer trouvé dans une réponse JSON sert à la vérification et n'entre jamais dans le rapport. `page-scan.ts` délègue désormais à `signIn` au lieu de dupliquer la logique.
- **Crawl borné** (`crawl.ts`) : même origine par défaut, limites de pages, profondeur, concurrence, octets et durée ; `robots.txt` respecté par groupe d'agent avec `Crawl-delay` ; `logout`/`delete`/`unsubscribe` jamais suivis ; le sitemap amorce la mesure sans élargir la frontière.
- **Contrôles de site** (`site-scan.ts`) : 13 questions qu'une page seule ne peut pas poser (liens cassés, redirections, titres dupliqués ou absents, pages lourdes ou lentes, TLS/HSTS absents, source maps publiées, contenu mixte, robots/sitemap, couverture). Chacune **nomme les pages** concernées au lieu de les compter.
- **Note calculée** : poids de risque lus dans le registre (le texte et le nombre ne peuvent pas se contredire), borne basse de Wilson sur le taux de réussite pondéré, × facteur de couverture. Un module fait uniquement d'avertissements tombe entre 0 et 100 au lieu de 0 ; 3 pages ne peuvent pas dépasser 40 pages lues.
- **Moteur** (`site-audit.ts`) : connexion → mesure complète de la page nommée → crawl → mesure des autres → note. Une connexion refusée n'interrompt pas : l'audit couvre la surface publique et le dit (`login.ok: false`).
- **Câblage** : `POST /audits` et `/audits/stream` partagent un seul `runScan` (le flux montre les phases réelles) ; `proofcore scan --crawl --login-endpoint --login-verify` (le mot de passe reste hors d'`argv`) ; l'assistant gagne `site_audit` borné à 20 pages, et `fail_scan`/`clean_audit` cessent de réimplémenter leurs contrôles pour appeler le même moteur.
- Registre : **59 contrôles**, tous bilingues, tous atteignables par `proofcore explain`.
- Vérifié contre un vrai site derrière un login CSRF : connexion, pages privées lues, deux pages au même titre et un 404 du pied de page trouvés, `/logout` jamais suivi. Sur `rfc-editor.org` : 4 pages mesurées, note 47/100, couverture 66 %, provisoire, « 4 of 4 pages send no Strict-Transport-Security ». 712 tests, 59 fichiers.
- Limite assumée : les phrases `observed` des contrôles de site sont en anglais technique (comme les ids et les statuts) ; le titre, la conséquence, le correctif et la vérification sont dans la langue de l'interface via le registre.
- Retouches après usage réel (commit `d091680`) : HSTS marqué `SKIPPED` sur un site entièrement http (c'était le même défaut que `pages_without_tls`, dit deux fois) ; la progression du moteur transporte désormais `step/page/done/total/status` et **chaque surface écrit sa phrase** — le CLI et le flux SSE parlent français, l'anglais du moteur n'est plus qu'un repli pour les appelants bibliothèque ; `performLogin` supprimé de `page-scan.ts` au profit de `signIn`.
- Vérifié de bout en bout sur un serveur local qui exige un jeton CSRF : `scan http://127.0.0.1:<port>/compte --crawl --login-url …/login` → « connexion établie et vérifiée », pages privées lues, 404 du pied de page et deux titres identiques trouvés, `/deconnexion` jamais suivi. Le flux `POST /api/v1/audits/stream` montre les mêmes phases en français.

## 2026-11-22 (déploiement production : Cloudflare + Vercel + Neon vérifié)

- **Neon branché et prouvé.** Projet `proofcore` (`lively-queen-66947281`, `aws-us-east-2`), schéma `apps/api/neon/schema.sql` déjà appliqué. `NEON_DATABASE_URL` (endpoint _pooled_) réinstallé comme secret Worker par `stdin`. Preuve de bout en bout depuis le Worker : `POST /api/v1/projects/:id/sources` → 201, la ligne est lue en `psql` sur la base, puis source et projet supprimés proprement.
- **`/health` distingue les deux bases.** `database` (D1) et `knowledge` (Neon : `ok | not_configured | unreachable`, avec un vrai aller-retour `select 1`). Le statut global passe à `degraded` si Neon est configuré mais injoignable. Un `database: ok` qui masquait un `NEON_DATABASE_URL` absent faisait passer une fonctionnalité entière (fichiers de projet, audits IA de code) pour livrée.
- **Déploiement** : migration D1 `0018` appliquée à distance, Worker `proofcore-api` version `fbfd3c60-529a-40d7-90a6-5c7b0c7ea6d1`, Cloudflare Pages `bbd46f5a.proofstack-01z.pages.dev` (alias `proofstack-01z.pages.dev`), Vercel `proofstack-pyn4po6q7` (alias `proofstack-iota.vercel.app`). Smoke 8/8, puis vérifié en navigateur : connexion, `/app`, `/app/scan` avec la case « Lire tout le site », zéro erreur console.
- **Le Worker `proofstack-api` est un doublon périmé** (déployé le 17/11, avant l'audit de sécurité du 21/11) : plus rien ne le référence, ni `vercel.json`, ni `wrangler.toml`, ni le code. Il reste en ligne tant que personne ne le supprime (`wrangler delete --name proofstack-api`), et il porte d'anciennes failles. Décision laissée au propriétaire.
- **`docs/deployment/CONNECTIONS.md` réécrit** comme liste unique de ce que seul l'opérateur peut fournir : où cliquer, format exact, commande d'installation, commande de vérification. Il inclut la façon de transmettre un secret sans l'écrire dans la conversation.
- Déploiement fait à la main (script `deploy-cloudflare.mjs` refusant un arbre sale à cause d'un fichier de travail d'un autre fil, `qa-hero.mjs`) : migration D1, `wrangler deploy`, `pages deploy`, `vercel --prod`, puis `smoke-deploy.mjs` — même ordre, mêmes contrôles.
- **Mot de passe Neon tourné** : il avait fuité en clair dans une commande de vérification. Rôle `neondb_owner` réinitialisé (`neon roles reset-password`), URL poolée réinstallée comme secret Worker par `stdin` depuis un fichier 0600 supprimé après usage. Vérifié après rotation : `/health` → `knowledge: ok`, et `POST sources` répond 200 depuis le Worker.

## 2026-11-22 (CLI 0.6.0 : binaire, connexion navigateur, et npm bloqué sur un jeton)

- **npm n'est pas à jour, et ne peut pas l'être sans le propriétaire.** Le registre public `proofcore` est à **0.1.0** ; le dépôt est à **0.6.0**. `npm whoami` n'est pas connecté, et `tooling/scripts/publish-cli.mjs` exige `NPM_TOKEN` (variable d'environnement ou saisie masquée). Tout le reste est prêt et vérifié : `node tooling/scripts/package-cli.mjs` produit `artifacts/proofcore-0.6.0.tgz`, installé dans un préfixe temporaire (`npm i -g --prefix`), `proofcore --version` → 0.6.0, et `proofcore login --device` ouvre le navigateur puis se connecte.
- **Binaire local à jour** : `~/.local/bin/proofcore` passe de 0.4.0 (20/11) à 0.6.0 (`node tooling/scripts/build-binary.mjs`, 1 min, 121 Mo). `proofcore scan https://example.com --crawl` fonctionne, `proofcore status` lit la production.
- **Connexion par navigateur prouvée de bout en bout** : `login --device` → code `U88S-Q3DE` → page `/device` sur Vercel → « Approuvé » → « Signed in as … », session écrite en 0600. La machine est désormais connectée au compte réel (`extends08@gmail.com`, espace `KICHUB`, plan Agency, 3 projets).
- **Défaut corrigé** : une session enregistrée contre un autre hôte était jetée puis annoncée « not signed in ». `staleSessionHost()` + `status` nomment maintenant les deux hôtes et la commande qui répare (`proofcore login`). C'est ce qui s'était produit ici : session sauvée contre `https://proofstack-iota.vercel.app`, l'ancien défaut.
- **Incident : j'ai balayé le travail d'un autre fil.** Le commit 0.6.0 a emporté trois suppressions déjà indexées (`NightSky.tsx`, `Ornaments.tsx`, `SeismoStrip.tsx`) alors que `Home.tsx`/`HomeLight.tsx` les importaient encore → master ne compilait plus (3× TS2307 en CI). Restaurés dans `bde162f` ; l'étiquette `v0.6.0` a été déplacée sur ce commit. Règle : ne jamais committer sans lister les chemins, même quand on vient de faire `git add`.
- **Release v0.6.0 non publiée, deux blocages d'infrastructure** : `macos-14`/`macos-13` ne sont pas disponibles sur ce compte (« configuration 'macos-14-arm64-us-default' is not supported »), et le job desktop Windows échoue avant l'upload. Le job Linux (installeur `.run`, `.deb`, AppImage, `latest-linux.yml`) passe. Run annulé pour ne pas laisser une release à moitié publiée.
- **CI master rouge, hors périmètre CLI** : 22 erreurs Biome, toutes dans `apps/web/src/components/brand/*` (fil de design en cours), plus 3 tests e2e marketing (`pricing shows real plan prices`, `no page logs a console error on load`, `the language switch actually changes the copy`). Non touché : c'est le travail en cours d'un autre fil.

## 2026-11-22 (release 0.6.2 : le site sert les fichiers, les trois systèmes sont construits)

- **Le téléchargement ne quitte plus le site.** `GET /api/v1/releases/versions` liste les étapes récentes avec nos propres URLs ; `GET /api/v1/releases/assets/:name` sert les octets, avec le nom du fichier, la longueur réelle et les requêtes `range` transmises (le différentiel de l'updater continue de marcher). Seuls les noms présents dans une release publiée sont servis : c'est un miroir, pas un proxy ouvert. La page a un sélecteur de version, détecte le système, et liste macOS qu'elle n'a jamais listé.
- **Le miroir ne tombe pas avec l'API GitHub.** Les Workers partagent leurs adresses de sortie : 60 appels anonymes par heure sont dépensés par d'autres, et la page a servi `v0.5.0` quatre jours après la sortie de `v0.6.1` (en-tête `x-release-cache: manifest`, donc un instantané de déploiement présenté comme la release). Chaque release attache désormais **`release.json`** — le build décrivant ses propres fichiers avec taille et sha256 — et le Worker, quand l'API refuse, lit le tag par la redirection `/releases/latest`, lit cet index, et reconstruit la page ; la liste des versions vient du flux `releases.atom`. Si aucune des deux sources ne répond, la route échoue encore en disant pourquoi.
- **Les anciennes versions restent listées.** Une étiquette d'avant `release.json` (0.5.0, 0.6.1) s'affiche avec sa date et sans fichiers ; la choisir appelle `/releases/latest?version=<tag>`, qui lit l'index ou l'API. Quand aucune ne répond, la page nomme la version, nomme la cause et dit quoi faire — au lieu de trois colonnes vides sans un mot.
- **Les trois systèmes sont réellement construits.** `esbuild` était invoqué par son binaire (`esbuild/bin/esbuild`), absent à ce chemin sous Windows : tout build Windows mourait en `ENOENT` avant d'écrire quoi que ce soit. Passé à l'API JS d'esbuild (`build()`), dans `build-binary.mjs` et `build-installers.mjs`. Le matrix macOS pointait sur `macos-14`/`macos-13`, indisponibles ici → `macos-latest` (arm64) et `macos-15-intel` (x64).
- **Quatre défauts de la publication, chacun découvert par un run :** `app:dist:mac` n'existait qu'en script de paquet (le job macOS échouait en 33 s) ; le job `publish` écrivait le manifeste depuis `packages/cli/package.json` sans checkout (`Cannot find module`) ; `download-artifact` conserve l'arborescence des uploads, donc les fichiers arrivent sous `dist/installers`, `dist/bin`, `dist/desktop` et l'étape ne lisait que la racine (« no binaries to describe » avec sept artefacts téléchargés) ; une apostrophe dans un commentaire du script `node -e '…'` fermait la chaîne du shell (`SyntaxError`). Le script extrait est désormais exécuté contre un faux `dist` avant commit.
- **macOS publie un `zip` en plus du `dmg`.** Squirrel.Mac ne sait pas se mettre à jour depuis un dmg : une release sans zip aurait livré une fenêtre incapable de se mettre à jour, avec un `latest-mac.yml` nommant un fichier inexistant.
- **Release `v0.6.2` publiée, 7 jobs verts + publish** : `PROOFCORE-0.6.2-x64.exe`, `-amd64.deb`, `-x86_64.AppImage`, `-arm64.dmg` + `.zip`, quatre installateurs CLI (`win-x64`, `linux-x64`, `darwin-arm64`, `darwin-x64`), quatre binaires autonomes, `manifest.json` (0.6.2, 4 cibles), `release.json`. Vérifié en navigateur : `v0.6.2` par défaut, trois colonnes remplies, 9 liens tous sur notre domaine, **zéro lien github.com**, aucune erreur console.
- **Sur Windows et macOS, l'app se met à jour depuis notre API** : `autoUpdater.setFeedURL({ provider: "generic", url: <api>/api/v1/releases/assets/ })`, et `proofcore update` lit `<api>/api/v1/releases/assets/manifest.json` (vérifié : manifeste 0.6.2, binaire HEAD 200, 121 Mo).
- **Textes faux retirés.** L'onboarding CLI de l'app disait encore « Le paquet npm n'est pas encore publié » et faisait cloner le dépôt (`git clone … && pnpm cli:install`) : remplacé par `npm i -g proofcore`. `download.lede` ignorait macOS, `download.cli.body` renvoyait « sur la page des versions », `download.fallback` disait « Ouvrez la page des versions ». `--help` ne mentionnait pas `scan`, la commande que le site conseille.
- **Reste un seul écart : npm est à `0.6.0`, la release à `0.6.2`.** `NPM_TOKEN` manque toujours. Le workflow de release gagne une étape « Publish the CLI to npm », sautée quand le secret est absent : `gh secret set NPM_TOKEN` puis re-run de la dernière étiquette suffisent, et les suivantes resteront synchrones sans intervention.

## 2026-11-23 (release 0.6.3 : le manifeste ne tombe plus, les installés se mettent à jour)

- **Version courante : 0.6.3** (`packages/cli`, `apps/desktop`, `version.ts`). Release `v0.6.3` publiée et `latest`. npm `proofcore` reste à **0.6.0** : `NPM_TOKEN` n'est pas défini.
- **Le 503 de `/releases/assets/manifest.json` venait du Worker.** Les assets issus de l'index avaient une URL relative ; la route de téléchargement la passait à `fetch()` (`Invalid URL`). Corrigé : l'URL GitHub reste interne, et `localise()` réécrit toute sortie, y compris la réponse en cache de `/releases/latest`, qui ne l'était pas. Test ajouté. Vérifié : manifeste 200 sur 5 appels, `proofcore update` 0.6.2 → 0.6.3 avec sha256 confirmé.
- **Leçon** : une route de téléchargement doit être testée avec un asset réel (URL relative ou absolue), pas seulement avec le chemin de sortie.

## 2026-11-22 (Vercel bloquait le site : protection de déploiement)

- **Symptôme** : « Vercel bloque le site ». Les URLs de déploiement (`proofstack-l60pa18ig-…vercel.app`, `proofstack-pyn4po6q7`) répondaient `302` vers l'écran d'authentification Vercel, alors que l'alias de production servait la page. Cause exacte : `ssoProtection.deploymentType = "all_except_custom_domains"` sur le projet `proofstack` (`prj_KHv33Dil9FBeANTqyITxLL8gAsht`). J'avais cité les deux types d'URL dans les rapports, donc la moitié des liens envoyés demandaient une connexion.
- **Correctif** : `PATCH https://api.vercel.com/v9/projects/proofstack {"ssoProtection": null}` avec le jeton de la CLI Vercel. Vérifié après coup via Playwright : les trois URL (déploiement, alias Vercel, `proofstack-01z.pages.dev`) rendent `/download` avec 9 liens et zéro erreur console.
- **Leçon** : ne citer qu'une URL canonique par hôte dans les rapports, et vérifier chaque lien envoyé plutôt que le seul alias.
- **`proofcore status` affiche la version.** Elle manquait : après une installation, « quelle version est sur cette machine et est-ce la dernière » demandait de connaître `--version`. Lue depuis le cache d'update, donc `status` ne fait pas d'appel réseau pour ça, et la ligne nomme `proofcore update` quand une version plus récente est connue. Binaire local réinstallé (`~/.local/bin/proofcore`, 0.6.2).

## 2026-11-22 (le site était cassé par ses propres en-têtes, pas par Vercel)

- **Deux défauts trouvés en instrumentant le navigateur au lieu de croire l'API.** Vercel ne bloquait plus rien (`ssoProtection` retiré) : ce sont les en-têtes du site qui bloquaient le site.
- **Toute la typographie tombait en polices système.** `index.html` chargeait Archivo, Instrument Sans/Serif et JetBrains Mono depuis Google Fonts, et la CSP dit `font-src 'self' data:` — chaque requête était refusée (`blocked:csp`). Le produit s'affichait donc dans les polices de secours depuis toujours, et chaque visite contactait Google, ce que la page confidentialité ne promet pas. Les 16 fichiers woff2 (latin, latin-ext) sont maintenant servis par notre origine via `apps/web/public/fonts.css` ; `tooling/scripts/fetch-fonts.mjs` les régénère depuis la feuille Google (mêmes familles, mêmes axes, mêmes `unicode-range`), et reste dans le dépôt pour que la source soit vérifiable.
- **Le comparateur de DA était vide.** La page d'accueil cadre `/?da=dark` et `/?da=light` dans deux iframes pour comparer les deux directions ; `frame-ancestors 'none'` et `X-Frame-Options: DENY` les refusaient (`ERR_BLOCKED_BY_RESPONSE`). Les deux en-têtes passent à `'self'` / `SAMEORIGIN` : le site peut se cadrer lui-même, personne d'autre ne peut. Fait sur les deux hôtes (`_headers` et `vercel.json`).
- **Le titre débordait de 8 px à 1280.** `.hero-title` se dimensionne en `5.6vw` (fenêtre entière) mais la colonne de texte était plafonnée à `max-w-[640px]` : « FONCTIONNER » demandait 648 px et était rogné. Élargi à `44rem` (704 px), vérifié de 768 à 1920 : zéro débordement, taille de police inchangée. Ce défaut était masqué par les polices de secours, plus étroites — le rendu correct des vraies polices l'a révélé.
- **Vérifié en direct sur les trois URL** (alias Vercel, URL de déploiement, Pages) : Archivo/Instrument chargées depuis notre origine, 2 iframes présentes, 0 requête refusée, 0 erreur JS, 0 débordement.
- **Leçon** : `curl` prouve qu'un serveur répond, pas qu'une page fonctionne. Pour « le site est bloqué », instrumenter `requestfailed` + `pageerror` + `document.fonts` dans un vrai navigateur, sur chaque URL citée.

## 2026-11-24 (TechText sur la landing + la page téléchargement ; CSS global sauvé d'une corruption)

- **TechText intégré** (`apps/web/src/components/brand/TechText.tsx` + `.css`, d'après React Bits, adapté : export nommé, props typées `TechTextProps`, `Settings = Omit<Required<…>>`, garde `prefers-reduced-motion` qui coupe intro et balayage). Le mot-marque est rendu en canvas : sous le pointeur la lettre active passe en contour vectoriel pointillé, cadrée par une sélection qui glisse, avec étiquettes de métrique ; les lettres se tirent hors de leur ligne et reviennent au ressort ; clic = impulsion. `intro="metrics"` trace d'abord baseline/x-height/cap height — le produit inspecte du logiciel, la marque qui s'inspecte elle-même est la blague.
- **Deux emplacements** : la landing (dans `AsciiHeroCopy`, entre le h1 et la lede, `.ascii-tech`, `aria-hidden` car le h1 dit déjà le nom) et la page `/download` (nouveau slot `tech` sur `SectionHeading` dans `BrandLayout.tsx`, qui casse la colonne de 62 ch). Vérifié en navigateur : survol → contour + cadre + repères ; glisser une lettre → étiquette `+26, +34` ; relâchée → retour au ressort. Mobile 390 px et `reduced-motion` testés.
- **La feuille globale était corrompue (11120 lignes, 1015 accolades non fermées)** : un balayage ligne/parenthèse a montré que la corruption = 1026 lignes dupliquées adjacentes + des sélecteurs multi-lignes coupés (région LIGHT DA). Reconstruction vérifiée : base = `HEAD:global.css` (profondeur 0), puis 92 blocs équilibrés extraits un à un de la copie de travail (les familles `ascii-*`, `peint-*`, `tp-*`, `ef-*`, `tech` — la refonte) et recollés sous la bannière « Récuperation du 24/11 ». Contrôles après : profondeur 0, `vite build` ✔, 769 tests verts, tous les noms de classes utilisés par le TSX présents (459 vérifiés, 3 faux positifs = crochets de style sans règle dédiée).
- **Leçon** : `tsc` ne voit pas le CSS ; la première preuve d'une feuille cassée a été l'échec `vite build` (`CssSyntaxError: Missing opening (`). Avant de builder après une session d'un autre agent : scan rapide accolades/parenthèses hors chaînes et commentaires.

## 2026-11-24 (bouton d'installation en switch sur /app/cli)

- **InstallSwitch** (`apps/web/src/components/app/InstallSwitch.tsx` + `.css`, d'après Uiverse.io — nazar-gavrylyk, evil-dragon-24, MIT, crédit conservé en tête). Un clic joue l'installation : pulsation du cercle, remplissage 3 s (le vrai téléchargement part en même temps via `onInstall`), puis la pilule se resserre, passe au vert et lit « Installée » — et devient un lien vers `/download` au lieu d'un bouton qui rejoue l'animation.
- **Adaptation au dépôt** : classes préfixées `insw-` (les originales `.label/.title/.circle` rentreraient en collision partout), couleurs lues dans les tokens (`--primary`, `--success`) au lieu du periwinkle du source. `prefers-reduced-motion` saute le théâtre : un clic amène directement l'état final. État annoncé en `aria-live` ; un téléchargement raté nomme le repli (commande ci-dessous) au lieu d'une pilule muette.
- **Sur `/app/cli`**, au-dessus des trois étapes, avec la phrase « Télécharge l'installateur autonome du CLI depuis ce site — sans Node ». La commande `npm i -g proofcore` reste en dessous, et le texte de dépannage ne renvoie plus vers `pnpm cli:install` depuis un checkout que le visiteur n'a pas.
- Vérifié en local et en production (`/app/cli`, compte jetable) : pilule présente, clic → pulsation, état final « Installée » en lien, zéro erreur console. 769 tests verts, tsc/biome propres.

## 2026-11-24 (le switch d'installation déplacé sur /download — bonne page, bon élément)

- **Placement corrigé** : le switch Uiverse était sur `/app/cli`, où rien ne se télécharge. Il est maintenant **l'action principale de chaque carte desktop de `/download`** : clic → pulsation, remplissage, « Installée » en vert, puis la pilule devient un lien vers la documentation. Les lignes CLI et binaire gardent leurs liens `<a download>` simples, pour qui veut le fichier sans le scénario. `/app/cli` retrouve ses étapes npm.
- **Composant élargi** : `className` en pass-through (l'hôte sombre thème via `--insw-ink`/`--insw-surface` au lieu d'un fork) et `errorHint` (le message d'échec vient de la page, dans sa langue). **Défaut corrigé en vérifiant le DOM, pas l'œil** : l'état final était rendu avec `insw-ink` presque noir sur fond noir — l'état `is-done` rendait le lien SANS la classe de l'hôte ; les classes passent maintenant sur les deux branches du rendu.
- Vérifié en local et en production sur les deux hôtes : 3 switches, le premier téléchargé (`proofcore-0.6.3-setup-win-x64.exe` part réellement), état final lisible, zéro erreur console. 769 tests verts.
- Leçon : la couleur « pâle » que l'œil jugeait être un bug d'opacité était un bug de classe — `getComputedStyle` sur l'élément rendu a tranché en une lecture (`border: rgb(10,10,11)` sur fond sombre = mauvaise branche du rendu).

## 2026-11-25 (le dossier de projets flotte sur la vue d'ensemble — FolderFloat, React Bits)

- **FolderFloat** (React Bits, matter-js) adapté en TS nommé dans `apps/web/src/components/app/FolderFloat.tsx` + `.css` : sur `/app` (vue d'ensemble), dans la colonne du tampon, sous les faits. Ouverture **au clic** (pas au survol — la vue d'ensemble est une surface de lecture) ; chaque projet du workspace sort en pilule, physique zéro-gravité après la pose (drift 0.4), clic sur une pilule → page du projet. Couleurs passées par props en tokens app (`--ink`, `--paper`, `--surface`) — pas de fork du CSS. Reduced-motion : pilules sans monde physique.
- **Leçons de lint** : Biome refuse le motif eslint-disable du source — positions lues via `posRef` (callbacks stables), clé React sans index (`value::label`), `noStaticElementInteractions` assumé par biome-ignore (les enfants portent la sémantique). `noUncheckedIndexedAccess` a exigé des gardes sur `sizes[i]`/`pos[i]`.
- **`overflow-x: clip` sur `.app-overview`** : le nuage de pilules (±188 px) ne doit jamais créer de scroll horizontal sur mobile (390 px vérifié = 390).
- **La config Biome d'un autre fil bloquait tout lint** (clé `include` au lieu de `includes` dans un override) — corrigé d'un mot.
- Vérifié : local (clic → pilule → drag physique → navigation `prj_…`, zéro erreur) et production sur Vercel + Pages (inscription jetable + projet créé via API, ouverture, physique active, navigation, zéro erreur). 769 tests verts, tsc/biome propres.
- Le tree commit de l'autre agent (`a8a6780`) a embarqué ce travail + son intelligence projet ; suivi `2bdf63e` (imports).

## 2026-11-25 (les KPI et les cinq questions deviennent des piles — Stack, React Bits)

- **CardStack** (React Bits « Stack », `motion` v14) adapté en TS nommé dans `apps/web/src/components/app/CardStack.tsx` + `.css` : classes préfixées `card-stack-` (le `.stack` du source est trop générique), `ariaLabel` en prop (le source code l'anglais en dur), timers `ReturnType<typeof setTimeout>`, garde `noUncheckedIndexedAccess`. Biome a exigé des suppressions documentées (tabIndex sur div d'une pile, clé positionnelle — l'index EST l'identité de la carte) et a fait corriger deux `forEach` qui retournaient une valeur.
- **Vue d'ensemble** : les quatre faits du workspace sont un deck (layout `deck`, spread 0.35 — les quatre restent visibles en recul, tirer/cliquer fait tourner) ; les cinq questions (WORLD. FLOW. EXIT. FAIL. CLEAN.) sont un éventail de cinq cartes (`fan`, visible 5) — un geste envoie la carte du dessus derrière, un clic simple ouvre toujours le module : le lien survit au drag.
- La grille `.app-object-grid` reste utilisée par `ModulesIndex` — pas de nettoyage CSS.
- Leçon de suppression biome : le commentaire `// biome-ignore` doit être la ligne **immédiatement** au-dessus de la ligne où l'ancre le diagnostic (attribut JSX pour `tabIndex`/`key`, ligne d'élément pour `noStaticElementInteractions`). Un ignore au-dessus de l'élément ne couvre pas les diagnostics ancrés sur un attribut.
- Vérifié : local (deck KPI cyclé au drag, éventail WORLD → FLOW au flick, clic → `/app/modules/flow`, reduced-motion : placement direct et navigation au clic, mobile 390 px sans scroll) et production sur les deux hôtes (2 piles, éventail cyclé, zéro erreur console). 769 tests verts, tsc/biome propres. `b049a6e`.

## 2026-11-25 (la pile dépliée montre les cinq noms — hauteur naturelle des cartes)

- **Le pied des cartes dépliées était coupé** : le glyphe de chaque module est plus grand que celui de WORLD, le contenu des cartes fait ~636 px, et la pile à 430 px coupait le nom derrière `overflow: hidden` — seul WORLD gardait son nom. Correction : `.app-module-stack { height: 640px }` (la hauteur naturelle de la carte, comme la grille d'origine) ; la rangée déployée réduit les cartes (échelle calculée sur la place de la section) donc rien ne déborde visuellement. Mesuré au DOM (`clientHeight/scrollHeight`, position du pied), pas à l'œil.
- Mode dépliant du Stack (`expandable`) : clic sur la pile → les cinq cartes se déploient en rangée sur la largeur de la section, chacune cliquable (navigation vérifiée `/app/modules/exit`) ; repli par carte du dessus, clic dehors ou Échap (écouteurs sur `document` — le focus reste sur un lien interne). **Le clic qui suit le pointerup du même geste est avalé** (tampon temporel de 200 ms) : sinon le lien navigue à l'ouverture et l'intercepteur referme ce qui vient de se déplier.
- Biome : le commentaire `biome-ignore` d'un hook doit être **au-dessus de la ligne `useEffect`** (l'ancre du diagnostic), pas au-dessus du tableau de dépendances ; un callback nommé `escape` déclenche `noShadowRestrictedNames`.
- Le tree commit de l'autre agent (`8f5e61c`) a de nouveau embarqué le changement CSS de cette passe.
- Vérifié en local (déploiement, navigation, trois replis, reduced-motion, mobile 390 px sans scroll) et en production sur Vercel + Pages (inscription/connexion jetable : déploiement ok, 0 carte cachée, les cinq noms visibles, navigation ok, zéro erreur console). 818 tests verts.

## 2026-11-26 (mission de reconstruction — phase 0 faite, phase 1.1 rouge→vert)

- **Phase 0 exécutée** : cartographie réelle inscrite dans `docs/PROOFCORE_{DEEP_AUDIT,CAPABILITY_MATRIX,ARCHITECTURE_MAP,RISK_REGISTER}` (sections du 26 nov. — 43 routes web, ~106 endpoints API/15 fichiers, 32 tables, 59 contrôles, 19 outils IA, walk navigateur de 8 pages publiques + 14 pages app avec compte jetable). Anomalies de walk : `/legal` `/app/account` `/app/local-agent` = 404 sans lien vers elles (R15), `/app/terminal` 404 API, `/app/admin` 503 (ADMIN_EMAILS vide).
- **Deux sous-agents Claude Sonnet 5.5 lancés en parallèle ont échoué** (« repeated API errors » côté fournisseur) — reprise intégrale dans le fil principal.
- **CI master rouge→vert** : cause réelle du smoke CLI trouvée en reproduisant au commit exact dans un clone propre — le correctif `asksHelp` (`packages/cli/src/index.ts`) et ses 2 tests existaient **seulement dans l'arbre de travail, jamais commités**. Commit `54fdbbe` (les 2 fichiers exacts), formatage biome des tables markdown des 4 docs (`dd7f3e4`) → **run 45761985280 : SUCCESS** (4m45s, e2e incluse). Première CI verte après les runs 45755203107/45756582954.
- Leçon de diagnostic : quand un échec CI ne se reproduit pas localement, vérifier **ce que contient le HEAD commité** vs l'arbre de travail (`git diff HEAD --stat`) — un correctif non commité est invisible pour la CI.
- Reste phase 1 : npm 0.6.0→0.6.3 (secret `NPM_TOKEN`, action propriétaire), incohérences docs « WORLD/FLOW/EXIT » localisées (R17), publication CLI sans build core isolé.
- **Mission longue : phases 2-9 (Analysis canonique, registre de capacités, Findings engine, Simple/Studio, orchestrateur IA, remédiation, UI, sécurité) — à planifier par lots de sessions.**

## 2026-11-26 (suite) — FAIL et CLEAN deviennent des modules, contrats inchangés

- **Déplacement** : `packages/modules/fail` (`src/checks.ts`, `failFindings`) et `packages/modules/clean` (`cleanFindings`) portent le code et les tests des deux familles HTTP. Aucun des deux ne dépend de `@proofcore/core` : `core` dépend d'eux, donc le build topologique reste acyclique (niveau 1 modules, niveau 2 core).
- **Contrat préservé** : `scanPage` / `auditSite` / `@proofcore/core` exportent exactement les mêmes symboles ; identifiants de constats et ordre identiques (`http_status` toujours ajouté en tête par `scanPage`). Les lectures partagées avec WORLD (langue déclarée, champs de formulaire) restent dans `analyse()`.
- **Preuves** : 16 nouveaux tests modules (9 FAIL, 7 CLEAN), 21 tests `page-scan` verts, suite complète 92 fichiers / 974 tests, `pnpm typecheck` et `pnpm build` verts, `biome check` 0 erreur.
- **Reste** : `site-audit.ts` (crawl + score) reste dans `core` ; le registre des contrôles (`controls.ts`) reste partagé par les cinq modules, par conception.

## 2026-11-26 (suite) — rotation du jeton courant au changement de mot de passe

- **Trou fermé** : `POST /api/account/password` révoquait les autres sessions mais laissait vivre le jeton qui avait fait la demande. Un cookie volé survivait donc à l'action censée l'expulser.
- **Correctif** : `AppStore.rotateSession` remplace `token_hash` et `expires_at` de la session courante ; la route émet un nouveau cookie `ps_sess_…` et renvoie `rotatedSession: true`. La session garde son identifiant, son `created_at` et son contexte (user-agent, IP).
- **Preuves** : le test de changement de mot de passe vérifie que l'ancien cookie ne rend plus de session et que le nouveau en rend une ; un test séparé prouve que deux connexions émettent deux jetons distincts et restent valides en parallèle. `apps/api/test/account-selfservice.test.ts` : 7/7, `pnpm typecheck` vert.

## 2026-11-26 (suite) — TTL glissant, deux outils IA, parcours navigateur

- **TTL glissant plafonné** : une session utilisée gagne 7 jours, sans jamais dépasser 30 jours depuis sa création (`rolledSessionExpiry`). Le cookie porte le plafond absolu ; le serveur expire après 7 jours d'inactivité. Preuve : `apps/api/test/session-ttl.test.ts` (4 cas, dont le plafond à 29 jours).
- **Outils IA** : `finding_details` (lecture) renvoie le constat complet, le contrôle du registre et la remédiation liée ; `verify_remediation` (écriture) réutilise `verifyRemediationWithAnalysis`, extrait de la route, et refuse sans `confirm`. Preuve : boucle d'outils réelle dans `apps/api/test/ai.test.ts` avec upstream simulé ; catalogue classé (28 outils).
- **Navigateur** : `tests/e2e/session-rotation.spec.ts` change le mot de passe depuis `/app/settings`, vérifie que le cookie `ps_session` change, puis recharge et reste authentifié.
- **Suite** : 93 fichiers, 980 tests, lint 0 erreur (5 avertissements), typecheck et build verts.

## 2026-11-27 — trois outils IA de conseil, de pré-vol et de patch

- **`suggest_analysis_profile`** (lecture) : classe les six profils du registre à partir de l'objectif formulé (mots des profils puis des capacités), renvoie les termes réellement corrélés et `recommendation: null` quand rien ne correspond ; un `targetType` sans profil (API) renvoie aussi `null`. Aucun profil inventé.
- **`validate_configuration`** (lecture) : extrait `validateModuleSettings` de `module_configure` ; même schéma Zod, même fusion avec la configuration active, mêmes blocages `validateConfig`, sans écriture. `FAIL`/`CLEAN` répondent qu'ils n'ont pas de réglages persistés.
- **`prepare_code_patch`** (lecture) : localise les fichiers importés par les termes du constat (contrôle, méthode mesurée, valeur observée/attendue) avec extraits et numéros de ligne ; avec `path`/`before`/`after` il exige un `before` exact sur des lignes entières et rend un diff unifié. Bloc absent ou ambigu refusé, jamais deviné ; `saved` et `applied` toujours `false`.
- **Preuves** : `analysis-profile-suggest.test.ts` (8), `validate-configuration.test.ts` (4), `code-patch.test.ts` (5), boucles d'outils dans `ai.test.ts` (dont locate + diff sur un constat HSTS), catalogue classé à 31 outils ; 41 tests ciblés verts, `pnpm typecheck` et `biome check` verts.
- **Limites** : classement lexical (pas sémantique) ; aucun fournisseur réel appelé ; `prepare_code_patch` ne lit que les sources importées et ne prouve pas le correctif — seule une analyse postérieure le fait.

## 2026-11-27 (suite) — une seule attente de la bannière cookies dans les E2E

- **Helper unique** : `tests/e2e/consent.ts` expose `dismissConsent(page)` — attente visible jusqu'à 20 s (la carte monte avec la coquille lazy), clic sur « Autoriser », puis attente du détachement (fondu de 240 ms). No-op si le consentement est déjà stocké.
- **Six specs branchées** : journey, a11y, viewports, route-compat, app-mobile, session-rotation. Les sondages `waitFor(..., 3_000)` qui laissaient la carte ouverte et interceptaient les clics sont supprimés.
- **Preuves** : journey + a11y + viewports = 36 verts, 2 ignorés (desktop-only) ; app-mobile + session-rotation = 4 verts, 2 ignorés (desktop) ; `biome check` 0 erreur.

## 2026-11-27 (suite) — pré-vol de configuration avant chaque sauvegarde

- **Endpoint** : `POST /projects/:projectId/config/validate` (lecture) — même `projectConfigInputSchema`, même `buildProjectConfig`, mêmes blocages `validateConfig` que le PUT ; répond 200 avec `valid:false` et `blocking` sans rien écrire. Le formulaire ne peut pas appeler l'outil de chat `validate_configuration` directement (il exige un fournisseur IA et consommerait le quota) : il appelle ce pré-vol, qui applique les mêmes règles.
- **Formulaire** : `ProjectConfig.tsx` appelle le pré-vol avant chaque PUT. Si bloqué, il conserve les valeurs saisies, affiche les points bloquants et le titre « À corriger avant d'enregistrer », et n'écrit rien. Si valide, il enregistre comme avant.
- **Preuves** : `apps/api/test/project-config.test.ts` 8/8 (pré-vol accepté, blocage `live_charge`, 400 sur payload invalide, `moduleConfig` toujours null) ; `tests/e2e/project-config.spec.ts` 2/2 (desktop + mobile) : cible EXIT production non acquittée → « Nothing was saved », source `defaults` ; puis synthetic → « saved », source `saved` ; `pnpm typecheck` et `biome check` verts.

## 2026-11-27 (suite) — outil `generate_remediation`

- **Outil** (lecture, 32e du catalogue) : `apps/api/src/remediation-plan.ts` assemble un plan complet depuis le constat et le registre — titre, gravité, priorité, cause, correctif et vérification documentés, les dix étapes de la chaîne (les trois premières déjà prouvées, `prepare_fix` suivante), exemples prêts à l'emploi, risques et complexité, extraits de code classés par `prepare_code_patch`, et la remédiation existante le cas échéant.
- **Honnêteté** : refuse un constat `PASSED`/`SKIPPED`/non défectueux (`finding_not_actionable`) ; `complete:false` + `missing` quand le registre, le correctif, la vérification ou la preuve manquent ; sans `NEON_DATABASE_URL`, le plan reste complet mais `code.note` explique l'absence d'extraits ; `writes:false`, aucune remédiation ouverte ni vérifiée.
- **Preuves** : `apps/api/test/remediation-plan.test.ts` 6/6 (plan complet HSTS, refus PASSED, sans source store, remédiation existante, constat inconnu, boucle `/ai/chat` réelle avec upstream simulé) ; `ai-tools.test.ts` 6/6 (catalogue 32, classification `read`) ; `pnpm typecheck` et `biome check` verts.

## 2026-11-27 (suite) — vérifier un patch en lançant l'analyse postérieure depuis le diff

- **Route** : `POST /api/v1/analyses/:analysisId/verify-patch` (`apps/api/src/routes/analyses.ts`) — relit la cible du constat (`services.scan`, mêmes gardes SSRF que `/audits`), enregistre une **analyse canonique** avec sa page audit, ouvre la remédiation si elle n'existe pas, puis appelle `verifyRemediationWithAnalysis`. Le verdict vient de la seconde mesure, jamais du bouton. Limites honnêtes : seules les analyses `PAGE` des modules `fail`/`clean`/`world`/`exit` sont re-mesurables ; un constat `PASSED` est refusé (`nothing_to_verify`), un scan injoignable renvoie 502 sans analyse ni remédiation fantôme, et un résultat non concluant revient en `verified:false`.
- **UI** : `FindingPatch.tsx` affiche « Vérifier par une nouvelle analyse » après le diff, avec une confirmation explicite (« relit la cible et consomme une analyse »). Le diff reste affiché après la vérification ; `FindingRemediation.tsx` remonte la remédiation mise à jour sans perdre l'état du panneau.
- **Preuves** : `apps/api/test/verify-patch.test.ts` 6/6 (vérifié, toujours en échec, remédiation réutilisée, constat conforme refusé, module non re-mesurable, scan hors ligne) ; E2E `finding-patch` 2/2 (desktop/mobile) avec route mockée : confirmation, « Verified by analysis », diff toujours visible, remédiation `rem_e2e` affichée ; `pnpm typecheck` et `biome check` verts.

## 2026-11-27 (suite) — vérifier un patch SITE et FLOW, puis appliquer avant de vérifier

- **SITE** : la route `verify-patch` rejoue `services.siteAudit` sur la cible avec un crawl borné (10 pages, profondeur 2), enregistre l'analyse `SITE` avec son page audit et son `coverage.pages`, puis compare le constat par sa clé sans URL (`module:controlId`). Un crawler injoignable renvoie 502 sans analyse ni remédiation fantôme.
- **FLOW** : la route rejoue `services.runFlow` (par défaut `runModule(..., "flow")`), enregistre `targetType: "WORKFLOW"` avec `runId`/`reportId`, et synthétise les cas dans `result` — l'identité du constat est l'id du cas (et son code d'échec), sans URL de page. `runId: null` renvoie 409 `flow_not_runnable` ; un cas encore `FAILED` donne `still_failing`, un cas `PASSED` donne `verified`.
- **Application** : `POST /verify-patch` accepte `applied: true`. La route ne modifie aucun fichier : elle enregistre l'application confirmée par la personne (chaîne avancée jusqu'à l'étape `apply`, `status: "applied"`, `appliedAt`, preuve « Diff confirmed applied by the user »), puis enchaîne la seconde mesure. Un changement concurrent de la remédiation renvoie 409.
- **UI** : après le diff, le bouton « Appliquer le patch » ouvre une confirmation qui dit que PROOFCORE ne peut pas écrire sur le site ; la case « J'ai appliqué ce diff sur la cible » débloque « Confirmer et vérifier », qui envoie `applied: true` et lance l'analyse. Le diff et le verdict restent affichés.
- **Preuves** : `verify-patch.test.ts` 13/13 (PAGE, SITE vérifié, SITE hors ligne 502, FLOW vérifié avec `runId`, FLOW encore en échec, FLOW sans run 409, FLOW en panne 502, API refusée, application confirmée) ; E2E `finding-patch` 2/2 (desktop/mobile) avec corps `applied:true` relu ; non-régression `analyses` + `remediations` + patch + plan = 35/35 ; `pnpm typecheck` et `biome check` verts.
- **Limites** : SITE et FLOW sont prouvés par des services injectés (pas de crawl ni de navigateur réel dans ces tests) ; l'application reste manuelle et n'est jamais prouvée par le bouton — seule la seconde mesure la valide.

## 2026-11-27 (suite) — le copilote agit dans un vrai navigateur et affiche ses jetons

- **Sessions navigateur** : `browser_open`, `browser_read`, `browser_act` et `browser_close` sont des outils réels. En Worker, Cloudflare Browser Rendering ouvre la session et D1 enregistre le propriétaire ; en Node, `createLocalBrowserAgent` pilote le Chromium de la machine via l'adaptateur. Les deux rendent le même `AgentView` (URL, titre, texte, éléments avec sélecteurs stables, capture). `browser_act` est classé `write`, `browser_open` `analysis`, les deux autres `read`.
- **Jetons** : `callUpstream` additionne l'`usage` réel de chaque appel (réponse, lentilles, synthèse, curateur). `/chat` renvoie entrée/sortie/total, `context {used,budget,remaining,trimmed}` et `outputBudget`, et persiste `usage` sur le message. Budgets de contexte : quick 16 k, balanced 32 k, deep 64 k, ultra 96 k.
- **Interface** : `TokenMeter` (jauge `role="progressbar"`, « reste N » visible et `aria-valuetext` « N restants ») + coût par message ; catalogue chargé depuis `/api/v1/ai/tools` (36 outils) avec badge de permission ; à ≤560 px le burn de l'effort est masqué pour que le bouton d'envoi ne chevauche plus les pièces jointes.
- **Preuves** : `local-browser-agent.test.ts` (1, vrai Chromium), `ai.test.ts` + `ai-tools.test.ts` (39), Playwright mobile assistant 320×700 (1), `tsc` API/Web et build Web verts.

## 2026-11-27 (suite) — finitions de la même passe

- **Sécurité** : une session navigateur est liée à `userId` ; un identifiant d'un autre compte est refusé (`browser_session_not_found`). Les URL passent par `assertPublicUrl`, les sélecteurs sont bornés, les touches filtrées.
- **Limite** : le chemin Cloudflare n'a pas été lancé localement (pas de binding) ; il est couvert par typage mais reste NON VÉRIFIÉ en production.

## 2026-11-27 (suite) — jeton CSRF double-submit et limites durables

- **CSRF** : `ps_csrf` est un cookie lisible (SameSite=Lax, 30 jours) ; toute écriture sous `/api/auth/sign-out`, `/api/account` et `/api/account/*` exige `x-csrf-token` identique quand les deux cookies sont présents. Une session héritée sans jeton reste acceptée, et `/api/auth/session` émet le jeton manquant — pas de déconnexion forcée. Le contrôle d'origine reste la première barrière ; le jeton est la seconde. Les routes de scan et d'IA restent protégées par l'origine seule (migration séparée, fichier IA en cours de réécriture).
- **Client** : `csrfToken()` lit `document.cookie` et `apiFetch` ajoute l'en-tête sur toute méthode non GET/HEAD ; la déconnexion et les révocations de session passent par lui.
- **Limites durables** : l'inscription et le formulaire de support quittent la `Map` par isolate pour `hitRateLimit` (`signup:address`, `support:address`) ; la connexion et le mot de passe oublié avaient déjà leurs compteurs en base. R2 est clos : chaque limite auth-adjacente a un point de décision durable.
- **Preuves** : `apps/api/test/csrf.test.ts` 6/6, `tests/e2e/csrf.spec.ts` 2/2, `signup-rate-limit.test.ts` 3/3, `support-rate-limit.test.ts` 1/1 ; suite complète 1057/1057, E2E complet 49 verts + 5 ignorés, `pnpm typecheck` vert.
- **Limites** : la couverture CSRF s'arrête aux routes compte/déconnexion ; le chemin navigateur de production (R13) et la publication npm (R16) restent hors de portée locale.

## 2026-11-28 — profondeur des modules FAIL, CLEAN, EXIT, FLOW et WORLD

- **FAIL** : HSTS est jugé sur son `max-age` (0 = désactivé, < 6 mois = avertissement) ; la CSP est lue directive par directive (`unsafe-inline`, `unsafe-eval`, `*`, `http:`, `data:` signalés, absence de `default-src`/`script-src` = échec) ; les cookies sont lus un par un avec `SameSite=None` sans `Secure` ; `Referrer-Policy` distingue `unsafe-url` (échec) des valeurs faibles (avertissement) ; `X-Frame-Options` invalide et `frame-ancestors *` ne passent plus. Trois contrôles ajoutés : `coop`, `password_form_action`, `sri`.
- **CLEAN** : `lang` doit être une étiquette BCP 47, le titre trop court/a long est un avertissement, le viewport qui bloque le zoom aussi ; cinq contrôles ajoutés : `doctype`, `heading_order`, `duplicate_ids`, `link_text`, `iframe_title`. `link_text` honore `aria-labelledby` et ignore les liens masqués ; `iframe_title` ignore les cadres `hidden`/`aria-hidden`. Les contrôles d'interface restent `SKIPPED` sur une coquille client-rendue, donc `not_measured` reste honnête.
- **EXIT** : le nom de fichier doit garder son extension et ne pas contenir de séparateur de chemin ; le manifeste ZIP est recoupé sur les doublons, les chemins `..`, les fichiers non déclarés et les tailles/digests déclarés.
- **FLOW** : `refund_flow` vérifie que le remboursement ne réécrit pas le montant capturé et que le statut reste stable à la relecture (codes `refund_amount_changed`, `refund_state_unstable`).
- **WORLD** : 7e catégorie `email` — 4 adresses valides qu'un motif ASCII refuse (point, +tag, apostrophe, TLD long), 2 cas souples (SMTPUTF8, local part entre guillemets) et 13 invalides (double @, point initial/double, label vide ou commençant par un tiret, dépassements 64/63/254 octets, injection d'en-tête, NUL, bidi).
- **Preuves** : `fail` 15/15, `clean` 14/14, `exit` 28/28, `flow` 20/20, `world` 17/17, `controls` 7/7, `page-scan` 21/21 ; suite complète 1081/1081 et `pnpm typecheck` vert le 2026-11-28.
- **Limites** : la couverture FAIL/CLEAN reste passive (ni injection ni exploitation) ; les cas email SMTPUTF8 et local part entre guillemets sont souples, leur refus est un avertissement documenté.

## 2026-11-28 (suite) — paquet `@proofcore/sdk` et alias vitest mort retiré

- **Paquet** : `packages/sdk` (`@proofcore/sdk`, privé, non publié) parle uniquement l'API machine réelle — `GET /v1/project` et `POST /v1/runs` avec `Authorization: Bearer psk_…`. Le reste (workspaces, projets, rapports, analyses, assistant) est session + CSRF : hors SDK plutôt que réimplémenté avec la mauvaise authentification.
- **Honnêteté** : les réponses sont validées par des schémas qui reproduisent la route (`invalid_response` si la forme change, jamais un cast) ; le jeton vient de `tokenEnvVar`, lu à chaque appel (rotation sans nouveau client) ; un jeton littéral est vérifié à la construction ; `Idempotency-Key` dérivé `sync:<run.id>` ou fourni ; aucun retry automatique et `retryAfterSeconds` exposé sur `429` ; un cookie de session est refusé comme credential.
- **Alias** : l'entrée `@proofcore/sdk` de `vitest.config.ts` pointait vers un fichier inexistant ; elle est retirée, les tests importent la source directement.
- **Preuves** : `packages/sdk/test/sdk.test.ts` 8/8 contre les routes réelles via le harness (identité, upload idempotent, en-tête transmis, 403 `scope_missing`, 401 `invalid_api_key`, rotation de variable, refus du cookie, refus d'un corps 2xx inconnu) ; `pnpm --filter @proofcore/sdk typecheck` et `pnpm typecheck` verts ; `biome check` vert.
- **Docs** : table du README ; `docs/PRODUCT_CAPABILITY_MATRIX.md` remplace « SDK public absent » par deux lignes exactes (publication npm absente ; serveur MCP hébergé absent, `proofcore mcp` local) ; `AGENTS.md` et `Docs/guides/AI_INTEGRATION.md` nomment `proofcore mcp` comme serveur MCP local officiel (MCP 2025-06-18, stdio, tools/resources/prompts, aucun endpoint hébergé). `AGENTS.md` était déjà aligné sur disque : le bloc d'instructions du début de session était périmé.

## 2026-11-28 (suite) — parcours assistant IA réel : bloqué à la frontière du fournisseur

- **Tentative réelle** : serveur Node local (`DATA_PATH=:memory: PORT=8799`), inscription réelle, puis `GET /api/v1/ai/profile` → `{"configured":false,"reason":"key_storage_unavailable"}` ; `PUT /api/v1/ai/profile` → **HTTP 503** `key_storage_unavailable` (refuse d'écrire une clé sans `AI_KEYS_SECRET`) ; `POST /api/v1/ai/chat` → **HTTP 400** `ai_not_configured` avec `managed:false, personal:false, deterministic:true`.
- **Cause** : aucun credential de modèle dans l'environnement — `AI_KEYS_SECRET`, `MANAGED_AI_API_KEY`, `MANAGED_AI_PROVIDER/MODEL`, `OPENAI_API_KEY`, `ANTHROPIC_API_KEY` et `NEON_DATABASE_URL` sont absents ; `.env.local` ne contient que `VERCEL_OIDC_TOKEN`. Le parcours n'a donc pas atteint de modèle : **NON VÉRIFIÉ de bout en bout**, et aucun tour n'a été simulé pour laisser croire le contraire.
- **Mesures réelles au passage** : `GET /api/v1/ai/tools` → 37 outils, `maxAnalysisCallsPerTurn: 3` — la limite est réelle, « sans limites » est faux.
- **Preuves existantes** : l'assistant reste prouvé avec un upstream simulé (48/48 sur `ai`, `ai-tools`, `local-browser-agent`, `module-copilot`) ; le refus honnête est maintenant prouvé sur un vrai serveur HTTP.
- **Déblocage** : fournir `MANAGED_AI_API_KEY` (+ provider/modèle) ou `AI_KEYS_SECRET` + une clé fournisseur, puis rejouer le même parcours et consigner la réponse du modèle, ses jetons et l'outil réellement appelé.

## 2026-11-28 (suite) — `proofcore mcp` vérifié par un vrai client MCP

- **Client** : `connectMcp` de `packages/adapters/ai/src/mcp.ts` (le client du produit), transport stdio, `node packages/cli/dist/index.js mcp`, script jetable `.proofcore/mcp-smoke.ts` (dossier ignoré par git).
- **Ce que le serveur annonce réellement** : `serverInfo` `proofcore` 0.1.0, protocole **2025-06-18**, capacités tools/resources/prompts ; **50 outils**, dont **22** annotés `readOnlyHint: true` ; 3 resources (`proofcore://project/summary`, `report/latest`, `instructions`) ; 4 prompts (`audit_target`, `explain_findings`, `fix_finding`, `release_check`).
- **Appel réel** : `project_summary` → `isError:false`, configuration lue sur disque (modules world/flow/exit, `http://localhost:3000`, sortie `.proofcore/reports`, sync désactivée, aucun avertissement).
- **Limite** : un seul outil de lecture appelé ; `run_tests`, les outils navigateur et les outils d'écriture ne sont pas exercés ici (couverts par `packages/cli/test/mcp-server.test.ts` 12/12 et `mcp-resources.test.ts` 11/11).

## 2026-11-28 (suite) — la synchro du CLI consomme `@proofcore/sdk`

- **Refactor** : `uploadScanRun` (`scan-sync.ts`) et la commande `sync` (`index.ts`) n'ont plus de `fetch` ni de construction d'en-têtes : les deux passent par `createProofcoreClient(...).uploadRun(...)`, qui porte l'auth `Bearer psk_…`, l'`Idempotency-Key` dérivé du run et la validation de la réponse. `resolveSyncIdentity` passe par `getProject()`. Les erreurs sont formatées par `describeSyncError` (`HTTP <status> <category> <code>: message`).
- **Dépendance** : `@proofcore/sdk` ajouté aux dépendances du CLI ; l'alias vitest `@proofcore/sdk` est rétabli, cette fois vers un fichier qui existe et que du code importe réellement (l'entrée morte avait été supprimée, pas remplacée à l'identique).
- **Fixture corrigée, pas affaiblie** : les stubs `/v1/runs` de `cli.test.ts` ne renvoyaient que `{runId, recorded}`, une forme que la vraie route ne produit jamais (elle ajoute `reportId`, `retainedUntil`, `usage`), et `/v1/project` n'avait ni `plan` ni `usage`. Le SDK strict les a refusés ; les stubs ont été alignés sur la route réelle.
- **Piège attrapé** : le premier passage 59/59 utilisait un `dist` antérieur au refactor et ne prouvait donc rien ; après `pnpm typecheck` (qui réémet `dist`), le test ciblé a échoué et a révélé la fixture périmée. Preuve finale après correction : `cli.test.ts` + `sdk.test.ts` = **42/42**, dont « sync uploads real totals » et « audit --sync uploads the scan » exécutés contre un serveur HTTP local réel.
- **Limites** : aucun essai contre l'API hébergée ; le délai de 30 s du SDK s'applique désormais à la synchro (auparavant aucun timeout).

## 2026-11-28 (suite) — parcours assistant IA réel : un tour abouti chez Groq, boucle d'outils non prouvée

- **Ce qui a réellement tourné** : serveur Node local (`DATA_PATH=:memory: PORT=8799`) avec fournisseur géré Groq (`MANAGED_AI_PROVIDER=groq`), inscription réelle, puis `POST /api/v1/ai/chat` avec `effort: "quick"` → **HTTP 200**. Réponse du modèle : « Cet espace de travail s'appelle « Qwen E2E ». » (`ai.mode: "managed"`, `provider: "groq"`, `model: "qwen/qwen3.8-27b"`, `managedCallsRemaining: 299`).
- **Jetons réels mesurés par le produit** : `input 6703`, `output 16`, `total 6719` ; contexte `used 1282 / 16000`, `trimmed 0`.
- **Ce qui n'a PAS été prouvé** : `trace: []` — aucun outil appelé (la question n'en exigeait pas) ; `turns: 0` ; les deux lentilles `evidence` et `consequence` sont revenues `ok:false` avec une note vide, donc **la vérification multi-passes n'a pas tourné**. Un second tour demandant explicitement `workspace_overview` a été refusé par Groq : **HTTP 429** `provider_rate_limited`, ITPM 7000 avec 4900 déjà consommés — le prompt produit (~6,7 k jetons d'entrée pour 37 outils) ne laisse pas la place à un second appel dans la même minute.
- **Tentatives antérieures** : `openai/gpt-oss-120b` puis `openai/gpt-oss-20b` → 429 TPM 8000, compteur déjà à ~4 800 ; bascule sur `qwen/qwen3.8-27b` pour obtenir le tour réussi. Quota gratuit Groq : 8 000 TPM sur gpt-oss, 7 000 ITPM sur qwen, 6 000 sur `allam-2-7b`.
- **Conclusion honnête** : le chemin réel jusqu'à la réponse du modèle est prouvé une fois ; **la boucle d'outils, les lentilles et la synthèse restent NON VÉRIFIÉES** avec cette clé gratuite. Aucun tour n'a été simulé.
- **Sécurité** : la clé n'a été utilisée qu'en variable d'environnement du processus, n'est écrite ni dans le dépôt ni dans ce journal ; elle reste dans l'historique de conversation et doit être révoquée.
- **Déblocage pour prouver la boucle** : une clé avec un quota plus large (ou un fournisseur géré payant), puis rejouer la même question avec un outil imposé et consigner `trace`, `turns` et `usage` du tour.

## 2026-11-28 (suite) — tour assistant avec outil imposé : NON exécuté, deux blocages mesurés

- **Objectif** : rejouer un tour réel avec `workspace_overview` imposé et consigner `trace`, `turns`, `usage`. **Aucune des deux voies disponibles ne le permet ; rien n'a été simulé.**
- **Voie 1 — clé Groq gratuite** : aucune clé à quota supérieur n'est présente (`MANAGED_AI_API_KEY`, `OPENAI_API_KEY`, `ANTHROPIC_API_KEY`, `GROQ_API_KEY`, `AI_KEYS_SECRET` tous absents). Un tour `quick` envoie **6 703 jetons d'entrée** (dont ~5,4 k de schémas d'outils) ; l'ITPM qwen est de 7 000. Le premier appel tient, mais le second — après le résultat de l'outil — dépasse nécessairement. Mesuré : second tour → `HTTP 429` ITPM 7 000, 4 900 déjà consommés.
- **Voie 2 — Ollama local** : fournisseur `ollama` présent dans le registre, `qwen2.5:0.5b` installé, petit prompt 36 jetons → **1,19 s**. Le même modèle sur **4 095 jetons de prompt** → **164,29 s** sur ce CPU (pas de GPU NVIDIA). Le tour produit a été coupé : `HTTP 502 ai_unreachable` à **25,04 s**, car `apps/api/src/routes/ai.ts:1891` fixe un deadline de 25 s non configurable. Un seul appel dépasse déjà 6× ce délai, et la boucle d'outils en exige deux.
- **Conséquence** : `trace`, `turns` et `usage` d'un tour avec outil restent **non obtenus**. La seule preuve réelle à ce jour reste le tour sans outil du 2026-11-28 (qwen via Groq, `input 6703`, `output 16`, `trace: []`).
- **Déblocage** : une clé à quota réellement supérieur (Groq tier dev, OpenAI, Anthropic) suffirait sans changer le produit ; sinon il faudrait soit rendre le deadline configurable, soit réduire les ~5,4 k jetons de schémas d'outils envoyés à chaque appel — deux changements produit, pas des preuves.

## 2026-11-28 (suite) — budget du prompt assistant mesuré : impossible de tenir 8 000 TPM en coupant la prose

- **Mesure réelle** (endpoint `/api/v1/ai/tools`, catalogue envoyé aux fournisseurs) : 37 outils, payload **21 965 caractères ≈ 5 491 jetons** — descriptions **2 252**, schémas de paramètres **2 346**, noms + enveloppe JSON **893**. Prompt système ≈ **1 270**. Entrée mesurée d'un tour `quick` : **6 703 jetons**.
- **Démonstration** : même avec zéro description il resterait ~3 239 jetons d'outils → ~4 500 par appel → ~9 000 pour deux appels, déjà au-dessus de 8 000. Un tour complet ajoute les deux lentilles (~1 000) et une synthèse qui réexpédie le prompt système (~1 600) : **~9 800 sans outil, ~16 400 avec outil**.
- **Décision** : ne pas dégrader le produit pour tenir dans le quota gratuit. Aucune description, aucun schéma, aucun outil n'a été retiré ; `apps/api/src/routes/ai.ts` est intact.
- **Conséquence** : le tour avec outil reste non prouvé tant qu'une clé à quota suffisant n'est pas fournie (viser ≥ ~20 000 jetons d'entrée par minute, ou un fournisseur sans plafond TPM serré). La clé Groq gratuite (7–8 k TPM) ne peut pas porter un tour complet.
- **Piste si le quota reste une contrainte** : sous-ensemble d'outils en mode `quick` (~10 outils, second appel sans schémas, ~6 850 jetons) ou routeur d'outils en deux étapes (~7 500). Les deux ont été chiffrés et refusés pour l'instant au nom de la qualité.

## 2026-11-28 (suite) — les lentilles non exécutées sont nommées, plus silencieuses

- **API** : la réponse `/api/v1/ai/chat` porte désormais `skippedSubagents` — les lentilles que le niveau d'effort n'achète pas (`quick` 2/5, `balanced` 3/5, `deep` 4/5, `ultra` 5/5), avec `id` et `label`. Les lentilles exécutées restent dans `subagents`, échecs compris.
- **Interface** : `ReviewPanel` affiche le décompte « · N non exécutées » dans le résumé (visible même replié), puis chaque lentille non lancée avec la mention explicite qu'elle n'a pas été vérifiée. Une lentille non exécutée a un style `is-skipped` distinct de `is-failed` : présente, mais visiblement pas une preuve.
- **Preuve** : `apps/api/test/ai.test.ts` 36/36, dont une assertion nouvelle qui fixe `skippedSubagents = ["coverage","reader"]` en `balanced` ; `pnpm typecheck` vert ; `biome check` vert.
- **Limite** : le rendu visuel n'a pas été regardé dans un navigateur — les tests couvrent le contrat de données et le typage, pas l'apparence du panneau.

## 2026-11-28 (suite) — deadline configurable et tour avec outil PROUVÉ sur Ollama local

- **Changement produit** : `AI_TURN_DEADLINE_MS` (défaut `25000`, borné 5 000–1 800 000 ms) alimente `services.config.aiTurnDeadlineMs`, utilisé pour le deadline du tour **et** pour le délai de chaque appel (`apps/api/src/routes/ai.ts`). Le message `ai_timeout` annonce la valeur configurée. Documenté dans `docs/deployment/ENVIRONMENT_VARIABLES.md` et `apps/api/.dev.vars.example`.
- **Second verrou levé, distinct du précédent** : même avec un deadline de 30 min, l'appel échouait en `HTTP 502 ai_unreachable` (« fetch failed ») à **300,9 s** — c'était le `headersTimeout` par défaut d'undici (300 s), Ollama n'envoyant ses en-têtes qu'une fois la génération terminée. `apps/api/src/node.ts` installe un `Agent` undici `{ headersTimeout: 0, bodyTimeout: 0 }` : le deadline produit est désormais la seule autorité de temps. `undici` ajouté aux dépendances de `@proofcore/api`.
- **Troisième cause trouvée** : Ollama servait `llama3.2:1b` avec **4 096 jetons de contexte** (`ollama ps`), alors que le prompt produit en fait ~6 700 → schémas d'outils tronqués, `usage.input` plafonné à **4 095**, aucun appel d'outil, puis 502. Modèle dérivé `llama32-16k` (`PARAMETER num_ctx 16384`) créé localement pour rejouer le tour.
- **Preuve réelle** : serveur Node (`DATA_PATH=:memory: PORT=8799`, `MANAGED_AI_PROVIDER=ollama`, `MANAGED_AI_MODEL=llama32-16k`, `AI_TURN_DEADLINE_MS=1800000`), inscription réelle, `POST /api/v1/ai/chat` `effort:"quick"` avec outil imposé → **HTTP 200 en 300,02 s**.
  - `trace: [{ tool: "workspace_overview", summary: "0 project(s), 0 run(s)" }]`
  - `turns: 1`
  - `usage: { input: 6717, output: 40, total: 6757, context: { used: 1301, budget: 16000, remaining: 14699, trimmed: 0 }, outputBudget: 500 }`
  - `message`: « The workspace_overview tool returns that the workspace contains 0 projects and has a recent findings count of 0. » — la réponse cite la donnée de l'outil, pas une supposition.
  - `skippedSubagents: [security, coverage, reader]` ; `subagents: [evidence ok:false, consequence ok:false]` — les lentilles n'ont pas tenu (12 s chacune) sur CPU ; elles sont affichées comme non vérifiées, jamais comme réussies.
- **Conclusion** : la boucle d'outils est **VÉRIFIÉE de bout en bout en local** (un appel d'outil réel, une réponse fondée dessus). Les lentilles et la synthèse restent **NON VÉRIFIÉES** sur CPU : leurs délais propres (12 s / 20 s) n'ont pas été rendus configurables, ce qui reste la prochaine limite mesurée.
- **Coût local** : `llama3.2:1b` (1,3 Go) + `llama32-16k` (2 Go) restent dans `~/.ollama`. Aucune clé n'a été utilisée ni écrite ; rien n'a été commité.

## 2026-11-28 (suite) — catalogue d'outils réduit sur le fil : un tour outil tient dans 8 000 TPM

- **Mesure avant** : 37 outils, catalogue **19 810 caractères** (descriptions 9 082, paramètres 8 745, noms 577 + enveloppe) ≈ **3 341 jetons réels** (tokenizer cl100k) quand il est compacté, ~4 593 en version complète. Trois appels du tour renvoyaient ce catalogue sans pouvoir s'en servir : les deux lentilles et le curateur de mémoire ; l'appel qui répond après l'outil le renvoyait aussi.
- **Changements dans `apps/api/src/routes/ai.ts`** :
  1. `wireParameters()` : sur le fil, un schéma d'argument ne garde que les **paramètres requis**, avec `type`, `enum` et `items`. Les paramètres optionnels (l'exécuteur les documente et les déduit) et la prose par paramètre ne partent plus. Catalogue : 19 810 → **14 801 caractères**, soit **1 252 jetons de moins par appel**. Toutes les descriptions d'outils et tous les noms restent intacts ; `/api/v1/ai/tools` continue de servir les schémas complets.
  2. En `quick` — dont la consigne dit déjà « au plus un outil » — l'appel qui répond après un résultat d'outil ne renvoie **plus de catalogue**.
  3. Lentilles, synthèse et curateur de mémoire passent `tools: false` : ils répondent en texte ou en JSON, jamais par un outil.
- **Mesure après, sur le fil réel** (proxy local devant Ollama enregistrant chaque corps, puis `gpt-tokenizer` cl100k) — tour `quick` complet avec outil imposé, `llama32-16k` :
  - appel 1 (catalogue) **4 585** · appel 2 (réponse) **1 353** · lentille 1 **225** · lentille 2 **221** · curateur **267**
  - **total 6 651 jetons < 8 000**, contre **≈ 26 300 reconstruits** avec l'ancien envoi (le catalogue complet sur les cinq appels).
  - La même exécution a bien appelé l'outil : `trace: [{ tool: "workspace_overview", summary: "0 project(s), 0 run(s)" }]`, `turns: 1`, `usage.input 5 860`, réponse fondée sur la donnée de l'outil.
- **Preuve outillée** : `apps/api/test/ai.test.ts` **38/38** — un test fixe que le schéma sur le fil garde `required` et l'`enum` en perdant les paramètres optionnels et leur prose, un autre fixe qu'en `quick` seul l'appel qui doit appeler un outil porte le catalogue. `biome` et `pnpm --filter @proofcore/api typecheck` verts.
- **Limites honnêtes** : cl100k n'est pas le tokenizer de Groq, donc les valeurs sont une mesure standard, pas le compteur exact du fournisseur ; l'appel 1 reste à 4 585 et ne peut pas descendre beaucoup plus sans couper des descriptions. Le gain est réel mais il vient surtout du retrait du catalogue là où il ne servait à rien.

## 2026-11-28 (suite) — vérification réelle, session de crawl, exports complets, Ollama retiré

- **Vérification avant correction** : `pnpm test` → **1 échec / 1 094 tests** (`packages/core/test/session.test.ts:137`) : un lien marketing `/auth` était pris pour un mur de connexion. Les trois revues indépendantes ont confirmé deux autres trous : le cookie fourni à l'UI ne suivait pas le crawl, et les exports sautaient des constats entiers.
- **Mur de connexion** : `LOGIN_PATH` dans `packages/core/src/page-scan.ts` ne compte plus `auth` comme un chemin de login. Un chemin `/auth` public avec une documentation, ou un lien marketing vers `/auth`, n'ouvre plus le popup. Test conservé et vert : 17/17.
- **Session et crawl** : `SiteAuditOptions.headers` (`packages/core/src/site-audit.ts`) propage l'en-tête `Cookie` au scan **et** au crawl ; `runScan` (`apps/api/src/routes/audits.ts`) transmet enfin `body.headers` à la branche `auditSite`. Test réel sur serveur local CSRF : un cookie `sid=ok` seul lit `/dashboard` **et** `/settings`. L'UI envoie maintenant les noms de champs détectés (`emailField`, `passwordField`) au lieu de les ignorer. Le popup existant (`Scan.tsx`) demande bien identifiant + mot de passe et force le crawl dès qu'un mur est détecté.
- **Flux SSE** : le timer fixe de 60 s dans `streamScan` (`Scan.tsx`) a été retiré ; un audit de 200 pages n'est plus interrompu alors que le serveur envoie encore des phases réelles.
- **Exports** : `apps/api/src/findings.ts` lit maintenant les deux formes de preuves (`observed`/status court et `detail`/status long) et les huit statuts terminaux, plus les conteneurs `moduleRuns`/`cases`. La route `/analyses/:id/report` ajoute `evidence` (payload brut, jamais tronqué) et un format `md`. UI : Markdown ajouté au centre d'analyses, boutons de téléchargement sur Start, Interact, Flow Studio, ModulePage et ProjectDetail. Les textes et les pages ignorées ne sont plus coupés dans `report-export.ts`.
- **Preuve exports** : `apps/api/test/analyses.test.ts` vérifie les 3 formats avec un constat `FAILED`+`detail` et un cas `BLOCKED` non finding-shaped ; `apps/web/src/lib/report-export.test.ts` vérifie la 45e page ignorée et une preuve de 900 caractères. Nouveaux tests d'abord rouges puis verts.
- **Ollama retiré** : preset supprimé du registre (`apps/api/src/ai-providers.ts`), de l'API, de l'UI, des textes et des docs ; `keyOptional` retiré comme champ devenu mort. Sur la machine : service arrêté/désactivé, unité `/etc/systemd/system/ollama.service`, binaire `/usr/local/bin/ollama`, `/usr/local/lib/ollama`, `/usr/share/ollama` (~5,8 Go de modèles), utilisateur et groupe supprimés. Port 11434 fermé, aucun process, aucun chemin restant. `AI_TURN_DEADLINE_MS` et le transport undici restent : ce sont des réglages génériques pour un endpoint auto-hébergé lent, pas des dépendances à Ollama.
- **Vérification après** : `pnpm lint` vert (598 fichiers), `pnpm typecheck` vert, `pnpm test` **108 fichiers / 1 098 tests verts**, `pnpm build` vert. Le bundle web reconstruit (`apps/web/dist`, `artifacts/desktop/linux-unpacked/resources/web`) ne contient plus la chaîne `ollama`. La reconstruction du `.deb` a échoué faute d'espace disque (8,8 Go libres, erreur fpm `ENOSPC`) : le paquet `.deb` n'a donc pas été re-vérifié, statut **NON VÉRIFIÉ** pour cet artefact précis.
                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                       

## 2026-11-28 (suite) — rendu navigateur, crawl SPA, module images sans vision

- **Cause du « une seule page »** : les sites `lauriax.com` et `enflesh.pages.dev` sont des SPA. Le HTML serveur est une coquille (`<div id="root"></div>`) sans lien : le crawler HTML s'arrête à `/`. Le DOM rendu contient au contraire `/login`, `/signup`, `/outils/...`, `/mentions-legales` (et un iframe pour lauriax). Les rapports PDF dans `~/Images` montraient « 1 page découverte, 1 page mesurée » — c'était réel, pas une erreur de comptage.
- **Correction moteur** : `PageRenderer` injecté dans `scanPage`, `detectLoginWall` et `crawlSite` (`packages/core`). Quand la réponse est une coquille (`isClientShell`), le renderer fournit le DOM réel ; le crawl suit ses liens et le scan mesure les cinq modules sur ce DOM. Un renderer absent ou en échec laisse le HTML serveur et le rapport le dit (`rendered_dom=SKIPPED`). Le `rendered_dom` est remplacé par `PASS` quand le rendu a réellement eu lieu.
- **Renderers** : `apps/api/src/local-renderer.ts` (Node, Chromium CDP via `@proofcore/adapter-browser`, fusionne les iframes de même origine) et `apps/api/src/worker-renderer.ts` (Worker, liaison `BROWSER` via `browsePage`). Injectés dans `node.ts` et `worker.ts`, propagés aux routes `/audits`, `/audits/login-check` et `/analyses`.
- **Preuve réelle sur lauriax.com** : avant = 1 page, `detected:false`, pas de popup. Après, via le moteur avec Chromium : **8 pages** (`/`, `/login`, `/signup`, 2 outils, mentions, confidentialité, contact), `clientRendered:false`, **50 contrôles mesurés**, `detectLoginWall` → `detected:true, loginUrl=https://lauriax.com/login`. Vérifié aussi via l'API locale (`login-check` → detected true). Le crawl complet via API reste soumis au quota payant (comportement attendu).
- **Module images sans vision** (`packages/modules/clean/src/images.ts`, 9 contrôles) : alt présent, qualité de l'alt (noms de fichiers, textes répétés), dimensions déclarées, lazy loading, images joignables, non vides, pixels 1–2 px, poids > 500 ko, Content-Type. Chaque contrôle non mesurable est SKIPPED, jamais PASS. 11 tests dédiés.
- **Tests corrigés** : `packages/core/test/crawl.test.ts` avait deux assertions contradictoires (exiger `/about` dans les pages tout en interdisant son fetch) et une accolade mal placée, introduced par un changement non commité. Corrigé sans affaiblir les limites d'origine/préfixe : 14/14 verts. `session.test.ts` renforce le cas d'un `/login` public sans formulaire.
- **Vérification** : lint vert (604 fichiers), typecheck vert, build vert, **1120 tests verts sur 111 fichiers**. Commit `e5b556c` poussé sur `origin/master`. Vercel `proofstack-cmg8uir1n` Ready + alias `proofstack-iota` ; Cloudflare Worker + Pages `3f9c3025` avec smoke vert. Le chunk `ReportExport-DgtdP-YL.js` servi contient « Rapport complet HTML » sur les deux plateformes.
- **Limite** : le Worker reconstruit un DOM minimal à partir de ce que `browsePage` observe (titre, titres, liens, texte) ; les contrôles de markup lisent donc le HTML serveur pour les attributs fins. Le rendu complet n'est disponible que sur le serveur Node local (Chromium CDP). Ceci est documenté dans `worker-renderer.ts`, pas masqué.

## 2026-11-28 (suite) — connexion réelle à LauriaX via le serveur MCP

- **Demande** : se connecter à `https://lauriax.com` avec `joelakichof@gmail.com` et le mot de passe fourni par l'utilisateur.
- **Parcours MCP** : client JSON-RPC stdio maison branché sur `node packages/cli/dist/index.js mcp` (protocole `2025-06-18`, 50 outils). `browser_open` sur `/login`, `browser_snapshot` → champs `e2` (`vous@exemple.com`) et `e3` (`••••••••`), bouton `e5` « Se connecter ». `browser_interact` type puis click. Résultat : redirection vers `https://lauriax.com/dashboard`, texte « Bonjour, Laudes 👋 », email `joelakichof@gmail.com`, lien « Déconnexion ».
- **Session vérifiée** : dans la même session MCP, `browser_goto` vers `/mon-profil`, `/portfolio` et `/parametres` reste sur ces URLs avec l'interface connectée (Accueil, Feed, Mon profil, Portfolio…). Aucune redirection vers `/login`.
- **Limite** : `browser_cookies` renvoie 0 cookie : la session est conservée dans le stockage du navigateur (Firebase), pas dans un cookie HTTP. Les identifiants ne sont pas écrits dans le dépôt, les logs ou la mémoire ; seul le succès du parcours est consigné.
