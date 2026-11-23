# Matrice des capacités — PROOFSTACK

Référence factuelle de la mission « PROOFSTACK 2.0 » (partie 1.2).
Chaque ligne a été vérifiée dans le code livré, pas dans un nom de dossier ni dans une page
marketing. Quand une capacité est partielle, la colonne **Limites** dit exactement ce qui
manque, et **Maturité** le dit en un mot.

Méthode de vérification : lecture des routes (`apps/api/src/routes/*.ts`), des modules
(`packages/modules/*/src`), du moteur de scan (`packages/core/src/page-scan.ts`), du CLI
(`packages/cli/src/index.ts`), du routeur web (`apps/web/src/App.tsx`), et exécution réelle
de la suite de tests. État au moment de la rédaction : **712 tests, 59 fichiers, lint 0
sur les fichiers livrés, typecheck web/API/CLI 0 erreur**.

Vocabulaire de maturité :

- **Disponible** — implémenté, prouvé par des tests, accessible depuis au moins une surface.
- **Partiel** — implémenté pour une partie du cas d'usage ; la limite est nommée.
- **Expérimental** — le code existe, mais le chemin réel n'est pas prouvé de bout en bout.
- **Absent** — annoncé ou souhaité, sans implémentation. Jamais présenté comme disponible.

---

## 1. Modules historiques

### WORLD — compatibilité internationale

| Élément      | Contenu                                                                                                                                                                                                                                     |
| ------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Objectif     | Une donnée réelle (nom, téléphone, adresse, montant, date) est-elle acceptée **et** restituée sans corruption ?                                                                                                                             |
| Utilisateurs | Développeurs d'applications multi-pays, fondateurs SaaS, studios                                                                                                                                                                            |
| Entrées      | `proofcore.config.ts` (`modules.world`), un `ProductUnderTest` (harness HTTP ou test), des profils de locale                                                                                                                                |
| Contrôles    | 6 catégories de fixtures : `identity`, `phone`, `address`, `currency`, `datetime`, `collation`. Deux propriétés par valeur : la décision (accepter/refuser) et le stockage (ce qui revient = ce qui est entré, ou normalisation documentée) |
| Sorties      | Un cas par fixture, avec la valeur exacte qui casse, l'attendu, le reçu, la commande de reproduction                                                                                                                                        |
| Dépendances  | `@proofcore/core` (money, unicodedata, scripts), un produit cible joignable                                                                                                                                                                 |
| Limites      | Ne teste pas un rendu visuel. Sans `target`, les cas sont `SKIPPED`, jamais `PASSED`                                                                                                                                                        |
| Interface    | `/app/modules/world`, `/world` (marketing)                                                                                                                                                                                                  |
| API          | `POST /runs`, `GET /runs`, `GET /findings`                                                                                                                                                                                                  |
| CLI          | `proofcore test --module world`, `proofcore world`                                                                                                                                                                                          |
| Tests        | `packages/modules/world/test/*`                                                                                                                                                                                                             |
| Maturité     | **Disponible**                                                                                                                                                                                                                              |

### FLOW — fiabilité des parcours

| Élément      | Contenu                                                                                                                                                                              |
| ------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Objectif     | Un parcours réel (panier → paiement → webhook → confirmation) aboutit-il, et où casse-t-il ?                                                                                         |
| Utilisateurs | E-commerce, SaaS avec paiement, équipes QA                                                                                                                                           |
| Entrées      | Journeys dans la config (étapes : ouvrir, remplir, cliquer, attendre) ; un runner navigateur                                                                                         |
| Contrôles    | Exécution étape par étape ; une étape obligatoire en échec avorte avec l'id de l'étape. Webhooks falsifiés/dupliqués/retardés contre un fournisseur sandbox                          |
| Sorties      | Le parcours cassé **à l'étape nommée**, pas « le flow a échoué »                                                                                                                     |
| Dépendances  | Un navigateur. **Le Worker n'en a pas**                                                                                                                                              |
| Limites      | Sans runner navigateur (exécution côté serveur), **tous les parcours sont `SKIPPED` avec la raison**. C'est volontaire : un run serveur ne doit pas ressembler à un parcours vérifié |
| Interface    | `/app/modules/flow`, `/flow`                                                                                                                                                         |
| API          | `POST /runs` (avec `totals.flow`), `GET /runs`                                                                                                                                       |
| CLI          | `proofcore test --module flow`, `proofcore flow`                                                                                                                                     |
| Tests        | `packages/modules/flow/test/flow.test.ts`                                                                                                                                            |
| Maturité     | **Partiel** — complet en CLI avec Chromium ; ignoré côté serveur                                                                                                                     |

