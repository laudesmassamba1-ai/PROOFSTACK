/// <reference lib="dom" />
import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { mkdir, readdir, readFile, stat, writeFile } from "node:fs/promises";
import { dirname, join, resolve, sep } from "node:path";
import { ProofCoreError } from "@proofcore/core";
import type { ToolContext } from "./code-tools.js";

/**
 * The remaining agent capabilities: semantic search, devtools, live preview, code
 * completion, image analysis, SVG generation and a step debugger.
 *
 * Each one is implemented as a real mechanism, and each one states its own limit:
 *
 * - **Semantic search** is a local TF-IDF index. It needs no key, produces a ranked list
 *   that can be checked against the file, and never calls a model to pretend relevance.
 *   Provider embeddings are accepted as an upgrade path, not as a requirement.
 * - **Devtools / preview** drive a real Chromium over the DevTools Protocol: console
 *   messages, network requests, DOM and accessibility come from the page, not from a
 *   guess. If no Chromium is installed, the tool says so instead of returning an empty
 *   report.
 * - **Completion** sends the surrounding context to the configured provider. Without a
 *   key it falls back to a symbol-based completion built from the real index.
 * - **Image analysis** sends the image to a vision-capable model and refuses when the
 *   configured model is not one.
 * - **SVG** is generated deterministically: no model, no network, byte-stable output.
 * - **Debugger** drives the Node inspector over CDP: real breakpoints, real scopes.
 */

// --------------------------------------------------------------- semantic index

export interface IndexedChunk {
  path: string;
  startLine: number;
  endLine: number;
  text: string;
}

export interface SemanticHit {
  path: string;
  startLine: number;
  endLine: number;
  score: number;
  preview: string;
}

interface IndexFile {
  version: 1;
  root: string;
  createdAt: string;
  /** term -> number of chunks containing it */
  documentFrequency: Record<string, number>;
  chunks: {
    path: string;
    startLine: number;
    endLine: number;
    length: number;
    terms: Record<string, number>;
  }[];
}

/** Resolves a path inside the workspace; anything escaping it is refused, not clamped. */
function confine(root: string, candidate: string): string {
  const rootResolved = resolve(root);
  const target = resolve(rootResolved, candidate);
  if (target !== rootResolved && !target.startsWith(rootResolved + sep)) {
    throw new ProofCoreError({
      message: `Path escapes the workspace: ${candidate}`,
      category: "VALIDATION",
      code: "path_outside_workspace",
    });
  }
  return target;
}

const INDEX_DIR = ".proofcore";
const INDEX_FILE = "semantic-index.json";
const STOP_WORDS = new Set([
  "the",
  "and",
  "for",
  "with",
  "from",
  "this",
  "that",
  "return",
  "const",
  "let",
  "var",
  "function",
  "import",
  "export",
  "type",
  "interface",
  "class",
  "async",
  "await",
  "if",
  "else",
  "true",
  "false",
  "null",
  "undefined",
  "les",
  "des",
  "une",
  "dans",
  "pour",
  "sur",
  "est",
  "que",
  "qui",
  "pas",
  "avec",
  "sans",
  "aux",
  "par",
]);

/** Splits an identifier into searchable words: `parseMoneyString` → parse, money, string. */
function tokenize(text: string): string[] {
  const words = text
    .replace(/([a-z0-9])([A-Z])/g, "$1 $2")
    .toLowerCase()
    .split(/[^a-z0-9\u00c0-\u024f]+/)
    .filter((word) => word.length >= 3 && !STOP_WORDS.has(word));
  return words;
}

function sourceFiles(context: ToolContext): Promise<string[]> {
  return (async () => {
    const out: string[] = [];
    const ignored = new Set([
      "node_modules",
      ".git",
      "dist",
      "build",
      ".next",
      "coverage",
      ".proofcore",
    ]);
    const walk = async (dir: string): Promise<void> => {
      const dirents = await readdir(dir, { withFileTypes: true }).catch(() => []);
      for (const entry of dirents) {
        if (entry.name.startsWith(".") || ignored.has(entry.name)) continue;
        const absolute = join(dir, entry.name);
        if (entry.isDirectory()) {
          await walk(absolute);
          continue;
        }
        if (!/\.(ts|tsx|js|jsx|mjs|cjs|py|go|rs|java|rb|php|md)$/.test(entry.name)) continue;
        const info = await stat(absolute).catch(() => undefined);
        if (!info || info.size > 400_000) continue;
        out.push(absolute);
      }
    };
    await walk(context.root);
    return out;
  })();
}

