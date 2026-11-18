# PROOFCORE for VS Code

Inline completions backed by `proofcore complete --json`.

## Status, stated plainly

The CLI side is tested (`packages/cli/test/agent-extra-tools.test.ts` covers the completion
path, including the no-key fallback). **This extension wrapper is not verified inside a real
VS Code window** — there is no editor in this environment. Treat it as source to install and
try, not as a tested artefact.

## Install

```bash
npm i -g proofcore          # provides the `proofcore` binary
mkdir -p ~/.vscode/extensions/proofcore-0.1.0
cp editor/vscode/* ~/.vscode/extensions/proofcore-0.1.0/
```

Then reload the window. Completions appear as grey ghost text; `Tab` accepts.

## How it decides what to suggest

1. If `PROOFCORE_AI_BASE_URL`, `PROOFCORE_AI_MODEL` and `PROOFCORE_AI_KEY` are set (or
   `proofcore agent --configure` was run), the configured model is asked.
2. Otherwise the local semantic index supplies real symbols from your project:
   `proofcore index` first, then it answers from your own code.

Either way the answer comes from an executed command, never from a placeholder.

## Configuration

| Setting             | Default     | Meaning                |
| ------------------- | ----------- | ---------------------- |
| `proofcore.binary`  | `proofcore` | Path to the executable |
| `proofcore.enabled` | `true`      | Suggest as you type    |

## Limits

- One completion, inserted verbatim; no multi-line ranking or context selection beyond the
  cursor position.
- The extension spawns the CLI per invocation. That is fine for on-demand use; a language
  server would be the next step for keystroke-level latency.
