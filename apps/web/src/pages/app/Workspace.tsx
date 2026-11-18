import { ArrowRight, Check, Loader2, Plus, ShieldCheck, Trash2, Users, X } from "lucide-react";
import type React from "react";
import { useCallback, useEffect, useState } from "react";
import { Card, ErrorState, Loading } from "../../components/app/ui.js";
import { useI18n } from "../../i18n/index.js";
import { PageHeader } from "../../layouts/AppLayout.js";
import { type ApiError, ApiError as ApiErrorClass, apiFetch } from "../../lib/api.js";
import { formatDay } from "../../lib/format.js";
import { type SessionWorkspace, useSession } from "../../lib/session.js";

/**
 * The workspace section: every space the account belongs to, with switching,
 * creation, membership management, renaming and deletion.
 *
 * Switching is a client-side selection (the session provider persists it).
 * Everything else talks to `/api/v1/workspaces*`, which enforces roles and the
 * last-owner guard server-side — the UI shows the API's verdict, it does not
 * guess.
 */

interface Member {
  userId: string;
  name: string;
  email: string;
  role: string;
  joinedAt: string;
}

const ROLES = ["owner", "admin", "member", "viewer"] as const;

const ROLE_LABELS: Record<string, { fr: string; en: string }> = {
  owner: { fr: "Propriétaire", en: "Owner" },
  admin: { fr: "Administrateur", en: "Admin" },
  member: { fr: "Membre", en: "Member" },
  viewer: { fr: "Observateur", en: "Viewer" },
};

const INVITABLE_ROLES = ["admin", "member", "viewer"] as const;

