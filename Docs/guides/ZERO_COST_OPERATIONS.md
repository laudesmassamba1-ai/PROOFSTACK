# PROOFCORE — guide d’exploitation à coût zéro

Ce document décrit l’état réel de l’infrastructure, ce qui est gratuit, ce qui ne l’est pas, et les gestes d’exploitation à effectuer. Il complète `docs/deployment/ENVIRONMENT_VARIABLES.md` et `Docs/security/AI_SECURITY.md`.

Dernière vérification : 21 novembre 2026.

---

## 1. Ce qui tourne, et où

| Brique              | Service                   | Rôle                                                      | Coût actuel             |
| ------------------- | ------------------------- | --------------------------------------------------------- | ----------------------- |
| API                 | Cloudflare Workers        | Auth, projets, runs, paiements, audit IA                  | Offre gratuite Workers  |
| Données produit     | Cloudflare D1             | Comptes, sessions, workspaces, projets, runs, facturation | Offre gratuite D1       |
| Intelligence projet | Neon PostgreSQL 18        | Fichiers importés, audits IA de code, métriques           | Offre gratuite Neon     |
| Web                 | Cloudflare Pages + Vercel | Site marketing et application                             | Offres gratuites        |
| E-mail              | EmailJS                   | Vérification, réinitialisation, notifications             | Offre gratuite EmailJS  |
| Paiement            | SasPay                    | Paiements et retraits                                     | Selon le contrat SasPay |
| Bureau              | GitHub Releases           | Installeurs signés                                        | Gratuit                 |

### Séparation volontaire des données

D1 reste la source de vérité pour **l’identité, l’authentification, la facturation, les runs et les audits de pages**. Neon ne reçoit que les **nouvelles données d’intelligence projet** : sources importées, contenu texte des fichiers, audits IA de code et agrégats de métriques.

Cette séparation évite une migration risquée de l’existant. Une suppression de projet efface les lignes Neon correspondantes ; elle ne touche pas aux runs D1 déjà facturés.

### Base Neon créée

- Projet : `proofcore`
- Identifiant : `lively-queen-66947281`
- Organisation : `org-polished-voice-49964556`
- Région : `aws-us-east-2`
- Version : PostgreSQL 18
- Schéma appliqué : `apps/api/neon/schema.sql`

Tables :

- `pc_project_sources` : une source importée (dossier, archive ou fichier unique) par projet.
- `pc_project_files` : contenu texte, chemin, taille et langue de chaque fichier.
- `pc_ai_audits` : audit IA, score, constats JSON, modèle, fournisseur, portée, statut.

La chaîne de connexion n’est **jamais** dans le dépôt. Pour les tests locaux, la lire depuis un fichier hors dépôt ou une variable d’environnement ; pour la production, la poser en secret Cloudflare.

```bash
cd apps/api
pnpm exec wrangler secret put NEON_DATABASE_URL
# Coller la chaîne poolée affichée par Neon, puis Entrée.
```

Pour le développement local, la même valeur va dans `apps/api/.dev.vars` ou dans l’environnement du serveur Node. Le fichier est ignoré par Git.

---

## 2. Prérequis et installation locale

```bash
corepack enable
pnpm install
cp apps/api/.dev.vars.example apps/api/.dev.vars
pnpm typecheck
pnpm test
pnpm --filter @proofcore/web build
```

Variables minimales pour l’API locale :

```dotenv
WEB_ORIGIN=http://localhost:5173
API_ORIGIN=http://localhost:8787
DATA_PATH=.proofstack/api.db
NEON_DATABASE_URL=postgresql://...        # secret, jamais commité
AI_KEYS_SECRET=...                         # 32 octets aléatoires, jamais commité
EMAILJS_SERVICE_ID=
EMAILJS_TEMPLATE_ID=
EMAILJS_PUBLIC_KEY=
EMAILJS_PRIVATE_KEY=
```

Générer `AI_KEYS_SECRET` :

```bash
openssl rand -hex 32
```

Lancer le serveur Node local (API sur `8787`) :

```bash
cd apps/api
node --experimental-sqlite --import tsx/esm src/node.ts
```

Lancer le web :