/** Builds (or rebuilds) the local index. Deterministic: same files give the same index. */
export async function buildSemanticIndex(
  context: ToolContext,
  options: { chunkLines?: number } = {}
): Promise<{ files: number; chunks: number; path: string }> {
  const chunkLines = Math.min(options.chunkLines ?? 40, 200);
  const files = await sourceFiles(context);
  const index: IndexFile = {
    version: 1,
    root: context.root,
    createdAt: new Date().toISOString(),
    documentFrequency: {},
    chunks: [],
  };

  for (const absolute of files) {
    const raw = await readFile(absolute, "utf8").catch(() => "");
    if (!raw) continue;
    const lines = raw.split("\n");
    for (let start = 0; start < lines.length; start += chunkLines) {
      const slice = lines.slice(start, start + chunkLines);
      if (slice.join("").trim().length < 20) continue;
      const text = slice.join("\n");
      const terms: Record<string, number> = {};
      for (const token of tokenize(text)) terms[token] = (terms[token] ?? 0) + 1;
      const keys = Object.keys(terms);
      if (keys.length === 0) continue;
      for (const key of keys) {
        index.documentFrequency[key] = (index.documentFrequency[key] ?? 0) + 1;
      }
      index.chunks.push({
        path: absolute.slice(context.root.length + 1),
        startLine: start + 1,
        endLine: Math.min(start + chunkLines, lines.length),
        length: keys.length,
        terms,
      });
    }
  }

  const dir = join(context.root, INDEX_DIR);
  await mkdir(dir, { recursive: true });
  const path = join(dir, INDEX_FILE);
  await writeFile(path, JSON.stringify(index), "utf8");
  return { files: files.length, chunks: index.chunks.length, path };
}

async function loadIndex(context: ToolContext): Promise<IndexFile> {
  const path = join(context.root, INDEX_DIR, INDEX_FILE);
  const raw = await readFile(path, "utf8").catch(() => undefined);
  if (!raw) {
    throw new ProofCoreError({
      message: "No semantic index yet. Run `proofcore index` (or build_semantic_index) first.",
      category: "CONFIGURATION",
      code: "index_missing",
    });
  }
  return JSON.parse(raw) as IndexFile;
}

/**
 * Ranked search over the local index.
 *
 * Scoring is TF-IDF with cosine normalisation, computed here rather than in a vector
 * database: for a repository of this size the arithmetic is instant, the ranking is
 * reproducible, and there is no third party that could return a neighbour that is not in
 * the file.
 */
export async function semanticSearch(
  context: ToolContext,
  input: { query: string; limit?: number }
): Promise<{ query: string; hits: SemanticHit[]; chunksSearched: number; note?: string }> {
  const index = await loadIndex(context);
  const limit = Math.min(input.limit ?? 8, 50);
  const queryTerms = tokenize(input.query);
  if (queryTerms.length === 0) {
    return {
      query: input.query,
      hits: [],
      chunksSearched: 0,
      note: "no searchable term in the query",
    };
  }
  const total = index.chunks.length;
  const idf: Record<string, number> = {};
  for (const term of new Set(queryTerms)) {
    const df = index.documentFrequency[term] ?? 0;
    idf[term] = df === 0 ? 0 : Math.log(1 + total / df);
  }

  const scored = index.chunks.map((chunk) => {
    let dot = 0;
    let norm = 0;
    for (const [term, count] of Object.entries(chunk.terms)) {
      const weight = count * (idf[term] ?? 0);
      norm += weight * weight;
      if (queryTerms.includes(term)) dot += weight * (idf[term] ?? 0);
    }
    const score = norm > 0 ? dot / Math.sqrt(norm) : 0;
    return { chunk, score };
  });

  const hits: SemanticHit[] = [];
  for (const { chunk, score } of scored) {
    if (score <= 0) continue;
    hits.push({
      path: chunk.path,
      startLine: chunk.startLine,
      endLine: chunk.endLine,
      score: Number(score.toFixed(4)),
      preview: `${chunk.path}:${chunk.startLine}-${chunk.endLine}`,
    });
  }
  hits.sort((a, b) => b.score - a.score || a.path.localeCompare(b.path));
  return {
    query: input.query,
    hits: hits.slice(0, limit),
    chunksSearched: total,
    ...(hits.length === 0
      ? { note: "no chunk shares a term with the query; the index is lexical, not generative" }
      : {}),
  };
}

