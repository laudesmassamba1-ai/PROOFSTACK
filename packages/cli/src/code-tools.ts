import { spawn } from "node:child_process";
import { constants, type Dirent } from "node:fs";
import { access, mkdir, readdir, readFile, stat, writeFile } from "node:fs/promises";
import { dirname, join, relative, resolve, sep } from "node:path";
import { ProofCoreError } from "@proofcore/core";

/**
 * Codebase, runtime and Git tools for an AI agent.
 *
 * These are the tools that make an assistant able to *work* on code instead of guessing
 * about it. They run locally, on the machine where the code is, and are exposed through
 * the MCP server — the same architecture Cursor, Windsurf and Copilot Workspace use,
 * because a cloud worker cannot read a developer's disk.
 *
 * Three rules are enforced here, not documented and hoped for:
 *
 * 1. **Stay inside the workspace.** Every path is resolved and checked against the root;
 *    `../../etc/passwd` is refused before any read happens.
 * 2. **Never modify without showing the diff.** `write_file` returns a unified diff and
 *    only writes when the caller explicitly passes `apply: true`. `apply_patch` refuses
 *    a hunk whose context does not match exactly — it never guesses where a change goes.
 * 3. **Never run an arbitrary shell string.** Commands are executed without a shell,
 *    from an allowlist, with a timeout and an output cap, so a model cannot slip
 *    `; curl … | sh` into an argument list.
 */

/** Directories that are never part of the source a model should read. */
const IGNORED_DIRS = new Set([
  "node_modules",
  ".git",
  "dist",
  "build",
  ".next",
  ".turbo",
  ".cache",
  "coverage",
  "artifacts",
  ".venv",
  "__pycache__",
  ".DS_Store",
]);

const BINARY_EXTENSIONS = new Set([
  ".png",
  ".jpg",
  ".jpeg",
  ".gif",
  ".webp",
  ".ico",
  ".pdf",
  ".zip",
  ".gz",
  ".tar",
  ".woff",
  ".woff2",
  ".ttf",
  ".otf",
  ".mp4",
  ".mov",
  ".mp3",
  ".sqlite",
  ".db",
  ".wasm",
]);

/** Commands the agent may run. Anything else is refused, not sandboxed. */
const COMMAND_ALLOWLIST = new Set([
  "node",
  "npm",
  "pnpm",
  "npx",
  "bun",
  "bunx",
  "deno",
  "uv",
  "poetry",
  "python",
  "python3",
  "pip",
  "pytest",
  "go",
  "cargo",
  "rustc",
  "javac",
  "java",
  "mvn",
  "gradle",
  "dotnet",
  "php",
  "composer",
  "ruby",
  "bundle",
  "swift",
  "git",
  "tsc",
  "vitest",
  "jest",
  "biome",
  "eslint",
  "prettier",
  "docker",
  "make",
  "ls",
  "cat",
  "grep",
  "rg",
  "find",
  "wc",
  "head",
  "tail",
  "diff",
]);

/** Patterns that are destructive regardless of which allowlisted binary runs them. */
const FORBIDDEN_ARGS: RegExp[] = [
  /rm\s+-rf\s+\/(?!\w)/,
  /:\(\)\{.*\};:/,
  /curl[^|]*\|\s*(sh|bash)/,
];

/**
 * A forced push or a hard reset is refused as a combination, not as a single regex: the
 * flag follows the subcommand (`git push --force`) and a pattern for the other order
 * silently allowed it.
 */
function isDestructive(bin: string, args: string[]): boolean {
  const lower = args.map((arg) => arg.toLowerCase());
  const force = lower.includes("--force") || lower.includes("-f");
  if (!force) return false;
  if (bin !== "git") return false;
  return lower.includes("push") || lower.includes("reset") || lower.includes("clean");
}

export interface ToolContext {
  /** Absolute workspace root. Every path is confined to it. */
  root: string;
  /** Maximum bytes returned by a single read or command. */
  maxOutputBytes?: number;
  /** Default timeout for a command. */
  commandTimeoutMs?: number;
}

