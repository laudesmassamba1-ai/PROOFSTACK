# PROOFCORE 2.0 — rapport de livraison

Date : 25 novembre 2026 · Base : commit `9976fdd` + changements de cette passe (non
commités) · Environnement : Linux, Node 22, SQLite en mémoire pour les tests.

> Règle appliquée : **une fonctionnalité = une implémentation + une preuve + un parcours
> validé**. Aucun statut VÉRIFIÉ ci-dessous ne repose sur la seule existence d'une route
> ou d'un composant.

## 1. Diagnostic initial

Le dépôt était plus avancé que sa documentation. `docs/AUDIT_2026-11.md` et
`docs/DEVELOPMENT_STATUS.md` annonçaient encore « pas de récupération de mot de passe »,
« pas de CI » et 534 tests. Le code livré contient la récupération, la vérification
d'e-mail, les sessions révocables, la CI et 811 tests. À l'inverse, le lint était rouge
(21 diagnostics) alors que le statut affirmait le contraire.

Les contrôles de cette passe ont trouvé deux défauts fonctionnels et une faille :

1. une SSRF exploitable par tout propriétaire de workspace via les webhooks sortants ;
2. l'inscription mobile qui échouait sur un téléphone réel (thread saturé par un fond
   WebGL) ;
3. une couverture d'isolation multi-comptes incomplète.

## 2. Défauts constatés

| #   | Défaut                                                                                                           | Preuve                                                | Gravité               |
| --- | ---------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------- | --------------------- |
| 1   | Webhook sortant accepté vers `169.254.169.254`, CGNAT, ULA IPv6, `.svc`, ports de service ; redirections suivies | `outbound.ts` avant correctif ; tests `webhook-guard` | Critique              |
| 2   | Inscription mobile abandonnée après 6 s                                                                          | E2E Pixel 7, capture « signal is aborted »            | Élevé                 |
| 3   | Parcours débutant bloqué par la carte cookies                                                                    | E2E mobile, clic intercepté                           | Moyen                 |
| 4   | Pas de tests systématiques d'isolation des sous-ressources                                                       | absence dans `apps/api/test`                          | Élevé                 |
| 5   | Lint rouge (21 erreurs)                                                                                          | `pnpm lint`                                           | Moyen                 |
| 6   | Documentation fausse sur l'état réel                                                                             | `DEVELOPMENT_STATUS.md`                               | Moyen                 |
| 7   | MFA, OAuth, vérification d'e-mail obligatoire absents                                                            | aucune route                                          | Élevé (ouverture)     |
| 8   | Sauvegarde/restauration et purge de rétention absentes                                                           | aucun script/job                                      | Critique (production) |
| 9   | Partage client, export PDF/CSV, recherche plein-texte absents                                                    | aucun code                                            | Élevé (vente)         |
| 10  | FAIL/CLEAN non poussés par le CLI                                                                                | pas de `audit --sync`                                 | Moyen                 |

## 3. Corrections livrées

1. **Garde SSRF complet** (`apps/api/src/outbound.ts`) : plages réservées, métadonnées,
   ULA/link-local IPv6, IPv4 mappées, identifiants, suffixes internes, ports de service
   en production, refus des redirections, revalidation à la livraison.
2. **Tests de la garde** : `apps/api/test/webhook-guard.test.ts`, 31 tests.
3. **Isolation multi-comptes** : `apps/api/test/tenant-isolation.test.ts`, 5 tests,
   22 lectures + 8 écritures + conversations IA + absence de session.
4. **Inscription mobile** : plafond du ratio de rendu WebGL à 1,5 dans
   `modern-login-signup.tsx`.
5. **Parcours E2E** : fermeture du consentement cookies comme un utilisateur, dans les
   deux helpers d'inscription.
6. **Lint** : 21 diagnostics corrigés sans suppression ; formatage Biom applied.
7. **Règle de preuve** : ajoutée en tête d'`AGENTS.md`.
8. **Documents** : les treize documents `docs/PROOFCORE_*.md` remplacent les
   affirmations périmées.

