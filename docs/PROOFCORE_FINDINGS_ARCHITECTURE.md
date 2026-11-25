# PROOFCORE — architecture des constats et des preuves

État : 25 novembre 2026. Références : `packages/contracts/src/statuses.ts`,
`packages/engine`, `packages/core/src/page-scan.ts`, `apps/api/src/routes/audits.ts`,
migrations 0017 et 0018.

## 1. Chaîne de vérité

```
Run
 └── ModuleRun (world | flow | exit | fail | clean)
      └── TestCase
           ├── Assertion (attendu / observé / ok)
           ├── Evidence (capture, en-tête, extrait, empreinte)
           └── Finding (id stable, gravité, description, impact, correctif)
                └── Correction (todo | in_progress | fixed | verify)
                     └── Vérification (fixed | still_present | worse | not_checked | inconclusive)
```

Un constat n'est pas une opinion : il porte l'identifiant du cas qui l'a produit, la
valeur exacte observée et la commande ou l'URL qui le reproduit.

## 2. Statuts

### Cas (`TEST_STATUSES`)

`PENDING`, `RUNNING`, `PASSED`, `FAILED`, `WARNING`, `SKIPPED`, `ERROR`, `BLOCKED`,
`NOT_APPLICABLE`, `NOT_CONFIGURED`.

- `BLOCKED` : la vérification n'a pas pu être tentée (pas de navigateur, pas de réseau,
  pas de credentials). Le produit n'est ni prouvé faux ni prouvé juste.
- `NOT_APPLICABLE` : la question ne s'applique pas (feuille d'impression sur une API).
- `NOT_CONFIGURED` : la vérification s'applique mais le produit n'a rien déclaré à
  vérifier (aucun format d'export, aucun profil de locale).

### Run (`RUN_STATUSES`)

`PENDING`, `RUNNING`, `COMPLETED`, `PARTIAL`, `FAILED`, `ERROR`, `CANCELLED`,
`NOTHING_VERIFIED`.

Un run n'est `COMPLETED` que si rien n'a échoué ni errored. `NOTHING_VERIFIED` signifie
que tout a été sauté faute de cible ; ce n'est ni un `ERROR` du harnais ni un succès.
Le CLI sort en code non nul pour qu'une CI ne confonde pas « non branché » et « vert ».

### Audit de page (`verdict`)

`pass`, `warnings`, `fail`, `not_measured`.

`not_measured` est utilisé quand la page se construit côté client et que les contrôles
DOM ne portent que sur le HTML initial. L'interface affiche « — » et « Non mesuré »,
jamais 100/100. Preuve : `packages/core/test/page-scan.test.ts:304` et
`site-scan.test.ts:164`.

## 3. Identité d'un constat

- Dans un run : `finding.id` + `testCaseId` + `module`.
- Dans un scan de page : clé stable `module:id` (ex. `fail:csp`), ce qui permet de dire
  « toujours présent », « disparu » ou « apparu » entre deux scans sans inventer une
  seconde identité.
- Les états de correction sont stockés par `(workspace_id, project_id, finding_key)`.
  Un identifiant de projet d'un autre tenant ne peut ni lire ni écrire ces lignes
  (clé primaire composite + filtre workspace).

## 4. Cycle de correction

1. **Constat** produit par un run ou un scan.
2. **État de travail** choisi par la personne : `todo`, `in_progress`, `fixed`,
   `verify`. C'est un état de son travail, pas un verdict sur le site.
3. **Comparaison** avec le scan précédent : `resolved`, `persisting`, `appeared`.
4. **Re-contrôle ciblé** : `POST /api/v1/projects/:id/corrections/:key/verify` relit la
   page et compare le contrôle à sa valeur précédente. Verdicts : `fixed`,
   `still_present`, `worse`, `not_checked`, `inconclusive`.
5. **Preuve** : l'état conserve la date, la valeur avant, la valeur observée et le
   verdict. Un re-contrôle ne crée pas de nouvelle baseline et ne consomme pas le quota
   d'audit mensuel.

## 5. Rapports

| Format    | Où                                      | Contenu                                     |
| --------- | --------------------------------------- | ------------------------------------------- |
| JSON      | API `GET /reports/:id?format=json`, CLI | payload complet du run                      |
| HTML      | API `GET /reports/:id?format=html`, CLI | table des cas, échappée                     |
| JUnit XML | CLI                                     | un `testcase` par cas, échec bloquant en CI |
| Texte     | CLI                                     | lecture humaine                             |

L'API HTML échappe module, nom, statut et identifiant avec `escapeHtml`. Le rapport HTML
ne contient ni secret ni en-tête de session. Les formats PDF et CSV ne sont pas
implémentés pour les rapports ; le PDF chargé dans l'application sert uniquement à lire
une pièce jointe du chat.

## 6. Règle d'honnêteté

- `NOT_MEASURED` / `not_measured` ne devient jamais `PASS`.
- Un run sans cible n'est jamais `COMPLETED`.
- Un constat sans preuve n'entre pas dans un rapport.
- Un score n'est affiché que si la couverture est nommée (pages mesurées / lues,
  contrôles exécutés).
- FAIL n'est pas une certification de sécurité : aucun test offensif, seulement des
  contrôles HTTP observables.

## 7. Limites connues

1. Le CLI ne pousse pas encore `fail`/`clean` comme runs (`proofcore audit --sync`
   absent) : les pages modules FAIL/CLEAN sont alimentées par les scans web et
   l'assistant.
2. Les constats d'un run local (CLI) et d'un scan web ne partagent pas la même clé
   d'identité native ; la comparaison de scans web se fait par `module:id`.
3. Aucun export PDF/CSV ; aucun partage public en lecture seule.
4. Les preuves sont stockées dans le payload du run/scan ; pas de stockage binaire
   séparé pour les captures.
