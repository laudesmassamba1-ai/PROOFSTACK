# Ce que seul l'opérateur peut fournir

Tout le reste est déjà construit et vérifié. Ce document liste, sans détour, les
identifiants et informations qui ne peuvent pas être inventés : chacun a son emplacement
prêt dans le code et une valeur par défaut honnête quand il manque.

Le principe tenu partout : **le produit ne prétend jamais que l'étape a eu lieu**. Sans
fournisseur d'e-mail, le message reste dans une file avec un statut explicite et
l'interface le dit ; sans clé SaaS de paiement, le mode sandbox est utilisé et affiché
comme tel.

---

## The in-app browser (`browse_url`)

The assistant can open a page in a real browser and show the screenshot in the chat. A
Worker cannot run Chromium, so this needs Cloudflare Browser Rendering. Two ways, in order
of preference:

**1. The binding (configured in this repository, nothing to supply).**

```toml
# apps/api/wrangler.toml
[browser]
binding = "BROWSER"
```

The account's own compute renders the page; there is no API token to create, leak or
rotate, and `wrangler deploy` reports `env.BROWSER → Browser`. Verified live: example.com
returns `basis: rendered_dom` with a 76 KB screenshot.

**2. The REST API, for a deployment without the binding.**

```bash
wrangler secret put CF_ACCOUNT_ID      # dashboard → Workers & Pages → Account ID
wrangler secret put CF_BROWSER_TOKEN   # My Profile → API Tokens,
                                       #   Account → Browser Rendering → Edit
```

Without them the tool still answers, and it says what it did: `basis: server_html` — the
page as fetched, JavaScript not executed. The chat shows the badge "HTML serveur" instead of
"rendu réel", so a single-page app's empty shell is never presented as the real page.

## 1. E-mail transactionnel — récupération de compte

Sans cela : pas de réinitialisation de mot de passe livrée, pas de vérification
d'adresse. Le mécanisme fonctionne (jeton, expiration, usage unique, journal), mais
aucun message ne part.

| Variable         | Obligatoire | Rôle                                                                  |
| ---------------- | ----------- | --------------------------------------------------------------------- |
| `RESEND_API_KEY` | pour livrer | Clé API Resend (`re_…`).                                              |
| `MAIL_FROM`      | recommandé  | Expéditeur vérifié, ex. `PROOFCORE <no-reply@tondomaine.com>`.        |
| `SUPPORT_EMAIL`  | recommandé  | Adresse affichée pour l'assistance et destinataire des notifications. |

Mise en place (5 minutes) :

1. Créer un compte sur resend.com (offre gratuite : 3 000 messages/mois).
2. Vérifier le domaine d'envoi (enregistrements DNS fournis par Resend).
3. Créer une clé API avec la permission `send`.
4. Publier les secrets :

```bash
cd apps/api
npx wrangler secret put RESEND_API_KEY     # colle la clé quand demandé
npx wrangler secret put MAIL_FROM
npx wrangler secret put SUPPORT_EMAIL
```