## 4. Architecture finale

Voir `PROOFCORE_ARCHITECTURE_MAP.md`. Résumé :

- `apps/web` (React/Vite) + `apps/api` (Hono, Worker/D1 ou Node/SQLite) ;
- `packages/engine` + `modules/{world,flow,exit}` + `core/page-scan` (FAIL/CLEAN) ;
- `packages/billing` (plans, quotas, checkout, webhooks) ;
- `packages/adapters/{payments,reporting,browser,ai}` ;
- `packages/cli` + `apps/desktop` pour le moteur local ;
- D1 pour l'identité, la facturation, les runs ; Neon optionnel pour le code importé.

## 5. Évolution de l'IA

- Contexte strictement limité au workspace ; 19 outils.
- Cinq outils de module : `module_status`, `module_config`, `module_configure`,
  `module_run`, `analyze_run`. L'IA lit l'état et le vocabulaire des cinq modules.
  `module_configure` ne sauvegarde que WORLD/FLOW/EXIT, avec les schémas réels.
  `module_run` persiste les runs WORLD et les cas FLOW compatibles avec le runtime
  serveur. FAIL/CLEAN exécutent un scan HTTP, consomment le quota `monthly_ai_audits`
  et enregistrent un `PageAudit` dans l'historique des scans. Ils retournent `auditId`,
  tandis que `runId: null` et `reportId: null` restent corrects : ce ne sont pas des
  `EngineRun` / `RunReport`. `module_status` expose le dernier audit et `get_report`
  peut le relire avec `auditId`. EXIT et les journeys FLOW Chromium restent locaux
  lorsque leurs prérequis nécessitent le poste du développeur.
- Une seule autre écriture : `remember` (fait de mémoire borné).
- Clés chiffrées AES-256-GCM ; fingerprint seul renvoyé.
- Contenus importés encadrés par un nonce ; 6 tests d'évasion.
- Quota `monthly_ai_audits` avant appel ; une panne fournisseur ne consomme pas.
- Mémoire curatée, lisible, ajoutable, supprimable.
- **Limite** : aucun fournisseur réel appelé dans cette passe ; parcours génératif
  NON VÉRIFIÉ en production.

### 5 bis. Parcours IA ↔ FLOW prouvé

`apps/api/test/module-copilot.test.ts` exécute le cycle entier avec le vrai moteur et
un faux fournisseur de modèle :

1. `module_status` lit les 5 modules et leur capacité réelle ;
2. `module_config` renvoie le schéma FLOW actif et son vocabulaire ;
3. `module_configure` sauvegarde 3 scénarios et un target HTTP, validés par
   `flowConfigSchema`, puis la config relue par l'API contient exactement ces valeurs ;
4. `module_run` exécute le moteur contre un produit HTTP local : 3 cas, 3 passés ;
5. le run est dans `GET /api/v1/runs` avec `flow.passed = 3` ;
6. `analyze_run` renvoie `passedCount: 3`, `failures: []`, et ce diagnostic est bien
   envoyé au modèle dans le tour suivant.

Le test « duplicate order » utilise le même chemin contre un produit qui crée deux
commandes : le run est `FAILED`, le cas `flow/order_duplicate` porte
`duplicate_order_created`, et `analyze_run` renvoie la cause, la reproduction et la
recommandation de correction.

Ce parcours a trouvé un défaut réel : `checks.ts` extrayait `target.checkout`,
`target.deliverWebhook`, `target.readOrder` et `target.refund` sans les lier à leur
instance. Les fakes à closures le masquaient ; avec `HttpPaymentTarget`, tous les cas
webhook/remboursement/lecture échouaient en `ERROR`. Les méthodes sont maintenant
liées, et le test de défaut le prouve.

Le journey navigateur est prouvé séparément par
`packages/cli/test/journey-browser.test.ts` : Chromium réel, clic, attente de texte,
assertion, cas `flow/journey/confirm` `PASSED`. Il est ignoré sur une machine sans
Chromium ; il a été exécuté ici (3,5 s).

