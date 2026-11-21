# PROOFSTACK 2.0 — rapport de livraison

Ce rapport dit ce qui a été **fait et vérifié**, ce qui reste **partiel**, et ce qui demande
une décision de ta part. Il ne décrit aucun travail futur comme acquis.

État au moment de l'écriture :

| Contrôle | Commande | Résultat |
| --- | --- | --- |
| Tests | `npx vitest run` | **653 passés**, 52 fichiers (647 avant ce tour, +6 nouveaux) |
| Lint / format | `npx biome check .` | 0 erreur |
| Types web | `npx tsc --noEmit -p apps/web` | 0 erreur |
| Types API | `npx tsc --noEmit -p apps/api` | 0 erreur |
| Build | `node tooling/scripts/build.mjs` | complet |
| Vérification navigateur | Playwright sur `/app/billing` (FR) | capture `/tmp/billing-verify.png` |

---

## 1. Livré et prouvé dans ce tour

### 1.1 `docs/PRODUCT_CAPABILITY_MATRIX.md` (partie 1.2)

La matrice demandée existe, construite en lisant le code et non les noms de dossiers :
objectif, utilisateurs, entrées, contrôles réels (ids exacts), sorties, dépendances,
limites, surface UI, routes API, commandes CLI, tests, maturité.

Trois faits qu'elle établit, et qui changent la feuille de route :

1. **FAIL et CLEAN n'ont pas de paquet dans `packages/modules/`.** Les 26 contrôles existent
   et fonctionnent, mais dans `packages/core/src/page-scan.ts` (1 271 lignes). Ce n'est pas
   un trou de fonctionnalité, c'est un écart d'architecture.
2. **FLOW est complet en CLI et ignoré côté serveur**, volontairement : le Worker n'a pas de
   navigateur, donc chaque parcours sort en `SKIPPED` avec sa raison plutôt qu'en succès.
3. **Le produit impose aujourd'hui une clé IA personnelle.** C'est le point où la mission
   (partie 4.4) et le produit actuel se contredisent frontalement. Voir §5.

### 1.2 Fuite d'anglais dans une page française — corrigé

`/app/billing` affichait, en français : « AI audits this period », puis
« One per audit id; a retried scan or chat turn is metered once. » La page traduisait par
comparaison de libellé (`counter.label === "Projects"`), donc tout nouveau compteur arrivait
en anglais.

- `apps/web/src/pages/app/Billing.tsx` : table de correspondance **par clé**, trois compteurs
  (`monthly_test_runs`, `monthly_ai_audits`, `project_limit`) × deux langues. Un compteur
  inconnu garde les mots de l'API au lieu d'inventer une phrase française fausse.
- Prouvé dans un vrai navigateur contre la vraie API : les quatre chaînes anglaises sont
  absentes du DOM, « Audits IA cette période » est présente (capture ci-dessus).

### 1.3 Contenu analysé = données non fiables, structurellement — corrigé

Le test 10 exige que « les contenus analysés soient considérés comme des données non
fiables, jamais comme des instructions ». Les prompts le disaient déjà ; le **format** ne le
garantissait pas. Un fichier analysé pouvait écrire `--- END FILE` puis un faux
`--- FILE: src/auth.ts`, et se faire lire comme un autre fichier.

- `apps/api/src/routes/project-intelligence.ts` : chaque fichier est encadré par une clôture
  à nonce aléatoire par appel, **toute** séquence `<<<…>>>` présente dans le contenu est
  neutralisée avant insertion, et la règle de lecture est ajoutée au prompt système
  (`AUDIT_UNTRUSTED_RULE`).
- `apps/api/test/untrusted-file-content.test.ts` : 6 tests, dont trois qui attaquent
  réellement la clôture (faux fermant, faux en-tête, enchaînement entre deux fichiers). Le
  test vérifie qu'il y a exactement deux clôtures et que le faux `SYSTEM:` reste à
  l'intérieur.
- Le nonce utilise le `crypto` global, pas `node:crypto` : aucun drapeau `nodejs_compat`
  n'est activé sur le Worker, donc la route reste déployable telle quelle.

### 1.4 Fichiers générés sortis du dépôt (partie 11.19 et 11.21)

- `.proofcore/semantic-index.json` (1,3 Mo, contenait `/home/laudes/Documents/PROOFSTACK`)
  n'est plus suivi. Il est déjà ignoré par `.gitignore` ; il avait été ajouté de force.
- `.perch/mcp.json` n'est plus suivi : il contient un chemin absolu propre à cette machine.
  `.perch/` passe dans `.gitignore`.
- Les deux fichiers restent sur le disque ; seul le suivi git change.

---

## 2. État réel des phases

| Phase | Ce qui est vrai | Verdict |
| --- | --- | --- |
| **1 — Stabilisation** | Tests, lint, types, build verts. Fichiers générés retirés du dépôt. Versions : paquets internes en 0.1.0, produits livrés (`cli`, `desktop`) en 0.5.0. Le dépôt tient la route. | **Fait**, sauf la publication npm du CLI |
| **2 — Cartographie** | Matrice livrée. Registre de contrôles : les contrôles existent et sont nommés, mais il n'existe pas de registre unique déclaratif (objectif, prérequis, complexité, risque) par contrôle. | **Moitié** |
| **3 — UX** | Chemin Simple, configuration guidée et états vides existent partiellement ; le scan en un champ et le board de corrections sont réels. Pas d'assistant d'accueil qui prend un débutant par la main jusqu'au premier résultat. | **Partiel** |
| **4 — IA** | Conversations, mémoire d'espace, effort→sous-agents, audit IA de projet, blog de corrections : réels. **Clé fournisseur par utilisateur : obligatoire.** | **Partiel, avec un conflit** |
| **5 — Refonte des cinq modules** | Les 46 contrôles sont réels et testés. La sélection par objectif et les profils combinés (général, sécurité, contenu, parcours, API) n'existent pas. | **Partiel** |
| **6 — Correction** | Board de corrections avec états par constat et comparaison au scan précédent : réel. Pas de boucle « vérifier après correction » automatisée. | **Partiel** |
| **7 — Distribution** | Web, CLI, desktop, installateurs Linux, mises à jour, facturation, support : réels. Pas d'e-mail sortant, pas de signature de code, pas de sauvegardes. | **Partiel** |
| **8 — QA final** | Non exécuté. Les 10 tests de validation ne sont pas passés en entier. | **Non fait** |