### EXIT — intégrité des exports

| Élément      | Contenu                                                                                         |
| ------------ | ----------------------------------------------------------------------------------------------- |
| Objectif     | Une donnée exportée puis réimportée revient-elle identique (schéma, relations, empreintes) ?    |
| Utilisateurs | Applications avec export CSV/JSON/ZIP, migration, facturation                                   |
| Entrées      | Un jeu de données synthétique (`exportSource`), les formats déclarés                            |
| Contrôles    | Fidélité d'aller-retour, cohérence du manifeste ZIP, écarts champ par champ                     |
| Sorties      | Diff au niveau du champ, pas seulement « export invalide »                                      |
| Dépendances  | `@proofcore/core` (hash, json), source de données                                               |
| Limites      | Sans `source`, les cas sont `SKIPPED`. Ne vérifie pas un export généré par un tiers non branché |
| Interface    | `/app/modules/exit`, `/exit`                                                                    |
| API          | `POST /runs`, `GET /runs`                                                                       |
| CLI          | `proofcore test --module exit`, `proofcore exit`                                                |
| Tests        | `packages/modules/exit/test/exit.test.ts`                                                       |
| Maturité     | **Disponible** (avec source configurée)                                                         |

### FAIL — audit de sécurité HTTP

| Élément      | Contenu                                                                                                                                                                                                                                                                   |
| ------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Objectif     | Quelles protections HTTP manquent sur une URL réellement déployée ?                                                                                                                                                                                                       |
| Utilisateurs | Toute équipe qui met un site en ligne                                                                                                                                                                                                                                     |
| Entrées      | Une URL publique, ou une URL protégée avec en-tête Cookie (jamais stocké)                                                                                                                                                                                                 |
| Contrôles    | 15 contrôles : `tls`, `hsts`, `csp`, `frame_ancestors`, `clickjacking_frame_headers`, `referrer_policy`, `permissions_policy`, `content_type`, `cookie_flags`, `mixed_content`, `server_banner`, `error_disclosure`, `stack_disclosure`, `secrets_in_html`, `http_status` |
| Sorties      | Par contrôle : statut, valeur observée, pourquoi cela compte. Score /100 par module                                                                                                                                                                                       |
| Dépendances  | Un `fetch` HTTP sortant vers la cible                                                                                                                                                                                                                                     |
| Limites      | **Ce n'est pas une certification de sécurité.** Aucun test actif offensif (pas d'injection, pas de fuzzing). Un site distant non vérifié voit ses emplacements masqués (anti-carte-aux-attaquants)                                                                        |
| Interface    | `/app/scan`, `/app/modules/fail`, `/fail`                                                                                                                                                                                                                                 |
| API          | `POST /audits`, `POST /audits/stream`, `GET /audits`, `GET /audits/:id`                                                                                                                                                                                                   |
| CLI          | `proofcore audit fail <url>`, `proofcore scan <url>`                                                                                                                                                                                                                      |
| Tests        | `apps/api/test/page-audits.test.ts`, `packages/core/test/page-scan.test.ts`                                                                                                                                                                                               |
| Maturité     | **Disponible**                                                                                                                                                                                                                                                            |

### CLEAN — qualité d'interface

| Élément      | Contenu                                                                                                                                                                                                                                                                                                                             |
| ------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Objectif     | L'interface est-elle structurée, accessible et propre, mesurablement ?                                                                                                                                                                                                                                                              |
| Utilisateurs | Designers, front-end, équipes produit                                                                                                                                                                                                                                                                                               |
| Entrées      | Une URL                                                                                                                                                                                                                                                                                                                             |
| Contrôles    | 11 contrôles : `title`, `meta_description`, `headings`, `html_lang`, `viewport`, `image_alt`, `field_labels`, `landmarks`, `inline_styles`, `html_weight`, `rendered_dom`                                                                                                                                                           |
| Sorties      | Observation brute + règle + score /100 par module                                                                                                                                                                                                                                                                                   |
| Dépendances  | HTML servi (et un signal `rendered_dom` distinct)                                                                                                                                                                                                                                                                                   |
| Limites      | **Analyse le HTML serveur** ; pour une application rendue côté client, la structure du DOM diffère. Le scan le dit (`rendered_dom`), saute les contrôles DOM qu'il n'a pas pu mesurer et marque CLEAN `not_measured` au lieu de produire un faux score. Le score est une heuristique de contrôle, pas une note d'accessibilité WCAG |
| Interface    | `/app/scan`, `/app/modules/clean`, `/clean`                                                                                                                                                                                                                                                                                         |
| API          | `POST /audits`, `GET /audits`                                                                                                                                                                                                                                                                                                       |
| CLI          | `proofcore audit clean <url>`, `proofcore scan <url>`                                                                                                                                                                                                                                                                               |
| Tests        | `packages/core/test/page-scan.test.ts`                                                                                                                                                                                                                                                                                              |
| Maturité     | **Disponible**, avec la limite HTML-serveur assumée                                                                                                                                                                                                                                                                                 |

