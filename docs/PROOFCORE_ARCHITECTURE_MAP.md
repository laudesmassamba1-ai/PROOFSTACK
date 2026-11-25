# PROOFCORE — carte d'architecture

État : 25 novembre 2026. Cette carte décrit le code livré, pas une architecture cible.

## 1. Applications

| Chemin                                              | Rôle                                                               | Runtime                                           |
| --------------------------------------------------- | ------------------------------------------------------------------ | ------------------------------------------------- |
| `apps/web`                                          | Site marketing, authentification, espace de travail, documentation | React + Vite, servie par Pages/Vercel             |
| `apps/api`                                          | API HTTP, auth, facturation, runs, IA, webhooks, notifications     | Hono ; Cloudflare Worker (D1) ou Node 22 (SQLite) |
| `apps/desktop`                                      | Enveloppe Electron, fenêtre de connexion, sidecar du moteur local  | Electron + Node                                   |
| `packages/cli`                                      | Moteur local, hub TUI, agent local, doctor, packaging              | Node 22                                           |
| `packages/engine`                                   | Exécution des modules, statuts, rapports                           | TypeScript pur                                    |
| `packages/modules/{world,flow,exit}`                | Fixtures et contrôles déterministes                                | TypeScript pur                                    |
| `packages/core`                                     | Scan de page, sécurité URL, temps, argent, Unicode, logs           | TypeScript pur                                    |
| `packages/contracts`                                | Schémas et types partagés (API, billing, statuts, config)          | TypeScript pur                                    |
| `packages/billing`                                  | Plans, entitlements, quotas, checkout, réconciliation, webhooks    | TypeScript pur                                    |
| `packages/adapters/{payments,reporting,browser,ai}` | Fournisseurs et formats                                            | TypeScript                                        |
| `tooling/scripts`                                   | Build, packaging, déploiement, smoke tests                         | Node                                              |

## 2. Flux principaux

### Analyse locale (CLI)

```
proofcore test / world / flow / exit / audit
  → proofcore.config.ts
  → packages/engine + modules
  → navigateur local (CDP) pour FLOW
  → rapport JSON/JUnit/HTML/texte
  → code de sortie 0/1/2/3
```

Aucun appel au site n'est nécessaire. Le CLI peut ensuite pousser un run vers l'API
avec une clé de projet (`POST /v1/runs`, en-tête `Idempotency-Key`).

### Analyse web

```
/app/scan ou /app/start
  → POST /api/v1/audits (ou /audits/stream)
  → assertScannableUrl + fetch avec redirections validées
  → pages/FAIL/CLEAN
  → page_audits (D1/SQLite)
  → UI + corrections + rapports
```

### Assistant IA

```
/app/ai
  → POST /api/v1/ai/chat
  → gate de quota (monthly_ai_audits)
  → profil chiffré (AES-GCM) → fournisseur choisi
  → outils serveur (workspace, runs, findings, code importé, web, scans)
  → réponse streamée + mémoire curatée
```

Le fournisseur est celui du compte. Sans profil, l'IA générative est indisponible ;
les explications déterministes et les rapports restent disponibles.

### Facturation

```
POST /api/v1/checkout/start
  → packages/billing/checkout (idempotence par période)
  → adaptateur (sandbox ou SasPay)
  → POST /api/webhooks/:provider (corps brut, signature, anti-rejeu)
  → vérification serveur avant crédit
  → payment_intents / invoices / entitlements / usage
  → UI billing
```

Une redirection frontend ne crédite jamais un paiement.

## 3. Frontières de confiance

1. **Navigateur → API** : cookie de session HttpOnly, origine vérifiée sur les écritures,
   corps plafonné, schémas Zod stricts.
2. **API → ressources** : chaque route `workspaceId` passe par `requireWorkspace` ;
   l'absence d'adhésion répond 404.
3. **API → réseau** : trois gardes d'URL (scanner, assistant, navigateur embarqué) +
   le garde des webhooks sortants. Toute URL est traitée comme non fiable.
4. **Fournisseur de paiement → API** : signature calculée sur le corps brut, fenêtre
   temporelle, identifiant d'événement unique, vérification serveur du paiement.
5. **Contenu importé → IA** : chaque fichier est encadré par une clôture à nonce ;
   le contenu est une donnée, jamais une instruction système.
6. **Webhook sortant → receiver** : HMAC-SHA256 sur `timestamp.body`, secret montré une
   fois, cible validée à l'enregistrement **et** à la livraison.

## 4. Données

Deux bases, deux responsabilités :

- **D1 / SQLite** (vérité produit) : `users`, `sessions`, `auth_tokens`,
  `auth_attempts`, `workspaces`, `workspace_members`, `workspace_invitations`,
  `projects`, `runs`, `findings`, `reports`, `page_audits`, `audit_finding_states`,
  `api_keys`, `subscriptions`, `payment_intents`, `payment_events`, `invoices`,
  `usage_events`, `ai_profiles`, `ai_conversations`, `workspace_memory`,
  `notifications`, `support_messages`, `email_outbox`, `workspace_webhooks`,
  `audit_logs`, `idempotency_keys`.
- **Neon Postgres** (optionnel) : sources de code importées, fichiers, audits IA de
  code, métriques. Son absence est signalée par `/health` (`knowledge:
  "not_configured"`), jamais masquée.

Migrations : `apps/api/migrations/0001…0020.sql`, appliquées par `apps/api/src/migrate.ts`
et par le script de déploiement.

## 5. Ordre de montage des routes (extrait)

`apps/api/src/app.ts` monte, dans cet ordre :

1. `/health` et middlewares (CORS, en-têtes, contrôle d'origine) ;
2. `/api/auth`, `/api/account`, `/api/auth/device` ;
3. `/api/v1` : plans, releases, contrôles (publics), puis workspace, notifications,
   intelligence projet, IA, audits, navigateur, facturation, admin ;
4. `/v1` (API machine par clé) ;
5. `/api/webhooks/:provider`.

Les routes publiques sont montées **avant** le routeur workspace qui garde `/api/v1/*`,
sinon elles répondraient 401 aux visiteurs anonymes.

## 6. Ce qui n'est pas dans l'architecture

- Pas de file de travaux durable : un scan web est lié à sa requête ; un run CLI est
  poussé par le client. Aucun worker de reprise.
- Pas de cache distribué : les limiteurs mémoire sont par isolate. Les compteurs
  durables passent par la base.
- Pas de bus d'événements : notifications, webhooks et automatisations sont appelés
  dans le chemin de la requête (ou `waitUntil` quand disponible).
- Pas de moteur de recherche : les listes sont paginées, pas indexées en plein-texte.