function roleLabel(role: string, fr: boolean): string {
  const labels = ROLE_LABELS[role];
  return labels ? labels[fr ? "fr" : "en"] : role;
}

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
  const [renaming, setRenaming] = useState(false);
  const [renameDraft, setRenameDraft] = useState("");
  const [inviteEmail, setInviteEmail] = useState("");
  const [inviteRole, setInviteRole] = useState<(typeof INVITABLE_ROLES)[number]>("member");
  const [inviting, setInviting] = useState(false);
  const [busyMember, setBusyMember] = useState<string | null>(null);
  const [confirmingDelete, setConfirmingDelete] = useState(false);
  const [deleting, setDeleting] = useState(false);

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

  const canManage = detail?.myRole === "owner" || detail?.myRole === "admin";
  const isOwner = detail?.myRole === "owner";

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
      // No timer: `load` depends on `session.workspaceId`, so the effect reloads the
      // detail as soon as the new id lands. The delay used to reload twice.
      session.setWorkspaceId(workspace.id);
    } finally {
      setSwitchingTo(null);
    }
  };

  const rename = async () => {
    const trimmed = renameDraft.trim();
    if (trimmed.length < 2 || !session.workspaceId || renaming) return;
    setRenaming(true);
    setError(null);
    try {
      const body = await apiFetch<{ workspace: { name: string } }>(
        `/api/v1/workspaces/${session.workspaceId}`,
        { method: "PATCH", body: { name: trimmed } }
      );
      setDetail((value) => (value ? { ...value, name: body.workspace.name } : value));
      setRenameDraft("");
      setNotice(fr ? "Espace renommé." : "Workspace renamed.");
      await session.refresh();
    } catch (caught) {
      setError(caught as ApiError);
    } finally {
      setRenaming(false);
    }
  };

  const invite = async () => {
    const email = inviteEmail.trim().toLowerCase();
    if (!email.includes("@") || !session.workspaceId || inviting) return;
    setInviting(true);
    setError(null);
    setNotice(null);
    try {
      const body = await apiFetch<{ member: Member }>(
        `/api/v1/workspaces/${session.workspaceId}/members`,
        { method: "POST", body: { email, role: inviteRole } }
      );
      if (!body.member)
        throw new Error(fr ? "Réponse d'invitation inattendue." : "Unexpected invite response.");
      setMembers((items) => [...(items ?? []), body.member]);
      setInviteEmail("");
      setNotice(
        fr ? `${body.member.email} rejoint l'espace.` : `${body.member.email} joined the workspace.`
      );
    } catch (caught) {
      if (caught instanceof ApiErrorClass || (caught as ApiError).code) {
        setError(caught as ApiError);
      } else {
        setError(caught as Error);
      }
    } finally {
      setInviting(false);
    }
  };

  const changeRole = async (member: Member, role: string) => {
    if (!session.workspaceId || busyMember) return;
    setBusyMember(member.userId);
    setError(null);
    try {
      await apiFetch(`/api/v1/workspaces/${session.workspaceId}/members/${member.userId}`, {
        method: "PATCH",
        body: { role },
      });
      setMembers((items) =>
        (items ?? []).map((item) => (item.userId === member.userId ? { ...item, role } : item))
      );
      setNotice(
        fr
          ? `${member.name} est maintenant ${roleLabel(role, fr).toLowerCase()}.`
          : `${member.name} is now ${roleLabel(role, fr)}.`
      );
    } catch (caught) {
      setError(caught as ApiError);
    } finally {
      setBusyMember(null);
    }
  };

  const removeMember = async (member: Member) => {
    if (!session.workspaceId || busyMember) return;
    setBusyMember(member.userId);
    setError(null);
    try {
      await apiFetch(`/api/v1/workspaces/${session.workspaceId}/members/${member.userId}`, {
        method: "DELETE",
      });
      setMembers((items) => (items ?? []).filter((item) => item.userId !== member.userId));
      setNotice(
        member.userId === session.user?.id
          ? fr
            ? "Vous avez quitté l'espace."
            : "You left the workspace."
          : fr
            ? `${member.name} retiré de l'espace.`
            : `${member.name} removed.`
      );
      if (member.userId === session.user?.id) await session.refresh();
    } catch (caught) {
      setError(caught as ApiError);
    } finally {
      setBusyMember(null);
    }
  };

  const deleteWorkspace = async () => {
    if (!session.workspaceId || deleting) return;
    setDeleting(true);
    setError(null);
    try {
      await apiFetch(`/api/v1/workspaces/${session.workspaceId}`, { method: "DELETE" });
      const remaining = session.workspaces.filter((item) => item.id !== session.workspaceId);
      await session.refresh();
      if (remaining[0]) session.setWorkspaceId(remaining[0].id);
      setConfirmingDelete(false);
      setNotice(
        fr
          ? "Espace supprimé, avec tous ses projets et historiques."
          : "Workspace deleted, with all its projects and history."
      );
    } catch (caught) {
      setError(caught as ApiError);
    } finally {
      setDeleting(false);
    }
  };

  const list = session.workspaces;

  return (
    <div className="mx-auto w-full max-w-[980px] px-5 py-8 lg:px-8">
      <PageHeader
        title={fr ? "Espaces de travail" : "Workspaces"}
        eyebrow="02"
        description={
          fr
            ? "Un espace regroupe vos projets, exécutions et conversations. Changez d'espace, invitez l'équipe, renommez ou supprimez."
            : "A workspace groups your projects, runs and conversations. Switch, invite the team, rename or delete."
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
                      {workspace.slug} · {roleLabel(workspace.role, fr)} ·{" "}
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
              <span className="app-badge app-badge-accent">{roleLabel(detail.myRole, fr)}</span>
            ) : null
          }
        >
          {detail && canManage ? (
            <div className="flex flex-wrap items-center gap-2 border-b border-line px-5 py-3">
              <input
                type="text"
                value={renameDraft}
                onChange={(event) => setRenameDraft(event.target.value)}
                onKeyDown={(event) => {
                  if (event.key === "Enter") void rename();
                }}
                maxLength={80}
                placeholder={fr ? `Renommer « ${detail.name} »…` : `Rename “${detail.name}”…`}
                className="app-input min-w-[220px] flex-1"
                aria-label={fr ? "Nouveau nom de l'espace" : "New workspace name"}
              />
              <button
                type="button"
                className="app-btn"
                onClick={() => void rename()}
                disabled={renaming || renameDraft.trim().length < 2}
              >
                {renaming ? <Loader2 size={13} className="animate-spin" aria-hidden /> : null}
                {fr ? "Renommer" : "Rename"}
              </button>
              {isOwner ? (
                confirmingDelete ? (
                  <span className="flex items-center gap-2">
                    <span className="text-xs text-muted">
                      {fr
                        ? "Tout le projet, les runs et les constats seront supprimés."
                        : "All projects, runs and findings will be deleted."}
                    </span>
                    <button
                      type="button"
                      className="app-btn app-btn-danger"
                      onClick={() => void deleteWorkspace()}
                      disabled={deleting}
                    >
                      {deleting ? (
                        <Loader2 size={13} className="animate-spin" aria-hidden />
                      ) : (
                        <Trash2 size={13} aria-hidden />
                      )}
                      {fr ? "Confirmer la suppression" : "Confirm delete"}
                    </button>
                    <button
                      type="button"
                      className="app-btn"
                      onClick={() => setConfirmingDelete(false)}
                      aria-label={fr ? "Annuler" : "Cancel"}
                    >
                      <X size={13} aria-hidden />
                    </button>
                  </span>
                ) : (
                  <button
                    type="button"
                    className="app-btn app-btn-danger"
                    onClick={() => setConfirmingDelete(true)}
                  >
                    <Trash2 size={13} aria-hidden />
                    {fr ? "Supprimer l'espace" : "Delete workspace"}
                  </button>
                )
              ) : null}
            </div>
          ) : null}

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
              {(members ?? []).map((member) => {
                const self = member.userId === session.user?.id;
                const canTouch = isOwner || (canManage && !self && member.role !== "owner");
                return (
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
                      <p className="truncate text-sm font-medium">
                        {member.name}
                        {self ? (
                          <span className="ml-2 text-xs text-muted">({fr ? "vous" : "you"})</span>
                        ) : null}
                      </p>
                      <p className="truncate text-xs text-muted">{member.email}</p>
                    </div>
                    {canTouch && !(self && detail?.myRole !== "owner") ? (
                      <>
                        <select
                          className="app-shell-pill app-shell-select"
                          value={member.role}
                          onChange={(event) => void changeRole(member, event.target.value)}
                          disabled={busyMember === member.userId}
                          aria-label={fr ? `Rôle de ${member.name}` : `Role of ${member.name}`}
                        >
                          {ROLES.map((role) => (
                            <option key={role} value={role}>
                              {roleLabel(role, fr)}
                            </option>
                          ))}
                        </select>
                        <button
                          type="button"
                          className="app-btn"
                          onClick={() => void removeMember(member)}
                          disabled={busyMember === member.userId}
                          aria-label={
                            self
                              ? fr
                                ? "Quitter l'espace"
                                : "Leave workspace"
                              : fr
                                ? `Retirer ${member.name}`
                                : `Remove ${member.name}`
                          }
                        >
                          {busyMember === member.userId ? (
                            <Loader2 size={13} className="animate-spin" aria-hidden />
                          ) : self ? null : (
                            <X size={13} aria-hidden />
                          )}
                          {self ? (fr ? "Quitter" : "Leave") : ""}
                        </button>
                      </>
                    ) : (
                      <span className="app-badge">{roleLabel(member.role, fr)}</span>
                    )}
                  </li>
                );
              })}
            </ul>

            {canManage ? (
              <div className="mt-4 flex flex-wrap items-center gap-2 rounded-lg border border-line bg-muted/40 px-3.5 py-3">
                <ShieldCheck size={14} aria-hidden className="text-muted" />
                <input
                  type="email"
                  value={inviteEmail}
                  onChange={(event) => setInviteEmail(event.target.value)}
                  onKeyDown={(event) => {
                    if (event.key === "Enter") void invite();
                  }}
                  placeholder={
                    fr
                      ? "email@exemple.dev — doit déjà avoir un compte"
                      : "email@example.dev — must already have an account"
                  }
                  className="app-input min-w-[220px] flex-1"
                  aria-label={fr ? "Email à inviter" : "Email to invite"}
                />
                <select
                  className="app-shell-pill app-shell-select"
                  value={inviteRole}
                  onChange={(event) =>
                    setInviteRole(event.target.value as (typeof INVITABLE_ROLES)[number])
                  }
                  aria-label={fr ? "Rôle attribué" : "Assigned role"}
                >
                  {INVITABLE_ROLES.map((role) => (
                    <option key={role} value={role}>
                      {roleLabel(role, fr)}
                    </option>
                  ))}
                </select>
                <button
                  type="button"
                  className="app-btn app-btn-primary"
                  onClick={() => void invite()}
                  disabled={inviting || !inviteEmail.includes("@")}
                >
                  {inviting ? (
                    <Loader2 size={13} className="animate-spin" aria-hidden />
                  ) : (
                    <Plus size={13} aria-hidden />
                  )}
                  {fr ? "Inviter" : "Invite"}
                </button>
              </div>
            ) : null}
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
    </div>
  );
}

export default WorkspacePage;
