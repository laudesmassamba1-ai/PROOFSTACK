import { createHash } from "node:crypto";
import { cp, mkdir, readdir, readFile, rename, rm, stat } from "node:fs/promises";
import { basename, dirname, extname, join, relative, resolve, sep } from "node:path";
import { ProofCoreError } from "@proofcore/core";
import { confine, type ToolContext, unifiedDiff } from "./code-tools.js";

/**
 * Filesystem tools beyond whole-file writes.
 *
 * `write_file` covers "replace this file"; real work also needs "change this one line",
 * "rename this folder", "delete this generated directory", "what is this file". Leaving
 * those to `run_command` would mean the agent shells out for `sed`, `mv` and `rm` — three
 * commands whose escaping rules differ per platform and whose mistakes are unrecoverable.
 *
 * Every mutating tool keeps the same contract as `write_file`: without `apply: true` it
 * computes and returns what it *would* do. Deletion cannot be shown as a unified diff, so it
 * returns the list of entries that would disappear.
 */

function rel(root: string, absolute: string): string {
  return relative(root, absolute) || ".";
}

function isInsideGit(absolute: string, root: string): boolean {
  return rel(root, absolute).split(sep).includes(".git");
}

export interface EditResult {
  path: string;
  applied: boolean;
  replacements: number;
  diff: string;
}

/**
 * Replaces an exact string in a file.
 *
 * Exact, not fuzzy: a model that cannot quote the text it wants to replace has not read the
 * file, and a fuzzy match is how an edit lands in the wrong branch of an `if`. When the
 * string appears more than once, the call fails unless `replaceAll` is explicit — the error
 * lists the line numbers so the next call can include more context.
 */
export async function editFile(
  context: ToolContext,
  input: {
    path: string;
    oldString: string;
    newString: string;
    replaceAll?: boolean;
    apply?: boolean;
  }
): Promise<EditResult> {
  const absolute = confine(context.root, input.path);
  if (!input.oldString) {
    throw new ProofCoreError({
      message: "oldString must not be empty: use write_file to create or replace a whole file.",
      category: "VALIDATION",
      code: "old_string_required",
    });
  }
  if (input.oldString === input.newString) {
    throw new ProofCoreError({
      message: "oldString and newString are identical: nothing to change.",
      category: "VALIDATION",
      code: "no_change",
    });
  }
  const before = await readFile(absolute, "utf8").catch(() => undefined);
  if (before === undefined) {
    throw new ProofCoreError({
      message: `Cannot edit missing file ${input.path}. Use write_file to create it.`,
      category: "VALIDATION",
      code: "file_not_found",
    });
  }

  const occurrences = before.split(input.oldString).length - 1;
  if (occurrences === 0) {
    throw new ProofCoreError({
      message: `The text was not found in ${input.path}. Re-read the file and quote it exactly, including indentation.`,
      category: "VALIDATION",
      code: "text_not_found",
    });
  }
  if (occurrences > 1 && input.replaceAll !== true) {
    const lines: number[] = [];
    let index = before.indexOf(input.oldString);
    while (index >= 0 && lines.length < 20) {
      lines.push(before.slice(0, index).split("\n").length);
      index = before.indexOf(input.oldString, index + 1);
    }
    throw new ProofCoreError({
      message: `${occurrences} occurrences in ${input.path} (lines ${lines.join(", ")}). Include more surrounding text, or pass replaceAll:true.`,
      category: "VALIDATION",
      code: "ambiguous_edit",
      details: { occurrences, lines },
    });
  }

  const after =
    input.replaceAll === true
      ? before.split(input.oldString).join(input.newString)
      : before.replace(input.oldString, input.newString);
  const diff = unifiedDiff({ path: rel(context.root, absolute), before, after });

  if (input.apply !== true) {
    return {
      path: rel(context.root, absolute),
      applied: false,
      replacements: occurrences,
      diff,
    };
  }
  const { writeFile } = await import("node:fs/promises");
  await writeFile(absolute, after, "utf8");
  return {
    path: rel(context.root, absolute),
    applied: true,
    replacements: occurrences,
    diff,
  };
}

export interface DeleteResult {
  path: string;
  applied: boolean;
  type: "file" | "directory" | "symlink";
  removed: string[];
  bytes: number;
}