## 6. Évolution des moteurs

| Moteur | État                                                             |
| ------ | ---------------------------------------------------------------- |
| WORLD  | fixtures déterministes ; sans cible, SKIPPED                     |
| FLOW   | CLI + Chromium ; serveur sans navigateur, SKIPPED explicite      |
| EXIT   | aller-retour, manifeste, écarts champ par champ                  |
| FAIL   | 15 contrôles HTTP, score avec couverture ; pas une certification |
| CLEAN  | 11 contrôles ; page client-rendue → `not_measured`               |

## 7. Modèle de données

20 migrations versionnées. Domaines : identité/sessions/jetons/tentatives, workspaces et
membres/invitations, projets et configuration, runs/findings/rapports, scans et états de
correction, clés API, abonnements/paiements/factures/usage, profils et conversations IA,
mémoire, notifications, support, outbox e-mail, webhooks, journal d'audit, idempotence.

## 8. Expérience simple

`/app/guide` → `/app/start` → résultat → rapport complet, sans CLI. Testé sur Pixel 7 :
inscription, consentement, guide, adresse, HTTP 200, lien de rapport, aucun débordement.

## 9. Expérience Studio

`/app/modules`, `/app/projects/:id/config`, `/app/cli`, `/app/terminal`,
`/app/ai/local`, `/app/admin`. Les E2E couvrent la coquille, les réglages, le 404
applicatif et l'absence de débordement ; les parcours de configuration avancée ne sont
pas couverts par un E2E dédié.

## 10. Design

Direction Ink & Object conservée. Aucune refonte. Correction du coût de rendu du fond
d'authentification sur mobile et nettoyage d'accessibilité des canvas/SVG décoratifs.
Aucune campagne de captures multi-viewports n'a été rejouée.

## 11. Responsive

Prouvé : Desktop Chrome 1280×800 (17 tests) et Pixel 7 412×915 / 390×844 (19 tests),
dont l'absence de débordement des pages du dashboard. La matrice de 14 tailles reste à
rejouer : statut **PARTIEL**.

## 12. Sécurité

Voir `PROOFCORE_SECURITY.md`. Points prouvés : PBKDF2 + sel, comparaison constant-time,
sessions hashées, reset à usage unique, révocation, isolation 404, plafonds de corps,
Zod strict, anti-SSRF, webhooks entrants signés/anti-rejeu avec vérification serveur,
clés IA chiffrées. Points ouverts : MFA, OAuth, vérification d'e-mail obligatoire,
énumération à l'inscription, secrets de webhooks/e-mails en clair, DNS rebinding,
redirections du navigateur embarqué.

## 13. CLI

Commandes présentes : init, doctor, validate, test, world/flow/exit, modules, report,
audit fail|clean, scan, sync, login/logout, ai, mcp, tools. 811 tests incluent la suite
CLI. La distribution (tarball/installateurs) n'a pas été reconstruite dans cette passe.
Manque : `audit --sync` pour pousser FAIL/CLEAN.

## 14. Desktop

Le code Electron (fenêtre, sidecar, coffre OS, proxy loopback, mises à jour) est présent
et documenté. **Aucun packaging ni lancement n'a été exécuté dans cette passe** : statut
NON VÉRIFIÉ pour cette livraison.

## 15. Facturation

Plans Free/Developer/Studio/Agency, entitlements, quotas, checkout idempotent, sandbox
settle, reçus, historique, annulation/changement de plan. SasPay est le fournisseur
réel ; `automatedRecurring: false`, `refunds: false` déclarés. Paiement sandbox prouvé
par tests + E2E. Paiement live NON VÉRIFIÉ.

## 16. E-mails

EmailJS prioritaire, Resend en repli. Chaque message est journalisé (`sent`, `failed`,
`unconfigured`) ; l'API ne prétend jamais qu'un e-mail est parti sans acceptation du
fournisseur. Aucun credential fourni : envoi réel NON VÉRIFIÉ.