---

### Le moteur de site — session, crawl, note

Les cinq modules ci-dessus répondent chacun à une famille de questions. Ce qui leur manquait
n'était pas une question de plus, mais une **portée** : ils ne voyaient qu'une page publique.
Trois pièces du moteur corrigent cela, et elles sont les mêmes pour le CLI, l'API, l'interface
et l'assistant.

| Élément  | Contenu                                                                                                                                                                                                  |
| -------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Objectif | Auditer un site entier, y compris derrière son login, et rendre une note que l'on peut recalculer à la main.                                                                                             |
| Fichiers | `packages/core/src/session.ts` (connexion), `crawl.ts` (exploration), `site-scan.ts` (contrôles de site + note), `site-audit.ts` (orchestration).                                                        |
| Maturité | **Disponible.** 4 fichiers, 38 tests, dont 4 qui attaquent le moteur (mot de passe refusé, MFA, formulaire en JavaScript, jeton qui ne doit pas fuir).                                                   |
| Surfaces | `proofcore scan <url> --crawl`, `POST /api/v1/audits` avec `crawl` et `login`, panneau « Le site, pas seulement l'adresse » dans `/app/scan`, outil `site_audit` de l'assistant.                         |
| Limites  | Pas de rendu JavaScript dans le crawl (une page dessinée côté client n'est lue que par son HTML) ; 200 pages maximum par appel d'API, 20 par l'assistant ; l'exploration reste sur l'origine par défaut. |

**Connexion.** Le formulaire est découvert dans la page (`action`, `method`, noms des champs,
champs cachés dont le jeton anti-CSRF). Les cookies sont gardés dans un jar qui applique les
règles de chemin, de domaine, `Secure` et d'expiration qu'un navigateur applique. Les
redirections sont suivies une par une pour que chaque saut conserve ses cookies. La session
n'est déclarée ouverte que si une page **qui l'exige** répond autrement qu'avec le formulaire :
un HTTP 200 accompagné d'un cookie ne prouve rien, et c'était exactement le défaut de la
version précédente, qui aurait présenté un mot de passe refusé comme une connexion réussie.
Un refus est rapporté avec la phrase du site, un mur MFA est dit MFA, et un jeton bearer
trouvé dans une réponse JSON sert à la vérification sans jamais entrer dans le rapport.

**Crawl.** Même origine par défaut ; limites de pages (25), de profondeur (3), de concurrence
(4), d'octets par page (1,5 Mo) et de durée (12 s). `robots.txt` est respecté par groupe
d'agent, `Crawl-delay` compris. Les adresses de déconnexion, de suppression et de
désabonnement ne sont **jamais** suivies : un outil d'audit qui se déconnecte du compte qu'on
lui a prêté détruit la preuve qu'il produisait.

**Contrôles de site.** Treize questions qu'une page seule ne peut pas poser : liens cassés,
redirections, titres dupliqués, titres absents, pages lourdes (> 400 kB de HTML), pages lentes
(> 1,5 s), pages sans TLS, pages sans HSTS, source maps publiées, contenu mixte, `robots.txt`,
`sitemap.xml`, couverture du crawl. Chacune **nomme les pages** concernées : « 3 liens cassés »
n'est pas actionnable, la liste des trois l'est.

**La note.** Les poids de risque sont lus dans le registre des contrôles, donc le texte et le
nombre ne peuvent pas se contredire. La note est une **borne basse de Wilson** sur le taux de
réussite pondéré, multipliée par un facteur de couverture `0,5 + 0,5 × pages lues / pages
découvertes`. Conséquences vérifiées par des tests arithmétiques : trois contrôles mesurés ne
peuvent pas valoir 100, un module fait uniquement d'avertissements tombe entre 0 et 100 au lieu
de 0, et un intervalle de 3 pages ne peut pas dépasser un crawl de 40. Sous 75 % de couverture,
la note est marquée `provisional` et l'interface l'affiche.

## 2. Surfaces produit

| Surface                | Ce qui existe réellement                                                                                                                                                                                                                                                                 | Limites                                                                         | Maturité                  |
| ---------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------- | ------------------------- |
| **CLI**                | `init`, `doctor`, `validate`, `test`, `world/flow/exit`, `modules`, `report`, `audit`, `scan`, `sync`, `login`/`logout` (session + device flow), `ai`, `mcp`, `tools`, `map`, `index`, `search`, `devtools`, `svg`, `debug`, `memory`, `whoami`, `hub`, `serve`, `exec`, `update`, `app` | `@proofcore/cli` n'est pas publié sur npm ; installation par tarball/installeur | **Disponible** localement |
| **Codes de sortie**    | Contrat : 0 = succès, 1 = défaut produit, 2 = erreur de harnais/config, 3 = annulé                                                                                                                                                                                                       | —                                                                               | **Disponible**, testé     |
| **Rapports**           | JSON, JUnit XML, HTML autonome, texte, depuis le même run                                                                                                                                                                                                                                | —                                                                               | **Disponible**            |
| **API**                | Cloudflare Worker + D1 ; Hono ; auth, workspaces, projets, runs, findings, rapports, insights, audits, corrections, billing, usage, webhooks, support, mémoire IA, appareils                                                                                                             | —                                                                               | **Disponible**            |
| **Web**                | Marketing + workspace (Ink & Object) : overview, projets, 5 modules, scan, CLI, terminal, IA, billing, settings, admin                                                                                                                                                                   | —                                                                               | **Disponible**            |
| **Desktop**            | Electron, sidecar = le binaire `proofcore`, connexion directe, gate de compte, grace hors-ligne 7 j, proxy loopback, mises à jour app+moteur                                                                                                                                             | Installateurs Windows/macOS construits en CI seulement, non signés              | **Partiel**               |
| **Terminal intégré**   | Shell sur SSE, **uniquement dans l'application desktop**                                                                                                                                                                                                                                 | Sur le web : panneau dit « disponible dans l'application desktop »              | **Disponible** (desktop)  |
| **Navigateur intégré** | Chromium dans la fenêtre (desktop) et panneau dans le chat                                                                                                                                                                                                                               | Quota plateforme                                                                | **Disponible**            |

---

## 3. Intelligence artificielle

| Capacité                           | Réalité du code                                                                                                                                                                                                                                | Limites                                                                                              | Maturité                     |
| ---------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------- | ---------------------------- |
| Conversation persistée             | `ai_conversations`, `POST /ai/chat`, `GET /ai/conversations`                                                                                                                                                                                   | —                                                                                                    | **Disponible**               |
| Contexte projet / module           | Le prompt système reçoit l'état de l'espace, les runs et constats réels via les outils en lecture                                                                                                                                              | Le modèle ne voit pas les fichiers clients                                                           | **Disponible**               |
| Mémoire d'espace                   | `workspace_memory` (migration 0014), injection à chaque tour, curation assistée (max 2 faits/tour), `GET/POST/DELETE /ai/memory`, `proofcore memory`                                                                                           | Séparée par espace, pas par projet                                                                   | **Disponible**               |
| Effort → sous-agents               | Niveaux low/medium/high → 0/2/3 relecteurs + synthèse, budget affiché                                                                                                                                                                          | —                                                                                                    | **Disponible**               |
| Audit IA de projet                 | `POST /projects/:projectId/ai-audit`, `GET /projects/:projectId/ai-audits`, quota `monthly_ai_audits`                                                                                                                                          | Dépend d'une clé fournisseur                                                                         | **Disponible**               |
| Blog de corrections                | `GET /projects/:projectId/corrections`, `PATCH .../corrections/:key` : état par constat + comparaison avec le scan précédent                                                                                                                   | —                                                                                                    | **Disponible**               |
| Fournisseur imposé à l'utilisateur | **Bring Your Own Key** est le chemin par défaut : chaque utilisateur colle sa clé                                                                                                                                                              | **C'est exactement ce que la partie 4.4 interdit.** Il n'existe pas de fournisseur serveur mutualisé | **Écart assumé, à corriger** |
| Explications déterministes         | Registre de 46 contrôles (`packages/core/src/controls.ts`) : objectif, conséquence, correctif, vérification, exemples par pile, en français et en anglais. Rendu dans la page de scan, dans `GET /api/v1/controls` et dans `proofcore explain` | Le « plan de résolution » ordonné (quelle correction d'abord) reste un calcul à écrire               | **Disponible**               |

---

## 4. Résultats et constats

| Élément                       | Réalité                                                                                                                                                                                                              | Limite                                                                                                          | Maturité       |
| ----------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------- | -------------- |
| Modèle de constat             | `findingSchema` : id, testCaseId, module, titre, détail, sévérité (5 niveaux), statut, `fingerprint` stable, failure (expected/actual), reproduction (commande exacte), evidenceIds, durées                          | Pas de champs `impact`, `cause probable`, `correction` structurés : ils vivent dans `detail` / le texte du scan | **Partiel**    |
| Empreinte stable              | `fingerprint` : le même défaut sur 10 runs = 1 problème avec une tendance                                                                                                                                            | —                                                                                                               | **Disponible** |
| Statuts                       | `PENDING, RUNNING, PASSED, FAILED, WARNING, SKIPPED, ERROR, **BLOCKED, NOT_APPLICABLE, NOT_CONFIGURED**` (+ `NOTHING_VERIFIED` au niveau run)                                                                        | Aucune : les trois statuts exigés en 6.6 existent, sont agrégés, rapportés (JUnit inclus) et comptés séparément | **Disponible** |
| Cinq niveaux d'explication    | Le scan produit `observed` (preuve) + `why` (conséquence) + statut ; la correction est proposée par l'IA ou la page de correction                                                                                    | Résumé / explication / conséquence / correction ne sont pas des champs normalisés du constat                    | **Partiel**    |
| Regroupement des doublons     | `findingKey` + état par constat dans le board de corrections                                                                                                                                                         | Le regroupement par cause commune (6.7) n'est pas implémenté                                                    | **Partiel**    |
| Comparaison historique        | `latestPageAudits(…, 2)` + `comparison` renvoyée par `/corrections`                                                                                                                                                  | Comparaison limitée à deux scans de page, pas aux runs moteur                                                   | **Partiel**    |
| Vérification après correction | `POST /projects/:id/corrections/:key/verify` : relit la page, isole le même `module:id`, enregistre avant/après et un verdict (`fixed`, `still_present`, `worse`, `not_checked`, `inconclusive`). Sans quota d'audit | Un contrôle à la fois, pas encore de « vérifier tout ce qui est marqué corrigé »                                | **Disponible** |
| Couverture réelle             | `verdict: not_measured` quand rien n'a été jugé ; `NOTHING_VERIFIED` au niveau run                                                                                                                                   | Pas de ratio « contrôles applicables / exécutés » affiché comme tel                                             | **Partiel**    |

---

## 5. Sécurité et multi-tenant

| Élément                  | Réalité                                                                                                            | Maturité                             |
| ------------------------ | ------------------------------------------------------------------------------------------------------------------ | ------------------------------------ |
| Cloisonnement            | Chaque requête est scopée `workspace_id` ; l'appartenance est revérifiée dans le store                             | **Disponible**                       |
| Secrets                  | Clés fournisseur chiffrées (`AI_KEYS_SECRET`), hash seul pour les tokens projet, secrets webhook affichés une fois | **Disponible**                       |
| Audits de sites distants | Emplacements masqués tant que la propriété du site n'est pas prouvée (jeton `.well-known`)                         | **Disponible**                       |
| Actions sensibles        | Approbateur dans l'agent local ; `ai.autonomy` par défaut `read`                                                   | **Disponible**                       |
| Rate limiting            | Limiteur par compte + adresse, `AI_RATE_LIMIT_PER_HOUR`                                                            | **Partiel** — en mémoire par isolate |
| Signature Desktop        | Non signée                                                                                                         | **Absent**                           |

---

## 6. Ce qui est annoncé et pas livré

Ces points sont volontairement listés ici pour qu'aucune surface ne les présente comme
disponibles. Ils sont identiques à `docs/DEVELOPMENT_STATUS.md`, section « Known gaps ».

| Annoncé                                                                                   | État réel                                                                             |
| ----------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------- |
| Intégration GitHub, partage client, rapports avancés, support prioritaire (plans payants) | **Absent** — la table tarifaire les marque « bientôt »                                |
| Récupération de mot de passe par e-mail                                                   | **Absent** — pas de fournisseur d'e-mail branché (`email_outbox` existe, aucun envoi) |
| OAuth, 2FA                                                                                | **Absent**                                                                            |
| Publication npm de `@proofcore/cli`                                                       | **Absent** — installation par tarball                                                 |
| Jobs de rétention, sauvegardes                                                            | **Absent**                                                                            |
| SDK public                                                                                | **Absent** — seuls les contrats internes existent                                     |

---

## 7. Comment cette matrice est tenue à jour

1. Une capacité ne passe à **Disponible** qu'avec un test qui la prouve et, quand une surface
   l'expose, une capture ou une vérification live.
2. Une limite constatée n'est jamais supprimée de ce fichier pour faire bonne figure ; elle
   est déplacée quand le code change, avec la preuve.
3. Toute nouvelle route API, commande CLI ou page web doit apparaître ici dans le même
   commit. Sinon elle est invisible pour la revue.