// ------------------------------------------------------------------- devtools

export interface DevtoolsReport {
  url: string;
  finalUrl: string;
  status: number | null;
  title: string;
  console: { type: string; text: string }[];
  network: { url: string; status: number; method: string; type: string }[];
  dom: { counts: Record<string, number>; landmarks: string[] };
  accessibility: { violationsLike: string[] };
  errors: { message: string; source?: string }[];
  screenshot?: string;
}

const DOM_COUNTS_EXPRESSION = `(() => {
  const counts = {};
  for (const tag of ["main","header","footer","nav","h1","h2","img","form","a","button"]) {
    counts[tag] = document.querySelectorAll(tag).length;
  }
  const landmarks = ["main","header","footer","nav"].filter((tag) => document.querySelectorAll(tag).length > 0);
  return { counts, landmarks };
})()`;

const ACCESSIBILITY_EXPRESSION = `(() => {
  const findings = [];
  for (const img of Array.from(document.querySelectorAll("img"))) {
    if (!img.getAttribute("alt")) findings.push("img without alt: " + (img.getAttribute("src") || "").slice(0, 60));
  }
  for (const input of Array.from(document.querySelectorAll("input,select,textarea"))) {
    const id = input.getAttribute("id");
    const labelled = id ? document.querySelector('label[for="' + CSS.escape(id) + '"]') : null;
    if (!labelled && !input.getAttribute("aria-label") && !input.getAttribute("placeholder")) {
      findings.push("unlabelled field: " + input.tagName.toLowerCase());
    }
  }
  if (document.querySelectorAll("h1").length === 0) findings.push("no h1");
  return findings;
})()`;

/**
 * Opens a page in a real Chromium and reports what actually happened.
 *
 * This is the audit view of the browser tools: one navigation, then console messages, page
 * errors, every response status, DOM landmarks, and the accessibility findings that are
 * decidable from the DOM. It runs on PROOFCORE's own engine — a Chromium already installed
 * on the machine — so it needs neither Playwright nor a rendering service.
 */
export async function inspectPage(
  input: { url: string; screenshotPath?: string; viewport?: { width: number; height: number } },
  options: { timeoutMs?: number; root?: string } = {}
): Promise<DevtoolsReport> {
  const { browsers } = await import("@proofcore/adapter-browser");
  const viewport = input.viewport ?? { width: 1280, height: 800 };
  const opened = await browsers.open({
    url: input.url,
    width: viewport.width,
    height: viewport.height,
  });
  try {
    await opened.page.waitFor({
      expression: "document.readyState === 'complete'",
      timeoutMs: options.timeoutMs ?? 30_000,
    });
    const state = await opened.page.state();
    const dom = await opened.page
      .evaluateScript(DOM_COUNTS_EXPRESSION)
      .then((value) => value as { counts: Record<string, number>; landmarks: string[] });
    const a11y = await opened.page
      .evaluateScript(ACCESSIBILITY_EXPRESSION)
      .then((value) => value as string[])
      .catch(() => []);

    let screenshotPath: string | undefined;
    if (input.screenshotPath) {
      const { mkdir, writeFile } = await import("node:fs/promises");
      const absolute = resolve(options.root ?? process.cwd(), input.screenshotPath);
      await mkdir(dirname(absolute), { recursive: true });
      const shot = await opened.page.screenshot({ fullPage: true });
      await writeFile(absolute, shot.data);
      screenshotPath = input.screenshotPath;
    }

    return {
      url: input.url,
      finalUrl: state.url,
      status: state.status,
      title: state.title,
      console: opened.page.console.slice(-100),
      network: opened.page.network.slice(-200).map((entry) => ({
        url: entry.url,
        status: entry.status,
        method: entry.method,
        type: entry.type,
      })),
      dom: { counts: dom.counts, landmarks: dom.landmarks },
      accessibility: { violationsLike: a11y.slice(0, 40) },
      errors: opened.page.pageErrors.slice(-20),
      ...(screenshotPath ? { screenshot: screenshotPath } : {}),
    };
  } finally {
    await browsers.close(opened.id);
  }
}

