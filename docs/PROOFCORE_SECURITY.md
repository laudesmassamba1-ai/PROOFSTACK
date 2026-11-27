# PROOFCORE — sécurité

État : 25 novembre 2026. Chaque contrôle renvoie au code et, quand il existe, au test
exécuté. Une absence est nommée.

## 1. Authentification et sessions

| Contrôle                          | Implémentation                                                                                                                                                                                               | Preuve                                                                       |
| --------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ---------------------------------------------------------------------------- |
| Hachage des mots de passe         | PBKDF2-HMAC-SHA256, 100 000 itérations (plafond Workers), sel 16 octets, paramètres relus du hash                                                                                                            | `auth.ts`, `auth.test.ts`                                                    |
| Comparaison                       | constant-time sur le hash dérivé                                                                                                                                                                             | `auth.ts`                                                                    |
| Politique de mot de passe         | 10–200 caractères ; pas de complexité ni de liste de mots de passe compromis                                                                                                                                 | `routes/auth.ts` (schéma)                                                    |
| Session                           | 32 octets aléatoires, cookie `ps_session` HttpOnly, SameSite=Lax, Secure en production/https, TTL 7 jours                                                                                                    | `auth.ts`, E2E reload                                                        |
| Stockage de session               | seul le SHA-256 du jeton est stocké                                                                                                                                                                          | `sessions.token_hash`                                                        |
| Expiration                        | vérifiée à chaque requête ; session expirée supprimée                                                                                                                                                        | `guards.ts`                                                                  |
| Révocation                        | liste des sessions, suppression par le propriétaire, « autres sessions » fermées au changement de mot de passe                                                                                               | `account-selfservice.test.ts`                                                |
| Réinitialisation                  | jeton 32 octets, hash stocké, TTL 1 h, usage unique (UPDATE conditionnel), tous les liens précédents invalidés, sessions fermées                                                                             | `account.test.ts`                                                            |
| Vérification d'e-mail             | jeton 24 h, hash stocké, usage unique, marque `email_verified_at`                                                                                                                                            | `account.test.ts`                                                            |
| Énumération                       | connexion et mot de passe oublié répondent de façon uniforme ; inscription : `email_taken` 409 (énumérable)                                                                                                  | `auth.test.ts`, `account.test.ts`                                            |
| Tentatives répétées               | compteurs durables D1 : connexion (8/40 échecs par e-mail/adresse sur 15 min), mot de passe oublié, inscription (20/h par adresse), support (5/h) ; le limiteur mémoire de connexion reste un premier filtre | `lockout.test.ts`, `signup-rate-limit.test.ts`, `support-rate-limit.test.ts` |
| MFA                               | **absent**                                                                                                                                                                                                   | —                                                                            |
| OAuth                             | **absent**                                                                                                                                                                                                   | —                                                                            |
| Vérification d'e-mail obligatoire | **non** ; la connexion ne l'exige pas                                                                                                                                                                        | —                                                                            |

## 2. Cookies, CSRF, origine

- Cookie de session : `HttpOnly`, `SameSite=Lax`, `Secure` si l'origine est https ou si
  l'environnement est production. Pas de préfixe `__Host-`.
- Double-submit CSRF : cookie `ps_csrf` lisible par l'application (jamais `HttpOnly`),
  `SameSite=Lax`, `Secure` en production, émis avec la session et tourné avec elle au
  changement de mot de passe. Les écritures de compte (`/api/account/*`) et la
  déconnexion n'acceptent un cookie de session que si `x-csrf-token` répète ce cookie ;
  sinon 403 `csrf_token_required` ou `csrf_token_invalid`.
- La règle est déclenchée par la présence des deux cookies : un client natif (CLI,
  machine) qui s'authentifie par `Authorization` n'est pas concerné, et une session
  antérieure au déploiement reçoit `ps_csrf` à sa prochaine sonde
  `/api/auth/session`. Les routes de scan et d'IA restent protégées par `Origin` +
  `Sec-Fetch-Site` seuls ; leur migration est une étape séparée.
- Écritures cookie : contrôle d'origine sur `/api/*` (hors `/api/webhooks/*`), monté sur
  toutes les méthodes non-GET/HEAD/OPTIONS. Une origine inconnue répond 403
  `cross_origin_denied`.
- CORS : une seule liste d'origines, `Access-Control-Allow-Credentials: true`, méthodes
  et en-têtes énumérés.

## 3. Isolation des comptes

- Toute route avec `workspaceId` appelle `requireWorkspace` (rôle vérifié).
- Un workspace non membre répond **404**, jamais 403, pour ne pas confirmer l'existence
  d'un identifiant.
- Les lectures de runs, findings, rapports, audits, sources, mémoire, notifications et
  factures filtrent par `workspace_id`.
- Les conversations IA sont liées à `(user_id, workspace_id)` ; une conversation d'un
  autre utilisateur répond 404 même avec l'identifiant exact.
- Preuve : `apps/api/test/tenant-isolation.test.ts` — 22 lectures et 8 écritures
  inter-comptes, accès à un projet étranger via son propre workspace, conversations IA,
  et refus sans session.

## 4. Validation et injections

- Corps JSON : `content-length` puis taille sérialisée plafonnées à 2 Mo ; webhooks
  plafonnés à 256 Ko sur l'en-tête **et** le corps réel.
- Schémas Zod `.strict()` sur les entrées ; les champs inconnus sont refusés.
- SQL : requêtes préparées avec paramètres liés (`prepare(...).bind(...)`) dans le
  store ; aucune concaténation de valeur utilisateur n'a été trouvée dans les fichiers
  inspectés.
