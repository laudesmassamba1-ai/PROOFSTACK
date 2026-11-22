# Ce qu'il me faut de toi pour terminer PROOFSTACK

Ce document est la liste unique. Chaque entrée dit **ce que ça débloque**, **où le trouver
exactement**, **le format attendu**, **la commande qui l'installe** et **la vérification qui
prouve que c'est branché**. Une case sans vérification n'est pas une case.

État au 22 novembre 2026, vérifié sur la production :

| Déjà en place                                        | Preuve                                                       |
| ---------------------------------------------------- | ------------------------------------------------------------ |
| Cloudflare (Workers, Pages, Browser Rendering, D1)   | `npx wrangler whoami` → compte `Laudesmassamba1@gmail.com`    |
| Vercel (site)                                        | `npx vercel whoami` → `laudesmassamba1-ai`                    |
| Neon (fichiers importés + audits IA de code)         | `GET /health` → `knowledge: "ok"` après le déploiement        |
| `AI_KEYS_SECRET` (chiffrement des clés fournisseurs) | `wrangler secret list`                                        |
| `ADMIN_EMAILS` (console `/app/admin`)                | `wrangler secret list`                                        |
| Rendu de navigateur pour l'assistant (`browse_url`)  | binding `[browser]` dans `apps/api/wrangler.toml`             |

Ce qui reste manque, et rien de tout cela ne peut être inventé : un paiement, une adresse
d'expédition ou une raison sociale faux valent moins qu'une case vide.

---

## Comment me donner un secret (ne l'écris jamais dans le chat)

Trois voies, de la meilleure à la moins bonne. Aucune ne demande de me faire confiance.

**1. Tu l'installes toi-même (recommandé).** Tu lances la commande, tu colles la valeur
quand le terminal la demande, elle ne passe ni par la conversation ni par un fichier :

```bash
cd /home/laudes/Documents/PROOFSTACK/apps/api
npx wrangler secret put SASPAY_API_KEY
```

**2. Tu me donnes un chemin.** Tu écris la valeur dans un fichier lisible par toi seul et tu
me donnes le chemin, pas le contenu :

```bash
umask 077 && printf '%s' 'la-valeur' > ~/.secrets/proofstack-saspay.key
chmod 600 ~/.secrets/proofstack-saspay.key
```

Je lis le fichier, j'installe le secret par `stdin` (jamais en argument de commande, jamais
affiché), et je ne le recopie nulle part.

**3. Tu me donnes le secret dans le chat — à éviter.** Il reste dans l'historique de la
conversation et dans les journaux du fournisseur de modèle. Si tu le fais quand même, change
la clé après.

---

## Priorité 0 — sans ça, un client réel ne peut pas payer ni récupérer son compte

### 1. Paiements SasPay

| Ce qu'il faut             | Où le trouver                                                                                     |
| ------------------------- | ------------------------------------------------------------------------------------------------- |
| `SASPAY_API_KEY`          | Dashboard SasPay → **API keys** → la clé `sk_live_…` (ou `sk_test_…` pour tester sans encaisser)    |
| `SASPAY_WEBHOOK_SECRET`   | Dashboard SasPay → **Webhooks** → créer `https://proofcore-api.laudesmassamba1.workers.dev/api/webhooks/saspay` → le secret n'est affiché qu'une fois |

Format : `sk_live_` + 32+ caractères ; le secret webhook est une chaîne opaque.

```bash
cd /home/laudes/Documents/PROOFSTACK/apps/api
npx wrangler secret put SASPAY_API_KEY
npx wrangler secret put SASPAY_WEBHOOK_SECRET
```

Vérification : `curl -s https://proofcore-api.laudesmassamba1.workers.dev/health` doit
répondre `"payments":{"provider":"saspay","configured":true}`.

Sans ces deux valeurs : fournisseur `sandbox`, affiché comme tel dans `/app/billing`, aucun
débit réel. Les boutons fonctionnent, l'argent ne circule pas.

Deux limites de SasPay, vérifiées dans sa spécification OpenAPI et déjà reflétées dans le
code : pas de route de remboursement, pas d'abonnement récurrent. Les remboursements sont
administratifs et les périodes sont prépayées. Ce n'est pas un choix du produit.

### 2. E-mail transactionnel

Un seul fournisseur suffit. EmailJS est prioritaire si les quatre valeurs sont là ; Resend
sert de repli.

