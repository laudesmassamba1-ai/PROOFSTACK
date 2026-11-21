import {
  Brain,
  ChevronRight,
  FileCode2,
  FolderOpen,
  FolderUp,
  Loader2,
  RefreshCw,
  ShieldAlert,
  Trash2,
} from "lucide-react";
import type React from "react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Link } from "react-router";
import { type ApiError, apiFetch } from "../../lib/api.js";
import { relativeTime } from "../../lib/format.js";
import { useSession } from "../../lib/session.js";
import { Empty, ErrorState } from "./ui.js";

interface Source {
  id: string;
  name: string;
  kind: "folder" | "repo";
  fileCount: number;
  createdAt: string;
}

interface FileMeta {
  id: string;
  path: string;
  language: string | null;
  size: number;
}

interface Finding {
  severity: "critical" | "high" | "medium" | "low";
  file: string;
  line: number | null;
  title: string;
  evidence: string;
  fix: string;
}

interface AiAudit {
  id: string;
  scope: string;
  mode: "file" | "folder" | "project";
  status: "done" | "failed";
  score: number | null;
  summary: string | null;
  model: string | null;
  provider: string | null;
  filesAnalyzed: number;
  findings: Finding[];
  error: string | null;
  createdAt: string;
}

interface Metrics {
  sources: number;
  files: number;
  audits: number;
  averageScore: number | null;
  findingsBySeverity: { severity: string; count: number }[];
  scoreTrend: { id: string; createdAt: string; score: number; scope: string }[];
}

const TEXT_EXTENSIONS = new Set([
  "ts",
  "tsx",
  "js",
  "jsx",
  "mjs",
  "cjs",
  "json",
  "css",
  "scss",
  "html",
  "md",
  "py",
  "rb",
  "go",
  "rs",
  "java",
  "kt",
  "php",
  "sql",
  "yml",
  "yaml",
  "toml",
  "sh",
  "txt",
  "env",
]);
const SKIP_DIRECTORIES = [
  "node_modules/",
  "dist/",
  "build/",
  ".git/",
  "coverage/",
  "vendor/",
  ".next/",
];
const SKIP_FILES = new Set([
  "pnpm-lock.yaml",
  "package-lock.json",
  "yarn.lock",
  "bun.lockb",
  "Cargo.lock",
]);
const MAX_FILES = 250;
const MAX_TOTAL_CHARS = 1_500_000;
const MAX_FILE_BYTES = 200_000;

function readable(file: File): boolean {
  if (file.size === 0 || file.size > MAX_FILE_BYTES) return false;
  if (SKIP_FILES.has(file.name)) return false;
  const extension = file.name.split(".").pop()?.toLowerCase() ?? "";
  return TEXT_EXTENSIONS.has(extension);
}

function errorText(error: unknown): string {
  if (typeof error === "object" && error !== null && "message" in error) {
    return String((error as { message: unknown }).message);
  }
  return "L'opération a échoué.";
}

