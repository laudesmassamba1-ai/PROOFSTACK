# ARCHITECTURE UX — PARCOURS & NAVIGATION

## 1. Les trois surfaces

| Surface           | URL                                                                                                                      | Rôle                                                               |
| ----------------- | ------------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------ |
| Site public       | `/`, `/product`, `/world…clean`, `/platform`, `/pricing`, `/download`, `/docs`, `/changelog`, `/security`, pages légales | Comprendre, comparer, télécharger                                  |
| Espace de travail | `/app/*`                                                                                                                 | Travailler : projets, analyses, modules, IA, terminal, facturation |
| Compte            | `/signin`, `/signup`, `/device`, récupérations                                                                           | Accéder                                                            |

## 2. Navigation espace de travail (constatée dans le code, `AppLayout`)

- **Mode Débutant** (« Vue d'ensemble · Projets · Démarrer ») : le shell court
  introduit par `836cd84`. Trois destinations, une action suivante proposée.
- **Mode Studio** (bouton `Mode Studio` de la topbar) : navigation complète —
  vue d'ensemble, projets, espace, modules (5), scan, CLI (+docs), terminal,
  facturation, réglages, IA, admin.
- Le projet actif est toujours visible (sélecteur `Aude workspace` + `Tous les projets`).
- ⌘K : palette de commandes (routes + projets).
- La console locale vit à `/app/ai/local` ; le terminal général à `/app/terminal`
  (distincts depuis le correctif `open-console`).

## 3. Parcours principaux

### Première visite → première preuve

1. `/` : la promesse + le mur des modules + l'audit IA enregistré.
2. `/pricing` : offres lues depuis `@proofcore/billing` (jamais recopiées).
3. `/signup` → `/app` : onboarding « Démarrer » (3 étapes, projet → CLI → première
   exécution). L'Overview sans exécution masque les graphiques zéro et propose
   « Analyser mon site maintenant ».
4. `/app/scan` : une adresse, cinq lectures, sans configuration.

### Utilisateur actif

1. `/app` : situation en tête (« AUCUNE EXÉCUTION. » ou l'état réel), cartes modules
   avec dernier état par module, prochaine action, exécutions récentes, échecs
   ouverts, usage.
2. `/app/projects/:id` : centre de travail du projet (runs, findings, config).
3. `/app/modules/:module` : la question du module, l'historique, la commande.
4. `/app/ai` : l'assistant avec relecteurs (2–5 selon l'effort), mémoire de projet
   auto-curée, navigateur intégré.

### Décision de facturation

`/app/billing` : offre, état, usage par compteur avec la règle de comptage
affichée (never colour-only), changement d'offre, historique, reçus, fournisseur.

## 4. Principes de hiérarchie appliqués

1. La page répond d'abord à « où en suis-je ? », ensuite « quoi faire ? », enfin
   « que s'est-il passé ? » (numérotation `01/`, `02/` visible dans l'Overview).
2. Chaque écran a une action primaire unique ; les secondaires restent fantômes.
3. Les états vides guident (prochaine action, cause, lien), ils ne décorent pas.
4. La navigation ne crée pas d'entrée pour une fonction absente (les entrées
   mappent les routes réelles de `apps/web/src/App.tsx`).
