# PROOFCORE — direction visuelle « Ink & Object »

État : 25 novembre 2026. La direction est conservée ; cette passe ne la refait pas.
Elle corrige un défaut de rendu mobile et nettoie des diagnostics d'accessibilité.

## 1. Intention

PROOFCORE doit ressembler à un instrument de mesure éditorial, pas à une carte de visite
de startup. Trois idées :

1. **Le papier et l'encre** : fond clair texturé dans l'espace de travail, noir profond
   sur les surfaces marketing ; la règle fine et le tampon remplacent la carte flottante.
2. **L'objet** : un module, un projet, un run sont des objets avec un état, une date,
   une preuve. Pas une icône décorative posée sur un dégradé.
3. **La mesure** : les chiffres sont réels, alignés, comparables. Un score sans
   couverture est un mensonge visuel.

## 2. Tokens et typographie

- Surfaces : noir `#04070a` (marketing), papier clair (workspace), encre `--ink`.
- Accent : émeraude/mint pour la validation, vermillon pour le danger et la ponctuation.
- Typographie : Bricolage Grotesque (display), Geist (texte), JetBrains Mono (chiffres,
  identifiants, petites capitales). Polices servies localement, pas de CDN.
- Mouvement : ressorts courts, révélation au scroll, parallaxe légère ; tout est coupé
  sous `prefers-reduced-motion: reduce`.

Références internes : `docs/VISUAL_DIRECTION.md`, `docs/DESIGN_SYSTEM.md`,
`docs/design/DESIGN_TOKENS.md`.

## 3. Composition par espace

| Espace          | Composition                                                                                                                      |
| --------------- | -------------------------------------------------------------------------------------------------------------------------------- |
| Dashboard       | phrase de situation + tampon de faits + prochaine action + usage ; les KPI sont une pile de cartes, pas quatre tuiles génériques |
| Projet          | objet projet, état des modules, dernière exécution, corrections                                                                  |
| Analysis Center | bande d'adresse, déroulé réel écrit par le serveur, constats groupés par module                                                  |
| Findings        | identifiant, statut, preuve observée, correction, vérification                                                                   |
| FLOW Studio     | étapes nommées, assertion par étape, échec localisé                                                                              |
| AI Workspace    | conversation plein écran, outils visibles, mémoire consultable                                                                   |
| Terminal        | console dense, mono, sans décoration                                                                                             |
| Rapports        | document lisible, en-tête, périmètre, constats, limites                                                                          |

## 4. Anti-AI design — règles tenues

Interdits explicites :

- cartes génériques répétées en grille sans hiérarchie ;
- dégradés décoratifs sans fonction ;
- glassmorphism généralisé ;
- badges sans information ;
- fausses métriques et pourcentages inventés ;
- textes marketing vides (« superchargez votre workflow ») ;
- grandes icônes sans action ;
- animations qui simulent un travail inexistant.

La progression d'un scan est écrite par le serveur, pas animée à vide. Un module sans
run affiche « non vérifié », pas une jauge à 0 % présentée comme un score.

## 5. Correction de cette passe

Le fond WebGL de la page d'authentification était rendu au ratio complet du téléphone
(×2,625). Il saturait le thread principal et faisait échouer l'inscription mobile. Le
ratio est plafonné à 1,5 ; le décor reste net, le formulaire reste réactif.

Les canvas et SVG purement décoratifs ne portent plus `aria-hidden` sur un élément que
Biome considère interactif ; ils sont sans nom accessible, ce qui évite une annonce
vocale inutile sans prétendre être un contenu.

## 6. Ce qui n'a pas été vérifié

- Aucune campagne de captures multi-viewports n'a été rejouée dans cette passe.
- Les contrastes ne sont pas mesurés par un outil automatique.
- Le rendu des polices et des animations n'a pas été comparé à une capture de
  référence récente.

Ces points restent ouverts et ne doivent pas être déclarés conformes sans mesure.