/** Deletes a file or a directory; a non-empty directory needs `recursive: true`. */
export async function deletePath(
  context: ToolContext,
  input: { path: string; recursive?: boolean; apply?: boolean }
): Promise<DeleteResult> {
  const absolute = confine(context.root, input.path);
  if (resolve(absolute) === resolve(context.root)) {
    throw new ProofCoreError({
      message: "Refusing to delete the workspace root.",
      category: "VALIDATION",
      code: "root_protected",
    });
  }
  if (isInsideGit(absolute, context.root)) {
    throw new ProofCoreError({
      message: "Refusing to delete inside .git: use git commands to change history.",
      category: "VALIDATION",
      code: "git_protected",
    });
  }
  const info = await stat(absolute).catch(() => undefined);
  if (!info) {
    throw new ProofCoreError({
      message: `Nothing to delete at ${input.path}.`,
      category: "VALIDATION",
      code: "path_not_found",
    });
  }

  const removed: string[] = [];
  let bytes = 0;
  const walk = async (target: string, depth: number): Promise<void> => {
    const entries = await readdir(target, { withFileTypes: true }).catch(() => []);
    if (entries.length === 0) {
      removed.push(`${rel(context.root, target)}${sep}`);
      return;
    }
    for (const entry of entries) {
      const child = join(target, entry.name);
      if (entry.isDirectory()) {
        if (depth >= 4) {
          removed.push(`${rel(context.root, child)}${sep}…`);
          continue;
        }
        await walk(child, depth + 1);
      } else {
        const fileInfo = await stat(child).catch(() => undefined);
        bytes += fileInfo?.size ?? 0;
        removed.push(rel(context.root, child));
      }
      if (removed.length >= 500) return;
    }
  };

  if (info.isDirectory()) {
    if (input.recursive !== true) {
      const entries = await readdir(absolute).catch(() => []);
      if (entries.length > 0) {
        throw new ProofCoreError({
          message: `${input.path} is a non-empty directory (${entries.length} entries). Pass recursive:true to delete it.`,
          category: "VALIDATION",
          code: "directory_not_empty",
        });
      }
    }
    await walk(absolute, 0);
  } else {
    bytes = info.size;
    removed.push(rel(context.root, absolute));
  }

  if (input.apply !== true) {
    return {
      path: rel(context.root, absolute),
      applied: false,
      type: info.isDirectory() ? "directory" : info.isSymbolicLink() ? "symlink" : "file",
      removed,
      bytes,
    };
  }
  await rm(absolute, { recursive: true, force: false });
  return {
    path: rel(context.root, absolute),
    applied: true,
    type: info.isDirectory() ? "directory" : info.isSymbolicLink() ? "symlink" : "file",
    removed,
    bytes,
  };
}

function assertDifferent(from: string, to: string, root: string): void {
  if (resolve(from) === resolve(to)) {
    throw new ProofCoreError({
      message: "Source and destination are the same path.",
      category: "VALIDATION",
      code: "same_path",
    });
  }
  if (resolve(root) === resolve(to)) {
    throw new ProofCoreError({
      message: "Refusing to replace the workspace root.",
      category: "VALIDATION",
      code: "root_protected",
    });
  }
}

/** Renames or moves a file or directory. Shows the move first, then performs it. */
export async function movePath(
  context: ToolContext,
  input: { from: string; to: string; overwrite?: boolean; apply?: boolean }
): Promise<{ from: string; to: string; applied: boolean; overwritten: boolean }> {
  const from = confine(context.root, input.from);
  const to = confine(context.root, input.to);
  assertDifferent(from, to, context.root);
  const source = await stat(from).catch(() => undefined);
  if (!source) {
    throw new ProofCoreError({
      message: `Nothing to move at ${input.from}.`,
      category: "VALIDATION",
      code: "path_not_found",
    });
  }
  const existing = await stat(to).catch(() => undefined);
  if (existing && input.overwrite !== true) {
    throw new ProofCoreError({
      message: `${input.to} already exists. Pass overwrite:true to replace it.`,
      category: "VALIDATION",
      code: "destination_exists",
    });
  }
  if (input.apply !== true) {
    return {
      from: rel(context.root, from),
      to: rel(context.root, to),
      applied: false,
      overwritten: Boolean(existing),
    };
  }
  await mkdir(dirname(to), { recursive: true });
  if (existing && input.overwrite === true) await rm(to, { recursive: true, force: true });
  await rename(from, to);
  return {
    from: rel(context.root, from),
    to: rel(context.root, to),
    applied: true,
    overwritten: Boolean(existing),
  };
}