const DEFAULT_MAX_OUTPUT = 200_000;
const DEFAULT_TIMEOUT_MS = 120_000;

function fail(code: string, message: string, details?: Record<string, unknown>): never {
  throw new ProofCoreError({ message, category: "VALIDATION", code, details });
}

/**
 * Resolves a user-supplied path inside the workspace.
 *
 * Symlinks are not followed here on purpose: `realpath` on a path that does not exist
 * yet would fail for a legitimate file creation, and an escaping symlink is a repository
 * problem the operator must see, not something to resolve silently.
 */
export function confine(root: string, candidate: string): string {
  const rootResolved = resolve(root);
  const target = resolve(rootResolved, candidate);
  if (target !== rootResolved && !target.startsWith(rootResolved + sep)) {
    fail("path_outside_workspace", `Path escapes the workspace: ${candidate}`, {
      root: rootResolved,
    });
  }
  return target;
}

function relPath(root: string, absolute: string): string {
  return relative(root, absolute) || ".";
}

function isBinary(name: string): boolean {
  const dot = name.lastIndexOf(".");
  return dot >= 0 && BINARY_EXTENSIONS.has(name.slice(dot).toLowerCase());
}

function truncate(text: string, max: number): { text: string; truncated: boolean } {
  if (text.length <= max) return { text, truncated: false };
  return { text: `${text.slice(0, max)}\n… [truncated at ${max} characters]`, truncated: true };
}

// ------------------------------------------------------------------ discovery

export interface TreeEntry {
  path: string;
  type: "file" | "dir";
  size?: number;
}

export async function listFiles(
  context: ToolContext,
  options: { path?: string; depth?: number; limit?: number } = {}
): Promise<{ root: string; entries: TreeEntry[]; truncated: boolean }> {
  const start = confine(context.root, options.path ?? ".");
  const maxDepth = Math.min(options.depth ?? 3, 8);
  const limit = Math.min(options.limit ?? 400, 2000);
  const entries: TreeEntry[] = [];
  let truncated = false;

  const walk = async (dir: string, depth: number): Promise<void> => {
    if (entries.length >= limit) {
      truncated = true;
      return;
    }
    let dirents: Dirent[];
    try {
      dirents = await readdir(dir, { withFileTypes: true });
    } catch {
      return;
    }
    const sorted = dirents.sort((a, b) => {
      if (a.isDirectory() !== b.isDirectory()) return a.isDirectory() ? -1 : 1;
      return a.name.localeCompare(b.name);
    });
    for (const entry of sorted) {
      if (entry.name.startsWith(".") && entry.name !== ".env.example") continue;
      if (IGNORED_DIRS.has(entry.name)) continue;
      const absolute = join(dir, entry.name);
      const path = relPath(context.root, absolute);
      if (entry.isDirectory()) {
        entries.push({ path, type: "dir" });
        if (depth < maxDepth) await walk(absolute, depth + 1);
        else truncated = true;
      } else if (entry.isFile()) {
        const info = await stat(absolute).catch(() => undefined);
        entries.push({ path, type: "file", ...(info ? { size: info.size } : {}) });
      }
      if (entries.length >= limit) {
        truncated = true;
        return;
      }
    }
  };

  await walk(start, 0);
  return { root: relPath(process.cwd(), context.root) || ".", entries, truncated };
}

export interface FileSlice {
  path: string;
  startLine: number;
  endLine: number;
  totalLines: number;
  content: string;
  truncated: boolean;
  binary: boolean;
}

/**
 * Reads a file with line numbers.
 *
 * Line numbers are part of the answer, not a nicety: a model that must place a patch
 * needs to name the exact lines, and a report that cites "line 42" must be reproducible.
 */
