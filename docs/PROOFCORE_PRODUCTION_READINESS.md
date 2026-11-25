# PROOFCORE — préparation à la production

État : 25 novembre 2026. Aucun déploiement n'a été effectué dans cette passe. Ce
document distingue ce qui est **prêt et prouvé** de ce qui **manque**.

## 1. Chaîne de vérification

```bash
pnpm install          # jamais --force sur ce dépôt
pnpm verify           # lint + typecheck + 811 tests + build web
pnpm test:e2e         # desktop + mobile, base en mémoire
pnpm build            # paquets + site
pnpm cloud:deploy     # préflight + migrations D1 + Worker + build web + Pages
pnpm smoke:deploy     # vérifie le déploiement
```

Preuve du 25 novembre : `pnpm verify` OK ; E2E 36 passés, 2 sautés. Le packaging desktop
(`pnpm app:dist`) n'a pas été rejoué dans cette passe.

## 2. CI

`.github/workflows/ci.yml` exécute lint, typecheck, tests et build sur chaque push
`master` et chaque pull request. `.github/workflows/desktop.yml` et `release.yml`
construisent et lancent les installateurs sur tag. Aucun de ces workflows n'a été
déclenché par cette passe (changements non poussés).

## 3. Configuration

Les variables sont documentées dans `docs/deployment/ENVIRONMENT_VARIABLES.md` :

| Domaine       | Variables                                                    | État                                             |
| ------------- | ------------------------------------------------------------ | ------------------------------------------------ |
| Origines      | `WEB_ORIGIN`, `API_ORIGIN`                                   | requis, validés au démarrage                     |
| Base          | D1 `proofcore` (Worker) / `DATA_PATH` (Node)                 | migrations 0001–0020                             |
| Connaissances | `NEON_DATABASE_URL`                                          | optionnel ; `/health` expose `not_configured`    |
| Paiement      | `SASPAY_API_KEY`, `SASPAY_WEBHOOK_SECRET`, `SASPAY_BASE_URL` | absents → sandbox                                |
| E-mail        | `EMAILJS_*` (4) ou `RESEND_API_KEY`, `MAIL_FROM`             | absents → outbox `unconfigured`                  |
| IA            | `AI_KEYS_SECRET`                                             | absent → stockage de clé refusé                  |
| Releases      | `GITHUB_TOKEN`                                               | optionnel, limite relevée                        |
| Admin         | `ADMIN_EMAILS`                                               | allow-list explicite, pas de « premier inscrit » |

Règle : aucun secret dans le dépôt, le frontend ou les logs. Les secrets Worker se
posent avec `wrangler secret put`.

## 4. Santé et observabilité

- `GET /health` : base (`ok`/`unreachable`), connaissances (`ok`/`not_configured`/
  `unreachable`), fournisseur de paiement, version d'API, heure. Une base Neon absente
  ne se cache pas derrière un `ok`.
- Chaque réponse porte `X-Request-Id` (ou reprend `x-request-id`).
- Les erreurs 5xx sont journalisées en JSON avec `requestId`, chemin, méthode, code et
  message ; pas de jeton ni de mot de passe.