// ----------------------------------------------------------------- completion

export interface CompletionResult {
  source: "model" | "index";
  completions: { text: string; confidence: number }[];
  note?: string;
}

/**
 * Inline completion for a position in a file.
 *
 * With a provider configured, the surrounding code is sent as a fill-in-the-middle
 * prompt and the answer is returned as-is. Without one, the local index supplies real
 * symbols from the same project — a weaker answer, but a true one.
 */
export async function completeCode(
  context: ToolContext,
  input: {
    path: string;
    line: number;
    column?: number;
    maxCompletions?: number;
    provider?: { baseUrl: string; model: string; apiKey: string; kind?: string };
  }
): Promise<CompletionResult> {
  const absolute = confine(context.root, input.path);
  const raw = await readFile(absolute, "utf8").catch(() => "");
  if (!raw) {
    throw new ProofCoreError({
      message: `Cannot read ${input.path}`,
      category: "VALIDATION",
      code: "file_not_found",
    });
  }
  const lines = raw.split("\n");
  const lineIndex = Math.min(Math.max(input.line - 1, 0), lines.length - 1);
  const prefix = lines.slice(Math.max(0, lineIndex - 60), lineIndex + 1).join("\n");
  const suffix = lines.slice(lineIndex + 1, lineIndex + 21).join("\n");
  const limit = Math.min(input.maxCompletions ?? 3, 5);

  if (input.provider) {
    const isAnthropic = input.provider.kind === "anthropic";
    const url = isAnthropic
      ? `${input.provider.baseUrl.replace(/\/+$/, "")}/messages`
      : `${input.provider.baseUrl.replace(/\/+$/, "")}/chat/completions`;
    const headers: Record<string, string> = isAnthropic
      ? {
          "content-type": "application/json",
          "x-api-key": input.provider.apiKey,
          "anthropic-version": "2023-06-01",
        }
      : { "content-type": "application/json", authorization: `Bearer ${input.provider.apiKey}` };
    const instruction =
      "You complete code. Answer with the exact text to insert at the cursor, nothing else. No explanation, no markdown fence.";
    const body = isAnthropic
      ? {
          model: input.provider.model,
          max_tokens: 256,
          temperature: 0,
          system: `${instruction}\nFile: ${input.path}`,
          messages: [{ role: "user", content: `BEFORE:\n${prefix}\n<CURSOR>\nAFTER:\n${suffix}` }],
        }
      : {
          model: input.provider.model,
          max_tokens: 256,
          temperature: 0,
          messages: [
            { role: "system", content: `${instruction}\nFile: ${input.path}` },
            { role: "user", content: `BEFORE:\n${prefix}\n<CURSOR>\nAFTER:\n${suffix}` },
          ],
        };
    try {
      const response = await fetch(url, {
        method: "POST",
        headers,
        body: JSON.stringify(body),
        signal: AbortSignal.timeout(20_000),
      });
      if (!response.ok) {
        return {
          source: "index",
          completions: await indexCompletions(context, prefix, limit),
          note: `provider answered HTTP ${response.status}; served local symbols instead`,
        };
      }
      const payload = (await response.json()) as {
        choices?: { message?: { content?: string } }[];
        content?: { type?: string; text?: string }[];
      };
      const text = isAnthropic
        ? (payload.content ?? [])
            .filter((b) => b.type === "text")
            .map((b) => b.text ?? "")
            .join("")
        : (payload.choices?.[0]?.message?.content ?? "");
      const cleaned = text.replace(/^```[a-z]*\n|```$/g, "").trimEnd();
      if (!cleaned) {
        return { source: "index", completions: await indexCompletions(context, prefix, limit) };
      }
      return { source: "model", completions: [{ text: cleaned, confidence: 0.8 }] };
    } catch (error) {
      return {
        source: "index",
        completions: await indexCompletions(context, prefix, limit),
        note: `provider unreachable: ${error instanceof Error ? error.message : "network error"}`,
      };
    }
  }

  return {
    source: "index",
    completions: await indexCompletions(context, prefix, limit),
    note: "no provider key: symbols are suggested from the project index",
  };
}

