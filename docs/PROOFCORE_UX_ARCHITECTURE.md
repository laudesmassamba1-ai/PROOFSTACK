# PROOFCORE — architecture de l'expérience

État : 25 novembre 2026. Décrit les routes et les parcours réellement câblés dans
`apps/web/src/App.tsx` et `apps/web/src/layouts/AppLayout.tsx`.

## 1. Deux lectures, un même produit

### Mode simple

Le mode simple est le parcours par défaut d'un nouveau compte :

1. **Accueil de l'espace** (`/app`) : une phrase de situation (« No project yet. »,
   « No run yet. », « 3 failures need a decision ») et une action suivante unique.
2. **Guide** (`/app/guide`) : « Comprendre l'app en 2 minutes », sans CLI.
3. **Démarrer** (`/app/start`) : une adresse, un bouton, un résultat lisible.
4. **Scan** (`/app/scan`) : cinq lectures sur une adresse, sans configuration.
5. **Projets** (`/app/projects`) : le projet comme objet de travail.
6. **Assistant** (`/app/ai`) : explication contextuelle, outils visibles.

Le menu mobile expose « Afficher le mode expert » ; le mode expert ajoute les entrées
techniques (modules, CLI, terminal). Le choix est mémorisé localement.

### Mode expert / Studio

- `/app/modules` et `/app/modules/:module` : les cinq lectures, états vides compris.
- `/app/projects/:id/config` : configuration des modules, précontrôle, blocage si une
  option est dangereuse.
- `/app/cli` et `/app/cli/docs` : commandes, installation, sorties.
- `/app/terminal` : console locale (SSE) dans le desktop.
- `/app/ai/local` : agent local qui voit le disque, distinct de l'assistant cloud.
- `/app/admin` : console opérateur (support, outbox) réservée à l'allow-list.

## 2. Parcours débutant réellement testé

`tests/e2e/app-mobile.spec.ts` (Pixel 7) exécute :

```
signup → consentement cookies → menu → Guide → « Analyser une adresse »
       → /app/start → saisie https://example.com → « Voir le résultat »
       → HTTP 200 + « Voir le rapport complet » + absence de libellés anglais
```

Le test vérifie aussi l'absence de débordement horizontal et l'absence des états
« Scanning… » / « See the result » après la réponse. Il est passé dans cette passe.

## 3. Parcours compte et facturation testés

`tests/e2e/journey.spec.ts` couvre :

- inscription, accès au dashboard, session conservée au rechargement ;
- refus d'un mauvais mot de passe avec message, pas écran blanc ;
- dashboard inaccessible sans session ;
- overview honnête (plan Free, modules non vérifiés) ;
- module sans run = « unverified », jamais « passed » ;
- facturation : le fournisseur affiche qu'il ne peut pas débiter automatiquement ;
- choix d'un plan et règlement sandbox ;
- suppression du seul workspace par son propriétaire ;
- documentation CLI dans le shell de l'app ;
- 404 applicatif sur une route inconnue ;
- réglages apparence/langue, thème sombre, absence de débordement.

## 4. États

| État          | Rendu                                                                      |
| ------------- | -------------------------------------------------------------------------- |
| chargement    | libellé explicite (« Chargement de la situation… »), pas de squelette muet |
| vide          | titre + corps + action ; jamais un tableau vide sans explication           |
| erreur API    | message + bouton réessayer, sans code HTTP brut                            |
| quota atteint | message, limite, plan requis, lien vers les offres                         |
| non mesuré    | « — » / « Non mesuré », jamais un score inventé                            |
| succès        | le fait observé (HTTP, date, identifiant), pas une célébration             |

## 5. Navigation et coquille

- Topbar : marque, espace de travail, notifications, recherche, menu.
- Dock (desktop) : sections principales ; sur mobile, le dock et le menu couvrent
  toutes les sections.
- Les routes marketing, docs, workspace et admin sont découpées en chunks.
- Les cartes de modules sont des objets liés aux données ; un clic déplie les cinq
  cartes (commit `9976fdd`).

## 6. Langue

- FR/EN sur les pages marketing, l'authentification, l'overview, les projets, les cinq
  modules, FAIL/CLEAN, la facturation, les réglages et la coquille.
- Le choix vit dans `localStorage` (`proofcore.locale`) et met à jour `lang` du document.
- Les identifiants API (plan, statut, environnement) restent en anglais et sont
  traduits au seul point d'affichage (`appLabels.ts`).

## 7. Cohérence des promesses

- Une fonctionnalité sans implémentation est marquée « bientôt » dans la grille
  tarifaire (`github_integration`, `advanced_reports`, `client_sharing`,
  `priority_support`).
- Aucun écran ne présente « Bientôt » comme opérationnel.
- Le mode simple n'oblige pas à connaître la CLI ; le mode expert ne cache pas les
  commandes.

## 8. Limites

1. La matrice responsive complète (14 tailles) n'a pas été rejouée ; seuls desktop
   Chrome et Pixel 7 sont couverts par les E2E de cette passe. Les scripts de QA
   visuelle existent mais n'ont pas été réexécutés.
2. Aucun audit axe-core ni test clavier exhaustif : ne pas revendiquer WCAG 2.2 AA.
3. Le consentement cookies est une carte qui peut recouvrir le contenu sur petit
   écran ; le parcours testé la ferme d'abord, comme un utilisateur.
4. Pas de partage de rapport ni de vue client en lecture seule.
