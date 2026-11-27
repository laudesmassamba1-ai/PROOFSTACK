import { type Control, controlFor, type Finding } from "@proofcore/core";
import { findingsForAnalysis } from "./findings.js";
import type { Services } from "./http/services.js";
import type { ProjectSourceRecord } from "./project-knowledge.js";

/**
 * Preparing a code patch from a finding.
 *
 * The assistant could read a finding and read uploaded code, but nothing joined the two:
 * a model would guess a file, quote a line from memory and present an invented diff. This
 * module joins them with the tenant's real data and refuses to pretend:
 *
 * - **Locate** (no path/before/after): rank the uploaded files by the finding's own terms
 *   (control id, measured method, observed/expected value, title) and return exact
 *   excerpts with line numbers. No file is written.
 * - **Diff** (path + before + after): require `before` to match whole lines exactly once,
 *   then return a real unified diff. Ambiguous or absent text is refused, never patched
 *   around. No file is written and no command runs.
 *
 * A patch is a proposal, not a fix: verification remains a later analysis of the same
 * control. The result says so in `next`, and `saved`/`applied` are always false.
 */

const MAX_FILES_READ = 40;
const MAX_FILE_CHARS = 60_000;
const MAX_TOTAL_CHARS = 1_200_000;
const MAX_CANDIDATES = 5;
const MAX_MATCHES_PER_FILE = 3;
const MAX_BEFORE_CHARS = 20_000;
const CONTEXT_LINES = 3;

const STOPWORDS = new Set([
  "the",
  "and",
  "for",
  "with",
  "that",
  "this",
  "from",
  "page",
  "site",
  "absent",
  "missing",
  "present",
  "expected",
  "observed",
  "value",
  "header",
  "headers",
  "response",
  "request",
  "should",
  "must",
  "does",
  "not",
  "are",
  "was",
  "were",
  "has",
  "have",
  "http",
  "https",
  "html",
  "code",
  "file",
  "using",
  "your",
  "you",
  "les",
  "des",
  "une",
  "pour",
  "sur",
  "dans",
  "avec",
  "sans",
  "est",
  "sont",
  "pas",
  "que",
  "qui",
  "page",
  "site",
  "absent",
  "present",
  "valeur",
  "entete",
  "entetes",
]);

function normalize(text: string): string {
  return text
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "");
}

/** Distinct lowercase words of a finding, long enough and specific enough to locate code. */
function termsOf(finding: Finding, control: Control | undefined): string[] {
  const text = [
    finding.controlId,
    finding.title,
    finding.cause,
    finding.evidence.method,
    finding.evidence.observed,
    finding.evidence.expected ?? "",
    finding.evidence.url ?? "",
    finding.explanation.fact,
    finding.explanation.fix,
    control?.en.title ?? "",
    control?.en.fix ?? "",
  ].join(" ");
  const terms = new Set<string>();
  for (const raw of normalize(text).split(/[^a-z0-9]+/)) {
    if (raw.length < 3 || STOPWORDS.has(raw)) continue;
    terms.add(raw);
  }
  return [...terms];
}

interface Match {
  line: number;
  excerpt: string;
}

/** The first occurrences of the finding's terms, with two lines of context. */
function matchesIn(content: string, terms: string[]): Match[] {
  const lines = content.split("\n");
  const lower = lines.map((line) => normalize(line));
  const found: Match[] = [];
  const seen = new Set<number>();
  for (const term of terms) {
    const index = lower.findIndex((line) => line.includes(term));
    if (index === -1 || seen.has(index)) continue;
    seen.add(index);
    const from = Math.max(0, index - 2);
    const to = Math.min(lines.length, index + 3);
    found.push({
      line: index + 1,
      excerpt: lines.slice(from, to).join("\n").slice(0, 600),
    });
    if (found.length >= MAX_MATCHES_PER_FILE) break;
  }
  return found;
}

export interface CodePatchCandidate {
  sourceId: string;
  sourceName: string;
  path: string;
  language: string | null;
  size: number;
  sha256: string;
  score: number;
  matches: Match[];
}

export interface PreparedFinding {
  key: string;
  module: string;
  controlId: string;
  title: string;
  status: string;
  severity: string;
  priority: string;
  cause: string;
  evidence: {
    method: string;
    observed: string;
    expected: string | null;
    url: string | null;
  };
  fix: string;
  verify: string;
}

