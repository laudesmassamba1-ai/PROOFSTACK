/**
 * Per-project memory for the local AI agent.
 *
 * The point is continuity: a user who switches provider or pastes a new key tomorrow must
 * still work on a project whose decisions, conventions and goals the agent already knows.
 * The memory is a small JSON file per repository — not a database, not a vector store —
 * because the agent opens the same folder every session, and a file it can read, edit and
 * delete is also the only kind of memory a user can audit.
 */

import { chmodSync } from "node:fs";
import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { basename, join, normalize } from "node:path";

export type MemoryFactKind = "decision" | "convention" | "stack" | "goal" | "lesson";

export interface MemoryFact {
  text: string;
  kind: MemoryFactKind;
  createdAt: string;
}

export interface ProjectMemory {
  root: string;
  createdAt: string;
  updatedAt: string;
  /** What this project is, in one breath. Kept short on purpose. */
  summary: string;
  facts: MemoryFact[];
}

const MAX_FACTS = 40;
const MAX_SUMMARY = 2000;
/** Rough on-disk budget: 40 facts of a line each plus the summary. */
const MAX_BYTES = 6 * 1024;

const KINDS: readonly MemoryFactKind[] = ["decision", "convention", "stack", "goal", "lesson"];

export const MEMORY_FILE = ".proofcore/memory.json";

export interface EmptyMemory {
  root: string;
  createdAt: string;
  updatedAt: string;
  summary: "";
  facts: [];
}

export function emptyMemory(root: string): ProjectMemory {
  const now = new Date().toISOString();
  return { root, createdAt: now, updatedAt: now, summary: "", facts: [] };
}

/** The one path a memory can live at for this root — traversal cannot move it. */
function memoryPath(root: string): string {
  // normalize() collapses "../" segments so a hostile root cannot walk out of its folder.
  return join(normalize(root), MEMORY_FILE);
}

export async function loadMemory(root: string): Promise<ProjectMemory> {
  const raw = await readFile(memoryPath(root), "utf8").catch(() => "");
  if (!raw.trim()) return emptyMemory(root);
  try {
    const parsed = JSON.parse(raw) as Partial<ProjectMemory>;
    return {
      root,
      createdAt: typeof parsed.createdAt === "string" ? parsed.createdAt : new Date().toISOString(),
      updatedAt: typeof parsed.updatedAt === "string" ? parsed.updatedAt : new Date().toISOString(),
      summary: typeof parsed.summary === "string" ? parsed.summary.slice(0, MAX_SUMMARY) : "",
      facts: Array.isArray(parsed.facts) ? parsed.facts.slice(-MAX_FACTS) : [],
    };
  } catch {
    // A corrupted memory behaves like an absent one: the agent works without context
    // instead of refusing to start, and the next write replaces the file.
    return emptyMemory(root);
  }
}

export async function saveMemory(root: string, memory: ProjectMemory): Promise<void> {
  const bounded: ProjectMemory = {
    root,
    createdAt: memory.createdAt,
    updatedAt: new Date().toISOString(),
    summary: memory.summary.slice(0, MAX_SUMMARY),
    facts: memory.facts.slice(-MAX_FACTS),
  };
  const payload = JSON.stringify(bounded, null, 2);
  if (Buffer.byteLength(payload, "utf8") > MAX_BYTES) {
    // The oldest facts go first: recent decisions beat founding ones for today's work.
    bounded.facts = bounded.facts.slice(-Math.ceil(MAX_FACTS / 2));
    bounded.summary = bounded.summary.slice(0, Math.floor(MAX_SUMMARY / 2));
  }
  const path = memoryPath(root);
  await mkdir(join(path, ".."), { recursive: true, mode: 0o700 });
  // Write-then-rename: a crash mid-write must not leave a truncated memory that reads as
  // "no memory" and quietly erases what the agent knew.
  const temporary = `${path}.tmp-${process.pid}`;
  await writeFile(temporary, `${JSON.stringify(bounded, null, 2)}\n`, {
    encoding: "utf8",
    mode: 0o600,
  });
  try {
    chmodSync(temporary, 0o600);
  } catch {
    // Windows allows the write to carry the mode; a chmod failure is not a lost memory.
  }
  await rename(temporary, path);
}

export async function rememberFact(
  root: string,
  text: string,
  kind: MemoryFactKind
): Promise<ProjectMemory> {
  if (!KINDS.includes(kind)) throw new Error(`unknown memory kind: ${kind}`);
  const cleaned = text.trim().slice(0, 300);
  if (!cleaned) return loadMemory(root);
  const memory = await loadMemory(root);
  const deduped = memory.facts.filter(
    (fact) => fact.text.trim().toLowerCase() !== cleaned.toLowerCase()
  );
  deduped.push({ text: cleaned, kind, createdAt: new Date().toISOString() });
  await saveMemory(root, { ...memory, facts: deduped });
  return loadMemory(root);
}