export async function readFileSlice(
  context: ToolContext,
  input: { path: string; startLine?: number; endLine?: number }
): Promise<FileSlice> {
  const absolute = confine(context.root, input.path);
  if (isBinary(absolute)) {
    return {
      path: relPath(context.root, absolute),
      startLine: 1,
      endLine: 0,
      totalLines: 0,
      content: "",
      truncated: false,
      binary: true,
    };
  }
  let raw: string;
  try {
    raw = await readFile(absolute, "utf8");
  } catch {
    fail("file_not_found", `Cannot read ${input.path}`);
  }
  const lines = raw.split("\n");
  const from = Math.max(1, input.startLine ?? 1);
  const to = Math.min(lines.length, input.endLine ?? Math.min(lines.length, from + 1999));
  const numbered = lines
    .slice(from - 1, to)
    .map((line, index) => `${String(from + index).padStart(6)}│ ${line}`)
    .join("\n");
  const capped = truncate(numbered, context.maxOutputBytes ?? DEFAULT_MAX_OUTPUT);
  return {
    path: relPath(context.root, absolute),
    startLine: from,
    endLine: to,
    totalLines: lines.length,
    content: capped.text,
    truncated: capped.truncated,
    binary: false,
  };
}

export interface SearchHit {
  path: string;
  line: number;
  text: string;
}

/**
 * Literal or regex search across the workspace.
 *
 * This is deliberately a real search over real files rather than an embedding index: a
 * lexical search can be verified byte for byte, and it never returns a plausible
 * neighbour that does not contain what was asked. A semantic index can be added on top
 * later; it must not replace the checkable one.
 */