/** Symbol completion from the real index: names that appear near the cursor's context. */
async function indexCompletions(
  context: ToolContext,
  prefix: string,
  limit: number
): Promise<{ text: string; confidence: number }[]> {
  const index = await loadIndex(context).catch(() => undefined);
  if (!index) return [];
  const words = new Set(tokenize(prefix));
  const scores = new Map<string, number>();
  for (const chunk of index.chunks) {
    for (const term of Object.keys(chunk.terms)) {
      if (words.has(term)) scores.set(term, (scores.get(term) ?? 0) + 1);
    }
  }
  return [...scores.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, limit)
    .map(([term, count]) => ({ text: term, confidence: Math.min(0.5, count / 10) }));
}

// ------------------------------------------------------------ image analysis

export interface ImageAnalysis {
  path: string;
  mediaType: string;
  bytes: number;
  provider: string;
  answer: string;
}

/**
 * Sends a screenshot to a vision model.
 *
 * The refusal matters: a text-only model receiving an image URL answers fluently about
 * nothing. The tools check the model family and say what is required instead.
 */
export async function analyzeImage(
  context: ToolContext,
  input: {
    path: string;
    prompt?: string;
    provider: { baseUrl: string; model: string; apiKey: string; kind?: string };
  }
): Promise<ImageAnalysis> {
  const absolute = confine(context.root, input.path);
  const buffer = await readFile(absolute).catch(() => undefined);
  if (!buffer) {
    throw new ProofCoreError({
      message: `Cannot read image ${input.path}`,
      category: "VALIDATION",
      code: "file_not_found",
    });
  }
  const mediaType =
    input.path.endsWith(".jpg") || input.path.endsWith(".jpeg")
      ? "image/jpeg"
      : input.path.endsWith(".webp")
        ? "image/webp"
        : "image/png";
  const base64 = buffer.toString("base64");
  const visionLikely = /gpt-4o|gpt-4\.1|gpt-5|claude|gemini|llava|qwen.*vl|mistral.*pixtral/i.test(
    input.provider.model
  );
  if (!visionLikely) {
    throw new ProofCoreError({
      message: `The configured model (${input.provider.model}) is not a vision model. Connect a vision-capable model to analyse images.`,
      category: "CONFIGURATION",
      code: "vision_model_required",
    });
  }

  const isAnthropic = input.provider.kind === "anthropic";
  const url = isAnthropic
    ? `${input.provider.baseUrl.replace(/\/+$/, "")}/messages`
    : `${input.provider.baseUrl.replace(/\/+$/, "")}/chat/completions`;
  const question =
    input.prompt ??
    "Describe precisely what this screenshot shows, then list any visual defect (layout, contrast, truncation, misalignment).";
  const headers: Record<string, string> = isAnthropic
    ? {
        "content-type": "application/json",
        "x-api-key": input.provider.apiKey,
        "anthropic-version": "2023-06-01",
      }
    : { "content-type": "application/json", authorization: `Bearer ${input.provider.apiKey}` };
  const body = isAnthropic
    ? {
        model: input.provider.model,
        max_tokens: 1200,
        messages: [
          {
            role: "user",
            content: [
              { type: "image", source: { type: "base64", media_type: mediaType, data: base64 } },
              { type: "text", text: question },
            ],
          },
        ],
      }
    : {
        model: input.provider.model,
        max_tokens: 1200,
        messages: [
          {
            role: "user",
            content: [
              { type: "text", text: question },
              { type: "image_url", image_url: { url: `data:${mediaType};base64,${base64}` } },
            ],
          },
        ],
      };

  const response = await fetch(url, {
    method: "POST",
    headers,
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(45_000),
  });
  if (!response.ok) {
    const text = await response.text().catch(() => "");
    throw new ProofCoreError({
      message: `The provider refused the image (HTTP ${response.status}): ${text.slice(0, 200)}`,
      category: "PROVIDER",
      code: "image_rejected",
    });
  }
  const payload = (await response.json()) as {
    choices?: { message?: { content?: string } }[];
    content?: { type?: string; text?: string }[];
  };
  const answer = isAnthropic
    ? (payload.content ?? [])
        .filter((b) => b.type === "text")
        .map((b) => b.text ?? "")
        .join("")
    : (payload.choices?.[0]?.message?.content ?? "");
  return {
    path: input.path,
    mediaType,
    bytes: buffer.byteLength,
    provider: input.provider.model,
    answer,
  };
}