```bash
pnpm --filter @proofcore/web dev
```

Le web de développement appelle `http://localhost:8787`. En production, il appelle la même origine que la page (`/api/*`), sans URL codée en dur.

---

## 3. EmailJS

EmailJS remplace Resend comme transport prioritaire. Resend reste un repli si `RESEND_API_KEY` existe déjà.

### 3.1 Créer le compte et le service

1. Créer un compte sur [emailjs.com](https://www.emailjs.com/).
2. Ajouter un service e-mail (Gmail, Outlook ou SMTP). Noter le **Service ID**.
3. Créer un template. Le template doit utiliser exactement ces variables :
   - `to_email` : destinataire ;
   - `subject` : objet ;
   - `message` : version texte ;
   - `html` : version HTML ;
   - `from_name` : expéditeur affiché ;
   - `reply_to` : adresse de réponse.
4. Noter le **Template ID**.
5. Dans **Account → General**, copier la **Public Key**.
6. Dans **Account → Security**, activer **Allow EmailJS API for non-browser applications**, puis copier la **Private Key**. Sans cette option, l’appel serveur est refusé.

Le template minimal côté EmailJS :

```html
<div style="font-family:Arial,sans-serif;max-width:560px;margin:auto">
  <h1 style="font-size:20px">{{subject}}</h1>
  <p>{{message}}</p>
  <div>{{html}}</div>
  <p style="color:#777;font-size:12px">{{from_name}} · réponse à {{reply_to}}</p>
</div>
```

### 3.2 Configurer les secrets

Développement, dans `apps/api/.dev.vars` :

```dotenv
EMAILJS_SERVICE_ID=service_xxxxxxx
EMAILJS_TEMPLATE_ID=template_xxxxxxx
EMAILJS_PUBLIC_KEY=xxxxxxxxxxxxxxxxxxxx
EMAILJS_PRIVATE_KEY=xxxxxxxxxxxxxxxxxxxx
```

Production, en secrets Cloudflare :

```bash
cd apps/api
pnpm exec wrangler secret put EMAILJS_SERVICE_ID
pnpm exec wrangler secret put EMAILJS_TEMPLATE_ID
pnpm exec wrangler secret put EMAILJS_PUBLIC_KEY
pnpm exec wrangler secret put EMAILJS_PRIVATE_KEY
```

### 3.3 Comportement du code

`apps/api/src/email.ts` :

- utilise EmailJS si les quatre variables sont présentes ;
- sinon utilise Resend si `RESEND_API_KEY` est présent ;
- sinon journalise `unconfigured` et n’invente pas d’envoi.

L’appel EmailJS est serveur uniquement (`https://api.emailjs.com/api/v1.0/email/send`). La clé privée ne doit jamais atteindre le navigateur. Le quota gratuit EmailJS (200 e-mails/mois au moment de la rédaction) suffit pour les vérifications et réinitialisations d’un lancement privé ; surveiller la consommation dans le tableau de bord.

### 3.4 Tester sans envoyer à un vrai client

Créer une adresse de test, puis déclencher une vérification depuis l’application. Vérifier :

- la réponse HTTP de l’API ;
- l’arrivée dans la boîte de réception et dans les indésirables ;
- les variables du template (objet, texte, HTML) ;
- que le journal Cloudflare ne contient ni clé ni contenu sensible.

Ne pas mettre de secret dans un template EmailJS : les templates sont visibles dans le tableau de bord.

---

## 4. Intelligence projet et audit IA

### 4.1 Import

L’onglet **Audit IA** d’un projet accepte :

- un dossier complet (sélection de dossier) ;
- plusieurs fichiers ;
- un fichier unique.

Le navigateur lit les fichiers en texte, ignore les binaires et les lockfiles, puis envoie le lot à l’API. Limites serveur et client :

- 250 fichiers par import ;
- 200 Ko par fichier ;
- 1,5 million de caractères au total ;
- extensions texte uniquement.

Un import crée une **source**. Les fichiers sont stockés dans Neon, pas dans D1, et ne sont jamais exposés par une URL publique. L’API vérifie l’appartenance au workspace à chaque lecture.

### 4.2 Portée d’un audit

Trois boutons :

- **Auditer tout le projet** : tous les fichiers de la source ;
- **Auditer ce dossier** : chemin sélectionné et ses sous-dossiers ;
- **Auditer ce fichier** : un seul chemin.

L’audit est un vrai appel au fournisseur IA configuré par l’utilisateur dans `/app/ai`. Il ne se contente pas de relire les verdicts des modules déterministes. Le prompt impose :

- de lire tous les fichiers fournis ;
- de citer le fichier et la ligne ;
- de ne signaler qu’un défaut appuyé par le contenu ;
- de rendre un JSON strict (score, résumé, constats, correction).

Les gros projets sont découpés en lots d’environ 45 000 caractères, 12 lots maximum. Les constats sont dédupliqués par fichier + titre, puis limités à 100. Un audit consomme un crédit `monthly_ai_audits`.

### 4.3 Ce que l’IA ne fait pas

- Elle ne remplace pas les modules WORLD, FLOW et EXIT : ceux-ci restent déterministes et reproductibles.
- Elle ne délivre aucun produit et ne modifie aucun accès.
- Elle ne reçoit pas la clé API du fournisseur dans le navigateur : le profil chiffré est lu côté serveur et la requête part du backend.
- Elle ne peut pas appeler un fichier local, un shell ou un serveur MCP depuis cet audit. L’audit de code est une lecture de texte importé.

### 4.4 Résultat et métriques

Chaque audit enregistre : score sur 100, résumé, constats (gravité, fichier, ligne, preuve, correction), nombre de fichiers lus, modèle, fournisseur, portée, date et statut.

L’onglet **Métriques** affiche :

- l’évolution des scores dans le temps (un point dès le premier audit, courbe ensuite) ;
- la répartition des constats par gravité ;
- le nombre de sources, de fichiers et le score moyen.

Aucune courbe n’est fabriquée : sans audit, l’écran l’indique.

---

## 5. Interface

La page projet a été ramenée à trois onglets :

1. **Audit IA** : import, sélection, portée, résultat, historique.
2. **Métriques** : évolution, gravité, couverture.
3. **Exécutions** : runs existants.

Les détails CI, configuration et identifiants sont repliés. Les modules restent accessibles par le bouton **Configurer**. L’objectif est qu’un utilisateur trouve en moins de dix secondes : où importer son code, quoi auditer, ce que l’IA a trouvé.

Règles visuelles du produit :

- noir, blanc cassé, un seul accent de danger ;
- pas de dégradé violet, pas d’illustration générique, pas de grille de cartes identiques ;
- titres éditoriaux, filets fins, chiffres tabulaires ;
- états vides explicites, jamais de faux graphique ;
- responsive : une colonne sous 1024 px.

---

## 6. Déploiement

### API Cloudflare Workers

```bash
cd apps/api
pnpm exec wrangler deploy
```

Secrets à vérifier avant le premier déploiement :

```bash
pnpm exec wrangler secret list
```

Doivent apparaître, selon les fonctions activées :

- `NEON_DATABASE_URL`
- `AI_KEYS_SECRET`
- `EMAILJS_SERVICE_ID`, `EMAILJS_TEMPLATE_ID`, `EMAILJS_PUBLIC_KEY`, `EMAILJS_PRIVATE_KEY`
- `SASPAY_API_KEY`, `SASPAY_WEBHOOK_SECRET` si les paiements réels sont activés
- `ADMIN_EMAILS`

Ne jamais mettre ces valeurs dans `wrangler.toml`, dans le dépôt ou dans une variable `VITE_*`.

### Web

Cloudflare Pages et Vercel déploient le même build statique. Le build ne contient aucune clé. Vérifier après déploiement :

```bash
curl -sS https://proofcore-api.laudesmassamba1.workers.dev/health
```

Puis ouvrir l’application, se connecter, importer un petit dossier et lancer un audit.

### Base Neon

Le schéma est déjà appliqué. Pour le rejouer sur une nouvelle branche :

```bash
psql "$NEON_DATABASE_URL" -f apps/api/neon/schema.sql
```

Le schéma est idempotent (`IF NOT EXISTS`). Ne pas lancer de migration destructive sans sauvegarde.

---

## 7. Sauvegardes et restauration

### D1

```bash
cd apps/api
pnpm exec wrangler d1 export proofcore --remote --output backup-$(date +%F).sql
```

Conserver le fichier hors du dépôt. Tester une restauration sur une base de test, pas sur la production.

### Neon

Neon conserve l’historique de branches et permet une restauration à un instant donné. Avant une opération risquée :

1. créer une branche de sauvegarde depuis la console Neon ;
2. vérifier que les tables `pc_*` sont présentes ;
3. ne supprimer la branche qu’après validation.

Export logique ponctuel :

```bash
pg_dump "$NEON_DATABASE_URL" --no-owner --no-acl -f neon-$(date +%F).sql
```

### Secrets

Les secrets Cloudflare ne sont pas exportables. Tenir un inventaire chiffré (gestionnaire de mots de passe) des noms de variables et de leurs propriétaires, jamais des valeurs dans Git.

---

## 8. Exploitation quotidienne

### Checklist après déploiement

- [ ] `/health` répond `ok`.
- [ ] Connexion et déconnexion fonctionnent.
- [ ] Un projet existant s’ouvre.
- [ ] Un import de 2 fichiers crée une source.
- [ ] Un audit IA renvoie un score et des constats.
- [ ] Les métriques reflètent l’audit.
- [ ] L’e-mail de vérification arrive (EmailJS).
- [ ] Les journaux ne contiennent aucun secret.
- [ ] Le bouton de suppression de projet ne laisse pas de source orpheline.

### Chaque semaine

- Consommation Workers, D1, Neon, Pages et EmailJS.
- Taille de la base Neon et nombre de fichiers importés.
- Erreurs 5xx dans les journaux Cloudflare.
- Audits bloqués en statut `failed` et raison.
- Quota d’e-mails restant.

### Chaque mois

- Export D1 et export Neon.
- Rotation des secrets compromise ou partagée.
- Vérification des accès admin (`ADMIN_EMAILS`).
- Revue des dépendances (`pnpm audit`).
- Test de restauration sur une branche.

---

## 9. Limites gratuites à connaître

Les offres gratuites évoluent. Vérifier les plafonds le jour du lancement.

- **Cloudflare Workers** : requêtes et CPU quotidiens limités ; un audit IA long peut dépasser le temps CPU. Les appels fournisseur sont déjà découpés, mais un projet de 12 lots reste coûteux en temps. Réduire la portée si nécessaire.
- **D1** : taille et lectures/écritures quotidiennes limitées. Les runs et l’auth restent légers ; ne pas y stocker de fichiers.
- **Neon** : stockage et temps de calcul limités ; le scale-to-zero endort la base après inactivité. La première requête peut être lente. Le driver HTTP `@neondatabase/serverless` est utilisé, pas de pool WebSocket dans le Worker.
- **EmailJS** : quota mensuel et débit limités ; un envoi refusé ne doit pas bloquer une inscription.
- **Pages/Vercel** : bande passante et builds limités.
- **SasPay** : les frais et conditions de retrait ne sont pas gratuits. Le mode sandbox ne déplace pas d’argent.

Si un plafond est atteint, la réponse attendue est une erreur explicite, pas une perte silencieuse. Les routes renvoient `429` ou `403` avec un message compréhensible.

---

## 10. Sécurité

### Règles non négociables

- Toutes les requêtes SasPay partent du backend.
- `Authorization: Bearer sk_test_...` en développement, `sk_live_...` en production.
- Montants en chaînes décimales (`"2500.00"`), jamais en flottants.
- `Idempotency-Key` sur les créations de paiement, retraits, transferts et retries.
- Aucun accès produit avant `GET /payments/{payment_id}/verify/` en `SUCCESS`.
- Webhooks vérifiés sur le corps brut, avec `X-Webhook-Signature` et `X-Webhook-Timestamp`, horodatage refusé au-delà de 300 secondes.
- Retraits : IP serveur whitelistée, sinon `403 ip_not_whitelisted`.
- Aucun endpoint, champ, statut ou événement inventé hors spécification OpenAPI.

### Données importées

Le contenu importé peut contenir des secrets malgré les filtres. Ne jamais l’afficher dans les journaux, ne jamais l’inclure dans une réponse d’erreur, et ne jamais l’envoyer à un fournisseur autre que celui choisi par l’utilisateur. Le prompt d’audit rappelle que les fichiers sont des données, pas des instructions.

### Clés IA

`AI_KEYS_SECRET` chiffre les clés fournisseur au repos. Une clé absente ou invalide doit produire `503 ai_not_configured` ou `400`, pas un fallback silencieux vers un modèle gratuit.

---

## 11. Paiements en mode sandbox

Sans `SASPAY_API_KEY` et `SASPAY_WEBHOOK_SECRET`, l’API utilise le fournisseur déterministe `sandbox`. Il permet de tester les parcours sans argent réel.

Pour activer SasPay test :

```dotenv
SASPAY_API_KEY=sk_test_...
SASPAY_WEBHOOK_SECRET=...
SASPAY_BASE_URL=https://sandbox-api.saspay.me/api/v1
```

Créer le webhook dans le tableau de bord SasPay et copier le secret affiché une seule fois. Whitelister l’IP de sortie du serveur avant tout retrait.

Passage en production : nouvelle clé `sk_live_...`, nouveau secret de webhook, test de bout en bout avec un petit montant, vérification `verify` avant livraison. Ne jamais réutiliser une clé de test en production.

---

## 12. Dépannage

| Symptôme                       | Cause probable                     | Action                                            |
| ------------------------------ | ---------------------------------- | ------------------------------------------------- |
| `503 ai_not_configured`        | `AI_KEYS_SECRET` absent            | Poser le secret, redéployer                       |
| `400 ai_not_configured`        | Aucun profil fournisseur           | Configurer `/app/ai`                              |
| `403 ai_audit_quota_exhausted` | Quota du plan épuisé               | Attendre la période ou changer de plan            |
| `404 source_empty`             | Source sans fichier texte          | Réimporter un dossier contenant du texte          |
| `404 scope_empty`              | Chemin mal saisi                   | Vérifier le chemin exact affiché                  |
| Audit `failed`                 | Fournisseur, réseau, JSON invalide | Lire le message, tester la clé, réduire la portée |
| E-mail `unconfigured`          | Variables EmailJS absentes         | Configurer les quatre variables                   |
| E-mail `403` EmailJS           | API non autorisée hors navigateur  | Activer l’option et utiliser la clé privée        |
| Métriques à zéro               | Aucun import ou audit              | Importer puis auditer                             |
| Neon lent au réveil            | Scale-to-zero                      | Première requête normale, ne pas recréer la base  |

Journaux utiles :

```bash
cd apps/api
pnpm exec wrangler tail
```

Ne jamais copier un journal contenant un corps de requête, un cookie ou une clé dans un ticket public.

---

## 13. Légal et vie privée

Avant un lancement public :

- publier des conditions d’utilisation et une politique de confidentialité ;
- documenter la durée de conservation des fichiers importés et des audits ;
- prévoir la suppression d’un projet et des données Neon associées ;
- vérifier les obligations locales de facturation et de TVA ;
- limiter les données personnelles envoyées au fournisseur IA ;
- obtenir le consentement pour les e-mails marketing, distinct des e-mails transactionnels.

Le mode gratuit ne dispense pas de ces obligations. Les secrets et les données clients ne doivent jamais servir à entraîner un modèle sans base légale explicite.

---

## 14. Coût réel de cette configuration

Tant que les plafonds gratuits ne sont pas dépassés, l’hébergement, la base et l’e-mail de transaction coûtent **0 €**. Les seuls coûts variables sont :

- les frais SasPay sur les paiements ;
- un éventuel dépassement de quota Cloudflare, Neon ou EmailJS ;
- un nom de domaine, s’il est acheté ;
- le temps passé à exploiter et modérer.

Surveiller les plafonds avant d’inviter un volume important d’utilisateurs. Un audit IA coûte surtout des tokens chez le fournisseur choisi par l’utilisateur : ce coût n’est pas couvert par l’offre gratuite de PROOFCORE.