- XSS : React échappe le texte ; l'API ne rend jamais de HTML (`default-src 'none'`) ;
  le rapport HTML de l'API échappe module, nom, statut et identifiant (`escapeHtml`).
- Traversée de répertoire : `cleanPath` sur les imports de code ; test
  `read-repo.test.ts`.
- Injection de commande : les commandes du CLI/MCP sont des tableaux argv avec
  `shell: false` (règle AGENTS) ; aucun outil cloud n'exécute de commande.
- Désérialisation : `JSON.parse` sur des payloads stockés, avec `try/catch` et retour
  « non configuré » plutôt qu'un crash.

## 5. SSRF et réseau sortant

Trois gardes distinctes, plus une pour les webhooks :

| Surface                                            | Contrôle                                                                                                            |
| -------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------- |
| Scanner de page                                    | `assertScannableUrl` : http(s), hôte public, pas de privé/link-local/CGNAT/ULA, redirections revalidées une par une |
| Assistant (`fetch_web`, `probe_url`, `browse_url`) | `assertPublicUrl` : hôte public, plages réservées, ports autorisés, redirections revalidées                         |
| Navigateur embarqué                                | garde d'URL initiale ; redirections Chromium **non interceptées**                                                   |
| Webhooks sortants                                  | garde complet + refus des redirections + revalidation à la livraison                                                |

Correctif de cette passe : `apps/api/src/outbound.ts` refuse désormais
`169.254/16`, `100.64/10`, `10/8`, `172.16/12`, `192.168/16`, `0/8`, les TEST-NET,
le multicast, les ULA/link-local IPv6, les IPv4 mappées, les identifiants dans l'URL,
les suffixes `.local`/`.internal`/`.svc`/`.cluster.local`, les noms de métadonnées, et
les ports de service en production. La livraison utilise `redirect: "manual"` et
marque un 3xx comme échec visible.

Preuve : `apps/api/test/webhook-guard.test.ts` — 31 tests.

Limite : pas de résolution DNS avant `fetch` dans un Worker ; un nom public qui résout
vers une adresse privée n'est pas détecté. Un correctif Node-only ne couvrirait pas le
Worker.

## 6. Secrets

| Secret                        | Stockage                                           | Exposition                                            |
| ----------------------------- | -------------------------------------------------- | ----------------------------------------------------- |
| Clé fournisseur IA            | AES-256-GCM, HKDF-SHA256, nonce par enregistrement | jamais renvoyée ; fingerprint seul                    |
| Secret de webhook             | clair en base (nécessaire à HMAC)                  | montré une fois à la création, préfixe ensuite        |
| Jeton de session              | hash SHA-256                                       | jamais renvoyé                                        |
| Jeton de reset / vérification | hash SHA-256                                       | lien dans l'e-mail ; corps stocké dans `email_outbox` |
| Clé API projet                | hash SHA-256                                       | montré une fois                                       |
| Clé SasPay                    | variable d'environnement                           | jamais dans le frontend ni les logs                   |

Points ouverts : le secret de webhook et le lien de reset sont en clair au repos. Une
fuite de base donnerait un secret de signature et des liens de reset valides jusqu'à
leur expiration. À chiffrer ou à réduire (corps d'e-mail chiffré, jeton haché + lien
reconstruit).

## 7. Webhooks entrants (paiement)

- Signature vérifiée sur le **corps brut**, avant tout parsing.
- Fenêtre temporelle de 300 s, rejet du rejeu par identifiant d'événement unique.
- Le corps ne décide jamais du statut : une vérification serveur du paiement est
  effectuée avant crédit.
- Un doublon répond 200 `duplicate: true` sans changer l'état.
- Un échec de traitement répond 500 pour déclencher un réessai.
- Taille plafonnée à 256 Ko, timeout de livraison 4 s.
- Preuve : `packages/billing/src/webhooks.ts`, `webhooks.test.ts`, `api.test.ts`.

## 8. Agent IA

Voir `docs/PROOFCORE_AI_ARCHITECTURE.md`. Résumé : contexte filtré par workspace,
contenus importés encadrés par un nonce, arguments validés, pas d'exécution de
commande, URLs gardées. Trois écritures existent, toutes bornées : `remember` (un fait
de mémoire), `module_configure` (patch Zod réel, `confirm: true`, refus des blocages de
`validateConfig`, audit `source: "assistant"`) et `module_run` (quota vérifié avant
lancement, hôte du projet seulement pour FAIL/CLEAN, run stocké et audité). Aucune de
ces écritures ne peut changer de tenant, exécuter un fichier ou une commande.

## 9. En-têtes et surface HTTP

L'API envoie `Content-Security-Policy: default-src 'none'; frame-ancestors 'none'`,
`X-Frame-Options: DENY`, `Referrer-Policy: no-referrer`, `nosniff`,
`Cross-Origin-Resource-Policy`, `Permissions-Policy`, HSTS. Le site a sa CSP, ses
en-têtes et `COOP` via `_headers`/`vercel.json`. `Cache-Control: no-store` sur l'API.

## 10. Ce qui reste à faire avant production

1. MFA et vérification d'e-mail obligatoire.
2. Chiffrement des secrets de webhook et des corps d'e-mail au repos.
3. Rétention planifiée et sauvegarde/restauration testées.
4. Interception des redirections du navigateur embarqué.
5. Limitation distribuée pour l'inscription et l'IA.
6. Audit d'accessibilité et de sécurité externe (FAIL n'est pas une certification).
7. Rotation des secrets et procédure d'incident.