Vérification : `/api/auth/session` renvoie `emailConfigured: true` via
`GET /api/account/delivery-status` (réservé à l'opérateur), et la page
« Mot de passe oublié » affiche « Vérifie ta boîte de réception » au lieu de l'alerte
« aucun e-mail n'a pu être envoyé ».

Sans clé, la console d'administration permet de lire la file et de remettre un lien à la
main : rien n'est perdu.

---

## 2. Pages légales — informations de l'entité

Les pages existent : `/legal/terms`, `/legal/privacy`, `/legal/cookies`. Elles décrivent
le comportement réel du logiciel (chiffrement des clés, absence d'analytics tiers, durées
de conservation, cookie `ps_session`).

Cinq valeurs restent à renseigner, affichées comme emplacements dans les pages :

| Emplacement          | Valeur attendue                                          |
| -------------------- | -------------------------------------------------------- |
| `LEGAL_ENTITY_NAME`  | raison sociale exacte                                    |
| `LEGAL_REGISTRATION` | forme juridique + numéro d'immatriculation (RCCM/SIREN…) |
| `LEGAL_ADDRESS`      | adresse du siège                                         |
| `LEGAL_JURISDICTION` | juridiction compétente                                   |
| `LEGAL_DPO_CONTACT`  | contact pour les demandes de données                     |

Fichier à modifier : `apps/web/src/pages/Legal.tsx` (constante `PLACEHOLDERS` + les
`<em>[…]</em>` correspondants). Aucune de ces valeurs n'est déductible du code : les
inventer serait publier une information juridique fausse.

---

## 3. Paiements réels — SasPay

| Variable                | Obligatoire    | Rôle                                                                       |
| ----------------------- | -------------- | -------------------------------------------------------------------------- |
| `SASPAY_API_KEY`        | pour encaisser | `sk_test_…` (bac à sable) ou `sk_live_…`.                                  |
| `SASPAY_WEBHOOK_SECRET` | pour encaisser | Secret affiché une fois à la création du webhook dans le dashboard SasPay. |

Sans clé : fournisseur `sandbox`, affiché comme tel, aucun débit réel. Les tests
automatisés n'effectuent jamais de paiement réel.

À savoir (vérifié dans la spécification OpenAPI) : SasPay n'expose **aucune** route de
remboursement ni d'abonnement récurrent. L'adaptateur ne les invente pas ; les
remboursements sont administratifs, et les périodes payées sont prépayées.

---

## 4. Modèles d'IA — clé de chiffrement

| Variable         | Obligatoire                  | Rôle                                                                                                         |
| ---------------- | ---------------------------- | ------------------------------------------------------------------------------------------------------------ |
| `AI_KEYS_SECRET` | oui, pour stocker une clé IA | Clé maître ≥ 32 caractères ; les clés fournisseurs sont chiffrées AES-256-GCM sous une clé dérivée par HKDF. |

Déjà en place sur le Worker. Sans elle, le stockage de clé est **refusé** (503) plutôt que
d'écrire en clair.

La clé du fournisseur choisie par l'utilisateur (Groq, OpenAI, Claude…) est saisie par
lui dans l'interface, jamais par l'opérateur.

---

## 5. Intégration continue — GitHub Actions

Aucun secret n'est nécessaire : `.github/workflows/ci.yml` lance lint, typecheck, tests,
build, un test de démarrage du CLI, et la suite e2e sur chaque push. Les secrets du dépôt
(`NPM_TOKEN`) ne servent qu'à publier le paquet, jamais à tester.

---

## 6. Rendu headless — audits CLEAN exacts

| Variable               | Obligatoire        | Rôle                                                     |
| ---------------------- | ------------------ | -------------------------------------------------------- |
| `PROOFCORE_RENDER_URL` | pour noter les SPA | Endpoint qui renvoie `{ "html": "…" }` après rendu réel. |

Sans ce service, un audit CLEAN sur une application cliente (React, Vue, Svelte) mesure le
HTML servi : la note est calculée, mais **aucune lettre n'est délivrée** et le rapport
l'indique (« basis: served HTML only »). C'est volontaire : une note sur une coquille vide
serait un chiffre inventé.

Le service attendu est trivial (Playwright + un POST). Il n'est pas inclus ici parce qu'il
demande un runtime avec navigateur, donc un hébergement séparé — décision d'opérateur, pas
de développeur.

---

## Récapitulatif

| Fonction                           | Sans identifiant                               | Avec identifiant           |
| ---------------------------------- | ---------------------------------------------- | -------------------------- |
| Connexion, espaces, runs, rapports | fonctionne                                     | —                          |
| Réinitialisation de mot de passe   | jeton créé, message en file, interface honnête | e-mail livré               |
| Vérification d'adresse             | idem                                           | e-mail livré               |
| Assistance                         | message enregistré avec référence              | notification à l'opérateur |
| Pages légales                      | publiées, 5 emplacements visibles              | prêtes à publier           |
| Paiement                           | mode sandbox explicite                         | encaissement réel          |
| Assistant IA                       | refuse proprement (503)                        | fonctionne                 |
| Audits FAIL                        | fonctionne (HTTP)                              | —                          |
| Audits CLEAN sur SPA               | note HTML, aucune lettre                       | note de l'interface rendue |