export function ProjectAiPanel({ projectId }: { projectId: string }) {
  const { workspaceId } = useSession();
  const [sources, setSources] = useState<Source[] | null>(null);
  const [sourceId, setSourceId] = useState("");
  const [files, setFiles] = useState<FileMeta[]>([]);
  const [audits, setAudits] = useState<AiAudit[]>([]);
  const [selected, setSelected] = useState<AiAudit | null>(null);
  const [selectedFile, setSelectedFile] = useState("");
  const [scope, setScope] = useState("");
  const [filter, setFilter] = useState("");
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState<"import" | "audit" | "delete" | null>(null);
  const [error, setError] = useState<ApiError | Error | null>(null);
  const [notice, setNotice] = useState("");
  const [instructions, setInstructions] = useState("");
  const folderRef = useRef<HTMLInputElement>(null);
  const filesRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    folderRef.current?.setAttribute("webkitdirectory", "");
    folderRef.current?.setAttribute("directory", "");
  }, []);

  const load = useCallback(async () => {
    if (!workspaceId) return;
    setLoading(true);
    setError(null);
    try {
      const [sourceBody, auditBody] = await Promise.all([
        apiFetch<{ items: Source[] }>(
          `/api/v1/projects/${projectId}/sources?workspaceId=${workspaceId}`
        ),
        apiFetch<{ items: AiAudit[] }>(
          `/api/v1/projects/${projectId}/ai-audits?workspaceId=${workspaceId}`
        ),
      ]);
      setSources(sourceBody.items);
      setAudits(auditBody.items);
      setSelected(auditBody.items[0] ?? null);
      setSourceId((current) => current || sourceBody.items[0]?.id || "");
    } catch (caught) {
      setError(caught as ApiError);
    } finally {
      setLoading(false);
    }
  }, [projectId, workspaceId]);

  useEffect(() => {
    void load();
  }, [load]);

  useEffect(() => {
    if (!workspaceId || !sourceId) {
      setFiles([]);
      return;
    }
    let alive = true;
    void apiFetch<{ items: FileMeta[] }>(
      `/api/v1/projects/${projectId}/sources/${sourceId}/files?workspaceId=${workspaceId}`
    )
      .then((body) => {
        if (alive) {
          setFiles(body.items);
          setSelectedFile("");
          setScope("");
        }
      })
      .catch((caught: unknown) => {
        if (alive) setError(caught as ApiError);
      });
    return () => {
      alive = false;
    };
  }, [projectId, sourceId, workspaceId]);

  const visibleFiles = useMemo(() => {
    const needle = filter.trim().toLowerCase();
    if (!needle) return files;
    return files.filter((file) => file.path.toLowerCase().includes(needle));
  }, [files, filter]);

  const directories = useMemo(
    () =>
      [
        ...new Set(
          files
            .map((file) => file.path.split("/").slice(0, -1).join("/"))
            .filter((path) => path.length > 0)
        ),
      ].sort(),
    [files]
  );

  const importFiles = async (list: File[], rootName: string) => {
    if (!workspaceId) return;
    setBusy("import");
    setError(null);
    setNotice("");
    try {
      const chosen = list.filter(readable);
      if (chosen.length === 0) {
        throw new Error(
          "Aucun fichier texte lisible. Les binaires, images, lockfiles et fichiers de plus de 200 Ko sont ignorés."
        );
      }
      const capped = chosen.slice(0, MAX_FILES);
      const payload = [];
      let total = 0;
      for (const file of capped) {
        const relative = (file as File & { webkitRelativePath?: string }).webkitRelativePath;
        const raw = relative || file.name;
        const path = raw.startsWith(`${rootName}/`) ? raw.slice(rootName.length + 1) : raw;
        if (SKIP_DIRECTORIES.some((directory) => raw.includes(directory))) continue;
        const content = await file.text();
        if (total + content.length > MAX_TOTAL_CHARS) break;
        total += content.length;
        payload.push({ path, content });
      }
      if (payload.length === 0) throw new Error("Aucun fichier n'a pu être lu.");
      const body = await apiFetch<{ source: Source }>(`/api/v1/projects/${projectId}/sources`, {
        method: "POST",
        body: {
          workspaceId,
          name: rootName || "Import local",
          kind: "folder",
          files: payload,
        },
      });
      setSourceId(body.source.id);
      setNotice(
        `${body.source.fileCount} fichier(s) importé(s). Tu peux maintenant lancer un audit IA.`
      );
      await load();
    } catch (caught) {
      setError(caught as ApiError);
    } finally {
      setBusy(null);
      if (folderRef.current) folderRef.current.value = "";
      if (filesRef.current) filesRef.current.value = "";
    }
  };

  const handleFolder = (event: React.ChangeEvent<HTMLInputElement>) => {
    const list = Array.from(event.target.files ?? []);
    const first = list[0] as (File & { webkitRelativePath?: string }) | undefined;
    const root = first?.webkitRelativePath?.split("/")[0] ?? "Import local";
    void importFiles(list, root);
  };

  const handleFiles = (event: React.ChangeEvent<HTMLInputElement>) => {
    void importFiles(Array.from(event.target.files ?? []), "Fichiers importés");
  };

  const removeSource = async () => {
    if (!workspaceId || !sourceId) return;
    setBusy("delete");
    setError(null);
    try {
      await apiFetch(
        `/api/v1/projects/${projectId}/sources/${sourceId}?workspaceId=${workspaceId}`,
        { method: "DELETE" }
      );
      setSourceId("");
      await load();
    } catch (caught) {
      setError(caught as ApiError);
    } finally {
      setBusy(null);
    }
  };

  const runAudit = async (mode: "file" | "folder" | "project") => {
    if (!workspaceId || !sourceId) return;
    setBusy("audit");
    setError(null);
    setNotice("");
    try {
      const body = await apiFetch<{ audit: AiAudit }>(`/api/v1/projects/${projectId}/ai-audit`, {
        method: "POST",
        body: {
          workspaceId,
          sourceId,
          ...(mode === "file" ? { path: selectedFile } : {}),
          ...(mode === "folder" ? { scope } : {}),
          ...(instructions.trim() ? { instructions: instructions.trim() } : {}),
        },
      });
      setSelected(body.audit);
      setAudits((current) => [body.audit, ...current]);
      setNotice(
        `${body.audit.filesAnalyzed} fichier(s) lus par ${body.audit.provider ?? "l'IA"} (${body.audit.model ?? "modèle"}).`
      );
    } catch (caught) {
      setError(caught as ApiError);
    } finally {
      setBusy(null);
    }
  };

  if (loading) {
    return (
      <div className="flex items-center gap-2 px-1 py-8 text-sm text-muted">
        <Loader2 size={16} className="animate-spin" /> Chargement des fichiers…
      </div>
    );
  }

  if (error && !sources) return <ErrorState error={error} onRetry={() => void load()} />;

  return (
    <div className="grid gap-4 xl:grid-cols-[0.9fr_1.1fr]">
      <section className="app-workbench min-w-0">
        <header className="app-workbench-head">
          <div>
            <p className="app-eyebrow">01 / SOURCE</p>
            <h2 className="app-workbench-title">Le code à comprendre</h2>
          </div>
          <div className="flex flex-wrap gap-2">
            <input
              ref={folderRef}
              type="file"
              multiple
              className="hidden"
              onChange={handleFolder}
            />
            <input ref={filesRef} type="file" multiple className="hidden" onChange={handleFiles} />
            <button
              type="button"
              className="app-btn app-btn-primary app-btn-sm"
              onClick={() => folderRef.current?.click()}
              disabled={busy !== null}
            >
              <FolderUp size={14} /> Importer un dossier
            </button>
            <button
              type="button"
              className="app-btn app-btn-sm"
              onClick={() => filesRef.current?.click()}
              disabled={busy !== null}
            >
              <FileCode2 size={14} /> Fichiers
            </button>
          </div>
        </header>

        {sources && sources.length > 0 ? (
          <div className="space-y-3 px-5 py-4">
            <div className="flex flex-wrap items-end gap-2">
              <label className="min-w-0 flex-1 text-xs text-muted">
                Source
                <select
                  className="app-select mt-1 w-full"
                  value={sourceId}
                  onChange={(event) => setSourceId(event.target.value)}
                >
                  {sources.map((source) => (
                    <option key={source.id} value={source.id}>
                      {source.name} · {source.fileCount} fichier(s)
                    </option>
                  ))}
                </select>
              </label>
              <button
                type="button"
                className="app-btn app-btn-sm"
                onClick={() => void removeSource()}
                disabled={busy !== null}
                title="Supprimer cette source et ses fichiers"
              >
                {busy === "delete" ? (
                  <Loader2 size={14} className="animate-spin" />
                ) : (
                  <Trash2 size={14} />
                )}
                Supprimer
              </button>
            </div>

            <input
              className="app-input"
              placeholder="Filtrer les fichiers…"
              value={filter}
              onChange={(event) => setFilter(event.target.value)}
            />

            <div className="max-h-64 overflow-auto rounded-[var(--radius)] border border-black/10">
              {visibleFiles.length === 0 ? (
                <p className="px-3 py-4 text-xs text-muted">Aucun fichier ne correspond.</p>
              ) : (
                visibleFiles.map((file) => (
                  <button
                    key={file.id}
                    type="button"
                    className={`flex w-full items-center gap-2 border-b border-black/5 px-3 py-2 text-left text-xs last:border-0 ${
                      selectedFile === file.path
                        ? "bg-surface-alt font-medium"
                        : "hover:bg-surface-alt"
                    }`}
                    onClick={() => {
                      setSelectedFile(file.path);
                      setScope(file.path.split("/").slice(0, -1).join("/"));
                    }}
                  >
                    <FileCode2 size={13} className="shrink-0 text-muted" />
                    <span className="min-w-0 flex-1 truncate app-mono">{file.path}</span>
                    <ChevronRight size={12} className="shrink-0 text-muted" />
                  </button>
                ))
              )}
            </div>

            <div className="grid gap-2 sm:grid-cols-2">
              <label className="text-xs text-muted">
                Dossier à auditer
                <input
                  className="app-input mt-1"
                  list="project-directories"
                  placeholder="src/api"
                  value={scope}
                  onChange={(event) => setScope(event.target.value)}
                />
                <datalist id="project-directories">
                  {directories.slice(0, 80).map((directory) => (
                    <option key={directory} value={directory} />
                  ))}
                </datalist>
              </label>
              <label className="text-xs text-muted">
                Consigne à l'IA (optionnel)
                <input
                  className="app-input mt-1"
                  maxLength={1000}
                  placeholder="Cherche les injections SQL et les secrets exposés"
                  value={instructions}
                  onChange={(event) => setInstructions(event.target.value)}
                />
              </label>
            </div>

            <div className="flex flex-wrap gap-2">
              <button
                type="button"
                className="app-btn app-btn-primary"
                onClick={() => void runAudit("project")}
                disabled={busy !== null}
              >
                {busy === "audit" ? (
                  <Loader2 size={14} className="animate-spin" />
                ) : (
                  <Brain size={14} />
                )}
                Auditer tout le projet
              </button>
              <button
                type="button"
                className="app-btn"
                onClick={() => void runAudit("folder")}
                disabled={busy !== null || !scope.trim()}
              >
                <FolderOpen size={14} /> Auditer ce dossier
              </button>
              <button
                type="button"
                className="app-btn"
                onClick={() => void runAudit("file")}
                disabled={busy !== null || !selectedFile}
              >
                <FileCode2 size={14} /> Auditer ce fichier
              </button>
            </div>
            <p className="text-[11px] leading-relaxed text-muted">
              L'IA lit réellement les fichiers sélectionnés, pas seulement les verdicts des modules.
              Maximum {MAX_FILES} fichiers et 1,5 million de caractères par import ; les binaires et
              lockfiles sont ignorés. L'audit consomme un crédit d'audit IA.
            </p>
          </div>
        ) : (
          <div className="px-5 py-5">
            <div className="rounded-[var(--radius)] border border-dashed border-black/15 px-5 py-8 text-center">
              <FolderUp size={28} className="mx-auto text-muted" strokeWidth={1.4} />
              <p className="mt-3 text-sm font-medium">Importe le dossier du projet</p>
              <p className="mx-auto mt-1 max-w-md text-xs leading-relaxed text-muted">
                Le navigateur lit les fichiers texte et les envoie à ton espace PROOFCORE. Tu
                pourras auditer un fichier, un sous-dossier ou tout le projet. Aucun binaire n'est
                envoyé.
              </p>
              <button
                type="button"
                className="app-btn app-btn-primary mt-4"
                onClick={() => folderRef.current?.click()}
                disabled={busy !== null}
              >
                {busy === "import" ? (
                  <Loader2 size={14} className="animate-spin" />
                ) : (
                  <FolderUp size={14} />
                )}
                Choisir un dossier
              </button>
            </div>
          </div>
        )}

        {error ? (
          <div className="border-t border-danger/20 px-5 py-3 text-xs leading-relaxed text-danger">
            {errorText(error)}
            {typeof error === "object" &&
            error !== null &&
            "code" in error &&
            (error as { code?: string }).code === "ai_not_configured" ? (
              <>
                {" "}
                <Link to="/app/ai" className="underline">
                  Connecter un fournisseur IA
                </Link>
              </>
            ) : null}
          </div>
        ) : null}
        {notice ? (
          <p className="border-t border-success/20 px-5 py-3 text-xs text-success">{notice}</p>
        ) : null}
      </section>

      <section className="min-w-0 space-y-4">
        <header className="app-workbench-head">
          <div>
            <p className="app-eyebrow">02 / RÉSULTAT IA</p>
            <h2 className="app-workbench-title">Ce que l'IA a réellement trouvé</h2>
          </div>
          <button
            type="button"
            className="app-btn app-btn-sm"
            onClick={() => void load()}
            disabled={busy !== null}
          >
            <RefreshCw size={13} /> Rafraîchir
          </button>
        </header>

        {selected ? (
          <AuditResult audit={selected} />
        ) : (
          <Empty
            title="Aucun audit IA"
            body="Importe un dossier puis lance « Auditer tout le projet ». Le résultat citera les fichiers, les lignes et une correction concrète."
            tester={false}
          />
        )}

        {audits.length > 1 ? (
          <details className="app-sheet">
            <summary className="cursor-pointer px-5 py-3 text-xs font-medium">
              Historique des audits ({audits.length})
            </summary>
            <div className="border-t border-black/10">
              {audits.slice(1, 15).map((audit) => (
                <button
                  key={audit.id}
                  type="button"
                  className="flex w-full items-center gap-3 border-b border-black/5 px-5 py-2.5 text-left text-xs last:border-0 hover:bg-surface-alt"
                  onClick={() => setSelected(audit)}
                >
                  <span className="w-9 shrink-0 tabular-nums">{audit.score ?? "—"}</span>
                  <span className="min-w-0 flex-1 truncate">{audit.scope}</span>
                  <span className="shrink-0 text-muted">{relativeTime(audit.createdAt)}</span>
                </button>
              ))}
            </div>
          </details>
        ) : null}
      </section>
    </div>
  );
}

