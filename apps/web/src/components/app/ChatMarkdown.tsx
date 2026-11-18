import { Check, Copy, Download } from "lucide-react";
import type React from "react";
import { useState } from "react";
import { type Token, tokenize } from "./highlight.js";

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
        {tokens.map((token) =>
          token.cls ? (
            // A token stream is positional by construction (two identical spans are
            // different tokens), so the offset in the code is the honest key here.
            <span key={`${token.cls}-${token.text}`} className={token.cls}>
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

/* ---------- print / PDF export ----------
 * The printed document gets the same treatment as the screen: the block parser's
 * grammar is re-walked to emit real HTML (tables are tables, code blocks keep
 * their syntax colours through `tokenize`), with a print stylesheet in the
 * design's typographic register. Nothing here trusts the message text — every
 * piece goes through `esc` before any markup is composed. */

function esc(value: string): string {
  return value.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

/** Inline markdown to HTML, on already-escaped text. */
function inlineHtml(value: string): string {
  return esc(value)
    .replace(/`([^`]+)`/g, "<code>$1</code>")
    .replace(/\*\*([^*]+)\*\*/g, "<strong>$1</strong>")
    .replace(/\*([^*\s][^*]*)\*/g, "<em>$1</em>")
    .replace(/\[([^\]]+)\]\(([^)\s]+)\)/g, '<a href="$2">$1</a>');
}

function codeBlockHtml(code: string, lang: string | undefined): string {
  const tokens = tokenize(code, lang);
  const body = tokens
    .map((token) =>
      token.cls ? `<span class="${token.cls}">${esc(token.text)}</span>` : esc(token.text)
    )
    .join("");
  return `<figure class="print-code"><figcaption>${esc(lang || "code")}</figcaption><pre><code>${body}</code></pre></figure>`;
}

function blocksToHtml(source: string): string {
  const lines = source.split("\n");
  const out: string[] = [];
  let index = 0;

  const flushList = (ordered: boolean, start: number): number => {
    const items: string[] = [];
    let cursor = start;
    const pattern = ordered ? /^\s*\d+[.)]\s+/ : /^\s*[-*]\s+/;
    while (cursor < lines.length && pattern.test(lines[cursor] ?? "")) {
      items.push(`<li>${inlineHtml((lines[cursor] ?? "").replace(pattern, ""))}</li>`);
      cursor += 1;
    }
    out.push(ordered ? `<ol>${items.join("")}</ol>` : `<ul>${items.join("")}</ul>`);
    return cursor;
  };

  while (index < lines.length) {
    const line = lines[index] ?? "";

    const fence = line.match(/^```(\w*)\s*$/);
    if (fence) {
      const body: string[] = [];
      index += 1;
      while (index < lines.length && !(lines[index] ?? "").startsWith("```")) {
        body.push(lines[index] ?? "");
        index += 1;
      }
      index += 1;
      out.push(codeBlockHtml(body.join("\n"), fence[1] || undefined));
      continue;
    }

    const heading = line.match(/^(#{1,4})\s+(.*)$/);
    if (heading) {
      const level = (heading[1] ?? "").length;
      const tag = level <= 1 ? "h2" : level === 2 ? "h3" : "h4";
      out.push(`<${tag}>${inlineHtml(heading[2] ?? "")}</${tag}>`);
      index += 1;
      continue;
    }

    if (/^\s*(---+|\*\*\*+)\s*$/.test(line)) {
      out.push("<hr>");
      index += 1;
      continue;
    }

    if (/^\s*\|.+\|\s*$/.test(line) && /^\s*\|[\s:|-]+\|\s*$/.test(lines[index + 1] ?? "")) {
      const cells = (row: string) =>
        row
          .trim()
          .replace(/^\||\|$/g, "")
          .split("|")
          .map((cell) => cell.trim());
      const head = cells(line)
        .map((cell) => `<th>${inlineHtml(cell)}</th>`)
        .join("");
      index += 2;
      const rows: string[] = [];
      while (index < lines.length && /^\s*\|.+\|\s*$/.test(lines[index] ?? "")) {
        rows.push(
          `<tr>${cells(lines[index] ?? "")
            .map((cell) => `<td>${inlineHtml(cell)}</td>`)
            .join("")}</tr>`
        );
        index += 1;
      }
      out.push(`<table><thead><tr>${head}</tr></thead><tbody>${rows.join("")}</tbody></table>`);
      continue;
    }

    if (/^>\s?/.test(line)) {
      const quoted: string[] = [];
      while (index < lines.length && /^>\s?/.test(lines[index] ?? "")) {
        quoted.push((lines[index] ?? "").replace(/^>\s?/, ""));
        index += 1;
      }
      out.push(`<blockquote>${blocksToHtml(quoted.join("\n"))}</blockquote>`);
      continue;
    }

    if (/^\s*[-*]\s+/.test(line)) {
      index = flushList(false, index);
      continue;
    }

    if (/^\s*\d+[.)]\s+/.test(line)) {
      index = flushList(true, index);
      continue;
    }

    if (!line.trim()) {
      index += 1;
      continue;
    }

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
    out.push(`<p>${inlineHtml(paragraph.join("\n"))}</p>`);
  }
  return out.join("\n");
}

export function printConversation(
  messages: { role: string; content: string }[],
  title: string
): void {
  const body = messages
    .map((message) =>
      message.role === "user"
        ? `<div class="print-user">${blocksToHtml(message.content)}</div>`
        : `<div class="print-ai">${blocksToHtml(message.content)}</div>`
    )
    .join("\n");
  const win = window.open("", "_blank", "width=820,height=920");
  if (!win) return;
  win.document.write(`<!doctype html>
<html lang="fr"><head><meta charset="utf-8"><title>${esc(title)}</title>
<style>
  :root { color-scheme: light; }
  body {
    font: 10.5pt/1.65 "Georgia", "Times New Roman", serif;
    color: #17150f;
    max-width: 46rem;
    margin: 2.6rem auto 3rem;
    padding: 0 1.1rem;
  }
  header.print-head { border-bottom: 2px solid #17150f; padding-bottom: 0.9rem; margin-bottom: 2rem; }
  header.print-head .mark { font: 700 10pt "JetBrains Mono", ui-monospace, monospace; letter-spacing: 0.22em; }
  h1 { font-size: 13pt; letter-spacing: 0.1em; text-transform: uppercase; margin: 0.7rem 0 0.2rem; }
  .meta { font: 8.5pt "JetBrains Mono", ui-monospace, monospace; color: #8a8577; margin: 0; }
  .print-user {
    background: #f4f1e9;
    border: 1px solid #e4dfd2;
    border-radius: 10px;
    padding: 0.8rem 1.1rem;
    margin: 1.4rem 0 0.5rem;
    font-family: -apple-system, "Segoe UI", sans-serif;
    font-size: 10pt;
  }
  .print-ai { padding: 0.2rem 0 1.2rem; margin: 0.3rem 0 1rem; }
  .print-ai > :first-child { margin-top: 0; }
  h2 { font-size: 12.5pt; border-bottom: 1px solid #e4dfd2; padding-bottom: 0.3rem; margin: 1.6rem 0 0.6rem; }
  h3 { font-size: 11pt; margin: 1.4rem 0 0.5rem; }
  h4 { font: 600 8.5pt "JetBrains Mono", ui-monospace, monospace; letter-spacing: 0.07em; text-transform: uppercase; color: #57503f; margin: 1.2rem 0 0.4rem; }
  p { margin: 0.5rem 0; }
  ul, ol { margin: 0.5rem 0; padding-left: 1.4rem; }
  li { margin: 0.25rem 0; }
  blockquote { border-left: 2px solid #c9c2ae; margin: 0.6rem 0; padding: 0.2rem 0 0.2rem 0.9rem; color: #57503f; }
  hr { border: 0; border-top: 1px solid #e4dfd2; margin: 1.4rem 0; }
  code {
    font: 9pt "JetBrains Mono", ui-monospace, monospace;
    background: #f4f1e9;
    padding: 0.08em 0.32em;
    border-radius: 4px;
  }
  figure.print-code {
    border: 1px solid #e4dfd2;
    border-radius: 10px;
    overflow: hidden;
    margin: 0.8rem 0;
    page-break-inside: avoid;
  }
  figure.print-code figcaption {
    font: 600 7.5pt "JetBrains Mono", ui-monospace, monospace;
    letter-spacing: 0.12em;
    text-transform: uppercase;
    background: #efece2;
    border-bottom: 1px solid #e4dfd2;
    padding: 0.35rem 0.8rem;
    color: #57503f;
  }
  figure.print-code pre {
    margin: 0;
    padding: 0.7rem 0.9rem;
    font: 9pt/1.6 "JetBrains Mono", ui-monospace, monospace;
    overflow-x: auto;
  }
  /* Syntax palette — same roles as the app, tuned for the paper print sheet. */
  .tok-key { color: #b13a2e; font-weight: 600; }
  .tok-str { color: #0e6e59; }
  .tok-num { color: #a05a12; }
  .tok-fn, .tok-tag, .tok-sel { color: #1d4ed8; }
  .tok-bif, .tok-prop, .tok-attr, .tok-flag { color: #0e6e59; }
  .tok-var { color: #6d28d9; }
  .tok-com { color: #9a927c; font-style: italic; }
  .tok-punc { color: #6b6350; }
  table { border-collapse: collapse; width: 100%; margin: 0.8rem 0; font-size: 9.5pt; page-break-inside: avoid; }
  th {
    text-align: left;
    font: 600 8pt "JetBrains Mono", ui-monospace, monospace;
    letter-spacing: 0.06em;
    text-transform: uppercase;
    color: #57503f;
    border-bottom: 1.5px solid #17150f;
    padding: 0.35rem 0.6rem;
  }
  td { border-bottom: 1px solid #e4dfd2; padding: 0.35rem 0.6rem; vertical-align: top; }
  tbody tr:nth-child(even) td { background: #faf8f1; }
  a { color: #1d4ed8; }
  @page { margin: 1.6cm; }
  @media print {
    body { max-width: none; margin: 0; }
    .print-user, figure.print-code { page-break-inside: avoid; }
    .print-ai { page-break-after: auto; }
  }
</style></head><body>
<header class="print-head">
  <p class="mark">PROOFCORE</p>
  <h1>${esc(title)}</h1>
  <p class="meta">${new Date().toLocaleString("fr-FR")}</p>
</header>
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
    window.setTimeout(trigger, 200);
  } else {
    win.addEventListener("load", () => window.setTimeout(trigger, 200));
  }
}