export async function forgetFact(root: string, matchText: string): Promise<ProjectMemory> {
  const memory = await loadMemory(root);
  const needle = matchText.trim().toLowerCase();
  if (!needle) return memory;
  await saveMemory(root, {
    ...memory,
    facts: memory.facts.filter((fact) => !fact.text.toLowerCase().includes(needle)),
  });
  return loadMemory(root);
}

/**
 * Renders the memory as the context block the agent sees.
 *
 * In French, like every agent-facing string in this product. Empty when there is nothing
 * to say — an empty header would teach the model to imitate empty sections.
 */
export function memoryPrompt(
  memory: ProjectMemory,
  root: string,
  stack?: { nodeVersion?: string; lockfile?: string; frameworks?: string[] }
): string {
  const sections: Record<MemoryFactKind, string[]> = {
    decision: [],
    convention: [],
    stack: [],
    goal: [],
    lesson: [],
  };
  for (const fact of memory.facts) sections[fact.kind].push(fact.text);

  const stackLines = [
    ...(stack?.nodeVersion ? [`Node ${stack.nodeVersion}`] : []),
    ...(stack?.lockfile ? [`${stack.lockfile} comme verrou des dépendances`] : []),
    ...(stack?.frameworks?.length ? [`Frameworks : ${stack.frameworks.join(", ")}`] : []),
  ];

  const parts: string[] = [];
  parts.push(`Contexte projet — ${basename(root)}`);
  parts.push(`(mémoire mise à jour le ${new Date(memory.updatedAt).toLocaleString("fr-FR")})`);
  if (memory.summary.trim()) parts.push(`Résumé : ${memory.summary.trim()}`);
  if (stackLines.length) parts.push(`Pile détectée : ${stackLines.join(" · ")}`);
  if (sections.goal.length)
    parts.push(`Objectif en cours :\n${sections.goal.map((text) => `- ${text}`).join("\n")}`);
  if (sections.decision.length)
    parts.push(
      `Décisions déjà prises (ne les re-propose pas) :\n${sections.decision.map((text) => `- ${text}`).join("\n")}`
    );
  if (sections.convention.length)
    parts.push(
      `Conventions du dépôt :\n${sections.convention.map((text) => `- ${text}`).join("\n")}`
    );
  if (sections.lesson.length)
    parts.push(
      `Leçons (échecs déjà rencontrés) :\n${sections.lesson.map((text) => `- ${text}`).join("\n")}`
    );
  if (sections.stack.length)
    parts.push(`Pile (déclaré) :\n${sections.stack.map((text) => `- ${text}`).join("\n")}`);

  // The header lines (project name, updated-at) are content-free on their own: an empty
  // memory says nothing at all rather than a block of headings that wastes context and
  // models a habit of talking to fill space.
  if (
    !memory.summary.trim() &&
    !memory.facts.length &&
    !(stack?.nodeVersion || stack?.lockfile || stack?.frameworks?.length)
  ) {
    // An empty memory says nothing at all: a header-only block wastes context and models
    // a habit of talking to fill space.
    return "";
  }
  return parts.join("\n");
}

const PATH_PATTERN = /(?:[\w.-]+\/)*[\w.-]+\.(?:ts|tsx|js|jsx|mjs|cjs|json|css|md|sql|toml|ya?ml)/g;

/**
 * Deterministic conversation summary — no model call.
 *
 * It errs on the side of less: three lines a model can skim beats a paragraph that
 * pretends to have understood.
 */
export function summarizeConversation(messages: { role: string; content: string }[]): string {
  const userMessages = messages.filter(
    (message) => message.role === "user" && message.content.trim()
  );
  if (!userMessages.length) return "";
  // The goal is the most substantial user message, not the latest one: a follow-up
  // ("et pour ce fichier ?") carries direction, but the task being continued lives in the
  // longer message — and a memory that forgets the task is worse than one that is stale.
  const goal =
    [...userMessages]
      .sort((left, right) => right.content.length - left.content.length)[0]
      ?.content.trim()
      .slice(0, 220) ?? "";
  const files = new Set<string>();
  for (const message of messages) {
    for (const match of `${message.content}`.matchAll(PATH_PATTERN)) files.add(match[0]);
    if (files.size >= 12) break;
  }
  const decisions = messages
    .filter((message) => message.role === "assistant")
    .flatMap((message) => `${message.content}`.split(/[.\n]/))
    .map((sentence) => sentence.trim())
    .filter((sentence) => /on (garde|conserve|supprime|utilise|remplace|migre)/i.test(sentence))
    .slice(0, 3);
  const lines = [`Dernier objectif : ${goal}`];
  if (files.size) lines.push(`Fichiers en jeu : ${[...files].slice(0, 12).join(", ")}`);
  for (const decision of decisions) lines.push(`Décision : ${decision}`);
  return lines.join("\n");
}