function AuditResult({ audit }: { audit: AiAudit }) {
  if (audit.status === "failed") {
    return (
      <div className="app-sheet border-danger/30 px-5 py-4 text-sm text-danger">
        <p className="font-medium">L'audit a échoué.</p>
        <p className="mt-1 text-xs leading-relaxed">{audit.error ?? "Erreur inconnue."}</p>
      </div>
    );
  }
  const counts = audit.findings.reduce<Record<string, number>>((accumulator, finding) => {
    accumulator[finding.severity] = (accumulator[finding.severity] ?? 0) + 1;
    return accumulator;
  }, {});
  return (
    <article className="app-sheet overflow-hidden">
      <div className="flex flex-wrap items-start gap-5 border-b border-black/10 px-5 py-5">
        <div className="flex h-20 w-20 shrink-0 flex-col items-center justify-center rounded-full border-4 border-black/10">
          <span className="text-2xl font-semibold tabular-nums">{audit.score ?? "—"}</span>
          <span className="text-[10px] uppercase tracking-wide text-muted">/ 100</span>
        </div>
        <div className="min-w-0 flex-1">
          <p className="app-eyebrow">
            {audit.mode.toUpperCase()} · {audit.scope}
          </p>
          <p className="mt-1 text-sm leading-relaxed">{audit.summary}</p>
          <p className="mt-2 text-[11px] text-muted">
            {audit.filesAnalyzed} fichier(s) · {audit.provider} / {audit.model} ·{" "}
            {relativeTime(audit.createdAt)}
          </p>
        </div>
      </div>
      {audit.findings.length === 0 ? (
        <p className="px-5 py-5 text-sm text-muted">
          Aucun défaut justifié par les fichiers fournis. Ce n'est pas une preuve que le projet est
          parfait : cela signifie que l'IA n'a rien trouvé dans ce qu'elle a lu.
        </p>
      ) : (
        <div>
          <div className="flex flex-wrap gap-3 border-b border-black/10 px-5 py-3 text-[11px] text-muted">
            {(["critical", "high", "medium", "low"] as const).map((severity) =>
              counts[severity] ? (
                <span key={severity}>
                  <strong className="text-ink">{counts[severity]}</strong> {severity}
                </span>
              ) : null
            )}
          </div>
          {audit.findings.map((finding) => (
            <details
              key={`${finding.file}-${finding.title}`}
              className="group border-b border-black/5 px-5 py-3 last:border-0"
            >
              <summary className="flex cursor-pointer list-none items-start gap-3">
                <ShieldAlert
                  size={15}
                  className={`mt-0.5 shrink-0 ${
                    finding.severity === "critical" || finding.severity === "high"
                      ? "text-danger"
                      : "text-warning"
                  }`}
                />
                <span className="min-w-0 flex-1">
                  <span className="block text-sm font-medium">{finding.title}</span>
                  <span className="mt-0.5 block app-mono text-[11px] text-muted">
                    {finding.file}
                    {finding.line ? `:${finding.line}` : ""}
                  </span>
                </span>
                <span className="shrink-0 text-[10px] uppercase tracking-wide text-muted">
                  {finding.severity}
                </span>
              </summary>
              <div className="mt-3 space-y-2 pl-6 text-xs leading-relaxed">
                <p>
                  <span className="font-medium">Constat : </span>
                  {finding.evidence}
                </p>
                <p>
                  <span className="font-medium">Correction : </span>
                  {finding.fix}
                </p>
              </div>
            </details>
          ))}
        </div>
      )}
    </article>
  );
}

