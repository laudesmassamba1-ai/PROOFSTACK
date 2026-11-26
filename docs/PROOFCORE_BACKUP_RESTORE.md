# PROOFCORE — Sauvegarde et restauration D1

Statut au 26 novembre 2026. Une sauvegarde n'existe que si une restauration a été
exécutée et comparée ; ce document sépare ce qui a été prouvé de ce qui ne l'a pas été.

| Élément                    | État            | Preuve                                                                     |
| -------------------------- | --------------- | -------------------------------------------------------------------------- |
| Export D1 local (workerd)  | **VÉRIFIÉ**     | `pnpm db:drill`, 38 tables / 30 lignes                                     |
| Restauration D1 locale     | **VÉRIFIÉ**     | drill : base vide, contrôles de lignes identiques, contenu du constat relu |
| Refus d'un dump altéré     | **VÉRIFIÉ**     | drill : `checksum mismatch`, code de sortie 1                              |
| Refus d'une cible non vide | **VÉRIFIÉ**     | drill : `not empty`, aucune écriture                                       |
| Export D1 distant          | **NON VÉRIFIÉ** | aucun credential Cloudflare dans l'environnement de cette passe            |
| Restauration D1 distante   | **NON VÉRIFIÉ** | procédure écrite ci-dessous, jamais exécutée sur un compte réel            |
| Sauvegarde Neon            | **NON VÉRIFIÉ** | hors périmètre D1 ; reposera sur les sauvegardes du fournisseur            |

## 1. Ce que les commandes font

Trois scripts, dans `tooling/scripts/` :

- `db-backup.mjs` appelle `wrangler d1 export`, puis calcule le SHA-256, interroge le
  nombre de lignes de chaque table et écrit un manifeste `*.manifest.json` à côté du
  dump. Les fichiers sont créés en `0600` : un dump contient des sessions, des jetons
  d'invitation et des données clients.
- `db-restore.mjs` vérifie la taille et le SHA-256 du dump, refuse une cible qui
  contient déjà des tables, importe avec `wrangler d1 execute --file`, puis compare
  chaque compteur de lignes au manifeste. Toute différence sort en code 1.
- `db-roundtrip.mjs` exécute l'exercice complet sur deux bases D1 locales isolées
  (`wrangler --cwd` dans des répertoires temporaires), avec les vraies migrations et
  une chaîne `workspace → project → run → report → finding`.

```bash
pnpm db:backup                         # D1 local, sortie backups/
pnpm db:backup -- --remote --out backups   # D1 déployée (session wrangler de la machine)
pnpm db:restore -- --file backups/proofcore-remote-....sql --confirm proofcore
pnpm db:drill                          # exercice complet, aucun credential requis
```

Le manifeste contient : format/version, date, mode (`local`/`remote`), nom de la base,
taille, SHA-256, compteurs par table, total de lignes, version de wrangler et commit
Git. C'est le contrat entre les deux commandes.

## 2. Procédure de restauration en production

Une restauration ne se fait jamais en place : `db-restore.mjs` refuse une base non vide,
et cette règle est volontaire. La procédure sûre est celle de Cloudflare — restaurer
dans une nouvelle base, vérifier, puis basculer le binding.

1. **Sauvegarder avant tout** : `pnpm db:backup -- --remote --out backups`. Archiver le
   `.sql` et son `.manifest.json` ensemble.
2. **Créer une base cible vide** : `wrangler d1 create proofcore-restore-<date>`, puis
   ajouter temporairement son entrée `[[d1_databases]]` dans `apps/api/wrangler.toml`
   (`database_name` et `database_id`). Ne pas la préfixer par les migrations : le dump
   contient déjà le schéma et `d1_migrations`.
3. **Restaurer** : `pnpm db:restore -- --remote --database proofcore-restore-<date> \
   --confirm proofcore-restore-<date> --file backups/<dump>.sql`. Le mode `remote` est
   repris du manifeste ; `--remote` le force si besoin.
4. **Lire le résultat** : chaque table doit avoir le même nombre de lignes que le
   manifeste. Un `FAIL` signifie que la base cible ne doit pas être basculée.
5. **Basculer** : remplacer le `database_id` du binding `DB` par celui de la base
   restaurée, déployer, puis vérifier les parcours critiques (connexion, dernier run,
   dernière analyse, remédiations).
6. **Conserver l'ancienne base** au moins sept jours avant suppression. C'est le seul
   retour arrière immédiat si la bascule révèle un problème.

Cloudflare D1 propose aussi _Time Travel_ (restauration à un instant donné) sur une
fenêtre limitée. Ce mécanisme n'a pas été exercé ici et ne remplace pas une copie
logique hors du compte Cloudflare : il ne protège ni d'une suppression du compte, ni
d'une erreur de configuration.

## 3. Planification

`.github/workflows/db-backup.yml` exporte la base distante chaque jour à **02:43 UTC**
(avant la purge de rétention de 03:17) et conserve le dump en artefact 90 jours. Le job
échoue explicitement si `CLOUDFLARE_API_TOKEN` ou `CLOUDFLARE_ACCOUNT_ID` manquent :
un job vert qui n'a rien sauvegardé serait pire que pas de job du tout.

Les artefacts GitHub sont accessibles aux personnes ayant accès au dépôt. Un dump
contient des données personnelles et des secrets de session : traiter les artefacts
comme la production, et ne jamais les joindre à un ticket ou à une conversation.

## 4. Exercice exécuté (26 novembre 2026)

```text
$ pnpm db:drill
[drill] applying the real migrations to the source database
[drill] seeding workspace → project → run → report → finding
[backup] 38 table(s), 30 row(s), 20.0 KiB
[backup] sha256 548f3ed1dcda623ef2c336e37edb29e42dac973916aef5ea4e4042274b730dd2
[restore] PASS — 38 table(s), 30 row(s) match the manifest
  ✓ 38 table(s) with identical row counts
  ✓ the seeded workspace row is present
  ✓ the seeded finding row is present
  ✓ the finding content survived the round trip
  ✓ a tampered dump is refused
  ✓ a non-empty target is refused
[drill] PASS — backup and restore verified on local D1 (workerd)
```

Le drill crée ses propres bases sous `$TMPDIR`, applique les migrations réelles, insère
la chaîne de données, sauvegarde, restaure dans une seconde base vide, puis relit le
constat restauré par une requête indépendante. Il ne touche ni la base locale de
développement ni la production.

## 5. Limites connues

- **La restauration distante n'a pas été exécutée.** Aucun credential Cloudflare n'était
  disponible ; la procédure ci-dessus est donc NON VÉRIFIÉE à distance.
- **Neon n'est pas couvert.** Aucun exercice de restauration Neon n'a été réalisé.
- **Le dump n'est pas chiffré par le script.** Il repose sur le chiffrement au repos de
  GitHub et de la machine qui l'exécute. Pour une conservation longue, le chiffrer
  (age/GPG) et stocker la clé séparément.
- **Les compteurs prouvent la structure, pas chaque octet.** Le drill vérifie en plus le
  contenu d'une ligne ; une comparaison ligne à ligne complète n'est pas automatisée.
- **RPO/RTO non mesurés.** Le RPO théorique est de 24 h (sauvegarde quotidienne) ; le
  RTO dépend de la création de la base et de la bascule de binding, et n'a pas été
  chronométré sur un compte réel.
- **La purge de rétention supprime des rapports** ; une sauvegarde antérieure à la purge
  peut donc contenir des données que la production a déjà supprimées. C'est le
  comportement attendu d'une sauvegarde, pas une fuite.