## 17. Support

Création avec référence, stockage, notification opérateur si e-mail configuré,
consultation par référence + adresse, réponse depuis la console admin, historique,
statut. Testé par `account.test.ts` et `admin.test.ts`. Le support humain n'est pas
présenté comme une permanence 24/7.

## 18. Tests

Les nombres ci-dessous sont les résultats consignés dans la passe locale de livraison
à laquelle ce rapport se réfère. Ils ne prouvent pas automatiquement que chaque commit
ultérieur, y compris la branche de suivi documentaire, passe encore la suite.

| Suite             | Résultat consigné dans la passe d'origine |
| ----------------- | ----------------------------------------- |
| `pnpm lint`       | 496 fichiers, 0 erreur                    |
| `pnpm typecheck`  | OK                                        |
| `pnpm test`       | 811 tests, 69 fichiers, 0 échec           |
| Preuve navigateur | Chromium réel, journey FLOW `PASSED`      |
| `pnpm verify`     | OK (lint + types + tests + build)         |
| E2E desktop       | 17 passés, 2 sautés                       |
| E2E mobile        | 19 passés                                 |

Les deux tests sautés sont les scénarios réservés au téléphone, exécutés dans le projet
mobile. Les modifications documentaires et le test du wordmark ajoutés ensuite doivent
encore être exécutés par la CI de la branche avant fusion.

## 19. Erreurs restantes

1. MFA/OAuth absents.
2. Vérification d'e-mail non obligatoire ; énumération à l'inscription.
3. Limitation distribuée incomplète (inscription, IA).
4. DNS rebinding non couvert ; redirections du navigateur embarqué non interceptées.
5. Secrets de webhooks et liens de reset en clair au repos.
6. Pas de sauvegarde/restauration testée, pas de purge de rétention.
7. Pas de partage client, PDF/CSV, recherche plein-texte.
8. FAIL/CLEAN non poussés par le CLI.
9. Pas de métriques/tracing.
10. Accessibilité non auditée.

## 20. Dépendances externes

| Dépendance        | État                    | Ce qui manque                                                  |
| ----------------- | ----------------------- | -------------------------------------------------------------- |
| EmailJS ou Resend | NON VÉRIFIÉ             | 4 valeurs EmailJS ou `RESEND_API_KEY` + `MAIL_FROM`            |
| SasPay live       | NON VÉRIFIÉ             | `SASPAY_API_KEY` live + `SASPAY_WEBHOOK_SECRET` + IP whitelist |
| Neon              | NON VÉRIFIÉ cette passe | `NEON_DATABASE_URL`                                            |
| GitHub releases   | non appelé              | `GITHUB_TOKEN` (recommandé)                                    |
| Cloudflare/Vercel | non déployé             | comptes et secrets de déploiement                              |

## 21. Étapes de déploiement

1. `pnpm verify` sur le commit exact.
2. Poser les secrets Worker (SasPay, e-mail, `AI_KEYS_SECRET`, `ADMIN_EMAILS`,
   `NEON_DATABASE_URL`, `GITHUB_TOKEN`).
3. `pnpm cloud:deploy` (migrations D1 + Worker + web + Pages).
4. `pnpm smoke:deploy`.
5. Compte de recette : guide → start → scan → rapport → suppression.
6. Test paiement sandbox, puis live avec un montant minimal et webhook observé.
7. Test e-mail réel (reset) et vérification de l'outbox.
8. Consigner version, date, opérateur, résultats.

## 22. Tableau de preuve final