export function ProjectMetricsPanel({ projectId }: { projectId: string }) {
  const { workspaceId } = useSession();
  const [metrics, setMetrics] = useState<Metrics | null>(null);
  const [error, setError] = useState<ApiError | Error | null>(null);

  const load = useCallback(async () => {
    if (!workspaceId) return;
    setError(null);
    try {
      setMetrics(
        await apiFetch<Metrics>(
          `/api/v1/projects/${projectId}/intelligence/metrics?workspaceId=${workspaceId}`
        )
      );
    } catch (caught) {
      setError(caught as ApiError);
    }
  }, [projectId, workspaceId]);

  useEffect(() => {
    void load();
  }, [load]);

  if (error) return <ErrorState error={error} onRetry={() => void load()} />;
  if (!metrics) {
    return (
      <div className="flex items-center gap-2 px-1 py-8 text-sm text-muted">
        <Loader2 size={16} className="animate-spin" /> Calcul des métriques…
      </div>
    );
  }

  const maximum = Math.max(1, ...metrics.findingsBySeverity.map((item) => item.count));
  return (
    <div className="grid gap-4 lg:grid-cols-2">
      <section className="app-workbench lg:col-span-2">
        <header className="app-workbench-head">
          <div>
            <p className="app-eyebrow">01 / ÉVOLUTION</p>
            <h2 className="app-workbench-title">Score des audits IA</h2>
          </div>
          <span className="text-xs text-muted">{metrics.audits} audit(s)</span>
        </header>
        <div className="px-5 py-4">
          {metrics.scoreTrend.length === 0 ? (
            <p className="py-6 text-center text-xs text-muted">
              Lance un premier audit pour mesurer le point de départ. Aucune courbe n'est inventée.
            </p>
          ) : (
            <>
              <ScoreChart points={metrics.scoreTrend} />
              <p className="mt-1 text-[11px] text-muted">
                {metrics.scoreTrend.length === 1
                  ? "Premier point de référence. Un second audit tracera l'évolution."
                  : "Chaque point est la moyenne réelle des audits enregistrés."}
              </p>
            </>
          )}
        </div>
      </section>

      <section className="app-workbench">
        <header className="app-workbench-head">
          <div>
            <p className="app-eyebrow">02 / GRAVITÉ</p>
            <h2 className="app-workbench-title">Défauts trouvés par l'IA</h2>
          </div>
        </header>
        <div className="space-y-3 px-5 py-4">
          {metrics.findingsBySeverity.length === 0 ? (
            <p className="text-xs text-muted">Aucun défaut enregistré pour l'instant.</p>
          ) : (
            metrics.findingsBySeverity.map((item) => (
              <div key={item.severity}>
                <div className="mb-1 flex justify-between text-xs">
                  <span className="capitalize">{item.severity}</span>
                  <span className="tabular-nums text-muted">{item.count}</span>
                </div>
                <div className="h-2 overflow-hidden rounded-full bg-black/10">
                  <div
                    className={`h-full ${
                      item.severity === "critical" || item.severity === "high"
                        ? "bg-danger"
                        : "bg-warning"
                    }`}
                    style={{ width: `${Math.max(4, (item.count / maximum) * 100)}%` }}
                  />
                </div>
              </div>
            ))
          )}
        </div>
      </section>

      <section className="app-workbench">
        <header className="app-workbench-head">
          <div>
            <p className="app-eyebrow">03 / COUVERTURE</p>
            <h2 className="app-workbench-title">Ce que l'IA peut lire</h2>
          </div>
        </header>
        <dl className="grid grid-cols-3 gap-2 px-5 py-5">
          {[
            ["Sources", metrics.sources],
            ["Fichiers", metrics.files],
            ["Score moyen", metrics.averageScore ?? "—"],
          ].map(([label, value]) => (
            <div key={String(label)}>
              <dt className="text-[10px] uppercase tracking-wide text-muted">{label}</dt>
              <dd className="mt-1 text-2xl font-semibold tabular-nums">{value}</dd>
            </div>
          ))}
        </dl>
      </section>
    </div>
  );
}

