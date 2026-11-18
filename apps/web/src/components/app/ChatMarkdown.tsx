import { Check, Copy, Download } from "lucide-react";
import type React from "react";
import { useState } from "react";
import { tokenize, type Token } from "./highlight.js";

/**
 * The assistant's text surface, at the standard set by Claude/GPT.
 *
 * Block parsing: fenced code first (it may contain anything), then headings,
 * lists, blockquotes, tables, rules and paragraphs. Inline parsing: `code`,
 * **bold**, *italic* and [links](url). No dependency: the assistant's answers
 * are prose with code, not documents, so a small honest parser beats a 40 kB
 * renderer that would pull its own escaping rules into the bundle.
 *
 * Every code block carries a copy button; message-level actions (copy, .md
 * download) live beside the message in AiChat.
 */

/* ---------- inline ---------- */

function Inline({ text }: { text: string }): React.ReactNode[] {
  const nodes: React.ReactNode[] = [];
  // One regex walk for `code`, **bold**, *italic* and [text](url).
  const pattern = /(`[^`]+`)|(\*\*[^*]+\*\*)|(\*[^*\s][^*]*\*)|(\[[^\]]+\]\([^)\s]+\))/g;
  let last = 0;
  let key = 0;
  // A `for` loop keeps the assignment out of the condition, which the linter rejects and
  // which hides the fact that `exec` both tests and advances.
  for (let match = pattern.exec(text); match !== null; match = pattern.exec(text)) {
    if (match.index > last) nodes.push(text.slice(last, match.index));
    const token = match[0];
    const k = `i${key++}`;
    if (token.startsWith("`")) {
      nodes.push(
        <code key={k} className="chat-inline-code">
          {token.slice(1, -1)}
        </code>
      );
    } else if (token.startsWith("**")) {
      nodes.push(<strong key={k}>{token.slice(2, -2)}</strong>);
    } else if (token.startsWith("*")) {
      nodes.push(<em key={k}>{token.slice(1, -1)}</em>);
    } else {
      const label = token.slice(1, token.indexOf("]"));
      const href = token.slice(token.indexOf("(") + 1, -1);
      nodes.push(
        <a key={k} href={href} target="_blank" rel="noreferrer" className="chat-link">
          {label}
        </a>
      );
    }
    last = match.index + token.length;
  }
  if (last < text.length) nodes.push(text.slice(last));
  return nodes;
}

/* ---------- code block ---------- */

/** Renders one token as its span; tokens never carry raw HTML. */
function HighlightedCode({ code, lang }: { code: string; lang?: string }) {
  const tokens: Token[] = tokenize(code, lang);
  return (
    <pre className="chat-code-body">
      <code>
        {tokens.map((token, index) =>
          token.cls ? (
            <span key={index} className={token.cls}>
              {token.text}
            </span>
          ) : (
            token.text
          )
        )}
      </code>
    </pre>
  );
}

function CodeBlock({ code, lang }: { code: string; lang?: string }): React.ReactElement {
  const [copied, setCopied] = useState(false);
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(code);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1600);
    } catch {
      // Clipboard can be denied; the text stays selectable either way.
    }
  };
  return (
    <figure className="chat-code">
      <figcaption className="chat-code-bar">
        <span className="chat-code-lang">{lang || "code"}</span>
        <button type="button" className="chat-code-copy" onClick={() => void copy()}>
          {copied ? <Check size={12} /> : <Copy size={12} />}
          {copied ? "Copié" : "Copier"}
        </button>
      </figcaption>
      <HighlightedCode code={code} lang={lang} />
    </figure>
  );
}

/* ---------- block parser ---------- */

