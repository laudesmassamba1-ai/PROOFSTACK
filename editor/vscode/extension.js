// PROOFCORE inline completions.
//
// The editor is only a front end: `proofcore complete --json` does the work, so the same
// completion is available from the terminal, from the MCP server and from here. When no
// model key is configured the CLI falls back to real project symbols instead of silence.
const vscode = require("node:vscode");
const { execFile } = require("node:child_process");

function binary() {
  return vscode.workspace.getConfiguration("proofcore").get("binary", "proofcore");
}

function completeAt(document, position) {
  const folder = vscode.workspace.getWorkspaceFolder(document.uri);
  const cwd = folder ? folder.uri.fsPath : undefined;
  const args = [
    "complete",
    document.uri.fsPath,
    "--line",
    String(position.line + 1),
    "--column",
    String(position.character + 1),
    "--json",
  ];
  return new Promise((resolve) => {
    execFile(binary(), args, { cwd, timeout: 20000, maxBuffer: 1024 * 1024 }, (error, stdout) => {
      if (error) return resolve([]);
      try {
        const payload = JSON.parse(stdout);
        const items = (payload.completions || []).map(
          (entry) =>
            new vscode.InlineCompletionItem(entry.text, new vscode.Range(position, position))
        );
        resolve(items);
      } catch {
        resolve([]);
      }
    });
  });
}

function activate(context) {
  const provider = {
    async provideInlineCompletionItems(document, position) {
      if (!vscode.workspace.getConfiguration("proofcore").get("enabled", true))
        return { items: [] };
      const items = await completeAt(document, position);
      return { items };
    },
  };
  context.subscriptions.push(
    vscode.languages.registerInlineCompletionItemProvider({ pattern: "**" }, provider)
  );
  context.subscriptions.push(
    vscode.commands.registerCommand("proofcore.complete", async () => {
      const editor = vscode.window.activeTextEditor;
      if (!editor) return;
      const items = await completeAt(editor.document, editor.selection.active);
      if (items.length === 0) {
        vscode.window.showInformationMessage("PROOFCORE: no completion here.");
        return;
      }
      await editor.insertSnippet(new vscode.SnippetString(items[0].insertText));
    })
  );
}

function deactivate() {}

module.exports = { activate, deactivate };
