# AUDIT VISUEL — PROOFCORE · 2026-11-21

Méthode : le produit rendu, pas le CSS. Un serveur API local (`apps/api/src/node.ts`, SQLite)
et le site en dev (`vite`, port 5173) ont servi les pages réelles. Un compte de test
(`audit1@example.com`) avec un projet (`Shop Demo`, staging, 5 modules) alimentait l'espace
de travail. Captures Playwright sur 16 pages marketing + 19 pages d'application, aux
viewports 1440×900 et 390×844 (dossier `docs/design/audit-2026-11-21/`).

Détection automatique : débordement horizontal de page, éléments hors écran hors conteneurs
à défilement contrôlé, absence de `h1`, pages trop pauvres en texte, erreurs console.
Observation manuelle : chaque capture a été regardée, pas seulement mesurée.

## Constats

| # | Page(s) | Défaut visuel | Défaut ergonomique | Impact | Correction | Priorité |
|---|---------|---------------|--------------------|--------|------------|----------|
| 1 | `/download` @390 | Les noms de fichiers et les empreintes sha256 (mono, insecables) poussent la grille hors écran ; défilement horizontal de page | L'utilisateur doit scanner latéralement pour lire une empreinte qu'il doit vérifier | Perte de confiance au moment le plus critique : vérifier avant d'exécuter | Colonnes `minmax(0,1fr)` + `min-w-0` sur les cartes ; troncature avec `title` conservée | **Critical** |
| 2 | `/app` (Overview) | Panneau d'usage en anglais codé en dur (« Test runs this period », « 5 run(s) left… », « View plans ») dans une interface française | Message de facturation incompris par l'utilisateur FR | Le sujet le plus sensible (quota, facturation) reste flou | 8 clés i18n `ws.overview.usage.*` FR/EN, interpolation `{n}`/`{date}` | **High** |
| 3 | `/app` (Overview) | Section « 14 derniers jours » rendue avant toute exécution : trois panneaux quasi vides (~480 px) entre les cartes modules et la bande d'action | Espace mort qui masque le manque de données ; l'utilisateur cherche un graphique qui ne dit rien | Perte de repère vertical, impression d'interface vide | La section attend la première exécution (`hasRuns`) | **High** |
| 4 | `/app/billing`, `/app/settings` @390 | Tableaux à 4 colonnes tronqués au bord droit, coupure sans signal | La colonne « Traitement » (règle de comptage) est invisible sans défiler | Règle de quota non lue | Défilement contrôlé avec affordance : fondu de bord, `scroll-snap`, padding réduit, min-width abaissée | **High** |
| 5 | `/app` (Overview) | L'état vide « Échecs ouverts » répétait le titre du panneau | Double lecture du même mot | Bruit | `Empty` accepte `title={null}` | Medium |
| 6 | `/product`, `/platform`, `/pricing`, `/download`, `/docs`, `/changelog`, `/security` | Pas de `h1` | Hiérarchie de titres incomplète (WCAG 1.3.1, SEO) | Navigation au lecteur d'écran moins claire | Ajouter un `h1` intégré à l'en-tête de page (voir plan d'action) | Medium |
| 7 | `/app/scan` @1440 | État sans configuration : héro + barre d'adresse puis ~60 % de page vide | L'écran d'entrée de l'analyse ne montre pas ce qui va être vérifié | Valeur perçue faible au moment de la première action | Prévisualiser les 5 lectures sous la barre (plan d'action) | Medium |
| 8 | `/app/terminal` | Élément de mesure xterm signalé hors écran | — | Faux positif vérifié : span absolu de mesure de caractères, invisible et sans interaction | Aucune | Low |
| 9 | `/app` | État vide « Exécutions récentes » répète aussi le titre du panneau | Idem #5 | Bruit | Idem #5 (même composant, à généraliser) | Low |
| 10 | Toutes pages marketing | Les sections sous la ligne de flottaison restent masquées si un script échoue entre l'init et l'observation | Contenu invisible | Risque de page blanche pour certains environnements | Filet existant (sweep 3 s) + `@media (scripting: none)` ; vérifié | Low (gardé sous surveillance) |

## Points forts confirmés (à ne pas dégrader)

- **Identité** : la vague de particules du héro (convergence en P) est réellement signature ;
  les illustrations d'objets des modules (sphère, pièces, boîte, jauges) donnent une
  personnalité qu'aucun template ne produit.
- **Mur des modules** : panneau instrument sombre, vocabulaire technique réel
  (`locale`, `RTL`, `csp`, `idempotency`), légende d'états PASS/WARN/FAIL/SKIPPED.
- **Honnêteté** : aucun chiffre inventé (les stats du héro sont des faits structurels :
  5 modules, 3 commandes, 11 entités, 4 formats) ; l'exemple d'audit IA est étiqueté
  « enregistré » ; la carte d'usage nomme la règle de comptage.
- **Accessibilité de base** : focus visible, `prefers-reduced-motion` respecté partout,
  zéro erreur console sur toutes les pages capturées.

## Plan d'action

1. **Fait dans cette passe** : #1, #2, #3, #4, #5 (commit `61b9ce8`), puis #6
   (`SectionHeading as="h1"` sur les 7 routes, commit `05f4a0f`), #7 (prévisualisation
   des cinq lectures sous la barre d'adresse, commit `05f4a0f`), et les descriptions
   d'offres anglaises sur la page tarifs francophone (commit `bb3241b`).
2. **Suivant** : #9 (généraliser les états vides sans titre dupliqué aux autres
   panneaux de l'app : exécutions récentes, etc.).
3. **Récurrent** : re-capturer après chaque passe dans `docs/design/audit-2026-11-21/`
   et comparer avec les captures de référence.

## Limites de l'audit

- Les pages admin et le mode Studio complet n'ont pas été capturés avec des données
  réelles (compte de test sans abonnement payant) : `/app/admin` est hors périmètre
  du compte de test standard.
- Les fenêtres natives desktop (Electron) sont auditées séparément, sur la même base
  de rendu web ; le shell desktop a été vérifié dans les sessions précédentes.
- Les états d'erreur serveur (500, réseau coupé) n'ont été vus que via les captures
  d'écran des sessions précédentes, pas rejoués page par page dans cette passe.
