# PROOFCORE — audit approfondi

Date : 25 novembre 2026 · Dépôt : `apps/`, `packages/`, `tooling/`, `tests/` · Base : commit
`9976fdd` plus les changements décrits au § 3.

> Méthode : lecture du code livré, exécution réelle des contrôles, tests à deux comptes,
> parcours navigateur sur base fraîche. Aucun statut n'est déduit d'un nom de fichier ou
> d'une page marketing.

## 1. Résultat mesuré

| Contrôle                    | Commande                       | Résultat                                     |
| --------------------------- | ------------------------------ | -------------------------------------------- |
| Lint                        | `pnpm lint`                    | 496 fichiers, 0 erreur, 0 avertissement      |
| Types                       | `pnpm typecheck`               | OK sur tous les paquets + web + desktop      |
| Tests unitaires/intégration | `pnpm test`                    | **811 tests, 69 fichiers, 0 échec** (~126 s) |
| Chaîne complète             | `pnpm verify`                  | OK : lint + typecheck + tests + build web    |
| E2E desktop (Chrome)        | `playwright --project=desktop` | **17 passés, 2 sautés**                      |
| E2E mobile (Pixel 7)        | `playwright --project=mobile`  | **19 passés**                                |

Les E2E ont été lancés avec `CI=1`, une base SQLite en mémoire neuve et des ports
dédiés (5186/8799). Les deux tests sautés sont les scénarios réservés au téléphone,
volontairement `test.skip(!isMobile)`.

## 2. Ce que l'audit a réellement trouvé

### 2.1 Faille SSRF dans les webhooks sortants — CORRIGÉ

`apps/api/src/outbound.ts` validait l'URL d'un webhook avec une courte expression
régulière. En production, `https://169.254.169.254/latest/meta-data` (métadonnées
cloud), `https://100.64.0.1/`, `https://[fd00::1]/`, `https://[::ffff:127.0.0.1]/`,
`https://relay.cluster.local/` et `https://hooks.example:6379/` passaient. La livraison
suivait aussi les redirections, ce qui transformait un receiver public en rebond vers le
réseau interne.

Correctif : garde complet sur les plages réservées (lien-local, CGNAT, TEST-NET,
multicast, ULA, link-local IPv6, IPv4 mappée), refus des identifiants dans l'URL, refus
des ports de service en production, `redirect: "manual"` et refus explicite des 3xx,
revalidation de l'URL stockée au moment de la livraison.

Preuve : `apps/api/test/webhook-guard.test.ts` — 31 tests (table d'URL + refus
d'enregistrement en production + refus de redirection + cible stockée devenue
invalide). Le test de redirection vérifie `lastStatus = 302` et
`lastError` contenant « redirect ».

### 2.2 Le parcours d'inscription mobile échouait — CORRIGÉ

`tests/e2e/journey.spec.ts` passait sur desktop et échouait sur Pixel 7 : la requête
d'inscription était abandonnée après 6 s (« signal is aborted without reason »). Cause
mesurée : le fond WebGL décoratif de la page d'authentification était rendu au
`devicePixelRatio` du téléphone (×2,625), soit ~2,6 millions de fragments par frame ;
le thread principal était saturé et le timer `AbortController` de 6 s se déclenchait
avant que la réponse ne soit traitée.

Correctif : `apps/web/src/components/ui/modern-login-signup.tsx` plafonne le ratio de
rendu à 1,5. Le formulaire n'entre plus en concurrence avec son décor.

Preuve : le test mobile « overview states the plan honestly… » échouait avant, passe
après ; la suite mobile complète est à 19/19.

### 2.3 La carte de consentement bloquait le parcours débutant — CORRIGÉ (parcours)