---

## 3. Les dix tests de validation

| # | Test | Statut | Ce qui bloque |
| - | ---- | ------ | ------------- |
| 1 | Débutant complet, sans clé IA ni CLI | **Échoue** | L'IA exige une clé fournisseur ; le parcours guidé s'arrête avant le premier résultat expliqué |
| 2 | Intelligence contextuelle | **Passe partiellement** | Le contexte projet est injecté ; la lecture d'un rapport précédent n'est pas prouvée de bout en bout |
| 3 | Configuration assistée WORLD | **Échoue** | Pas de génération de config par l'IA avec validation avant écriture |
| 4 | Constructeur FLOW | **Échoue** | Les parcours s'écrivent à la main dans la config |
| 5 | EXIT | **Passe** | Fidélité d'aller-retour prouvée par tests, à condition d'avoir une source |
| 6 | FAIL et CLEAN | **Passe** | Contrôles, scores, limites HTML-serveur assumées |
| 7 | Historique et comparaison | **Passe partiellement** | Deux scans de page comparés ; les runs moteur ne sont pas comparés |
| 8 | Cohérence Web et CLI | **Passe partiellement** | Même API, mêmes statuts ; le partage de config Web→CLI n'est pas outillé |
| 9 | Assistant sans fournisseur | **Échoue** | Sans clé, il n'y a pas d'explications déterministes de rechange |
| 10 | Sécurité | **Passe sur le cloisonnement, la faille d'injection fermée** | Restent à prouver : appels IA, approbations d'actions, commandes sensibles de bout en bout |

Quatre tests sur dix échouent pour une raison unique et nommable : **le produit dépend d'une
clé IA fournie par l'utilisateur pour la partie « explication »**. C'est le prochain chantier,
et il demande ta décision (§5).

---

## 4. Ce que je n'ai pas fait, et pourquoi

- **Aucun mockup, aucune page factice, aucun bouton sans effet** n'a été ajouté. La matrice
  liste explicitement ce qui est annoncé et absent.
- **Aucun paquet de module FAIL/CLEAN créé.** Déplacer 1 271 lignes de contrôles qui marchent
  vers deux nouveaux paquets est une opération de structure, pas une correction : elle
  touche le moteur, les rapports et le CLI, et rapporte zéro capacité. À faire quand un
  besoin réel l'exige (contrôles tiers, plugins), pas pour aligner des dossiers.
- **Aucune bibliothèque d'animation ajoutée.** Le budget disque est à 9 Go libres et le
  produit tient sans. Si le mouvement doit passer à GSAP/Lenis, c'est une décision séparée,
  avec une mesure de bundle avant/après.
- **Pas de fournisseur IA mutualisé.** Ce n'est pas une tâche technique : c'est un coût
  récurrent à ta charge, avec un plafond par compte à fixer.

---

## 5. Trois décisions qui t'appartiennent

1. **Clé IA.** La mission interdit d'exiger une clé personnelle. Deux issues : (a) un
   fournisseur serveur mutualisé avec un plafond par plan, donc un coût mensuel à assumer ;
   (b) des explications déterministes complètes, écrites par nous, sans modèle. (b) est
   moins cher, entièrement testable, et rend le test 9 vrai. Je recommande de commencer par
   (b), puis (a) pour ce que (b) ne sait pas dire.
2. **Cinq modules.** La mission autorise à ne pas garder cinq noms si un module ne justifie
   pas son existence. Aucun des cinq n'est redondant aujourd'hui : WORLD teste la donnée,
   FLOW le parcours, EXIT le retour, FAIL la surface HTTP, CLEAN la structure. Je garde les
   cinq et je documente la frontière de chacun dans la matrice.
3. **E-mail.** Récupération de mot de passe, invitations et support reposent sur un
   fournisseur d'e-mail absent. Sans lui, la production n'est pas complète, quel que soit le
   code livré.

---

## 6. Prochaine tranche, dans cet ordre

1. **Explications déterministes** : pour chaque contrôle, résumé, conséquence et correction
   écrite en dur, dans les deux langues, rendue sans IA. Rend les tests 1 et 9 vrais et ne
   dépend d'aucun fournisseur.
2. **Registre de contrôles déclaratif** : un seul fichier par module décrivant objectif,
   prérequis, complexité, risque, méthode de vérification. Les profils combinés en découlent.
3. **`BLOCKED` / `NOT_APPLICABLE` / `NOT_CONFIGURED`** dans le contrat de statuts, avec
   agrégation et affichage. Aujourd'hui un contrôle non applicable ne peut pas le dire.
4. **Boucle de vérification après correction** : relancer les seuls contrôles du constat
   corrigé et comparer.
5. **Fournisseur IA mutualisé**, une fois le plafond décidé.