- Pas de métriques agrégées (latence p95, taux d'erreur, profondeur de file), pas de
  tracing distribué. **PARTIEL.**

## 5. Traitements longs

- Un scan web est exécuté dans la requête (ou en flux SSE) ; il n'existe pas de file
  durable avec reprise après redémarrage.
- Un run CLI est exécuté localement puis poussé par le client ; le serveur ne relance
  pas un run interrompu.
- Les sessions de navigateur embarqué sont étatiques et liées à l'isolate.
- L'utilisateur peut quitter la page d'un run CLI et retrouver le résultat dans
  l'historique après upload ; pour un scan web, la réponse est perdue si l'onglet est
  fermé avant la fin.

Statut : **PARTIEL**. Ne pas promettre une progression persistante pour un scan web.

## 6. Sauvegarde, restauration, rétention

| Élément               | État                                                                                                                                     |
| --------------------- | ---------------------------------------------------------------------------------------------------------------------------------------- |
| Sauvegarde D1         | **ABSENT** : aucun script ni plan de sauvegarde dans `tooling/`                                                                          |
| Sauvegarde Neon       | **ABSENT** : repose sur les sauvegardes du fournisseur, non testées ici                                                                  |
| Restauration          | **ABSENT** : aucune procédure écrite, aucun exercice réalisé                                                                             |
| Rétention             | entitlément `report_retention_days` déclaré (7/90/365/730) et `retainedUntil` calculé à l'import de run, mais **aucune purge planifiée** |
| Suppression de compte | implémentée avec confirmation ; supprime les workspaces possédés et les données liées                                                    |

Une donnée sans sauvegarde restaurée n'est pas une donnée de production. Ces trois
points bloquent une exploitation commerciale sérieuse.

## 7. Fournisseurs externes

| Fournisseur     | Code            | Preuve réelle                                                             |
| --------------- | --------------- | ------------------------------------------------------------------------- |
| SasPay sandbox  | oui, adaptateur | tests + E2E checkout/settle                                               |
| SasPay live     | oui, adaptateur | **NON VÉRIFIÉ** — aucun credential                                        |
| EmailJS         | oui             | **NON VÉRIFIÉ** — aucun credential                                        |
| Resend          | oui, repli      | **NON VÉRIFIÉ** — aucun credential                                        |
| Neon            | oui             | **NON VÉRIFIÉ** dans cette passe (URL absente de l'environnement de test) |
| GitHub releases | oui             | non appelé dans cette passe                                               |

Un message n'est jamais annoncé « envoyé » si le fournisseur n'a pas accepté ; il reste
`unconfigured` ou `failed` dans `email_outbox`, avec le motif.

## 8. Checklist de mise en production

### Bloquant

- [ ] Sauvegarde D1/Neon planifiée + restauration testée sur un environnement non
      productif.
- [ ] Purge de rétention planifiée, alignée sur les plans.
- [ ] MFA et vérification d'e-mail obligatoire.
- [ ] Credentials EmailJS/Resend testés (un envoi réel accepté).
- [ ] SasPay live testé avec un paiement de bout en bout et un webhook signé.
- [ ] Rotation des secrets et procédure d'incident.
- [ ] Audit d'accessibilité (axe + clavier) et revue de sécurité externe.

### Important

- [ ] Limitation distribuée pour inscription et IA.
- [ ] Export PDF/CSV et partage client, ou retrait des entitlements.
- [ ] Rétention et partage documentés dans les CGU/confidentialité.
- [ ] Interception des redirections du navigateur embarqué.
- [ ] Métriques de latence/erreur et alerte sur `/health`.

### Déjà prêt

- [x] Lint, types, tests, build reproductibles.
- [x] CI sur push/PR.
- [x] Migrations versionnées et déterministes.
- [x] `/health` honnête sur les dépendances.
- [x] En-têtes de sécurité API et site.
- [x] Journal de livraison e-mail avec statut explicite.
- [x] Webhooks entrants signés, anti-rejeu, vérification serveur avant crédit.

## 9. Déploiement (procédure, non exécutée ici)

1. `pnpm verify` sur le commit à déployer.
2. Poser les secrets Worker (`wrangler secret put …`) dans l'environnement cible.
3. `pnpm cloud:deploy` : préflight, migrations D1, Worker, build web, Pages.
4. `pnpm smoke:deploy` : `/health`, page d'accueil, une route API publique.
5. Vérifier `X-Request-Id` et un 404 inconnu.
6. Créer un compte de recette, parcourir guide → start → scan, puis supprimer le compte.
7. Consigner la version, la date, l'opérateur et les résultats.

Les étapes 1–4 n'ont pas été exécutées dans cette passe : aucun déploiement n'a été
autorisé ni demandé.