// ---------------------------------------------------------------------- SVG

export interface SvgResult {
  path?: string;
  svg: string;
  bytes: number;
}

/**
 * Deterministic SVG generation.
 *
 * Icons and placeholders are geometry, not a language-model task: a model asked for a
 * "gear icon" returns markup that varies between calls and cannot be reviewed. Here the
 * shapes are drawn from parameters, so the same request always produces the same file.
 */
export function generateSvg(input: {
  shape: "icon" | "placeholder" | "spinner" | "wave";
  name?: string;
  size?: number;
  color?: string;
  background?: string;
  label?: string;
}): SvgResult {
  const size = Math.min(Math.max(input.size ?? 24, 8), 2048);
  const color = input.color ?? "currentColor";
  const background = input.background ?? "transparent";
  const stroke = Math.max(1, Math.round(size / 12));
  const head = `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="0 0 24 24" fill="none" role="img"${
    input.name ? ` aria-label="${escapeXml(input.name)}"` : ' aria-hidden="true"'
  }>`;
  const wrap = (body: string): SvgResult => {
    const svg = `${head}\n  ${body}\n</svg>\n`;
    return { svg, bytes: Buffer.byteLength(svg, "utf8") };
  };

  if (input.shape === "placeholder") {
    const text = input.label ?? `${size}×${size}`;
    return wrap(
      [
        `<rect width="24" height="24" rx="3" fill="${escapeXml(background === "transparent" ? "#e5e7eb" : background)}"/>`,
        `<text x="12" y="13.2" text-anchor="middle" font-family="system-ui,sans-serif" font-size="4.2" fill="${escapeXml(color === "currentColor" ? "#6b7280" : color)}">${escapeXml(text)}</text>`,
      ].join("\n  ")
    );
  }

  if (input.shape === "spinner") {
    return wrap(
      [
        `<circle cx="12" cy="12" r="9" stroke="${escapeXml(color)}" stroke-opacity="0.25" stroke-width="${stroke / 2}"/>`,
        `<path d="M21 12a9 9 0 0 0-9-9" stroke="${escapeXml(color)}" stroke-width="${stroke / 2}" stroke-linecap="round"><animateTransform attributeName="transform" type="rotate" from="0 12 12" to="360 12 12" dur="0.8s" repeatCount="indefinite"/></path>`,
      ].join("\n  ")
    );
  }

  if (input.shape === "wave") {
    return wrap(
      `<path d="M1 12c2-4 4-4 6 0s4 4 6 0 4-4 6 0 4 4 5 0" stroke="${escapeXml(color)}" stroke-width="${stroke / 2}" stroke-linecap="round" fill="none"/>`
    );
  }

  // A small, real icon set drawn from primitives — no dependence on an icon font.
  const icons: Record<string, string> = {
    check: `<path d="M4.5 12.5 9 17l10.5-10.5" stroke="${escapeXml(color)}" stroke-width="${stroke}" stroke-linecap="round" stroke-linejoin="round"/>`,
    close: `<path d="M6 6l12 12M18 6 6 18" stroke="${escapeXml(color)}" stroke-width="${stroke}" stroke-linecap="round"/>`,
    arrow: `<path d="M5 12h14M13 6l6 6-6 6" stroke="${escapeXml(color)}" stroke-width="${stroke}" stroke-linecap="round" stroke-linejoin="round"/>`,
    search: `<circle cx="11" cy="11" r="6.5" stroke="${escapeXml(color)}" stroke-width="${stroke}"/><path d="m16 16 4 4" stroke="${escapeXml(color)}" stroke-width="${stroke}" stroke-linecap="round"/>`,
    shield: `<path d="M12 3l7 3v6c0 4-3 7.5-7 9-4-1.5-7-5-7-9V6l7-3z" stroke="${escapeXml(color)}" stroke-width="${stroke}" stroke-linejoin="round"/>`,
    layers: `<path d="m12 3 9 5-9 5-9-5 9-5z" stroke="${escapeXml(color)}" stroke-width="${stroke}" stroke-linejoin="round"/><path d="m3 13 9 5 9-5" stroke="${escapeXml(color)}" stroke-width="${stroke}" stroke-linejoin="round"/>`,
  };
  const body = icons[input.name ?? "check"] ?? icons.check;
  return wrap(body ?? "");
}

