# Copywriting guidelines — workspace

## Voice

Terse, exact, calm, occasionally dry. Every sentence answers one of: what is this,
what does it show, what happened, why it matters, what can I do, what happens next.

Do not sound impressed by the software. Do not congratulate the user for loading a page.

## Banned phrases

English: unlock, supercharge, revolutionize, next level, seamless, empower, journey,
endless possibilities, “Welcome back 👋”.

French: « libérez votre potentiel », « révolutionnez », « passez à la vitesse
supérieure », « votre aventure commence ici », « exploitez toute la puissance ».

Also banned: exclamation marks in status text, emoji as icons, “healthy”, “secure” or
“verified” when nothing has run.

## Status vocabulary

| Internal | FR | EN |
| --- | --- | --- |
| not tested | Non testé | Not tested |
| needs setup | À configurer | Needs setup |
| running | En cours | Running |
| passed | Réussi | Passed |
| failed | Échec | Failed |
| warning | Avertissement | Warning |
| partial | Incomplet | Incomplete |
| unavailable | Indisponible | Unavailable |

The UI must not translate raw API codes into new claims. `NOTHING_VERIFIED` is shown as
“nothing verified”; `SKIPPED` is never “passed”.

## Headlines

Use the real state, not a slogan:

- No project: `AUCUN PROJET.` / `NO PROJECT.`
- Project, no run: `AUCUNE EXÉCUTION.` / `NO RUN YET.`
- Failures: `{n} ÉCHEC(S) À EXAMINER.` / `{n} FAILURE(S) TO REVIEW.`
- Runs, no failure: `AUCUNE ANOMALIE.` / `NO ANOMALY.`

Support line: latest project, module, relative time, or the next command. Never invent
a success rate.

## Actions

Use verbs that name the operation:

- `Créer un projet` / `Create project`
- `Installer la CLI` / `Install the CLI`
- `Ouvrir le module` / `Open module`
- `Examiner les échecs` / `Review failures`
- `Créer un token projet` / `Create project token`

`Upgrade` may appear only next to a real plan and a real checkout. It is not a generic
CTA.

## Empty states

Format: state → consequence → next action → optional Tester.

> No run yet.  
> The project exists, but no result has been uploaded. Install the CLI, run the checks,
> then sync. Until then, cases are untested — not passed.

Testers may carry real-looking data strings in their bubbles: `Zoë-Marie N'Diaye`,
`ß ≠ SS ?`, `名前`, `+229 01 97 …`, `1 234,56 €`, `export_final_v2.csv`. Humour is dry
and technical. Never in errors, billing or destructive confirmations.

## Errors

State what happened and whether data changed. Do not expose stack traces, internal
addresses or provider secrets. Development diagnostics stay behind `import.meta.env.DEV`.

> Service temporarily unavailable.  
> The server connection did not complete. Your data was not confirmed.

## Billing

Plain, exact, no pressure. Say “prepaid period”, “renew manually” and “verified payment”
when true. A redirect never activates a plan. A failed payment is shown, not hidden.

## Loading

Describe the work, not a feeling: “Loading WORLD activity…”, “Checking the workspace
connection…”. A Tester may walk; a generic shimmer is not the default.