| Ce qu'il faut                                   | Où le trouver                                                                        |
| ----------------------------------------------- | ------------------------------------------------------------------------------------ |
| `EMAILJS_SERVICE_ID`                            | emailjs.com → **Email Services** → ton service                                       |
| `EMAILJS_TEMPLATE_ID`                           | → **Email Templates** → le modèle (il doit lier `to_email`, `subject`, `message`, `html`, `from_name`, `reply_to`) |
| `EMAILJS_PUBLIC_KEY`                            | → **Account** → General → *API keys* → Public Key                                    |
| `EMAILJS_PRIVATE_KEY`                           | même écran → Private Key (exige « Allow EmailJS API for non-browser applications »)   |
| `RESEND_API_KEY` (repli)                        | resend.com → **API Keys** → créer avec la permission `send`                          |
| `MAIL_FROM`                                     | une adresse d'un domaine **vérifié** chez le fournisseur, ex. `PROOFSTACK <no-reply@tondomaine.com>` |
| `SUPPORT_EMAIL`                                 | l'adresse où tu veux recevoir les demandes d'assistance                              |

```bash
cd /home/laudes/Documents/PROOFSTACK/apps/api
npx wrangler secret put EMAILJS_SERVICE_ID
npx wrangler secret put EMAILJS_TEMPLATE_ID
npx wrangler secret put EMAILJS_PUBLIC_KEY
npx wrangler secret put EMAILJS_PRIVATE_KEY
npx wrangler secret put SUPPORT_EMAIL
```

Vérification : une session d'opérateur, puis
`curl -s -b cookies.txt https://proofcore-api.laudesmassamba1.workers.dev/api/account/delivery-status`
doit répondre `"emailConfigured": true`. Ensuite, un vrai « mot de passe oublié » doit
arriver dans la boîte.

Sans fournisseur : le jeton est créé, le message reste dans `email_outbox` avec le statut
`unconfigured`, la page le dit, et l'opérateur peut remettre le lien à la main depuis
`/app/admin`. Rien n'est perdu, mais rien n'est automatique.

---

## Priorité 1 — l'app est utilisable, il manque la finition

### 3. Jeton GitHub pour le flux des versions

| Ce qu'il faut | Où le trouver                                                                                     |
| ------------- | ------------------------------------------------------------------------------------------------- |
| `GITHUB_TOKEN` | github.com → **Settings** → Developer settings → **Personal access tokens (fine-grained)** → *Generate new token* → accès en lecture seule au dépôt `laudesmassamba1-ai/PROOFSTACK`, permission **Contents: Read** |

```bash
cd /home/laudes/Documents/PROOFSTACK/apps/api
npx wrangler secret put GITHUB_TOKEN
```

Vérification : `curl -s -o /dev/null -w '%{http_code}\n' https://proofcore-api.laudesmassamba1.workers.dev/api/v1/releases/latest`
doit rester `200` même après plusieurs appels d'affilée. Sans jeton, GitHub plafonne à
60 appels par heure **par IP de sortie** — et les Workers partagent les leurs, donc la page
`/download` finit par servir un instantané au lieu du direct. Le jeton ne va jamais au
navigateur.

### 4. Informations légales (5 valeurs, dans le code)

Les pages `/legal/terms`, `/legal/privacy`, `/legal/cookies` existent et décrivent le
comportement réel du logiciel. Cinq valeurs y sont affichées comme des emplacements
visibles : les inventer serait publier une information juridique fausse.

| Emplacement          | Ce que je dois recevoir                                  |
| -------------------- | -------------------------------------------------------- |
| `LEGAL_ENTITY_NAME`  | la raison sociale exacte                                 |
| `LEGAL_REGISTRATION` | forme juridique + numéro d'immatriculation (RCCM, SIREN…) |
| `LEGAL_ADDRESS`      | adresse du siège                                         |
| `LEGAL_JURISDICTION` | juridiction compétente                                   |
| `LEGAL_DPO_CONTACT`  | contact pour les demandes de données personnelles        |

Ce sont des textes, pas des secrets : tu peux me les donner dans la conversation. Je les
place dans `apps/web/src/pages/Legal.tsx` (constante `PLACEHOLDERS`).

Vérification : `/legal/privacy` ne contient plus aucun `[…]`.

### 5. Nom de domaine (décision + DNS)

Aujourd'hui : `https://proofstack-01z.pages.dev` (Cloudflare) et
`https://proofstack-iota.vercel.app`. Fonctionnels, mais un client sérieux clique sur un
domaine à toi.

| Ce que je dois recevoir | Où le trouver                                                                |
| ----------------------- | ---------------------------------------------------------------------------- |
| Le domaine exact        | chez ton registrar (Namecheap, OVH, Cloudflare Registrar…)                    |
| Accès DNS               | Cloudflare → **Websites** → *Add a site* → remplacer les serveurs DNS chez le registrar |

Ensuite, pour moi : `WEB_ORIGIN` et `API_ORIGIN` dans `apps/api/wrangler.toml`, un domaine
personnalisé sur le projet Pages, un domaine sur le projet Vercel, et un certificat géré par
les deux plateformes. Rien à acheter en plus que le domaine lui-même.

Vérification : `curl -sI https://tondomaine.com` → `200` + `strict-transport-security`.

---

## Priorité 2 — confort et confiance, à faire quand le reste tourne

### 6. Signature des installeurs Windows et macOS