/** Copies a file or a directory, recursively. */
export async function copyPath(
  context: ToolContext,
  input: { from: string; to: string; overwrite?: boolean; apply?: boolean }
): Promise<{ from: string; to: string; applied: boolean; overwritten: boolean }> {
  const from = confine(context.root, input.from);
  const to = confine(context.root, input.to);
  assertDifferent(from, to, context.root);
  const source = await stat(from).catch(() => undefined);
  if (!source) {
    throw new ProofCoreError({
      message: `Nothing to copy at ${input.from}.`,
      category: "VALIDATION",
      code: "path_not_found",
    });
  }
  const existing = await stat(to).catch(() => undefined);
  if (existing && input.overwrite !== true) {
    throw new ProofCoreError({
      message: `${input.to} already exists. Pass overwrite:true to replace it.`,
      category: "VALIDATION",
      code: "destination_exists",
    });
  }
  if (input.apply !== true) {
    return {
      from: rel(context.root, from),
      to: rel(context.root, to),
      applied: false,
      overwritten: Boolean(existing),
    };
  }
  await mkdir(dirname(to), { recursive: true });
  if (existing && input.overwrite === true) await rm(to, { recursive: true, force: true });
  await cp(from, to, {
    recursive: source.isDirectory(),
    force: input.overwrite === true,
    errorOnExist: input.overwrite !== true,
  });
  return {
    from: rel(context.root, from),
    to: rel(context.root, to),
    applied: true,
    overwritten: Boolean(existing),
  };
}

/** Creates a directory, including parents. Idempotent. */
export async function makeDirectory(
  context: ToolContext,
  input: { path: string }
): Promise<{ path: string; created: boolean }> {
  const absolute = confine(context.root, input.path);
  const existing = await stat(absolute).catch(() => undefined);
  if (existing?.isDirectory()) return { path: rel(context.root, absolute), created: false };
  if (existing) {
    throw new ProofCoreError({
      message: `${input.path} exists and is not a directory.`,
      category: "VALIDATION",
      code: "not_a_directory",
    });
  }
  await mkdir(absolute, { recursive: true });
  return { path: rel(context.root, absolute), created: true };
}

export interface PathInfo {
  path: string;
  type: "file" | "directory" | "other";
  size: number;
  modifiedAt: string;
  lines?: number;
  sha256?: string;
  extension: string;
  name: string;
}

/** What a file is, before deciding what to do with it. */
export async function pathInfo(context: ToolContext, input: { path: string }): Promise<PathInfo> {
  const absolute = confine(context.root, input.path);
  const info = await stat(absolute).catch(() => undefined);
  if (!info) {
    throw new ProofCoreError({
      message: `No such path: ${input.path}`,
      category: "VALIDATION",
      code: "path_not_found",
    });
  }
  const result: PathInfo = {
    path: rel(context.root, absolute),
    type: info.isDirectory() ? "directory" : info.isFile() ? "file" : "other",
    size: info.size,
    modifiedAt: info.mtime.toISOString(),
    extension: extname(absolute),
    name: basename(absolute),
  };
  if (info.isFile() && info.size <= 5_000_000) {
    const buffer = await readFile(absolute).catch(() => undefined);
    if (buffer) {
      result.sha256 = createHash("sha256").update(buffer).digest("hex");
      // A line count on a binary is meaningless; only count what decodes as UTF-8 text.
      const text = buffer.toString("utf8");
      if (!text.includes("\u0000")) result.lines = text.split("\n").length;
    }
  }
  return result;
}

/** Every entry directly under a directory, for a quick inventory. */
export async function listDirectory(
  context: ToolContext,
  input: { path?: string; limit?: number }
): Promise<{
  path: string;
  entries: { name: string; type: "file" | "directory" | "other"; size: number }[];
}> {
  const absolute = confine(context.root, input.path ?? ".");
  const limit = Math.min(input.limit ?? 500, 2_000);
  const entries = await readdir(absolute, { withFileTypes: true }).catch(() => []);
  const out: { name: string; type: "file" | "directory" | "other"; size: number }[] = [];
  for (const entry of entries.slice(0, limit)) {
    const info = await stat(join(absolute, entry.name)).catch(() => undefined);
    out.push({
      name: entry.name,
      type: entry.isDirectory() ? "directory" : entry.isFile() ? "file" : "other",
      size: info?.size ?? 0,
    });
  }
  return { path: rel(context.root, absolute), entries: out };
}