| Fonction | État | Limite / preuve |
| --- | --- | --- |
| Inscription, connexion et sessions | VÉRIFIÉ (hors production) | Parcours desktop et mobile consignés |
| Réinitialisation du mot de passe | PARTIEL | API testée ; livraison réelle des e-mails non vérifiée |
| Vérification d'e-mail | PARTIEL | Flux API présent ; non exigée à la connexion et fournisseur réel non vérifié |
| MFA et OAuth | ABSENT | Aucun fournisseur ni parcours |
| Isolation multi-comptes | VÉRIFIÉ (hors production) | 22 lectures et 8 écritures contrôlées |
| Rôles et invitations | VÉRIFIÉ (hors production) | API et notifications testées |
| IA contextuelle | PARTIEL | Tests avec fournisseur simulé ; fournisseur réel non vérifié |
| Copilot des cinq modules | PARTIEL | WORLD/FLOW produisent des EngineRun ; FAIL/CLEAN enregistrent un PageAudit ; EXIT reste local |
| FLOW navigateur | VÉRIFIÉ sur machine de test | Chromium local via CLI ; non exécuté dans le Worker |
| WORLD/FLOW/EXIT | VÉRIFIÉ hors production | Moteur partagé et parcours CLI/API testés, avec limites de runtime |
| FAIL/CLEAN | PARTIEL | PageAudit persisté ; historique distinct des EngineRun ; aucun `audit --sync` CLI |
| Rapports JSON/JUnit/HTML/texte | VÉRIFIÉ | Web et CLI |
| Export PDF/CSV et partage client | ABSENT | Aucune implémentation |
| Pagination | VÉRIFIÉ hors production | API et interface |
| Recherche plein-texte | ABSENT | Aucun index ni endpoint |
| Paiement sandbox | VÉRIFIÉ en sandbox | Parcours checkout et confirmation E2E |
| Paiement live SasPay | NON VÉRIFIÉ | Credentials et transaction réelle manquants |
| Webhooks entrants et sortants | VÉRIFIÉ hors production | Signature, anti-rejeu et receiver local testés |
| Quotas et consommation | VÉRIFIÉ hors production | API et interface testées |
| E-mails transactionnels | NON VÉRIFIÉ | Fournisseur de production non configuré |
| Notifications et support | VÉRIFIÉ hors production | Interface, API et console admin testées |
| Design et responsive | PARTIEL | Captures E2E et 2 viewports ; campagne visuelle complète à rejouer |
| Accessibilité | PARTIEL | Contrôle clavier limité ; audit WCAG/axe absent |
| Observabilité | PARTIEL | Request ID et logs JSON ; pas de tracing ni tests dédiés |
| Sauvegarde/restauration et rétention | ABSENT | Aucun processus opérationnel testé |

## 23. Verdict

La transformation n'est **pas** déclarée terminée. Ce qui est prouvé : le socle
d'identité, l'isolation, les moteurs, les rapports, la facturation sandbox, les
notifications, le support et les parcours web desktop/mobile. Ce qui manque pour une
exploitation commerciale : sauvegarde/restauration, rétention, MFA/vérification
obligatoire, partage/export, et la preuve réelle des fournisseurs externes.

Le produit est **démontrable et testé**, pas encore **exploitable en production**.


## 24. Addendum de revue — 25 novembre 2026

Cette revue a corrigé puis étendu la description des capacités du copilot. Seuls les runs WORLD et les exécutions FLOW compatibles avec le runtime serveur créent des `EngineRun` / `RunReport`. FAIL/CLEAN enregistrent désormais un `PageAudit` après leur scan HTTP ; ils ne créent toujours pas d'EngineRun et renvoient `auditId` plutôt que `runId`. EXIT et les journeys Chromium restent locaux lorsque leurs prérequis l'exigent. Ces deux historiques restent volontairement distincts.

Cette branche ajoute aussi :

- correction du wordmark : le P géométrique est rendu une seule fois, le texte adjacent devient `ROOFCORE`, et la version sans symbole reste `PROOFCORE` ;
- un test de rendu du wordmark et du hero animé ;
- des descriptions d'outils IA qui distinguent clairement exécution, scan live et persistance ;
- une clarification du README, du statut de développement et de la matrice de capacités.

**Validation de cette branche : NON EXÉCUTÉE localement par cette revue.** Les changements ont été poussés sur une branche séparée. La CI doit encore confirmer lint, typecheck, tests, build et E2E. Aucune publication npm ni aucun déploiement de production n'a été effectué.
