/**
 * Unicode and international text primitives.
 *
 * These are the building blocks the WORLD module uses to decide whether a string
 * survived a round trip through a product intact. The rules encoded here are the
 * ones real implementations get wrong: length in code units is not length in
 * characters, NFC and NFD look identical but are not equal, and a grapheme cluster
 * can be several code points.
 */

export type NormalizationForm = "NFC" | "NFD" | "NFKC" | "NFKD";

export function normalize(value: string, form: NormalizationForm = "NFC"): string {
  return value.normalize(form);
}

/** Combine a base letter and a combining mark the way a user expects to see it. */
export function composeStrict(value: string): string {
  return value.normalize("NFC");
}

export function decompose(value: string): string {
  return value.normalize("NFD");
}

const COMBINING_MARKS = /[\u0300-\u036f\u1ab0-\u1aff\u1dc0-\u1dff\u20d0-\u20ff\ufe20-\ufe2f]/;

export function hasCombiningMarks(value: string): boolean {
  return COMBINING_MARKS.test(value);
}

/** Remove diacritics. Lossy by design; never used for equality, only for slugs. */
export function stripDiacritics(value: string): string {
  return value
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .normalize("NFC");
}

const segmenter = new Intl.Segmenter(undefined, { granularity: "grapheme" });

/** Count grapheme clusters ("🇧🇯" is 1, "é" as e+́ is 1). */
export function graphemeLength(value: string): number {
  let count = 0;
  for (const _ of segmenter.segment(value)) count++;
  return count;
}

export function codePointLength(value: string): number {
  return [...value].length;
}

/** Truncate on a grapheme boundary so no cluster is left half-decoded. */
export function truncateGraphemes(value: string, max: number): string {
  if (max <= 0) return "";
  let out = "";
  let n = 0;
  for (const { segment } of segmenter.segment(value)) {
    if (n >= max) break;
    out += segment;
    n++;
  }
  return out;
}

const RTL_RANGES: ReadonlyArray<readonly [number, number]> = [
  [0x0590, 0x05ff], // Hebrew
  [0x0600, 0x06ff], // Arabic
  [0x0700, 0x074f], // Syriac
  [0x0750, 0x077f], // Arabic supplement
  [0x08a0, 0x08ff], // Arabic extended A
  [0xfb1d, 0xfdff], // Hebrew presentation
  [0xfe70, 0xfeff], // Arabic presentation forms
];

const SCRIPTS = {
  latin: /[\p{Script=Latin}]/u,
  cyrillic: /[\p{Script=Cyrillic}]/u,
  arabic: /[\p{Script=Arabic}]/u,
  hebrew: /[\p{Script=Hebrew}]/u,
  han: /[\p{Script=Han}]/u,
  hiragana: /[\p{Script=Hiragana}]/u,
  katakana: /[\p{Script=Katakana}]/u,
  hangul: /[\p{Script=Hangul}]/u,
  devanagari: /[\p{Script=Devanagari}]/u,
  thai: /[\p{Script=Thai}]/u,
  greek: /[\p{Script=Greek}]/u,
  armenian: /[\p{Script=Armenian}]/u,
  tamil: /[\p{Script=Tamil}]/u,
} as const;

export type ScriptName = keyof typeof SCRIPTS;

export function detectScripts(value: string): ScriptName[] {
  const found: ScriptName[] = [];
  for (const [name, re] of Object.entries(SCRIPTS) as [ScriptName, RegExp][]) {
    if (re.test(value)) found.push(name);
  }
  return found;
}

/**
 * Direction of the *first strong* character, which is what a browser uses to set
 * base paragraph direction. Returns "neutral" for digits/punctuation only strings.
 */
export function textDirection(value: string): "rtl" | "ltr" | "neutral" {
  for (const ch of value) {
    const cp = ch.codePointAt(0) ?? 0;
    for (const [lo, hi] of RTL_RANGES) if (cp >= lo && cp <= hi) return "rtl";
    if (/\p{Script=Latin}|\p{Script=Cyrillic}|\p{Script=Han}|\p{Script=Hiragana}/u.test(ch))
      return "ltr";
  }
  return "neutral";
}

export function isRtl(value: string): boolean {
  return textDirection(value) === "rtl";
}

/**
 * Compare two strings the way a human reader would, after Unicode normalization.
 * `aeiou` vs `äëïöü` are different strings; `é` composed vs decomposed are the same.
 */
export function unicodeEquals(a: string, b: string): boolean {
  return a.normalize("NFC") === b.normalize("NFC");
}

export function localeCompare(a: string, b: string, locale?: string): number {
  return new Intl.Collator(locale, { sensitivity: "variant", numeric: true }).compare(a, b);
}

/** Case fold for identifier-ish comparison, locale independent by design. */
export function caseFold(value: string): string {
  return value.normalize("NFC").toLowerCase();
}

const BIDI_CONTROLS = /[\u200e\u200f\u202a-\u202e\u2066-\u2069]/;

/**
 * A display name that contains bidi isolates/overrides is a spoofing vector
 * ("biaƖi" style homoglyph attacks and direction inversions). Flagged, not dropped.
 */
export function containsBidiControls(value: string): boolean {
  return BIDI_CONTROLS.test(value);
}

const HOMOGLYPH_GROUPS = [
  ["0", "O", "o", "Ο", "ο", "О", "о", "ې"],
  ["1", "l", "I", "І", "і", "ӏ", "𝐈"],
  ["5", "S", "ѕ", "Ѕ"],
  ["8", "B", "Β", "в"],
  ["a", "а", "ɑ", "ӑ"],
  ["e", "е", "є", "ē"],
  ["x", "х", "х", "х"],
];

/** Report characters from a different script that look like an ASCII letter/digit. */
export function suspiciousHomoglyphs(value: string): string[] {
  const out: string[] = [];
  for (const ch of value) {
    if (ch.codePointAt(0)! < 128) continue;
    for (const group of HOMOGLYPH_GROUPS) {
      if (group.includes(ch) && group.some((c) => c.codePointAt(0)! < 128)) {
        out.push(ch);
        break;
      }
    }
  }
  return out;
}

/** Strip the characters that must never reach a database or a CSV cell. */
export function sanitizeControlChars(value: string): string {
  // biome-ignore lint/suspicious/noControlCharactersInRegex: the pattern's purpose is to detect control characters
  return value.replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/g, "");
}

export function containsControlChars(value: string): boolean {
  // biome-ignore lint/suspicious/noControlCharactersInRegex: the pattern's purpose is to detect control characters
  return /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/.test(value);
}

/**
 * Formula-injection guard for CSV/spreadsheet exports: a cell starting with =, +,
 * -, @ or a tab/CR can be executed by the spreadsheet app that opens the export.
 */
export function isFormulaLikeCell(value: string): boolean {
  return /^[=+\-@\t\r]/.test(value);
}
