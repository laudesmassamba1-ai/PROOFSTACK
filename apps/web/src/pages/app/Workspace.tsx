import { ArrowRight, Check, Loader2, Plus, Users } from "lucide-react";
import type React from "react";
import { useCallback, useEffect, useState } from "react";
import { Card, ErrorState, Loading } from "../../components/app/ui.js";
import { useI18n } from "../../i18n/index.js";
import { PageHeader } from "../../layouts/AppLayout.js";
import { type ApiError, apiFetch } from "../../lib/api.js";
import { formatDay } from "../../lib/format.js";
import { type SessionWorkspace, useSession } from "../../lib/session.js";

/**
 * The workspace section: every space the account belongs to, with switching,
 * creation and membership in one place.
 *
 * Switching is a client-side selection (the session provider persists it), and
 * creation posts to `/api/v1/workspaces`, which enforces the plan's
 * workspace_limit entitlement server-side — the UI shows the API's verdict, it
 * does not guess at plan limits.
 */

interface Member {
  userId: string;
  name: string;
  email: string;
  role: string;
  joinedAt: string;
}

const ROLE_LABELS: Record<string, { fr: string; en: string }> = {
  owner: { fr: "Propriétaire", en: "Owner" },
  admin: { fr: "Administrateur", en: "Admin" },
  member: { fr: "Membre", en: "Member" },
  viewer: { fr: "Observateur", en: "Viewer" },
};

