# DIRECTION ARTISTIQUE — PROOFCORE

Statut : **choisie et en application** (pas une proposition). Ce document fixe l'identité
que chaque écran — site public, espace de travail, CLI, app desktop — doit respecter.

## 1. La direction retenue : **instrument de preuve sur fond noir**

PROOFCORE est un instrument qui lit un produit et rapporte des faits vérifiables.
Son interface assume cette nature : un **environnement de mesure sombre**, précis,
où la couleur porte de l'information et où la matière (particules, jauges, tokens
techniques) raconte la vérification.

Une piste d'exploration « cinéma » (plus théâtrale) avait été tentée puis retirée
(`d657e7b` → `ea21084`) : elle plaçait le spectacle devant la lisibilité. La ligne
actuelle est la synthèse : **la chorégraphie existe, elle est subordonnée au contenu.**

### Ce que la direction interdit (et pourquoi)

| Interdit                                                  | Raison                                                               |
| --------------------------------------------------------- | -------------------------------------------------------------------- |
| Dégradé violet/bleu global, blobs flottants               | Aucun lien avec la mission ; identité de template                    |
| Icône étincelle/IA générique (`Sparkles`)                 | Vague à voiture-balai ; retirée du produit                           |
| Chiffres inventés, jauges décoratives                     | Le produit vend la preuve ; une décoration mensongère le tue         |
| Cartes empilées identiques en grille symétrique           | La répétition masque l'absence de hiérarchie                         |
| Animation permanente (halo pulsant, particules hors héro) | L'instrument ne vibre pas sans signal                                |
| Glassmorphism systématique                                | La profondeur vient des ombres en couches et des filets, pas du flou |

### Ce que la direction exige

- **Preuve visible** : chaque état (PASS/WARN/FAIL/SKIPPED) a un marqueur
  couleur **et** un libellé ; jamais la couleur seule.
- **Vocabulaire technique assumé** : les tokens vérifiés (`locale`, `RTL`, `csp`,
  `idempotency`, `checksum`) s'affichent en monospace, non traduits — c'est le
  vocabulaire de contrôle du produit.
- **Exemples étiquetés** : toute donnée de démonstration porte une mention
  (« exemple · pas en direct », « enregistré »).
- **Une animation signature, des animations utilitaires** : la vague de particules
  convergente est réservée au héro de marque ; partout ailleurs, le mouvement
  révèle, confirme ou déplace — jamais il ne décore.

## 2. Références absorbées (et comment)

| Référence                            | Ce qui a été retenu                                                                       | Ce qui a été écarté                                                     |
| ------------------------------------ | ----------------------------------------------------------------------------------------- | ----------------------------------------------------------------------- |
| `ref_visuelles/da1.png` (CAYLENT)    | Fond noir, champ de points menthe ondé entrant par le bord, wordmark espacé               | Le logo au centre ; le nôtre converge en P puis se dissout              |
| `ref_visuelles/exp2.webp` (Freebuff) | Héro sombre, phrase d'accent colorée dans le titre, grande stat calme, CTA pilule discret | Le globe de « développeurs » ; nos chiffres sont des faits structurels  |
| `ref_visuelles/da2.png` (cartes 3D)  | Ombres profondes en couches, objets détachés du fond                                      | Le dégradé arc-en-ciel de fond ; nos surfaces restent noires            |
| `ref_visuelles/z1–z3`                | Typographie display massive, lignes décalées                                              | Le collage aléatoire ; notre grille reste lisible                       |
| Images jointes (bento, dashboards)   | Densité maîtrisée, données colorées portant du sens                                       | Le look « admin SaaS » pour l'espace de travail : il reste Ink & Object |

## 3. Les deux mondes, une même identité

- **Site public (marque)** : noir `#050708`, menthe `#78e3cb`, cyan `#70c9db`,
  émeraude `#73d68b`. Typography display Bricolage Grotesque, texte Geist,
  données JetBrains Mono. La lumière vient des particules et des accents.
- **Espace de travail (app)** : papier `#f3f0e8`, encre `#0a0a0b`, accents menthe
  `#5cf2c4`, turquoise `#0fd9d0`, bleu monde `#2f5bff`, ambre exit `#ffb020`.
  Composition « Ink & Object » : illustrations d'objets par module, jauges, frises.
- **Le pont** : mêmes couleurs de statut, même typographie de données (mono),
  même grammaire de rayons (`--radius-sm` 6 / `--radius` 10 / `--radius-lg` 16),
  même moteur de mouvement (`lib/motion.ts`, courbes `--ease-*`).

## 4. Mouvement (contrat)

1. **Courbes** : `--ease-anticipate` `cubic-bezier(0.76,0,0.24,1)` pour les entrées,
   `--ease-spring` `cubic-bezier(0.25,1,0.5,1)` pour les interactions, ressorts
   sous-amortis (intégrateur semi-implicite) pour l'inertie. Pas de `linear`, pas
   de `ease` par défaut.
2. **Chorégraphie** : les titres se lèvent mot à mot hors de leur masque
   (`SplitWords`), décalage asymétrique (hash premier) ; les blocs entrent par
   masque `clip-path`, jamais en fondu de bloc.
3. **Micro-interactions** : inclinaison à ressort avec reflet spéculaire sur les
   panneaux (`data-tilt`), contrôle magnétique sur les CTA primaires
   (`data-magnet`), dérive de scroll liée à la progression (`data-parallax`).
4. **Limites** : `prefers-reduced-motion` coupe tout (rendu statique complet) ;
   sans JS, tout est visible ; un filet à 3,5 s révèle ce qui n'aurait pas armé.
   Le mouvement n'est jamais porteur d'information.