export type UnifiedDiff =
  | {
      ok: true;
      diff: string;
      line: number;
      linesAdded: number;
      linesRemoved: number;
      lineEndings: "LF" | "CRLF";
    }
  | {
      ok: false;
      error: "before_not_found" | "before_ambiguous";
      message: string;
      lines?: number[];
    };

/**
 * A one-hunk unified diff, from whole lines only.
 *
 * Whole-line matching is deliberate: a diff computed from a substring would move code
 * around lines it never read. When `before` appears zero or several times, the caller
 * gets the line numbers instead of a guess.
 */
export function buildUnifiedDiff(
  path: string,
  content: string,
  before: string,
  after: string,
  context = CONTEXT_LINES
): UnifiedDiff {
  const lineEndings = content.includes("\r\n") ? "CRLF" : "LF";
  const normalized = content.replace(/\r\n/g, "\n");
  const strip = (text: string) => text.replace(/\r\n/g, "\n").replace(/\n$/, "");
  const lines = normalized.split("\n");
  const oldLines = strip(before).split("\n");
  const newLines = after.trim() === "" ? [] : strip(after).split("\n");

  const starts: number[] = [];
  for (let index = 0; index + oldLines.length <= lines.length; index += 1) {
    if (oldLines.every((line, offset) => lines[index + offset] === line)) starts.push(index);
  }
  if (starts.length === 0) {
    return {
      ok: false,
      error: "before_not_found",
      message:
        "`before` does not match whole lines of this file. Call the tool without path/before/after to get the exact excerpt and line numbers.",
    };
  }
  if (starts.length > 1) {
    return {
      ok: false,
      error: "before_ambiguous",
      message:
        "`before` matches several places. Include surrounding lines so the change targets one of them.",
      lines: starts.map((start) => start + 1),
    };
  }

  const start = starts[0] ?? 0;
  const from = Math.max(0, start - context);
  const to = Math.min(lines.length, start + oldLines.length + context);
  const oldCount = to - from;
  const newCount = oldCount - oldLines.length + newLines.length;
  const body = [
    ...lines.slice(from, start).map((line) => ` ${line}`),
    ...oldLines.map((line) => `-${line}`),
    ...newLines.map((line) => `+${line}`),
    ...lines.slice(start + oldLines.length, to).map((line) => ` ${line}`),
  ];
  return {
    ok: true,
    diff: [
      `--- a/${path}`,
      `+++ b/${path}`,
      `@@ -${from + 1},${oldCount} +${from + 1},${newCount} @@`,
      ...body,
    ].join("\n"),
    line: start + 1,
    linesAdded: newLines.length,
    linesRemoved: oldLines.length,
    lineEndings,
  };
}

export interface CodePatchInput {
  analysisId: string;
  findingKey: string;
  sourceId?: string;
  path?: string;
  before?: string;
  after?: string;
}

type Prepared = { finding: PreparedFinding; control: Control | undefined; projectId: string };

async function loadFinding(
  services: Services,
  workspaceId: string,
  analysisId: string,
  findingKey: string
): Promise<
  { ok: false; error: string; hint?: string } | { ok: true; prepared: Prepared; finding: Finding }
> {
  const analysis = await services.store.getAnalysis(workspaceId, analysisId);
  if (!analysis) {
    return { ok: false, error: "analysis_not_found", hint: "Call list_analyses to get a real id." };
  }
  const loaded = await findingsForAnalysis(services, analysis);
  const finding = loaded.findings.find((item) => item.key === findingKey);
  if (!finding) {
    return {
      ok: false,
      error: "finding_not_found",
      hint: "Call analysis_findings with this analysisId to get a real key.",
    };
  }
  if (!analysis.projectId) {
    return {
      ok: false,
      error: "finding_has_no_project",
      hint: "This analysis is not attached to a project, so no uploaded source can be patched. Run it from a project.",
    };
  }
  const control = controlFor(finding.module as never, finding.controlId);
  return {
    ok: true,
    finding,
    prepared: {
      finding: {
        key: finding.key,
        module: finding.module,
        controlId: finding.controlId,
        title: finding.title,
        status: finding.status,
        severity: finding.severity,
        priority: finding.priority,
        cause: finding.cause,
        evidence: { ...finding.evidence },
        fix: control?.en.fix ?? finding.explanation.fix,
        verify: control?.en.verify ?? finding.explanation.verification,
      },
      control,
      projectId: analysis.projectId,
    },
  };
}

