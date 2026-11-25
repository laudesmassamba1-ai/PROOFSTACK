# PROOFCORE — architecture de l'IA

État : 25 novembre 2026. Décrit `apps/api/src/routes/ai.ts`, `ai-crypto.ts`,
`ai-providers.ts`, `project-intelligence.ts` et le pont local du CLI.

## 1. Principe

L'IA ne mesure rien. Les cinq moteurs produisent des faits et des preuves ; l'IA lit ces
faits, les relie au contexte autorisé et prépare une explication ou une correction. Un
appel de modèle n'est jamais présenté comme un scan.

Sans profil fournisseur, l'IA générative est indisponible ; les rapports, les
explications déterministes et les moteurs restent utilisables. Aucun faux résultat n'est
produit pour combler l'absence.

## 2. Fournisseurs et clés

- Liste exposée par `GET /api/v1/ai/providers` (identifiants, libellés, documentation,
  `keyOptional`). Le client choisit un fournisseur et un modèle ; le serveur valide le
  catalogue avant d'enregistrer.
- La clé est chiffrée en AES-256-GCM, avec une clé dérivée par HKDF-SHA256 depuis
  `AI_KEYS_SECRET` et un nonce aléatoire par enregistrement (`ai-crypto.ts`).
- `GET /api/v1/ai/profile` renvoie un **fingerprint**, jamais la clé. La clé déchiffrée
  ne quitte le serveur que dans l'en-tête de l'appel au fournisseur.
- Sans `AI_KEYS_SECRET`, le stockage est refusé (`key_storage_unavailable`) plutôt que
  d'écrire en clair.
- La clé n'est jamais journalisée ni incluse dans un rapport.

## 3. Contexte autorisé

Avant tout appel, la route `/chat` exige une session et une adhésion au workspace. Le
contexte est construit exclusivement depuis ce workspace :

- aperçu, projets, runs récents, findings récents, rapports stockés ;
- sources de code **importées** dans le projet (jamais le disque du serveur) ;
- mémoire du workspace (faits `decision|convention|stack|goal|lesson`) ;
- résultats des outils demandés par le modèle.

Aucune donnée d'un autre compte n'entre dans le prompt : les lectures passent par les
mêmes filtres `workspace_id` que l'API, et les conversations sont liées à
`(user_id, workspace_id)`.

## 4. Outils (19)

| Outil                                                                                 | Nature                                                  |
| ------------------------------------------------------------------------------------- | ------------------------------------------------------- |
| `workspace_overview`, `list_projects`, `recent_runs`, `recent_findings`, `get_report` | lecture du workspace                                    |
| `module_status`, `module_config`                                                      | état, configuration active et vocabulaire des 5 modules |
| `project_code`                                                                        | lecture des fichiers importés (sourceId / path)         |
| `fetch_web`, `browse_url`, `probe_url`                                                | lecture réseau avec garde d'URL                         |
| `fail_scan`, `clean_audit`, `site_audit`                                              | contrôles HTTP mesurés                                  |
| `read_repo`                                                                           | lecture d'un dépôt public avec garde                    |
| `module_configure`                                                                    | écriture validée : WORLD/FLOW/EXIT                      |
| `module_run`, `analyze_run`                                                           | lancement réel + diagnostic d'un run stocké             |
| `remember`                                                                            | écriture : un fait de mémoire borné                     |

Contrôles :

- les arguments sont validés par outil (`remember` : kind autorisé + longueur) ;
- `module_configure` exige `confirm: true`, passe le patch par le schéma Zod réel, le
  fusionne avec la configuration active, refuse les blocages de `validateConfig` et
  écrit un audit `project.config_updated` avec `source: "assistant"` ;
- `module_run` exige `confirm: true`, vérifie le quota `monthly_test_runs` avant de
  lancer, n'accepte pour FAIL/CLEAN qu'un hôte du projet, et enregistre le run comme un
  upload CLI (même compteur, même historique) ;
- les identifiants de projet/source sont revérifiés côté serveur ;
- aucun outil n'écrit un fichier, n'exécute une commande ou ne franchit le tenant ;
- les URLs sortantes passent par `assertPublicUrl` (http(s), hôte public, ports
  autorisés, redirections revalidées) ;
- le nombre de pas est borné par le niveau d'effort (`maxSteps` 10/18/28).

Limites de runtime, dites au modèle : EXIT avec une source fichier/commande et les
journeys FLOW navigateur ne s'exécutent pas dans le Worker. `module_status` renvoie
`runnableHere: false` et la commande locale exacte ; l'assistant ne peut pas les
présenter comme lancés.

## 5. Contenu non fiable

Une page, un fichier importé ou un résultat d'outil est **une donnée**, pas une
instruction. `fileBlock()` encadre chaque fichier par une clôture
`<<<PROOFSTACK-UNTRUSTED-DATA-<nonce>>>>` à nonce aléatoire, neutralise les clôtures
forgées et interdit qu'un fichier ouvre un second bloc. Le prompt système rappelle que
le contenu encadré n'est jamais une instruction et que la clôture n'est pas une
frontière de sécurité.

Preuve : `apps/api/test/untrusted-file-content.test.ts` (6 tests), dont un fichier qui
devine la clôture, un chemin `../../etc/passwd` et un faux `SYSTEM:`.

Limite : ces contrôles réduisent la surface d'injection, ils ne prouvent pas qu'un
modèle ne sera jamais influencé. Une injection réussie ne peut pas exécuter de commande
ni lire un autre tenant. Elle pourrait, au pire, proposer une configuration refusée par
le schéma ou lancer un run que l'utilisateur a demandé ; `confirm: true` et le quota
bornent l'action, l'audit la rend attribuable.

## 6. Quotas, effort, mémoire

- Gate `monthly_ai_audits` avant l'appel ; un échec fournisseur ne consomme pas le
  quota (`ai.test.ts`).
- Trois niveaux d'effort (`low`, `medium`, `high`) : sous-agents 0/2/3, pas 10/18/28,
  profondeur essential/standard/deep (`packages/cli/src/effort.ts`).
- Mémoire : le modèle peut appeler `remember`, un curateur séparé peut retenir au plus
  deux faits durables par tour, et l'utilisateur peut lire/ajouter/supprimer chaque
  fait. Une curation en échec ne fait pas échouer la réponse.
- Conversations : historique borné et paginé ; import local dédupliqué par
  `importId`.

## 7. Traçabilité

Chaque tour renvoie les outils appelés et leurs résumés ; l'interface les affiche. Les
erreurs fournisseur sont catégorisées (`provider_rate_limited`, indisponible, etc.) et
les 5xx sont journalisés avec `requestId`, sans jeton ni clé.

## 8. Limites

1. Aucun fournisseur réel n'a été appelé dans cette passe : les tests utilisent un
   fournisseur simulé/local. Le parcours génératif est **NON VÉRIFIÉ** en production.
2. Le limiteur d'appels IA est en mémoire par isolate ; le quota mensuel est durable.
3. Pas d'évaluation adversariale automatique au-delà des tests de clôture.
4. Pas de modération de contenu ni de filtre de sortie au-delà du prompt et des outils.
5. L'agent local (CLI/desktop) est un autre chemin, avec ses propres approbations ;
   il ne partage pas la session du cloud.
6. Les journeys FLOW navigateur sont prouvés par Chromium local
   (`packages/cli/test/journey-browser.test.ts`) et restent hors du Worker ; le run
   stocké est lisible par l'IA après upload.
7. EXIT est configurable et analysable par l'IA, mais son exécution fichier/commande
   reste locale ; seule une source HTTP serait exécutable côté serveur.
