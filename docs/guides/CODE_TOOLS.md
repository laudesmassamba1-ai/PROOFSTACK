# Outils de code de l'assistant

Un assistant qui écrit du code sans pouvoir le lire, l'exécuter ou le corriger produit des
réponses plausibles et fausses. Ce document décrit ce que PROOFCORE expose réellement, où
cela s'exécute, et ce qui manque encore.

## Où les outils tournent, et pourquoi

Les outils qui touchent au code s'exécutent **sur la machine du développeur**, exposés par
le serveur MCP (`proofcore mcp`). C'est la seule architecture correcte : un Worker
Cloudflare n'a pas accès à votre disque, donc un assistant hébergé ne peut pas lire vos
fichiers. Cursor, Windsurf et Claude Code fonctionnent tous ainsi.

Conséquence pratique : ces outils sont disponibles **immédiatement** dans votre éditeur
habituel, sans attendre une interface web.

```jsonc
// Claude Code / Cursor / Codex / OpenCode — configuration MCP
{
  "mcpServers": {
    "proofcore": { "command": "proofcore", "args": ["mcp"] }
  }
}
```

## Ce qui est livré

| Outil MCP                                                                                                         | Ce qu'il fait                                                                | Lecture seule |
| ----------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------- | ------------- |
| `list_files`                                                                                                      | arborescence du projet, `node_modules`/`dist`/build exclus                   | oui           |
| `read_file`                                                                                                       | lecture paginée **avec numéros de ligne**                                    | oui           |
| `search_code`                                                                                                     | recherche littérale ou regex (vrai parcours de fichiers)                     | oui           |
| `map_architecture`                                                                                                | graphe d'imports réel → diagramme Mermaid                                    | oui           |
| `write_file`                                                                                                      | écrit un fichier — **renvoie un diff et n'écrit rien** sans `apply:true`     | non           |
| `apply_patch`                                                                                                     | applique un diff unifié, refuse si le contexte ne correspond pas             | non           |
| `run_command`                                                                                                     | exécute une commande allowlistée, sans shell, avec délai et sortie plafonnée | non           |
| `git_status` / `git_diff` / `git_log`                                                                             | état, diff, historique                                                       | oui           |
| `git_commit`                                                                                                      | branche + commit de fichiers **explicites** (`git add -A` refusé)            | non           |
| `git_branch` / `git_show` / `git_blame` / `git_stage` / `git_unstage`                                             | branches, objets, attribution, index                                         | mixte         |
| `edit_file`                                                                                                       | remplacement exact de texte, une ou toutes les occurrences                   | non           |
| `delete_path` / `move_path` / `copy_path` / `make_directory` / `path_info`                                        | opérations de fichiers, chemins confinés au workspace                        | non           |
| `list_directory`                                                                                                  | un niveau, types et tailles                                                  | oui           |
| `run_shell`                                                                                                       | shell complet, pour ce qu'une allowlist ne couvre pas                        | non           |
| `http_request` / `web_fetch`                                                                                      | requête HTTP et extraction lisible d'une page                                | non / oui     |
| `system_info`                                                                                                     | OS, architecture, CPU, mémoire, chemins                                      | oui           |
| `browser_open` / `goto` / `snapshot` / `interact` / `eval` / `screenshot` / `pdf` / `cookies` / `pages` / `close` | navigateur réel sur Chromium, via CDP                                        | mixte         |
| `project_summary` / `doctor` / `validate_config` / `run_tests` / `last_report`                                    | surface PROOFCORE existante                                                  | mixte         |

## Navigateur intégré

Le navigateur n'emprunte ni Playwright ni service de rendu : `@proofcore/adapter-browser`
trouve un Chromium déjà installé (Chrome, Chromium, Edge, Brave sur Linux, macOS et
Windows), le lance avec un profil temporaire, et parle le DevTools Protocol sur un
WebSocket local. La même implémentation sert l'interface desktop (un `WebContentsView`
Electron) et les outils de l'assistant.

Un snapshot émet des références (`data-pc-ref`) vers les éléments visibles ; les actions
`click`, `type`, `key`, `scroll`, `select` et `upload` produisent de vrais événements
d'entrée sur ces références. Les références sont réémises à chaque snapshot, donc une page
qui change ne laisse pas l'assistant agir sur un élément disparu.

Limites assumées : un seul Chromium à la fois par processus, pas de gestion de profils
multi-utilisateurs, et aucune émulation mobile avancée. `browser_screenshot` et
`browser_pdf` renvoient un fichier dans le workspace, pas une image dans le contexte.

