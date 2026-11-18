/**
 * A small, honest syntax highlighter for the chat's code blocks.
 *
 * Why not Prism/Shiki: the assistant's answers carry a handful of languages
 * (ts/js, json, html, css, bash, python) and the block surface must stay inside
 * the paper/ink design system in both themes — token classes themed from the
 * design tokens beat a foreign theme stylesheet, and ~2 KB beats a 12–280 KB
 * grammar engine for prose-adjacent code. Shiki remains the right upgrade if
 * the docs site later needs full TextMate fidelity.
 *
 * The tokenizer walks each language family with one ordered regex: comments,
 * strings, numbers, keywords, builtins, tags, attributes, punctuation. It never
 * interprets the text — every token is rendered through React text nodes.
 */

export interface Token {
  text: string;
  /** CSS class in global.css (`tok-*`); absent for plain code. */
  cls?: string;
}

const KEYWORDS =
  /\b(?:const|let|var|function|return|if|else|for|while|switch|case|break|continue|new|class|extends|super|import|from|export|default|async|await|try|catch|finally|throw|typeof|instanceof|delete|in|of|do|yield|static|get|set|interface|type|enum|implements|public|private|protected|readonly|abstract|as|satisfies|namespace|declare|module|def|elif|lambda|pass|raise|with|not|and|or|is|None|True|False|self|print|null|undefined|true|false|then|fi|esac|elif|echo|export|local|function|end|begin)\b/;

const BUILTIN =
  /\b(?:console|window|document|JSON|Math|Object|Array|String|Number|Boolean|Promise|Map|Set|Date|Error|fetch|setTimeout|setInterval|process|require|React|useEffect|useState|useRef|useMemo|useCallback|useId)\b/;

interface Family {
  // Order matters: earlier groups win. Each entry is [name, source].
  rules: Array<[string, RegExp]>;
}

const FAMILIES: Record<string, Family> = {
  script: {
    rules: [
      ["com", /\/\/[^\n]*|\/\*[\s\S]*?\*\/|#[^\n]*/],
      ["str", /`(?:\\.|[^`\\])*`|"(?:\\.|[^"\\\n])*"|'(?:\\.|[^'\\\n])*'/],
      ["num", /\b\d[\d_]*(?:\.\d+)?(?:e[+-]?\d+)?\b|\b0x[\da-fA-F]+\b/],
      ["key", KEYWORDS],
      ["fn", /\b[A-Za-z_$][\w$]*(?=\s*\()/],
      ["bif", BUILTIN],
      ["punc", /[{}[\]();,.:?!<>=+\-*/%&|^~]+/],
    ],
  },
  json: {
    rules: [
      ["prop", /"(?:\\.|[^"\\])*"(?=\s*:)/],
      ["str", /"(?:\\.|[^"\\])*"/],
      ["num", /-?\b\d[\d.]*(?:e[+-]?\d+)?\b/i],
      ["key", /\b(?:true|false|null)\b/],
      ["punc", /[{}[\],:]+/],
    ],
  },
  markup: {
    rules: [
      ["com", /<!--[\s\S]*?-->/],
      ["tag", /<\/?[a-zA-Z][\w-]*/],
      ["attr", /[a-zA-Z-]+(?==)/],
      ["str", /"(?:\\.|[^"\\])*"|'(?:\\.|[^'\\])*'/],
      ["punc", /[<>/=]+/],
    ],
  },
  css: {
    rules: [
      ["com", /\/\*[\s\S]*?\*\//],
      ["str", /"(?:\\.|[^"\\])*"|'(?:\\.|[^'\\])*'/],
      ["prop", /[-a-zA-Z]+(?=\s*:)/],
      ["num", /#[\da-fA-F]{3,8}\b|\b\d[\d.]*(?:px|rem|em|%|vh|vw|s|ms)?\b/],
      ["key", /@[\w-]+|!important\b|\b[a-z-]+(?=\()/],
      ["sel", /[.#]?[\w-]+(?=[^;{}]*\{)/],
      ["punc", /[{}();:,]+/],
    ],
  },
  shell: {
    rules: [
      ["com", /#[^\n]*/],
      ["str", /"(?:\\.|[^"\\])*"|'(?:\\.|[^'\\])*'/],
      ["num", /\b\d[\d.]*\b/],
      ["flag", /\s-{1,2}[\w-]+/],
      [
        "key",
        /\b(?:if|then|else|fi|for|while|do|done|case|esac|in|function|export|local|return|echo|cd|sudo|npm|pnpm|npx|node|git|curl|proofcore)\b/,
      ],
      ["var", /\$\{?[\w]+\}?/],
      ["punc", /[|&;(){}<>]+/],
    ],
  },
};

function familyFor(lang: string | undefined): Family {
  const id = (lang ?? "").toLowerCase();
  if (id in FAMILIES) return FAMILIES[id] as Family;
  if (/^(js|jsx|ts|tsx|mjs|cjs|javascript|typescript|py|python)$/.test(id)) {
    return FAMILIES.script as Family;
  }
  if (/^(html|xml|svg|vue|svelte)$/.test(id)) return FAMILIES.markup as Family;
  if (/^(css|scss|less)$/.test(id)) return FAMILIES.css as Family;
  if (/^(sh|bash|zsh|shell|console|terminal)$/.test(id)) return FAMILIES.shell as Family;
  // No family: plain text, but the caller still gets one safe token.
  return { rules: [] };
}

/**
 * Tokenizes `code` for `lang`. Unknown text always becomes plain tokens, so the
 * caller can render output directly without escaping concerns.
 */
export function tokenize(code: string, lang: string | undefined): Token[] {
  const family = familyFor(lang);
  if (family.rules.length === 0) return [{ text: code }];
  // One combined regex: each family rule becomes a numbered group; a match's
  // group index names its class.
  const sources = family.rules.map(([, source]) => `(${source.source})`);
  const combined = new RegExp(sources.join("|"), "g");
  const tokens: Token[] = [];
  let last = 0;
  // `for` keeps the assignment out of the loop condition: `exec` both tests and advances,
  // and hiding that behind an assignment is what the linter objects to.
  for (let match = combined.exec(code); match !== null; match = combined.exec(code)) {
    if (match.index > last) tokens.push({ text: code.slice(last, match.index) });
    const groupIndex = match.slice(1).findIndex((value) => value !== undefined);
    const [name] = family.rules[Math.max(0, groupIndex)] ?? [];
    tokens.push({ text: match[0], cls: name ? `tok-${name}` : undefined });
    last = match.index + match[0].length;
    if (match[0].length === 0) combined.lastIndex += 1; // safety against empty matches
  }
  if (last < code.length) tokens.push({ text: code.slice(last) });
  return tokens;
}