Sans certificat, Windows affiche « Éditeur inconnu » et macOS refuse le premier lancement
sans clic droit → Ouvrir. Les installeurs fonctionnent : ils font peur.

| Ce qu'il faut            | Où le trouver                                                                                   | Coût indicatif |
| ------------------------ | ----------------------------------------------------------------------------------------------- | -------------- |
| Certificat Windows       | un certificateur (Sectigo, DigiCert…) pour un **OV/EV code signing** ; EV supprime SmartScreen plus vite | 200–400 €/an   |
| Identité Apple Developer | developer.apple.com → **Programs** → Developer Program ; puis un certificat *Developer ID Application* + *Developer ID Installer* | 99 €/an        |

Une fois le certificat obtenu, je branche `CSC_LINK` / `CSC_KEY_PASSWORD` (Windows) et
`APPLE_ID` / `APPLE_APP_SPECIFIC_PASSWORD` / `APPLE_TEAM_ID` dans les secrets GitHub du
dépôt, et `.github/workflows/release.yml` signe puis notarise.

Vérification : `signtool verify /pa installer.exe` (Windows), `codesign -dv --verbose=4`
(macOS).

### 7. Rendu réel pour les audits CLEAN sur application cliente

`PROOFCORE_RENDER_URL` attend un service qui répond `{ "html": "…" }` après avoir exécuté le
JavaScript. Il ne sert qu'au CLI, sur ta machine, pour noter une SPA à sa vraie interface.

Sans lui, un audit CLEAN sur une application React mesure le HTML servi : la note est
calculée, aucune lettre n'est délivrée, et le rapport écrit « basis: served HTML only ».
C'est volontaire — une note sur une coquille vide serait un chiffre inventé.

Ce service demande un hébergement avec navigateur (Playwright + un POST). Le Worker ne peut
pas le faire ; Cloudflare Browser Rendering pourrait, avec un petit Worker dédié. Dis-moi si
tu veux que je l'écrive : c'est une demi-journée, et ça supprime la dernière note partielle.

### 8. Automatisation n8n (facultatif)

`N8N_WEBHOOK_URL` + `N8N_WEBHOOK_SECRET` reçoivent les événements de paiement vérifiés.
Sans eux, rien ne casse : c'est un confort d'exploitation, jamais une autorité de paiement.

---

## Une décision, pas un identifiant : la clé IA

L'assistant fonctionne aujourd'hui en **BYOK** : chaque compte saisit sa propre clé
fournisseur dans `/app/ai`, chiffrée en AES-256-GCM avec `AI_KEYS_SECRET`. Personne ne paie
les jetons d'un autre, et une fuite de clé ne touche qu'un compte.

L'alternative est une clé d'opérateur partagée : l'assistant marche dès l'inscription, mais
tu paies chaque requête de chaque client, et un compte gratuit peut consommer sans limite
autre que le quota de plan.

Dis-moi laquelle tu veux. Si c'est la seconde, il me faut une clé fournisseur (Groq, OpenAI,
Anthropic, OpenRouter) et je l'installe comme secret Worker ; le code lit déjà une clé
d'opérateur quand elle existe.

---

## Récapitulatif

| Fonction                                | Sans identifiant                                | Avec identifiant           | Priorité |
| --------------------------------------- | ----------------------------------------------- | -------------------------- | -------- |
| Connexion, espaces, runs, scans de site | fonctionne                                      | —                          | —        |
| Paiement                                | sandbox explicite, aucun débit                  | encaissement réel          | **P0**   |
| Réinitialisation de mot de passe        | jeton créé, message en file, interface honnête  | e-mail livré               | **P0**   |
| Fichiers de projet + audits IA de code  | `503 neon_not_configured` (déjà branché, vérifié) | fonctionne                 | ✔        |
| Assistant IA                            | fonctionne avec la clé du compte (BYOK)         | —                          | ✔        |
| Flux des versions sur `/download`       | instantané, parfois périmé                      | direct, 5 000 appels/h     | P1       |
| Pages légales                           | publiées, 5 emplacements visibles               | prêtes à publier           | P1       |
| Domaine                                 | `.pages.dev` + `.vercel.app`                    | domaine à toi              | P1       |
| Installeurs Windows/macOS               | fonctionnent, avertissement de l'OS             | signés, silencieux         | P2       |
| Audits CLEAN sur SPA (CLI)              | note HTML, aucune lettre                        | note de l'interface rendue | P2       |

---

## Ce que je fais dès que j'ai une ligne

1. J'installe le secret (`wrangler secret put` par `stdin`), je ne l'écris nulle part.
2. Je relance `node tooling/scripts/deploy-cloudflare.mjs` (API puis site, migrations D1,
   puis smoke) et `npx vercel --prod`.
3. Je vérifie par la commande de la section concernée, et je te donne la sortie brute.
4. J'ajoute la ligne à `APP-MEMORY.md` pour que le prochain passage ne la redécouvre pas.