En ligne de commande, le graphe est aussi disponible seul :

```bash
proofcore map                 # résumé + diagramme Mermaid
proofcore map --mermaid       # uniquement le bloc Mermaid (README, docs)
proofcore map src --json      # structure complète pour un pipeline
```

## Les garde-fous, appliqués dans le code

Ils sont testés, pas seulement documentés (`packages/cli/test/code-tools.test.ts`, 31 tests) :

1. **Confinement au workspace** — `../../etc/passwd`, `/etc/passwd` et `src/../../x` sont
   refusés avant toute lecture.
2. **Aucune écriture sans diff** — `write_file` sans `apply:true` ne modifie rien et rend
   le diff unifié ; `apply_patch` valide sans écrire.
3. **Aucun patch approximatif** — si un hunk ne correspond pas, le patch entier est refusé
   (jamais d'application partielle, jamais de recherche « au plus proche »).
4. **Pas de shell** — `spawn(bin, args)` sans `shell: true`, allowlist d'exécutables, refus
   des métacaractères et de `git push --force` / `git reset --force`.
5. **Sortie déterministe** — `LC_ALL=C` : un message d'erreur destiné à un modèle ou à un
   rapport ne doit pas être traduit par le bureau de l'utilisateur.
6. **Plafonds** — lecture, recherche, arbre et sortie de commande sont bornés ; un agent qui
   aspire un dépôt entier dans la fenêtre de contexte est inutilisable.

## Registre des six catégories demandées

| Catégorie                         | Statut                                                                               | Où                      |
| --------------------------------- | ------------------------------------------------------------------------------------ | ----------------------- |
| Explorateur d'arborescence        | **livré**                                                                            | `list_files`            |
| Indexation sémantique (RAG)       | recherche lexicale **livrée**, embeddings à venir                                    | `search_code`           |
| Sélecteur de contexte granulaire  | **livré** côté client MCP (`@fichiers`, `@dossiers`)                                 | éditeur                 |
| Mémoire des règles projet         | **partiel** : `AGENTS.md`/`SKILL.md` sont lus par les agents ; fichier dédié à venir | —                       |
| Éditeur multi-fichiers + vue Diff | **livré côté outil** (diff obligatoire avant écriture) ; vue web à venir             | `write_file`            |
| Autocomplétion prédictive         | **non** — c'est un moteur d'inférence inline, hors périmètre                         | —                       |
| Aperçu en direct                  | **non livré** (nécessite un runtime navigateur côté client)                          | —                       |
| Diagrammes Mermaid/UML            | **livré** (graphe d'imports réel)                                                    | `map_architecture`      |
| Terminal intégré + logs           | **livré**                                                                            | `run_command`           |
| Bac à sable isolé                 | **partiel** : allowlist + pas de shell + délai, pas de conteneur                     | `run_command`           |
| Inspecteur navigateur / DevTools  | **non livré** ; l'audit FAIL/CLEAN couvre le HTTP                                    | —                       |
| Débogueur pas-à-pas               | **non** — nécessite un protocole de débogage                                         | —                       |
| Navigateur de documentation       | **livré**                                                                            | `fetch_web` (assistant) |
| Lecture de dépôts distants        | **livré** (GitHub/GitLab publics)                                                    | `read_repo` (assistant) |
| Git complet                       | **partiel** : état, diff, log, branche, commit ; merge/PR à venir                    | `git_*`                 |
| Client HTTP / base de données     | **partiel** : HTTP via `probe_url` ; SQL à venir (identifiants opérateur)            | —                       |
| Connecteurs de déploiement        | **non livré** (identifiants opérateur)                                               | —                       |
| Capture d'écran / import d'image  | **non livré**                                                                        | —                       |
| Générateur d'icônes SVG           | **non livré**                                                                        | —                       |

## Ce qui demande un identifiant (à fournir par l'opérateur)

| Fonction                                     | Variable                        | Sans elle                                             |
| -------------------------------------------- | ------------------------------- | ----------------------------------------------------- |
| Dépôts privés GitHub/GitLab                  | `GITHUB_TOKEN`                  | les dépôts privés répondent « not found, or private » |
| Lecture d'une base SQL                       | `DATABASE_URL` de l'utilisateur | non proposé                                           |
| Déploiement (Vercel, Cloudflare, Docker Hub) | jetons fournisseur              | non proposé                                           |

Règle : un jeton n'est jamais lu depuis un message de chat, seulement depuis la
configuration du serveur. Un assistant ne peut pas décider d'élargir ses propres droits.