function controlSummary(control: Control | undefined) {
  if (!control) return null;
  return {
    id: control.id,
    module: control.module,
    fr: { ...control.fr },
    en: { ...control.en },
    fixes: control.fixes.slice(0, 3).map((example) => ({ ...example })),
  };
}

export type CodePatchResult =
  | {
      ok: false;
      error: string;
      message?: string;
      hint?: string;
      finding?: PreparedFinding;
      control?: ReturnType<typeof controlSummary>;
    }
  | {
      ok: true;
      mode: "locate";
      finding: PreparedFinding;
      control: ReturnType<typeof controlSummary>;
      project: { id: string; name: string };
      sources: { id: string; name: string; files: number }[];
      filesAvailable: number;
      filesScanned: number;
      candidates: CodePatchCandidate[];
      saved: false;
      applied: false;
      next: string;
      hint?: string;
    }
  | {
      ok: true;
      mode: "diff";
      finding: PreparedFinding;
      control: ReturnType<typeof controlSummary>;
      project: { id: string; name: string };
      path: string;
      sourceId: string;
      sourceName: string;
      line: number;
      linesAdded: number;
      linesRemoved: number;
      lineEndings: "LF" | "CRLF";
      diff: string;
      saved: false;
      applied: false;
      next: string;
    };