function renderBlocks(source: string): React.ReactNode[] {
  const out: React.ReactNode[] = [];
  const lines = source.split("\n");
  let index = 0;
  let key = 0;
  const nextKey = () => `b${key++}`;

  while (index < lines.length) {
    const line = lines[index] ?? "";

    // Fenced code block.
    const fence = line.match(/^```(\w*)\s*$/);
    if (fence) {
      const lang = fence[1] || undefined;
      const body: string[] = [];
      index += 1;
      while (index < lines.length && !(lines[index] ?? "").startsWith("```")) {
        body.push(lines[index] ?? "");
        index += 1;
      }
      index += 1; // closing fence
      out.push(<CodeBlock key={nextKey()} code={body.join("\n")} lang={lang} />);
      continue;
    }

    // Heading.
    const heading = line.match(/^(#{1,4})\s+(.*)$/);
    if (heading) {
      const level = (heading[1] ?? "").length;
      const Tag = (level <= 1 ? "h3" : level === 2 ? "h4" : "h5") as "h3" | "h4" | "h5";
      out.push(<Tag key={nextKey()}>{Inline({ text: heading[2] ?? "" })}</Tag>);
      index += 1;
      continue;
    }

    // Rule.
    if (/^\s*(---+|\*\*\*+)\s*$/.test(line)) {
      out.push(<hr key={nextKey()} className="chat-rule" />);
      index += 1;
      continue;
    }

    // Table: a header row with | … | followed by a |---|---| separator.
    if (/^\s*\|.+\|\s*$/.test(line) && /^\s*\|[\s:|-]+\|\s*$/.test(lines[index + 1] ?? "")) {
      const cells = (row: string) =>
        row
          .trim()
          .replace(/^\||\|$/g, "")
          .split("|")
          .map((cell) => cell.trim());
      const head = cells(line);
      index += 2;
      const rows: string[][] = [];
      while (index < lines.length && /^\s*\|.+\|\s*$/.test(lines[index] ?? "")) {
        rows.push(cells(lines[index] ?? ""));
        index += 1;
      }
      out.push(
        <div key={nextKey()} className="chat-table-wrap">
          <table className="chat-table">
            <thead>
              <tr>
                {head.map((cell) => (
                  <th key={`h-${cell}`}>{Inline({ text: cell })}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {rows.map((row) => (
                <tr key={`r-${row.join("|")}`}>
                  {row.map((cell) => (
                    <td key={`c-${cell}`}>{Inline({ text: cell })}</td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      );
      continue;
    }

    // Blockquote.
    if (/^>\s?/.test(line)) {
      const quoted: string[] = [];
      while (index < lines.length && /^>\s?/.test(lines[index] ?? "")) {
        quoted.push((lines[index] ?? "").replace(/^>\s?/, ""));
        index += 1;
      }
      out.push(
        <blockquote key={nextKey()} className="chat-quote">
          {renderBlocks(quoted.join("\n"))}
        </blockquote>
      );
      continue;
    }

    // Unordered list.
    if (/^\s*[-*]\s+/.test(line)) {
      const items: string[] = [];
      while (index < lines.length && /^\s*[-*]\s+/.test(lines[index] ?? "")) {
        items.push((lines[index] ?? "").replace(/^\s*[-*]\s+/, ""));
        index += 1;
      }
      out.push(
        <ul key={nextKey()}>
          {items.map((item) => (
            <li key={`l-${item}`}>{Inline({ text: item })}</li>
          ))}
        </ul>
      );
      continue;
    }

    // Ordered list.
    if (/^\s*\d+[.)]\s+/.test(line)) {
      const items: string[] = [];
      while (index < lines.length && /^\s*\d+[.)]\s+/.test(lines[index] ?? "")) {
        items.push((lines[index] ?? "").replace(/^\s*\d+[.)]\s+/, ""));
        index += 1;
      }
      out.push(
        <ol key={nextKey()}>
          {items.map((item) => (
            <li key={`l-${item}`}>{Inline({ text: item })}</li>
          ))}
        </ol>
      );
      continue;
    }

    // Blank line.
    if (!line.trim()) {
      index += 1;
      continue;
    }

    // Paragraph: consume until a blank line or a new block starts.
    const paragraph: string[] = [];
    while (
      index < lines.length &&
      (lines[index] ?? "").trim() !== "" &&
      !/^```/.test(lines[index] ?? "") &&
      !/^#{1,4}\s/.test(lines[index] ?? "") &&
      !/^\s*[-*]\s+/.test(lines[index] ?? "") &&
      !/^\s*\d+[.)]\s+/.test(lines[index] ?? "") &&
      !/^>\s?/.test(lines[index] ?? "") &&
      !/^\s*\|.+\|\s*$/.test(lines[index] ?? "")
    ) {
      paragraph.push(lines[index] ?? "");
      index += 1;
    }
    out.push(
      <p key={nextKey()} className="chat-p">
        {Inline({ text: paragraph.join("\n") })}
      </p>
    );
  }
  return out;
}

export function ChatMarkdown({ text }: { text: string }): React.ReactElement {
  // Providers answer with CRLF endings sometimes; the block parser splits on \n
  // and a stray \r would break the table and fence matches at line end.
  return <div className="chat-prose">{renderBlocks(text.replace(/\r\n?/g, "\n"))}</div>;
}

/* ---------- message-level actions ---------- */

export function MessageActions({ text, fr }: { text: string; fr: boolean }): React.ReactElement {
  const [copied, setCopied] = useState(false);
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(text);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1600);
    } catch {
      /* ignore */
    }
  };
  const download = () => {
    const blob = new Blob([text], { type: "text/markdown;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = `proofcore-reponse-${Date.now()}.md`;
    anchor.click();
    URL.revokeObjectURL(url);
  };
  return (
    <div className="chat-msg-actions">
      <button type="button" onClick={() => void copy()} className="chat-action-btn">
        {copied ? <Check size={12} /> : <Copy size={12} />}
        {copied ? (fr ? "Copié" : "Copied") : fr ? "Copier" : "Copy"}
      </button>
      <button type="button" onClick={download} className="chat-action-btn">
        <Download size={12} />
        {fr ? "Exporter .md" : "Export .md"}
      </button>
    </div>
  );
}

/* ---------- conversation print (browser "Save as PDF") ---------- */

export function printConversation(
  messages: { role: string; content: string }[],
  title: string
): void {
  const esc = (value: string) =>
    value.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
  // Blocks are pre-escaped; inline markdown is applied afterwards on the escaped
  // text so user content can never inject markup.
  const inline = (value: string) =>
    esc(value)
      .replace(/`([^`]+)`/g, "<code>$1</code>")
      .replace(/\*\*([^*]+)\*\*/g, "<strong>$1</strong>")
      .replace(/\*([^*\s][^*]*)\*/g, "<em>$1</em>")
      .replace(/\n/g, "<br>");
  const body = messages
    .map((message) =>
      message.role === "user"
        ? `<div class="user">${inline(message.content)}</div>`
        : `<div class="ai">${inline(message.content)}</div>`
    )
    .join("\n");
  const win = window.open("", "_blank", "width=820,height=920");
  if (!win) return;
  win.document.write(`<!doctype html>
<html lang="fr"><head><meta charset="utf-8"><title>${esc(title)}</title>
<style>
  body { font: 12pt/1.6 Georgia, "Times New Roman", serif; color: #111; max-width: 46rem; margin: 3rem auto; padding: 0 1rem; }
  h1 { font-size: 14pt; letter-spacing: 0.08em; text-transform: uppercase; border-bottom: 1px solid #111; padding-bottom: 0.4rem; }
  .meta { font: 9pt monospace; color: #666; margin-bottom: 2rem; }
  .user { background: #f2f0ea; border-radius: 8px; padding: 0.7rem 1rem; margin: 1.2rem 0 0.4rem; }
  .ai { padding: 0.2rem 0 1rem; border-left: 2px solid #ddd; padding-left: 1rem; margin: 0.4rem 0 1.4rem; }
  code { font: 9.5pt "JetBrains Mono", ui-monospace, monospace; background: #f2f0ea; padding: 0.05em 0.3em; border-radius: 3px; }
</style></head><body>
<h1>${esc(title)}</h1>
<p class="meta">PROOFCORE · ${new Date().toLocaleString("fr-FR")}</p>
${body}
</body></html>`);
  win.document.close();
  // No inline script in the generated document: the app's CSP is `script-src
  // 'self'`, and an about:blank popup inherits it, which would block the
  // print-on-load snippet. The opener drives the print dialog instead.
  const trigger = () => {
    win.focus();
    win.print();
  };
  if (win.document.readyState === "complete") {
    window.setTimeout(trigger, 150);
  } else {
    win.addEventListener("load", () => window.setTimeout(trigger, 150));
  }
}