function ScoreChart({ points }: { points: { score: number; createdAt: string }[] }) {
  const width = 640;
  const height = 160;
  const padding = 18;
  const usable = width - padding * 2;
  const single = points.length === 1;
  const coords = points.map((point, index) => {
    const x = single
      ? padding + usable * 0.5
      : padding + (index / Math.max(1, points.length - 1)) * usable;
    const y = padding + (1 - point.score / 100) * (height - padding * 2);
    return { x, y, ...point };
  });
  const path = coords.map((point) => `${point.x},${point.y}`).join(" ");
  return (
    <svg
      viewBox={`0 0 ${width} ${height}`}
      className="h-40 w-full text-primary"
      role="img"
      aria-label="Évolution du score des audits IA"
    >
      {[0, 25, 50, 75, 100].map((value) => {
        const y = padding + (1 - value / 100) * (height - padding * 2);
        return (
          <g key={value}>
            <line
              x1={padding}
              x2={width - padding}
              y1={y}
              y2={y}
              stroke="currentColor"
              opacity="0.12"
            />
            <text x={2} y={y + 3} fontSize="9" fill="currentColor" opacity="0.55">
              {value}
            </text>
          </g>
        );
      })}
      {!single && (
        <polyline
          points={path}
          fill="none"
          stroke="currentColor"
          strokeWidth="2.5"
          strokeLinejoin="round"
          strokeLinecap="round"
        />
      )}
      {coords.map((point) => (
        <g key={point.createdAt}>
          <circle cx={point.x} cy={point.y} r={single ? 5 : 3.5} fill="currentColor">
            <title>
              {point.score}/100 · {relativeTime(point.createdAt)}
            </title>
          </circle>
          <text
            x={point.x}
            y={Math.max(10, point.y - 10)}
            textAnchor="middle"
            fontSize="10"
            fill="currentColor"
            opacity="0.75"
          >
            {point.score}
          </text>
        </g>
      ))}
    </svg>
  );
}