export function WorkspacePage(): React.ReactElement {
  const { locale } = useI18n();
  const fr = locale === "fr";
  const session = useSession();
  const [members, setMembers] = useState<Member[] | null>(null);
  const [detail, setDetail] = useState<{
    name: string;
    slug: string;
    myRole: string;
    createdAt: string;
  } | null>(null);
  const [error, setError] = useState<ApiError | Error | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [name, setName] = useState("");
  const [creating, setCreating] = useState(false);
  const [switchingTo, setSwitchingTo] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (!session.workspaceId) {
      setMembers(null);
      setDetail(null);
      return;
    }
    setError(null);
    try {
      const body = await apiFetch<{
        name: string;
        slug: string;
        myRole: string;
        createdAt: string;
        members: Member[];
      }>(`/api/v1/workspaces/${session.workspaceId}`);
      setDetail({
        name: body.name,
        slug: body.slug,
        myRole: body.myRole,
        createdAt: body.createdAt,
      });
      setMembers(body.members);
    } catch (caught) {
      setError(caught as ApiError);
    }
  }, [session.workspaceId]);

  useEffect(() => {
    void load();
  }, [load]);

  const create = async () => {
    const trimmed = name.trim();
    if (trimmed.length < 2 || creating) return;
    setCreating(true);
    setError(null);
    setNotice(null);
    try {
      const created = await apiFetch<{ workspace: { id: string } }>("/api/v1/workspaces", {
        method: "POST",
        body: { name: trimmed },
      });
      setName("");
      await session.refresh();
      session.setWorkspaceId(created.workspace.id);
      setNotice(
        fr ? `Espace « ${trimmed} » créé et activé.` : `Workspace “${trimmed}” created and active.`
      );
    } catch (caught) {
      setError(caught as ApiError);
    } finally {
      setCreating(false);
    }
  };

  const switchTo = async (workspace: SessionWorkspace) => {
    if (workspace.id === session.workspaceId || switchingTo) return;
    setSwitchingTo(workspace.id);
    try {
      session.setWorkspaceId(workspace.id);
      // Give the provider a tick to persist, then reload detail + members.
      window.setTimeout(() => void load(), 250);
    } finally {
      setSwitchingTo(null);
    }
  };

  const list = session.workspaces;

  return (
    <main className="mx-auto w-full max-w-[980px] px-5 py-8 lg:px-8">
      <PageHeader
        title={fr ? "Espaces de travail" : "Workspaces"}
        eyebrow="02"
        description={
          fr
            ? "Un espace de travail regroupe vos projets, exécutions et conversations. Changez d'espace, créez-en un nouveau, consultez l'équipe."
            : "A workspace groups your projects, runs and conversations. Switch spaces, create one, see the team."
        }
      />

      <div className="grid gap-4" data-reveal>
        {/* All workspaces */}
        <Card
          title={fr ? "Mes espaces de travail" : "My workspaces"}
          description={
            fr
              ? "L'espace actif pilote toute la navigation : projets, CLI, IA et facturation."
              : "The active workspace drives everything: projects, CLI, AI and billing."
          }
        >
          <ul className="divide-y divide-line">
            {list.map((workspace) => {
              const active = workspace.id === session.workspaceId;
              const role = ROLE_LABELS[workspace.role];
              return (
                <li key={workspace.id} className="flex flex-wrap items-center gap-3 px-5 py-3.5">
                  <span
                    aria-hidden
                    className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-lg border border-line text-sm font-semibold ${
                      active ? "bg-accent text-accent-foreground" : "bg-muted text-foreground"
                    }`}
                  >
                    {workspace.name.slice(0, 1).toUpperCase()}
                  </span>
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm font-semibold">
                      {workspace.name}
                      {active ? (
                        <span className="app-badge app-badge-success ml-2">
                          {fr ? "actif" : "active"}
                        </span>
                      ) : null}
                    </p>
                    <p className="mt-0.5 truncate text-xs text-muted">
                      {workspace.slug} · {role ? role[fr ? "fr" : "en"] : workspace.role} ·{" "}
                      {formatDay(workspace.createdAt, locale)}
                    </p>
                  </div>
                  {active ? (
                    <span className="flex items-center gap-1.5 text-xs text-muted">
                      <Check size={13} aria-hidden /> {fr ? "actuel" : "current"}
                    </span>
                  ) : (
                    <button
                      type="button"
                      className="app-btn"
                      onClick={() => void switchTo(workspace)}
                      disabled={switchingTo === workspace.id}
                    >
                      {switchingTo === workspace.id ? (
                        <Loader2 size={13} className="animate-spin" aria-hidden />
                      ) : (
                        <ArrowRight size={13} aria-hidden />
                      )}
                      {fr ? "Activer" : "Switch"}
                    </button>
                  )}
                </li>
              );
            })}
            {list.length === 0 ? (
              <li className="px-5 py-6 text-sm text-muted">
                {fr ? "Aucun espace pour l'instant." : "No workspace yet."}
              </li>
            ) : null}
          </ul>
        </Card>

        {/* Create */}
        <Card
          title={fr ? "Créer un espace de travail" : "Create a workspace"}
          description={
            fr
              ? "La limite d'espaces dépend de votre plan ; l'API la vérifie à la création."
              : "Workspace limits depend on your plan; the API enforces them at creation."
          }
        >
          <div className="flex flex-wrap items-center gap-3 px-5 py-4">
            <input
              type="text"
              value={name}
              onChange={(event) => setName(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === "Enter") void create();
              }}
              maxLength={80}
              placeholder={
                fr ? "Nom de l'espace — ex. Studio SasPay" : "Workspace name — e.g. Studio SasPay"
              }
              className="app-input min-w-[240px] flex-1"
              aria-label={fr ? "Nom du nouvel espace" : "New workspace name"}
            />
            <button
              type="button"
              className="app-btn app-btn-primary"
              onClick={() => void create()}
              disabled={creating || name.trim().length < 2}
            >
              {creating ? (
                <Loader2 size={13} className="animate-spin" aria-hidden />
              ) : (
                <Plus size={13} aria-hidden />
              )}
              {fr ? "Créer" : "Create"}
            </button>
          </div>
        </Card>

        {/* Active workspace detail */}
        <Card
          title={fr ? "Espace actif" : "Active workspace"}
          description={
            detail
              ? `${detail.name} · ${detail.slug} · ${formatDay(detail.createdAt, locale)}`
              : undefined
          }
          actions={
            detail ? (
              <span className="app-badge app-badge-accent">
                {ROLE_LABELS[detail.myRole]?.[fr ? "fr" : "en"] ?? detail.myRole}
              </span>
            ) : null
          }
        >
          <div className="px-5 py-4">
            <p className="flex items-center gap-2 text-xs font-semibold uppercase tracking-wide text-muted">
              <Users size={13} aria-hidden /> {fr ? "Équipe" : "Team"}
            </p>
            {members === null && !error ? (
              <div className="py-6">
                <Loading />
              </div>
            ) : null}
            {members !== null && members.length === 0 ? (
              <p className="py-4 text-sm text-muted">
                {fr ? "Aucun membre pour l'instant." : "No members yet."}
              </p>
            ) : null}
            <ul className="mt-2 grid gap-2">
              {(members ?? []).map((member) => (
                <li
                  key={member.userId}
                  className="flex flex-wrap items-center gap-3 rounded-lg border border-line px-3.5 py-2.5"
                >
                  <span
                    aria-hidden
                    className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-muted text-xs font-semibold"
                  >
                    {member.name.slice(0, 1).toUpperCase()}
                  </span>
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm font-medium">{member.name}</p>
                    <p className="truncate text-xs text-muted">{member.email}</p>
                  </div>
                  <span className="app-badge">
                    {ROLE_LABELS[member.role]?.[fr ? "fr" : "en"] ?? member.role}
                  </span>
                </li>
              ))}
            </ul>
          </div>
        </Card>
      </div>

      {notice ? (
        <p role="status" className="mt-4 rounded-lg border border-line bg-muted px-4 py-3 text-sm">
          {notice}
        </p>
      ) : null}
      {error ? (
        <div className="mt-4">
          <ErrorState
            error={error}
            onRetry={() => {
              setError(null);
              void load();
            }}
          />
        </div>
      ) : null}
    </main>
  );
}

export default WorkspacePage;