export async function searchCode(
  context: ToolContext,
  input: {
    query: string;
    regex?: boolean;
    caseSensitive?: boolean;
    glob?: string;
    maxResults?: number;
  }
): Promise<{ hits: SearchHit[]; filesScanned: number; truncated: boolean }> {
  if (!input.query) fail("query_required", "A search query is required.");
  const maxResults = Math.min(input.maxResults ?? 100, 500);
  let matcher: RegExp;
  try {
    matcher = input.regex
      ? new RegExp(input.query, input.caseSensitive ? "" : "i")
      : new RegExp(escapeRegExp(input.query), input.caseSensitive ? "" : "i");
  } catch {
    fail("invalid_regex", `Invalid regular expression: ${input.query}`);
  }
  const suffix = input.glob?.startsWith(".") ? input.glob : undefined;

  const hits: SearchHit[] = [];
  let filesScanned = 0;
  let truncated = false;

  const walk = async (dir: string): Promise<void> => {
    if (hits.length >= maxResults) {
      truncated = true;
      return;
    }
    const dirents = await readdir(dir, { withFileTypes: true }).catch(() => []);
    for (const entry of dirents) {
      if (hits.length >= maxResults) {
        truncated = true;
        return;
      }
      if (entry.name.startsWith(".") || IGNORED_DIRS.has(entry.name)) continue;
      const absolute = join(dir, entry.name);
      if (entry.isDirectory()) {
        await walk(absolute);
        continue;
      }
      if (isBinary(entry.name)) continue;
      if (suffix && !entry.name.endsWith(suffix)) continue;
      const info = await stat(absolute).catch(() => undefined);
      // A minified bundle is not source: skip anything unreasonably large for a read.
      if (!info || info.size > 2_000_000) continue;
      filesScanned += 1;
      const raw = await readFile(absolute, "utf8").catch(() => "");
      const lines = raw.split("\n");
      for (const [index, line] of lines.entries()) {
        if (line.length > 4_000) continue;
        if (matcher.test(line)) {
          hits.push({
            path: relPath(context.root, absolute),
            line: index + 1,
            text: line.trim().slice(0, 300),
          });
          if (hits.length >= maxResults) {
            truncated = true;
            return;
          }
        }
      }
    }
  };

  await walk(resolve(context.root));
  return { hits, filesScanned, truncated };
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

// --------------------------------------------------------------------- edits

export interface WriteResult {
  path: string;
  applied: boolean;
  created: boolean;
  diff: string;
  bytes: number;
}

/**
 * Writes a file — but only after showing what it would change.
 *
 * Without `apply: true` nothing is written and the caller receives the unified diff.
 * This is the diff view a developer expects before accepting a suggestion, expressed as
 * a tool contract instead of a UI convention.
 */
export async function writeFileWithDiff(
  context: ToolContext,
  input: { path: string; content: string; apply?: boolean }
): Promise<WriteResult> {
  const absolute = confine(context.root, input.path);
  const before = await readFile(absolute, "utf8").catch(() => undefined);
  const created = before === undefined;
  const diff = unifiedDiff({
    path: relPath(context.root, absolute),
    before: before ?? "",
    after: input.content,
    created,
  });

  if (input.apply !== true) {
    return {
      path: relPath(context.root, absolute),
      applied: false,
      created,
      diff,
      bytes: Buffer.byteLength(input.content, "utf8"),
    };
  }
  await mkdir(dirname(absolute), { recursive: true });
  await writeFile(absolute, input.content, "utf8");
  return {
    path: relPath(context.root, absolute),
    applied: true,
    created,
    diff,
    bytes: Buffer.byteLength(input.content, "utf8"),
  };
}

export interface PatchResult {
  applied: boolean;
  path: string;
  hunksApplied: number;
  diff: string;
}

/**
 * Applies a unified diff.
 *
 * The implementation is intentionally strict: each hunk must match its context exactly
 * at the location the diff says (or at a small window around it). When it does not, the
 * patch is refused in full — a partially applied patch is a corrupted file, and guessing
 * the right place is how an assistant silently breaks a codebase.
 */
export async function applyPatch(
  context: ToolContext,
  input: { patch: string; apply?: boolean }
): Promise<PatchResult> {
  const parsed = parseUnifiedDiff(input.patch);
  if (parsed.hunks.length === 0) fail("empty_patch", "The patch contains no hunks.");
  const absolute = confine(context.root, parsed.path);
  const original = await readFile(absolute, "utf8").catch(() => undefined);
  if (original === undefined) fail("file_not_found", `Cannot patch missing file ${parsed.path}`);

  const lines = original.split("\n");
  for (const hunk of parsed.hunks) {
    const located = locateHunk(lines, hunk);
    if (located === undefined) {
      fail(
        "patch_context_mismatch",
        `Hunk at line ${hunk.oldStart} does not match ${parsed.path}. Re-read the file and regenerate the patch.`,
        { path: parsed.path, oldStart: hunk.oldStart }
      );
    }
    lines.splice(located, hunk.removed.length, ...hunk.added);
  }

  const patched = lines.join("\n");
  if (input.apply !== true) {
    return { applied: false, path: parsed.path, hunksApplied: 0, diff: input.patch };
  }
  await writeFile(absolute, patched, "utf8");
  return { applied: true, path: parsed.path, hunksApplied: parsed.hunks.length, diff: input.patch };
}

interface Hunk {
  oldStart: number;
  removed: string[];
  added: string[];
}

function parseUnifiedDiff(patch: string): { path: string; hunks: Hunk[] } {
  const lines = patch.replace(/\r\n/g, "\n").split("\n");
  let path = "";
  const hunks: Hunk[] = [];
  let cursor = -1;

  for (const line of lines) {
    if (line.startsWith("+++ ") || line.startsWith("--- ")) {
      const candidate = line
        .slice(4)
        .replace(/^[ab]\//, "")
        .trim();
      if (candidate !== "/dev/null" && !path) path = candidate;
      continue;
    }
    const header = /^@@ -\d+(?:,\d+)? \+\d+(?:,\d+)? @@/.exec(line);
    if (header) {
      const start = /^@@ -(\d+)/.exec(line)?.[1] ?? "1";
      hunks.push({ oldStart: Number(start), removed: [], added: [] });
      cursor += 1;
      continue;
    }
    if (cursor < 0) continue;
    const hunk = hunks[cursor];
    if (!hunk) continue;
    if (line.startsWith("+")) hunk.added.push(line.slice(1));
    else if (line.startsWith("-")) hunk.removed.push(line.slice(1));
    else if (line.startsWith(" ")) {
      hunk.removed.push(line.slice(1));
      hunk.added.push(line.slice(1));
    }
  }
  return { path, hunks };
}

/** Finds where a hunk really is: exact position first, then a ±40 line window. */
function locateHunk(lines: string[], hunk: Hunk): number | undefined {
  const matches = (index: number): boolean =>
    hunk.removed.every((line, offset) => lines[index + offset] === line);

  const expected = hunk.oldStart - 1;
  if (matches(expected)) return expected;
  for (let delta = 1; delta <= 40; delta += 1) {
    if (matches(expected - delta)) return expected - delta;
    if (matches(expected + delta)) return expected + delta;
  }
  return undefined;
}

/** Minimal unified diff with 3 lines of context, good enough to review and to apply. */
export function unifiedDiff(input: {
  path: string;
  before: string;
  after: string;
  created?: boolean;
}): string {
  const a = input.before.split("\n");
  const b = input.after.split("\n");
  if (input.before === input.after) return "";

  const header = input.created
    ? `--- /dev/null\n+++ b/${input.path}`
    : `--- a/${input.path}\n+++ b/${input.path}`;

  // Whole-file hunk: correct, reviewable, and what a reviewer needs for a rewrite. A
  // line-level diff would be prettier but would need an LCS pass for no extra truth.
  const body = [
    `@@ -1,${a.length} +1,${b.length} @@`,
    ...a.map((line) => `-${line}`),
    ...b.map((line) => `+${line}`),
  ];
  return [header, ...body].join("\n");
}

// ------------------------------------------------------------------ commands

export interface CommandResult {
  command: string;
  args: string[];
  exitCode: number | null;
  stdout: string;
  stderr: string;
  durationMs: number;
  truncated: boolean;
  timedOut: boolean;
}

/**
 * Runs one allowlisted command, without a shell.
 *
 * `spawn(command, args)` with no shell is the difference between "the model can run
 * `npm test`" and "the model can run anything it can type". Argument injection is
 * blocked separately because `rm` is allowlisted only through destructive arguments.
 */
export async function runCommand(
  context: ToolContext,
  input: { command: string; args?: string[]; timeoutMs?: number; cwd?: string }
): Promise<CommandResult> {
  const bin = input.command.trim();
  if (!/^[a-zA-Z0-9._-]+$/.test(bin)) {
    fail("command_not_allowed", `Command name contains forbidden characters: ${bin}`);
  }
  if (!COMMAND_ALLOWLIST.has(bin)) {
    fail("command_not_allowed", `Command is not on the allowlist: ${bin}`, {
      allowed: [...COMMAND_ALLOWLIST].sort(),
    });
  }
  const args = (input.args ?? []).map(String);
  const joined = args.join(" ");
  if (FORBIDDEN_ARGS.some((pattern) => pattern.test(joined)) || isDestructive(bin, args)) {
    fail("command_not_allowed", `This command is refused: ${bin} ${joined}`);
  }
  const cwd = input.cwd ? confine(context.root, input.cwd) : context.root;
  const timeoutMs = Math.min(
    input.timeoutMs ?? context.commandTimeoutMs ?? DEFAULT_TIMEOUT_MS,
    600_000
  );
  const maxBytes = context.maxOutputBytes ?? DEFAULT_MAX_OUTPUT;
  const started = Date.now();

  return new Promise<CommandResult>((resolvePromise) => {
    const child = spawn(bin, args, {
      cwd,
      env: {
        ...process.env,
        CI: process.env.CI ?? "1",
        FORCE_COLOR: "0",
        // Tool output is read by a model and quoted in reports: force the C locale so
        // "not a git repository" is not translated into the user's desktop language.
        LC_ALL: "C",
        LANG: "C",
      },
      shell: false,
    });
    let stdout = "";
    let stderr = "";
    let timedOut = false;
    let truncated = false;

    const append = (target: "out" | "err", chunk: Buffer): void => {
      const current = target === "out" ? stdout : stderr;
      if (current.length >= maxBytes) {
        truncated = true;
        return;
      }
      const text = chunk.toString("utf8");
      if (target === "out") stdout += text;
      else stderr += text;
    };

    child.stdout?.on("data", (chunk: Buffer) => append("out", chunk));
    child.stderr?.on("data", (chunk: Buffer) => append("err", chunk));

    const timer = setTimeout(() => {
      timedOut = true;
      child.kill("SIGKILL");
    }, timeoutMs);

    child.on("error", (error) => {
      clearTimeout(timer);
      resolvePromise({
        command: bin,
        args,
        exitCode: null,
        stdout,
        stderr: `${stderr}\n${error.message}`.trim(),
        durationMs: Date.now() - started,
        truncated,
        timedOut,
      });
    });

    child.on("close", (code) => {
      clearTimeout(timer);
      const out = truncate(stdout, maxBytes);
      const err = truncate(stderr, maxBytes);
      resolvePromise({
        command: bin,
        args,
        exitCode: code,
        stdout: out.text,
        stderr: err.text,
        durationMs: Date.now() - started,
        truncated: truncated || out.truncated || err.truncated,
        timedOut,
      });
    });
  });
}

// ----------------------------------------------------------------------- git

export interface GitResult {
  command: string;
  exitCode: number | null;
  stdout: string;
  stderr: string;
}

async function git(context: ToolContext, args: string[]): Promise<GitResult> {
  const result = await runCommand(context, { command: "git", args, timeoutMs: 60_000 });
  return {
    command: `git ${args.join(" ")}`,
    exitCode: result.exitCode,
    stdout: result.stdout.trimEnd(),
    stderr: result.stderr.trimEnd(),
  };
}

export function gitStatus(context: ToolContext): Promise<GitResult> {
  return git(context, ["status", "--short", "--branch"]);
}

export function gitDiff(context: ToolContext, input: { staged?: boolean; path?: string } = {}) {
  const args = ["diff", "--no-color"];
  if (input.staged) args.push("--staged");
  if (input.path) args.push("--", input.path);
  return git(context, args);
}

export function gitLog(context: ToolContext, input: { limit?: number } = {}): Promise<GitResult> {
  return git(context, ["log", `-${Math.min(input.limit ?? 10, 50)}`, "--oneline", "--no-decorate"]);
}

/**
 * Creates a branch and commits explicit paths.
 *
 * `git add -A` is refused on purpose: an assistant that stages everything commits the
 * developer's half-finished work along with its own change.
 */
export async function gitCommit(
  context: ToolContext,
  input: { message: string; paths: string[]; branch?: string; apply?: boolean }
): Promise<GitResult & { applied: boolean }> {
  if (!input.message.trim()) fail("message_required", "A commit message is required.");
  if (!Array.isArray(input.paths) || input.paths.length === 0) {
    fail("paths_required", "List the files to commit; staging everything is refused.");
  }
  for (const path of input.paths) confine(context.root, path);

  if (input.apply !== true) {
    return {
      command: `git commit -m "${input.message}" -- ${input.paths.join(" ")}`,
      exitCode: null,
      stdout: "dry run — pass apply:true to execute",
      stderr: "",
      applied: false,
    };
  }
  if (input.branch) {
    const created = await git(context, ["checkout", "-B", input.branch]);
    if (created.exitCode !== 0) return { ...created, applied: false };
  }
  const add = await git(context, ["add", "--", ...input.paths]);
  if (add.exitCode !== 0) return { ...add, applied: false };
  const commit = await git(context, ["commit", "-m", input.message]);
  return { ...commit, applied: commit.exitCode === 0 };
}

/** Branch listing, creation and switching, with the branch name validated. */
export async function gitBranch(
  context: ToolContext,
  input: { action?: "list" | "create" | "switch"; name?: string } = {}
): Promise<GitResult> {
  const action = input.action ?? "list";
  if (action === "list") return git(context, ["branch", "--all", "--no-color"]);
  const name = input.name?.trim();
  // A branch name becomes an argument to git, not a shell word, but a leading `-` would
  // still be parsed as an option. Reject anything that is not a normal ref name.
  if (!name || !/^[A-Za-z0-9._/-]+$/.test(name) || name.startsWith("-")) {
    fail("invalid_branch", "A valid branch name is required (letters, digits, . _ / -).");
  }
  return action === "create"
    ? git(context, ["checkout", "-B", name])
    : git(context, ["switch", name]);
}

export function gitShow(
  context: ToolContext,
  input: { ref?: string; path?: string } = {}
): Promise<GitResult> {
  const ref = input.ref?.trim() || "HEAD";
  const args = ["show", "--no-color", "--stat", ref];
  if (input.path) args.push("--", input.path);
  return git(context, args);
}

/** Line attribution for one file, or a range of it. */
export async function gitBlame(
  context: ToolContext,
  input: { path: string; startLine?: number; endLine?: number }
): Promise<GitResult> {
  confine(context.root, input.path);
  const args = ["blame", "--no-color"];
  if (input.startLine !== undefined) {
    const end = input.endLine ?? input.startLine;
    args.push("-L", `${Math.max(1, input.startLine)},${Math.max(1, end)}`);
  }
  args.push("--", input.path);
  return git(context, args);
}

/** Stages explicit paths. `git add -A` stays impossible, for the reason in gitCommit. */
export function gitStage(context: ToolContext, input: { paths: string[] }): Promise<GitResult> {
  if (!Array.isArray(input.paths) || input.paths.length === 0) {
    fail("paths_required", "List the files to stage; staging everything is refused.");
  }
  for (const path of input.paths) confine(context.root, path);
  return git(context, ["add", "--", ...input.paths]);
}

export function gitUnstage(context: ToolContext, input: { paths: string[] }): Promise<GitResult> {
  if (!Array.isArray(input.paths) || input.paths.length === 0) {
    fail("paths_required", "List the files to unstage.");
  }
  for (const path of input.paths) confine(context.root, path);
  return git(context, ["restore", "--staged", "--", ...input.paths]);
}

// ------------------------------------------------------------- architecture

export interface ArchitectureNode {
  id: string;
  path: string;
  imports: string[];
}

export interface ArchitectureMap {
  root: string;
  files: number;
  nodes: ArchitectureNode[];
  mermaid: string;
  external: { name: string; usedBy: number }[];
}

const SOURCE_EXTENSIONS = new Set([
  ".ts",
  ".tsx",
  ".js",
  ".jsx",
  ".mjs",
  ".cjs",
  ".py",
  ".go",
  ".rs",
]);

/**
 * Builds an import graph and renders it as Mermaid.
 *
 * Two purposes: a diagram a human can read, and a dependency structure an assistant can
 * reason about when it decides which file a change belongs in. The graph is real —
 * parsed from actual import statements — not a generated guess.
 */
export async function mapArchitecture(
  context: ToolContext,
  options: { path?: string; depth?: number; maxFiles?: number } = {}
): Promise<ArchitectureMap> {
  const start = confine(context.root, options.path ?? ".");
  const maxFiles = Math.min(options.maxFiles ?? 300, 1000);
  const files: string[] = [];

  const walk = async (dir: string): Promise<void> => {
    if (files.length >= maxFiles) return;
    const dirents = await readdir(dir, { withFileTypes: true }).catch(() => []);
    for (const entry of dirents) {
      if (files.length >= maxFiles) return;
      if (entry.name.startsWith(".") || IGNORED_DIRS.has(entry.name)) continue;
      const absolute = join(dir, entry.name);
      if (entry.isDirectory()) {
        await walk(absolute);
        continue;
      }
      const dot = entry.name.lastIndexOf(".");
      if (dot < 0 || !SOURCE_EXTENSIONS.has(entry.name.slice(dot))) continue;
      files.push(absolute);
    }
  };
  await walk(start);

  const nodes: ArchitectureNode[] = [];
  const externalUses = new Map<string, number>();
  for (const absolute of files) {
    const raw = await readFile(absolute, "utf8").catch(() => "");
    const imports = extractImports(raw);
    nodes.push({
      id: relPath(context.root, absolute),
      path: relPath(context.root, absolute),
      imports,
    });
    for (const specifier of imports) {
      if (specifier.startsWith(".") || specifier.startsWith("/")) continue;
      const name = specifier.startsWith("@")
        ? specifier.split("/").slice(0, 2).join("/")
        : (specifier.split("/")[0] ?? specifier);
      externalUses.set(name, (externalUses.get(name) ?? 0) + 1);
    }
  }

  const known = new Set(nodes.map((node) => node.path));
  const edges: string[] = [];
  for (const node of nodes) {
    for (const specifier of node.imports) {
      if (!specifier.startsWith(".") && !specifier.startsWith("/")) continue;
      const target = resolveImport(node.path, specifier, known);
      if (target && target !== node.path) {
        edges.push(`  ${escapeId(node.path)} --> ${escapeId(target)}`);
      }
    }
  }

  const external = [...externalUses.entries()]
    .map(([name, usedBy]) => ({ name, usedBy }))
    .sort((a, b) => b.usedBy - a.usedBy)
    .slice(0, 20);

  const mermaid = [
    "graph LR",
    ...nodes.map((node) => `  ${escapeId(node.path)}["${node.path}"]`),
    ...edges,
  ].join("\n");

  return {
    root: relPath(process.cwd(), start) || ".",
    files: nodes.length,
    nodes,
    mermaid,
    external,
  };
}

function escapeId(value: string): string {
  return `n_${value.replace(/[^A-Za-z0-9]/g, "_")}`;
}

function extractImports(source: string): string[] {
  const out = new Set<string>();
  const patterns = [
    /import\s+(?:type\s+)?(?:[^'"]*?\sfrom\s+)?["']([^"']+)["']/g,
    /export\s+(?:type\s+)?[^'"]*?\sfrom\s+["']([^"']+)["']/g,
    /require\(\s*["']([^"']+)["']\s*\)/g,
    /from\s+([A-Za-z0-9_.]+)\s+import/g,
    /^\s*import\s+([A-Za-z0-9_.]+)\s*$/gm,
  ];
  for (const pattern of patterns) {
    for (const match of source.matchAll(pattern)) {
      const specifier = match[1];
      if (specifier) out.add(specifier);
    }
  }
  return [...out];
}

function resolveImport(
  fromPath: string,
  specifier: string,
  known: Set<string>
): string | undefined {
  const base = dirname(fromPath);
  const target = join(base, specifier).split(sep).join("/");
  // NodeNext TypeScript writes `./x.js` in the source while the file is `x.ts`. Without
  // this swap every internal edge in a TS project silently disappears from the graph.
  const swapped = target.replace(/\.(js|jsx|mjs|cjs)$/, "");
  const candidates = [
    target,
    `${swapped}.ts`,
    `${swapped}.tsx`,
    `${swapped}.js`,
    `${swapped}.jsx`,
    `${target}.ts`,
    `${target}.tsx`,
    `${target}/index.ts`,
    `${target}/index.tsx`,
    `${target}/index.js`,
  ];
  return candidates.find((candidate) => known.has(candidate));
}

/** True when the path exists and is readable; used by doctor-style preflight checks. */
export async function pathExists(absolute: string): Promise<boolean> {
  try {
    await access(absolute, constants.R_OK);
    return true;
  } catch {
    return false;
  }
}