Le test « a non-technical phone user follows the guide and analyses a site » cliquait
« Voir le résultat » derrière la carte cookies, qui intercepte le pointeur. Un visiteur
réel doit d'abord consentir. Les helpers E2E effectuent maintenant ce choix comme un
utilisateur (attente de l'affichage, puis clic sur « Autoriser »/« Allow »). Aucune
assertion n'a été affaiblie.

### 2.4 Lint rouge sur 21 diagnostics — CORRIGÉ

Contrairement à ce qu'affirmait `DEVELOPMENT_STATUS.md`, `pnpm lint` échouait. Les
corrections portent sur : variables/imports/paramètres inutilisés, concaténations à
remplacer par des templates, assertions non nulles dans `scenario.ts`, clés de listes
instables dans `SplitChars`/`PeintScene`, et `aria-hidden` sur des canvas/SVG décoratifs
(remplacé par des éléments sans nom accessible). Aucun `biome-ignore` n'a été ajouté.

### 2.5 Absence de tests d'isolation multi-comptes exhaustive — CORRIGÉ

Il existait un test ponctuel sur workspace/projet, mais pas de couverture systématique
des sous-ressources. `apps/api/test/tenant-isolation.test.ts` couvre maintenant :

- 22 lectures inter-comptes (projets, configuration, runs, findings, corrections,
  sources, métriques, audits IA, insights, overview, webhooks, facturation,
  notifications, clés API, mémoire IA, workspaces, membres, invitations) ;
- 8 écritures inter-comptes (création de projet, PATCH, configuration, suppression,
  webhook, checkout, conversation IA, import de sources) ;
- l'accès à un projet étranger via son propre workspace ;
- les conversations IA (liste, lecture, suppression) ;
- le refus de toute route sans session.

Chaque lecture doit répondre **404** (jamais 403, qui confirmerait l'existence de l'id)
et le corps ne doit contenir ni l'id utilisateur ni le nom du projet de l'autre compte.

## 3. Corrections de documentation

- `docs/AUDIT_2026-11.md` classait C2 « aucun moyen de récupérer un compte » comme
  ouvert. Le code livré contient pourtant `POST /api/account/forgot-password`,
  `reset-password`, `verify-email/request|confirm`, la révocation des sessions et les
  tests correspondants. Le constat est corrigé dans ce document.
- `docs/DEVELOPMENT_STATUS.md` annonçait 534 tests, « no password recovery », « no CI »
  et un lint propre. Les trois premiers points sont faux aujourd'hui ; la section
  « Known gaps » est remplacée par un renvoi à ce rapport.
- Les documents de la phase 9-20 sont créés dans `docs/PROOFCORE_*.md` avec le statut
  réel de chaque capacité.

## 4. Limites restantes (non corrigées dans cette passe)

1. **MFA et OAuth absents** : aucune route, aucun schéma. Non annoncés comme disponibles.
2. **Vérification d'e-mail non bloquante** : l'adresse est vérifiable, mais la connexion
   n'exige pas `email_verified_at`. Un compte non vérifié reste utilisable.
3. **Énumération à l'inscription** : `email_taken` répond 409, ce qui révèle l'existence
   d'un compte. La connexion et le mot de passe oublié, eux, répondent de façon uniforme.
4. **Limitation distribuée partielle** : les tentatives de connexion, le mot de passe
   oublié, le changement de mot de passe et la recherche de support sont durables (D1,
   table `auth_attempts`). L'inscription et les appels IA utilisent un limiteur en
   mémoire par isolate ; les quotas mensuels, eux, sont durables.
5. **Pas de protection DNS rebinding** : le Worker ne peut pas résoudre un nom avant le
   `fetch`. Les adresses littérales et les redirections sont bloquées ; un nom public
   qui résout vers une adresse privée n'est pas détecté.
6. **Redirections du navigateur embarqué** : `page.goto` valide l'URL initiale, pas les
   redirections internes de Chromium.
7. **Secrets au repos** : les clés de fournisseurs IA sont chiffrées (AES-256-GCM). Les
   secrets de webhooks sont stockés en clair (nécessaires à la signature HMAC) et les
   liens de réinitialisation restent en clair dans `email_outbox` pour livraison
   manuelle.
8. **Pas de tâche de rétention ni de sauvegarde/restauration testée** : les plans
   déclarent `report_retention_days`, et l'import calcule `retainedUntil`, mais aucune
   suppression planifiée n'existe.
9. **Pas de partage de rapport, pas d'export PDF/CSV de rapport, pas de recherche
   plein-texte** : la pagination existe (limit/offset + index), la recherche exacte
   n'est pas exposée.
10. **Pas de métriques/traçage** : identifiants de requête et logs d'erreur structurés
    existent ; ni OpenTelemetry, ni compteurs de latence.
11. **Fournisseurs externes non vérifiés** : aucun credential EmailJS/Resend ni SasPay
    live n'a été fourni. La livraison réelle et le paiement live restent NON VÉRIFIÉS.

## 5. Verdict

Le socle est cohérent et testé : authentification complète (hors MFA/OAuth), isolation
multi-comptes prouvée, moteurs et rapports communs, facturation sandbox, notifications,
support, e-mails avec journal de livraison honnête. La faille SSRF des webhooks sortants
était la seule vulnérabilité exploitable identifiée dans cette passe ; elle est fermée
et couverte par des tests.

Le produit reste **PARTIEL** pour un usage commercial de masse : MFA, vérification
d'e-mail obligatoire, rétention/sauvegarde, partage client et exports avancés manquent,
et les fournisseurs externes n'ont pas été prouvés en conditions réelles.