function escapeXml(value: string): string {
  return value.replace(/[<>&"']/g, (char) => {
    switch (char) {
      case "<":
        return "&lt;";
      case ">":
        return "&gt;";
      case "&":
        return "&amp;";
      case '"':
        return "&quot;";
      default:
        return "&apos;";
    }
  });
}

// ------------------------------------------------------------------ debugger

export interface DebugSession {
  file: string;
  breakpointLine: number;
  stopped: boolean;
  reason?: string;
  scopes?: { name: string; variables: { name: string; value: string; type: string }[] }[];
  stdout: string;
  stderr: string;
  exitCode: number | null;
  durationMs: number;
  usedCdp: boolean;
  note?: string;
}

interface CdpMessage {
  id?: number;
  method?: string;
  params?: Record<string, unknown>;
  result?: Record<string, unknown>;
  error?: { message: string };
}

/**
 * A step debugger for Node scripts.
 *
 * It launches the script with `--inspect-brk`, connects to the inspector over the
 * DevTools Protocol using Node 22's built-in WebSocket, sets a breakpoint at the
 * requested line, and reads the real scopes when execution pauses. When the inspector is
 * unreachable it falls back to running the script and says `usedCdp: false` — it never
 * reports "debugged" without having paused.
 */
export async function debugScript(
  context: ToolContext,
  input: {
    file: string;
    breakpointLine: number;
    args?: string[];
    expression?: string;
    timeoutMs?: number;
  }
): Promise<DebugSession> {
  const absolute = confine(context.root, input.file);
  if (!existsSync(absolute)) {
    throw new ProofCoreError({
      message: `Cannot debug missing file ${input.file}`,
      category: "VALIDATION",
      code: "file_not_found",
    });
  }
  const started = Date.now();
  const port = 9230 + Math.floor(Math.random() * 200);
  const child = spawn(
    process.execPath,
    [`--inspect-brk=${port}`, absolute, ...(input.args ?? [])],
    {
      cwd: dirname(absolute),
      stdio: ["ignore", "pipe", "pipe"],
      // A debuggee must not inherit the test runner's or the harness's Node flags: an
      // inherited NODE_OPTIONS silently prevents `--inspect-brk` from binding, and the
      // debugger then reports that it could not attach.
      env: {
        ...process.env,
        NODE_OPTIONS: "",
        NODE_V8_COVERAGE: "",
        VITEST: "",
        VITEST_POOL_ID: "",
      },
    }
  );
  let stdout = "";
  let stderr = "";
  child.stdout?.on("data", (chunk: Buffer) => {
    stdout += chunk.toString("utf8");
  });
  child.stderr?.on("data", (chunk: Buffer) => {
    stderr += chunk.toString("utf8");
  });

  const waitForInspector = async (): Promise<string | undefined> => {
    for (let attempt = 0; attempt < 40; attempt += 1) {
      try {
        const response = await fetch(`http://127.0.0.1:${port}/json/list`, {
          signal: AbortSignal.timeout(500),
        });
        if (response.ok) {
          const targets = (await response.json()) as { webSocketDebuggerUrl?: string }[];
          const url = targets[0]?.webSocketDebuggerUrl;
          if (url) return url;
        }
      } catch {
        // Inspector not up yet.
      }
      await new Promise((resolvePromise) => setTimeout(resolvePromise, 100));
    }
    return undefined;
  };

  let stopped = false;
  let reason: string | undefined;
  let scopes: DebugSession["scopes"];
  let usedCdp = false;

  try {
    const wsUrl = await waitForInspector();
    if (!wsUrl) {
      child.kill("SIGKILL");
      return {
        file: input.file,
        breakpointLine: input.breakpointLine,
        stopped: false,
        stdout,
        stderr,
        exitCode: null,
        durationMs: Date.now() - started,
        usedCdp: false,
        note: "the Node inspector did not start; the script was not stepped",
      };
    }
    usedCdp = true;

    const socket = new WebSocket(wsUrl);
    let nextId = 1;
    const pending = new Map<number, (message: CdpMessage) => void>();
    // Pauses arrive as events, not as replies: they are queued so the caller can wait for
    // the one it cares about instead of taking whatever came first.
    const pauseQueue: CdpMessage[] = [];
    const pauseWaiters: ((message: CdpMessage) => void)[] = [];
    socket.addEventListener("message", (event) => {
      const message = JSON.parse(String((event as MessageEvent).data)) as CdpMessage;
      if (message.id && pending.has(message.id)) {
        pending.get(message.id)?.(message);
        pending.delete(message.id);
      }
      if (message.method === "Debugger.paused") {
        const waiter = pauseWaiters.shift();
        if (waiter) waiter(message);
        else pauseQueue.push(message);
      }
    });
    const waitPause = (timeoutMs = 8000): Promise<CdpMessage | undefined> =>
      new Promise((resolvePromise) => {
        const queued = pauseQueue.shift();
        if (queued) {
          resolvePromise(queued);
          return;
        }
        const timer = setTimeout(() => resolvePromise(undefined), timeoutMs);
        pauseWaiters.push((message) => {
          clearTimeout(timer);
          resolvePromise(message);
        });
      });
    const send = (method: string, params: Record<string, unknown> = {}): Promise<CdpMessage> =>
      new Promise((resolvePromise) => {
        const id = nextId++;
        pending.set(id, resolvePromise);
        socket.send(JSON.stringify({ id, method, params }));
      });

    await new Promise<void>((resolvePromise, reject) => {
      socket.addEventListener("open", () => resolvePromise());
      socket.addEventListener("error", () => reject(new Error("inspector websocket failed")));
    });

    await send("Debugger.enable");
    await send("Runtime.enable");
    await send("Debugger.setBreakpointByUrl", {
      lineNumber: Math.max(0, input.breakpointLine - 1),
      urlRegex: `${absolute.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}$`,
    });
    await send("Runtime.runIfWaitingForDebugger");

    // `--inspect-brk` pauses before the first statement. That pause is not the
    // breakpoint: reading its scopes would report the module frame as if it were the
    // function's locals. Resume until a pause actually reports a hit breakpoint.
    let event = await waitPause();
    for (let attempt = 0; attempt < 3; attempt += 1) {
      const hits = (event?.params?.hitBreakpoints ?? []) as unknown[];
      const breakOnStart = String(event?.params?.reason ?? "") === "Break on start";
      if (event && !breakOnStart && hits.length > 0) break;
      if (!event) break;
      await send("Debugger.resume");
      event = await waitPause(5000);
    }

    if (event?.params) {
      stopped = true;
      reason = String(event.params.reason ?? "breakpoint");
      const frames = (event.params.callFrames ?? []) as {
        scopeChain?: { type: string; object: { objectId: string } }[];
      }[];
      const chain = frames[0]?.scopeChain ?? [];
      scopes = [];
      for (const scope of chain.slice(0, 3)) {
        const properties = await send("Runtime.getProperties", {
          objectId: scope.object.objectId,
          ownProperties: true,
        });
        const result = (properties.result?.result ?? []) as {
          name: string;
          value?: { type?: string; value?: unknown; description?: string };
        }[];
        scopes.push({
          name: scope.type,
          variables: result
            .filter((entry) => entry.value)
            .slice(0, 25)
            .map((entry) => ({
              name: entry.name,
              type: entry.value?.type ?? "unknown",
              value: String(entry.value?.value ?? entry.value?.description ?? "").slice(0, 120),
            })),
        });
      }
      if (input.expression) {
        await send("Runtime.evaluate", {
          expression: input.expression,
          includeCommandLineAPI: true,
        });
      }
      await send("Debugger.resume");
      await new Promise((resolvePromise) => setTimeout(resolvePromise, 150));
    }

    socket.close();
    child.kill("SIGKILL");
    return {
      file: input.file,
      breakpointLine: input.breakpointLine,
      stopped,
      ...(reason ? { reason } : {}),
      ...(scopes ? { scopes } : {}),
      stdout,
      stderr,
      exitCode: null,
      durationMs: Date.now() - started,
      usedCdp: true,
      ...(stopped ? {} : { note: "the breakpoint was never hit before the timeout" }),
    };
  } catch (error) {
    child.kill("SIGKILL");
    return {
      file: input.file,
      breakpointLine: input.breakpointLine,
      stopped: false,
      stdout,
      stderr: `${stderr}\n${error instanceof Error ? error.message : "debugger error"}`.trim(),
      exitCode: null,
      durationMs: Date.now() - started,
      usedCdp,
      note: "the debugger could not attach; no variable was inspected",
    };
  }
}