export async function prepareCodePatch(input: {
  services: Services;
  workspaceId: string;
  args: CodePatchInput;
}): Promise<CodePatchResult> {
  const { services, workspaceId, args } = input;
  if (!args.analysisId || !args.findingKey) {
    return { ok: false, error: "analysisId and findingKey are required" };
  }

  const loaded = await loadFinding(services, workspaceId, args.analysisId, args.findingKey);
  if (!loaded.ok) return loaded;
  const { prepared } = loaded;
  const control = controlSummary(prepared.control);

  if (!services.projectKnowledge) {
    return {
      ok: false,
      error: "project_intelligence_not_configured",
      hint: "This deployment has no project source store (NEON_DATABASE_URL). Uploaded code cannot be read.",
      finding: prepared.finding,
      control,
    };
  }
  const project = await services.store.getProject(workspaceId, prepared.projectId);
  if (!project) {
    return {
      ok: false,
      error: "project_not_found",
      hint: "The analysis references a project that is no longer in this workspace.",
      finding: prepared.finding,
      control,
    };
  }

  const knowledge = services.projectKnowledge;
  const sources = await knowledge.listSources(workspaceId, project.id);
  if (args.sourceId && !sources.some((source) => source.id === args.sourceId)) {
    return {
      ok: false,
      error: "source_not_found",
      hint: "Call project_code without a sourceId to list the project's uploaded sources.",
      finding: prepared.finding,
      control,
    };
  }

  const wanted = [args.path, args.before, args.after].filter(
    (value) => typeof value === "string" && value.length > 0
  ).length;
  const wantsDiff = wanted > 0;
  if (
    wantsDiff &&
    (typeof args.path !== "string" ||
      typeof args.before !== "string" ||
      typeof args.after !== "string")
  ) {
    return {
      ok: false,
      error: "incomplete_patch",
      message: "path, before and after must be provided together.",
      hint: "Omit all three to locate candidate files; then pass the exact excerpt as `before`.",
      finding: prepared.finding,
      control,
    };
  }
  if (wantsDiff && typeof args.before === "string" && args.before.trim() === "") {
    return {
      ok: false,
      error: "before_empty",
      message:
        "before must quote the lines to replace; pass the exact excerpt, not an empty string.",
      finding: prepared.finding,
      control,
    };
  }
  if (typeof args.before === "string" && args.before.length > MAX_BEFORE_CHARS) {
    return {
      ok: false,
      error: "before_too_large",
      message: `before is limited to ${MAX_BEFORE_CHARS} characters.`,
      finding: prepared.finding,
      control,
    };
  }

  // ---------------------------------------------------------------- diff mode
  if (wantsDiff && typeof args.path === "string") {
    const selected = args.sourceId
      ? sources.find((source) => source.id === args.sourceId)
      : undefined;
    const searchIn = selected ? [selected] : sources;
    const holders: ProjectSourceRecord[] = [];
    for (const source of searchIn) {
      const files = await knowledge.listFiles(workspaceId, project.id, source.id);
      if (files.some((file) => file.path === args.path)) holders.push(source);
    }
    if (holders.length === 0) {
      return {
        ok: false,
        error: "file_not_found",
        hint: "Call project_code without a path to list the files of this project.",
        finding: prepared.finding,
        control,
      };
    }
    if (holders.length > 1) {
      return {
        ok: false,
        error: "file_ambiguous",
        message: `Several uploaded sources contain ${args.path}.`,
        hint: "Pass sourceId to choose one.",
        finding: prepared.finding,
        control,
      };
    }
    const holder = holders[0] as ProjectSourceRecord;
    const file = await knowledge.readFile(workspaceId, project.id, holder.id, args.path);
    if (!file) {
      return {
        ok: false,
        error: "file_not_found",
        hint: "The file disappeared while preparing the patch.",
        finding: prepared.finding,
        control,
      };
    }
    const diff = buildUnifiedDiff(file.path, file.content, args.before ?? "", args.after ?? "");
    if (!diff.ok) {
      return {
        ok: false,
        error: diff.error,
        message: diff.message,
        hint: "Call prepare_code_patch without path/before/after to get the exact excerpt.",
        finding: prepared.finding,
        control,
      };
    }
    return {
      ok: true,
      mode: "diff",
      finding: prepared.finding,
      control,
      project: { id: project.id, name: project.name },
      path: file.path,
      sourceId: holder.id,
      sourceName: holder.name,
      line: diff.line,
      linesAdded: diff.linesAdded,
      linesRemoved: diff.linesRemoved,
      lineEndings: diff.lineEndings,
      diff: diff.diff,
      saved: false,
      applied: false,
      next: "Review this diff with the person. Applying it is their action; a later analysis of the same control is what verifies the fix.",
    };
  }

  // -------------------------------------------------------------- locate mode
  const terms = termsOf(loaded.finding, prepared.control);
  const candidates: CodePatchCandidate[] = [];
  let filesAvailable = 0;
  let filesScanned = 0;
  let charsRead = 0;

  for (const source of sources) {
    if (args.sourceId && source.id !== args.sourceId) continue;
    const files = await knowledge.listFiles(workspaceId, project.id, source.id);
    filesAvailable += files.length;
    const ranked = files
      .map((file) => ({
        file,
        pathScore: terms.reduce(
          (score, term) => (normalize(file.path).includes(term) ? score + 3 : score),
          0
        ),
      }))
      .sort((left, right) => right.pathScore - left.pathScore || left.file.size - right.file.size);

    for (const { file, pathScore } of ranked) {
      if (filesScanned >= MAX_FILES_READ || charsRead >= MAX_TOTAL_CHARS) break;
      if (file.size > MAX_FILE_CHARS) continue;
      const read = await knowledge.readFile(workspaceId, project.id, source.id, file.path);
      if (!read) continue;
      filesScanned += 1;
      charsRead += read.content.length;
      const lower = normalize(read.content);
      const matches = matchesIn(read.content, terms);
      const contentScore = terms.reduce(
        (score, term) => (lower.includes(term) ? score + 1 : score),
        0
      );
      const score = pathScore + contentScore;
      if (score === 0) continue;
      candidates.push({
        sourceId: source.id,
        sourceName: source.name,
        path: file.path,
        language: file.language,
        size: file.size,
        sha256: file.sha256,
        score,
        matches,
      });
    }
  }

  candidates.sort((left, right) => right.score - left.score || left.path.localeCompare(right.path));
  const top = candidates.slice(0, MAX_CANDIDATES).map((candidate) => ({
    ...candidate,
    matches: candidate.matches.map((match) => ({ ...match })),
  }));

  return {
    ok: true,
    mode: "locate",
    finding: prepared.finding,
    control,
    project: { id: project.id, name: project.name },
    sources: sources.map((source) => ({
      id: source.id,
      name: source.name,
      files: source.fileCount,
    })),
    filesAvailable,
    filesScanned,
    candidates: top,
    saved: false,
    applied: false,
    next: "Read the excerpt, then call again with path, before (the exact lines) and after to receive a unified diff. Nothing is written by this tool.",
    ...(top.length === 0
      ? {
          hint: "No uploaded file contains the finding's terms. Ask which file implements this control, or read one with project_code; do not invent a path.",
        }
      : {}),
  };
}
