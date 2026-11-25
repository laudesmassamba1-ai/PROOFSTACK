# PROOFCORE — registre des risques

Date : 25 novembre 2026. Échelle : **Critique** (exploitation directe ou perte de
données), **Élevé** (bloque une vente ou une promesse), **Moyen** (limite d'usage),
**Faible** (finition). Un risque n'est « clos » que si le correctif est couvert par un
test exécuté.

## 1. Risques ouverts

| ID  | Risque                                                 | Preuve                                                                     | Impact                      | Mitigation / état                                                                                                                             |
| --- | ------------------------------------------------------ | -------------------------------------------------------------------------- | --------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------- |
| R1  | Aucun second facteur : un mot de passe volé suffit     | aucune route TOTP dans `apps/api/src/routes`                               | Élevé                       | **Ouvert.** À implémenter (TOTP + codes de secours + révocation). Non annoncé comme disponible.                                               |
| R2  | Adresse e-mail non vérifiée à la connexion             | `session` renvoie `emailVerified` mais `sign-in` ne l'exige pas            | Moyen                       | **Ouvert.** Blocage configurable à ajouter ; sinon un compte peut usurper une adresse.                                                        |
| R3  | Énumération de comptes à l'inscription                 | `createUser` lève `email_taken`, mappé 409                                 | Moyen                       | **Ouvert.** Réponse générique + vérification par e-mail, ou acceptation documentée. Connexion et forgot-password sont uniformes.              |
| R4  | Limiteur d'inscription/IA en mémoire par isolate       | `RateLimiter` dans `http/errors.ts`                                        | Moyen                       | **Partiel.** Les quotas mensuels et les tentatives de connexion sont durables ; le reste ne l'est pas. Pas de Redis/DO dans l'infra.          |
| R5  | DNS rebinding sur les URL sortantes                    | `fetch` du Worker ne résout pas avant l'appel ; gardes sur l'hôte littéral | Moyen                       | **Partiel.** Adresses littérales, métadonnées, ULA, link-local et redirections bloquées ; un nom public résolvant en privé n'est pas détecté. |
| R6  | Redirections du navigateur embarqué                    | `page.goto(assertPublicUrl(...))` valide le départ, pas les hops Chromium  | Moyen                       | **Ouvert.** Interception des requêtes CDP à ajouter.                                                                                          |
| R7  | Secrets de webhooks en clair au repos                  | `workspace_webhooks.secret` nécessaire à HMAC                              | Moyen                       | **Accepté, documenté.** Chiffrement au repos possible avec `AI_KEYS_SECRET` ; rotation à ajouter.                                             |
| R8  | Liens de réinitialisation en clair dans `email_outbox` | `email.ts` journalise le corps complet                                     | Moyen                       | **Ouvert.** Nécessaire à la livraison manuelle ; chiffrer le corps ou ne stocker que le jeton haché + un lien reconstruit.                    |
| R9  | Pas de rétention planifiée                             | entitlement `report_retention_days`, aucun job de purge                    | Élevé (conformité)          | **Ouvert.** Job + politique écrite + preuve sur environnement non productif.                                                                  |
| R10 | Pas de sauvegarde/restauration testée                  | aucun script dans `tooling/`                                               | Critique (perte de données) | **Ouvert.** Procédure D1/Neon + restore drill à documenter et exécuter.                                                                       |
| R11 | Pas de partage client malgré l'entitlement             | `client_sharing` déclaré, aucune route de partage                          | Élevé (vente)               | **Atténué commercialement** : la grille affiche « bientôt ». À implémenter ou retirer.                                                        |
| R12 | Pas d'export PDF/CSV de rapport                        | seuls JSON/JUnit/HTML/texte existent                                       | Moyen                       | **Ouvert.** Le PDF chargé dans le web sert aux pièces jointes du chat, pas aux rapports.                                                      |
| R13 | FAIL/CLEAN non poussés par le CLI                      | aucun `proofcore audit --sync`                                             | Moyen                       | **Ouvert.** Les pages modules restent alimentées par les scans web et l'assistant.                                                            |
| R14 | Aucune métrique de latence/erreur                      | `X-Request-Id` + logs JSON des 5xx seulement                               | Moyen                       | **Partiel.** Corrélation possible, agrégation absente.                                                                                        |
| R15 | Accessibilité non auditée                              | aucun axe-core, aucun test clavier systématique                            | Moyen                       | **Ouvert.** Ne pas revendiquer WCAG 2.2 AA sans audit.                                                                                        |
| R16 | Fournisseurs externes non prouvés                      | aucun credential EmailJS/Resend/SasPay live                                | Élevé (exploitation)        | **NON VÉRIFIÉ.** Le code journalise l'absence ; aucune promesse de livraison réelle.                                                          |

## 2. Risque clos dans cette passe

| ID  | Risque                                                                                                      | Preuve avant                                                                 | Correctif                                                          | Preuve après                                                                 |
| --- | ----------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------- | ------------------------------------------------------------------ | ---------------------------------------------------------------------------- |
| R0  | SSRF via les webhooks sortants : `169.254.169.254`, CGNAT, ULA IPv6, `.svc`, ports de service, redirections | `isValidWebhookUrl` ne bloquait que `127.`, `10.`, `172.16/12`, `192.168/16` | Garde complet + `redirect: "manual"` + revalidation à la livraison | `webhook-guard.test.ts` : 31 tests, dont refus 302 et cible stockée invalide |
| R0b | Inscription mobile abandonnée par saturation du thread principal                                            | E2E Pixel 7 en échec, requête abortée à 6 s                                  | Plafond DPR 1,5 sur le fond WebGL                                  | E2E mobile 19/19                                                             |

## 3. Risques à traiter avant une vente

Ordre recommandé, du plus bloquant au moins bloquant :

1. **R10** sauvegarde/restauration (perte de données = fin de confiance).
2. **R9** rétention (conformité et promesse des plans).
3. **R1/R2** MFA et vérification d'e-mail (identité).
4. **R11/R12** partage client et exports (promesses commerciales).
5. **R4/R5/R6** défenses réseau et débit (robustesse).
6. **R8** secrets d'e-mail au repos.

Aucun de ces points ne doit être coché « fait » sur la seule présence d'une route.
