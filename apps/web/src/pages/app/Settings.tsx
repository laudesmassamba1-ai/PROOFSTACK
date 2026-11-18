import { KeyRound, Moon, Sun, Trash2, Webhook } from "lucide-react";
import { useCallback, useEffect, useState } from "react";
import { Cannot, Card, Empty, ErrorState, Loading } from "../../components/app/ui.js";
import { useI18n } from "../../i18n/index.js";
import { PageHeader } from "../../layouts/AppLayout.js";
import { type ApiError, apiFetch } from "../../lib/api.js";
import { formatDay, relativeTime } from "../../lib/format.js";
import { useSession } from "../../lib/session.js";
import { useTheme } from "../../lib/theme.js";

interface Member {
  userId: string;
  name: string;
  email: string;
  role: string;
  joinedAt: string;
}
interface ApiKey {
  id: string;
  label: string;
  prefix: string;
  scopes: string[];
  createdAt: string;
  lastUsedAt: string | null;
  revokedAt: string | null;
}

interface WebhookEntry {
  id: string;
  url: string;
  events: string[];
  secretPrefix: string;
  createdAt: string;
  lastStatus: number | null;
  lastStatusAt: string | null;
  lastError: string | null;
}

/** "Chrome · Linux" is enough context to recognise a device; the full UA is noise. */
function describeUserAgent(userAgent: string | null, fr: boolean): string {
  if (!userAgent) return fr ? "Appareil inconnu" : "Unknown device";
  const browser = /Edg\//.test(userAgent)
    ? "Edge"
    : /Chrome\//.test(userAgent)
      ? "Chrome"
      : /Safari\//.test(userAgent)
        ? "Safari"
        : /Firefox\//.test(userAgent)
          ? "Firefox"
          : fr
            ? "Navigateur"
            : "Browser";
  const os = /Windows/.test(userAgent)
    ? "Windows"
    : /Mac OS X/.test(userAgent)
      ? "macOS"
      : /Android/.test(userAgent)
        ? "Android"
        : /iPhone|iPad/.test(userAgent)
          ? "iOS"
          : /Linux/.test(userAgent)
            ? "Linux"
            : "";
  return os ? `${browser} · ${os}` : browser;
}

export function Settings() {
  const { theme, setTheme } = useTheme();
  const { locale, setLocale, t } = useI18n();
  const fr = locale === "fr";
  const session = useSession();
  const [members, setMembers] = useState<Member[] | null>(null);
  const [workspace, setWorkspace] = useState<{ name: string; slug: string; myRole: string } | null>(
    null
  );
  const [keys, setKeys] = useState<ApiKey[] | null>(null);
  const [webhooks, setWebhooks] = useState<WebhookEntry[] | null>(null);
  const [showWhForm, setShowWhForm] = useState(false);
  const [whUrl, setWhUrl] = useState("https://");
  const [whEvents, setWhEvents] = useState<string[]>(["run.completed"]);
  const [whSecret, setWhSecret] = useState<string | null>(null);
  const [error, setError] = useState<ApiError | Error | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [sessions, setSessions] = useState<
    | {
        id: string;
        createdAt: string;
        lastSeenAt: string | null;
        userAgent: string | null;
        ip: string | null;
        current: boolean;
      }[]
    | null
  >(null);
  const [currentPassword, setCurrentPassword] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [changingPassword, setChangingPassword] = useState(false);
  const [deletePassword, setDeletePassword] = useState("");
  const [deleteConfirm, setDeleteConfirm] = useState("");
  const [deletingAccount, setDeletingAccount] = useState(false);

  /**
   * Account self-service. Every call here is destructive or security-relevant, so each
   * one reports what actually happened ("3 sessions closed") instead of a generic
   * "saved" that would hide a no-op.
   */
  const loadSessions = useCallback(async () => {
    try {
      const body = await apiFetch<{
        items: {
          id: string;
          createdAt: string;
          lastSeenAt: string | null;
          userAgent: string | null;
          ip: string | null;
          current: boolean;
        }[];
      }>("/api/account/sessions");
      setSessions(body.items);
    } catch (caught) {
      setError(caught as ApiError);
    }
  }, []);

  const changePassword = async () => {
    if (!currentPassword || newPassword.length < 10 || changingPassword) return;
    if (newPassword !== confirmPassword) {
      setError(
        new Error(
          fr
            ? "Les deux nouveaux mots de passe ne correspondent pas."
            : "The two new passwords do not match."
        )
      );
      return;
    }
    setChangingPassword(true);
    setError(null);
    setNotice(null);
    try {
      const body = await apiFetch<{ revokedSessions: number }>("/api/account/password", {
        method: "POST",
        body: { currentPassword, newPassword },
      });
      setCurrentPassword("");
      setNewPassword("");
      setConfirmPassword("");
      setNotice(
        body.revokedSessions > 0
          ? fr
            ? `Mot de passe modifié. ${body.revokedSessions} autre(s) session(s) fermée(s) : cette session reste ouverte.`
            : `Password changed. ${body.revokedSessions} other session(s) closed; this one stays open.`
          : fr
            ? "Mot de passe modifié. Aucune autre session n'était ouverte."
            : "Password changed. No other session was open."
      );
      await loadSessions();
    } catch (caught) {
      setError(caught as ApiError);
    } finally {
      setChangingPassword(false);
    }
  };

  const revokeSession = async (id: string) => {
    setError(null);
    try {
      await apiFetch(`/api/account/sessions/${id}`, { method: "DELETE" });
      setSessions((items) => (items ?? []).filter((item) => item.id !== id));
      setNotice(fr ? "Session fermée." : "Session closed.");
    } catch (caught) {
      setError(caught as ApiError);
    }
  };

  const deleteAccount = async () => {
    if (deleteConfirm !== "DELETE" || !deletePassword || deletingAccount) return;
    setDeletingAccount(true);
    setError(null);
    try {
      await apiFetch("/api/account", {
        method: "DELETE",
        body: { password: deletePassword, confirm: "DELETE" },
      });
      await session.signOut();
      window.location.assign("/");
    } catch (caught) {
      setError(caught as ApiError);
    } finally {
      setDeletingAccount(false);
    }
  };

  const load = useCallback(async () => {
    if (!session.workspaceId) return;
    setError(null);
    try {
      const body = await apiFetch<{
        name: string;
        slug: string;
        myRole: string;
        members: Member[];
      }>(`/api/v1/workspaces/${session.workspaceId}`);
      setWorkspace({ name: body.name, slug: body.slug, myRole: body.myRole });
      setMembers(body.members);
      if (body.myRole === "owner" || body.myRole === "admin") {
        const keyBody = await apiFetch<{ items: ApiKey[] }>(
          `/api/v1/api-keys?workspaceId=${session.workspaceId}`
        );
        setKeys(keyBody.items);
      } else {
        setKeys([]);
      }
      if (body.myRole === "owner" || body.myRole === "admin") {
        const webhookBody = await apiFetch<{ items: WebhookEntry[] }>(
          `/api/v1/webhooks?workspaceId=${session.workspaceId}`
        );
        setWebhooks(webhookBody.items);
      } else {
        setWebhooks([]);
      }
    } catch (caught) {
      setError(caught as ApiError);
    }
  }, [session.workspaceId]);

  // `loadSessions` is stable (useCallback over the workspace), and adding it here would
  // refetch on every render the id changes — which is the same bug, one level up.
  // biome-ignore lint/correctness/useExhaustiveDependencies: intentional, see above.
  useEffect(() => {
    void loadSessions();
    void load();
  }, [load]);

  const revoke = async (id: string) => {
    if (!session.workspaceId) return;
    setBusy(true);
    try {
      await apiFetch(`/api/v1/api-keys/${id}?workspaceId=${session.workspaceId}`, {
        method: "DELETE",
      });
      setNotice(
        fr
          ? "Jeton révoqué. La CI qui l'utilise recevra 401 à son prochain envoi."
          : "Token revoked. CI using it will receive 401 on its next upload."
      );
      await load();
    } catch (caught) {
      setError(caught as ApiError);
    } finally {
      setBusy(false);
    }
  };

  const createWebhook = async () => {
    if (!session.workspaceId) return;
    setBusy(true);
    setError(null);
    try {
      const created = await apiFetch<{
        id: string;
        secret: string;
      }>("/api/v1/webhooks", {
        method: "POST",
        body: {
          workspaceId: session.workspaceId,
          url: whUrl.trim(),
          events: whEvents,
        },
      });
      setWhSecret(created.secret);
      setShowWhForm(false);
      setWhUrl("https://");
      setWhEvents(["run.completed"]);
      setNotice(fr ? "Webhook créé." : "Webhook created.");
      await load();
    } catch (caught) {
      setError(caught as ApiError);
    } finally {
      setBusy(false);
    }
  };

  const deleteWebhook = async (id: string) => {
    if (!session.workspaceId) return;
    setBusy(true);
    try {
      await apiFetch(`/api/v1/webhooks/${id}?workspaceId=${session.workspaceId}`, {
        method: "DELETE",
      });
      await load();
    } catch (caught) {
      setError(caught as ApiError);
    } finally {
      setBusy(false);
    }
  };

  if (!session.workspaceId)
    return (
      <Empty
        title={fr ? "Aucun espace de travail" : "No workspace"}
        body={fr ? "Créez d'abord un espace de travail." : "Create a workspace first."}
      />
    );
  if (error) return <ErrorState error={error} onRetry={() => void load()} />;

  const canManage = workspace ? ["owner", "admin"].includes(workspace.myRole) : false;
  const roleLabel = (role: string) =>
    fr
      ? ({ owner: "propriétaire", admin: "administrateur", member: "membre" }[role] ?? role)
      : role;

  return (
    <>
      <PageHeader title={t("ws.settings.title")} description={t("ws.settings.description")} />

      {notice ? (
        <p
          className="mb-4 rounded-[var(--radius)] border border-line bg-surface px-4 py-3 text-xs text-muted"
          role="status"
        >
          {notice}
        </p>
      ) : null}

      <div className="grid gap-4 xl:grid-cols-2">
        <Card title={fr ? "Compte" : "Account"} enhanced>
          <dl className="grid gap-3 px-5 py-4 text-sm">
            <div>
              <dt className="text-xs text-muted">{fr ? "Nom" : "Name"}</dt>
              <dd className="mt-0.5">{session.user?.name}</dd>
            </div>
            <div>
              <dt className="text-xs text-muted">Email</dt>
              <dd className="mt-0.5">{session.user?.email}</dd>
            </div>
            <div>
              <dt className="text-xs text-muted">
                {fr ? "Vérification de l'e-mail" : "Email verification"}
              </dt>
              <dd className="mt-0.5">
                {session.user?.emailVerified
                  ? fr
                    ? "Vérifié"
                    : "Verified"
                  : fr
                    ? "Non configurée — aucun fournisseur d'e-mail n'est relié à ce déploiement."
                    : "Not configured — no email provider is wired to this deployment."}
              </dd>
            </div>
            <div>
              <dt className="text-xs text-muted">{fr ? "Membre depuis" : "Member since"}</dt>
              <dd className="mt-0.5">{formatDay(session.user?.createdAt)}</dd>
            </div>
          </dl>
          <Cannot
            reason={
              fr
                ? "La modification du profil n'est pas exposée : l'API n'a aucun endpoint qui l'enregistrerait honnêtement. Le formulaire n'a pas été ajouté plutôt que d'être affiché désactivé."
                : "Profile edits are not exposed yet: the API has no endpoint that would store them honestly. The form was not added instead of being shown disabled."
            }
          />
        </Card>

        <Card
          title={fr ? "Espace de travail" : "Workspace"}
          description={
            workspace
              ? fr
                ? `${workspace.name} · ${workspace.slug} · vous êtes ${roleLabel(workspace.myRole)}`
                : `${workspace.name} · ${workspace.slug} · you are ${workspace.myRole}`
              : undefined
          }
        >
          {!members ? (
            <Loading label={fr ? "Chargement des membres…" : "Loading members…"} />
          ) : (
            <div className="overflow-x-auto">
              <table className="app-table">
                <thead>
                  <tr>
                    <th>{fr ? "Membre" : "Member"}</th>
                    <th>{fr ? "Rôle" : "Role"}</th>
                    <th>{fr ? "Arrivée" : "Joined"}</th>
                  </tr>
                </thead>
                <tbody>
                  {members.map((member) => (
                    <tr key={member.userId}>
                      <td>
                        <p className="font-medium">{member.name}</p>
                        <p className="text-xs text-muted">{member.email}</p>
                      </td>
                      <td>
                        <span className="app-badge">{roleLabel(member.role)}</span>
                      </td>
                      <td className="text-muted">{formatDay(member.joinedAt)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
          <Cannot
            reason={
              fr
                ? "L'invitation se fait depuis la page Espace, et elle ajoute un compte PROOFCORE existant : aucun e-mail n'est envoyé. L'adresse doit donc déjà s'être inscrite."
                : "Invitations happen on the Workspace page, and they add an existing PROOFCORE account: no email is sent, so the address must already have signed up."
            }
          />
        </Card>
      </div>

      <div className="mt-4 grid gap-4 xl:grid-cols-2">
        <Card
          title={fr ? "Apparence" : "Appearance"}
          description={
            fr ? "S'applique uniquement à ce navigateur." : "Applies to this browser only."
          }
        >
          <div className="flex flex-wrap gap-2 px-5 py-4">
            {(
              [
                { value: "light", label: fr ? "Clair" : "Light", icon: Sun },
                { value: "dark", label: fr ? "Sombre" : "Dark", icon: Moon },
              ] as const
            ).map((option) => (
              <button
                key={option.value}
                type="button"
                className={`app-btn ${theme === option.value ? "app-btn-primary" : ""}`}
                aria-pressed={theme === option.value}
                onClick={() => setTheme(option.value)}
              >
                <option.icon size={14} /> {option.label}
              </button>
            ))}
          </div>
          <Cannot
            reason={
              fr
                ? "L'espace de travail suit votre choix ; le site marketing reste sombre par conception."
                : "The dashboard follows your choice; the marketing site stays dark by design."
            }
          />
        </Card>

        <Card
          title={fr ? "Langue" : "Language"}
          description={
            fr
              ? "Langue de l'interface. Les rapports et la sortie du CLI ne changent pas."
              : "Interface language. Reports and CLI output are unaffected."
          }
        >
          <div className="flex flex-wrap gap-2 px-5 py-4">
            {(
              [
                { value: "en", label: "English" },
                { value: "fr", label: "Français" },
              ] as const
            ).map((option) => (
              <button
                key={option.value}
                type="button"
                className={`app-btn ${locale === option.value ? "app-btn-primary" : ""}`}
                aria-pressed={locale === option.value}
                onClick={() => setLocale(option.value)}
              >
                {option.label}
              </button>
            ))}
          </div>
          <Cannot
            reason={
              fr
                ? "Stockée dans ce navigateur. L'espace de travail, la vue d'ensemble, les projets, les modules, le CLI, la facturation et les paramètres suivent ce choix. Les rapports d'exécution gardent la langue de la configuration du projet."
                : "Stored in this browser. Every customer workspace screen follows this choice. Run reports and CLI output keep the language of the project config."
            }
          />
        </Card>
      </div>

      <Card
        className="mt-4"
        title={fr ? "Sécurité" : "Security"}
        description={
          fr
            ? "Mot de passe et sessions ouvertes. Changer le mot de passe ferme les autres appareils."
            : "Password and open sessions. Changing the password closes the other devices."
        }
        enhanced
      >
        <div className="grid gap-4 px-5 py-4">
          <div className="grid gap-2 sm:grid-cols-2">
            <label className="grid gap-1 text-xs text-muted">
              {fr ? "Mot de passe actuel" : "Current password"}
              <input
                type="password"
                autoComplete="current-password"
                className="app-input"
                value={currentPassword}
                onChange={(event) => setCurrentPassword(event.target.value)}
              />
            </label>
            <span aria-hidden />
            <label className="grid gap-1 text-xs text-muted">
              {fr
                ? "Nouveau mot de passe (10 caractères min.)"
                : "New password (10 characters min.)"}
              <input
                type="password"
                autoComplete="new-password"
                className="app-input"
                value={newPassword}
                onChange={(event) => setNewPassword(event.target.value)}
              />
            </label>
            <label className="grid gap-1 text-xs text-muted">
              {fr ? "Confirmer le nouveau mot de passe" : "Confirm the new password"}
              <input
                type="password"
                autoComplete="new-password"
                className="app-input"
                value={confirmPassword}
                onChange={(event) => setConfirmPassword(event.target.value)}
              />
            </label>
          </div>
          <div className="flex flex-wrap items-center gap-3">
            <button
              type="button"
              className="app-btn app-btn-primary"
              onClick={() => void changePassword()}
              disabled={
                changingPassword ||
                !currentPassword ||
                newPassword.length < 10 ||
                newPassword !== confirmPassword
              }
            >
              <KeyRound size={13} aria-hidden />{" "}
              {fr ? "Changer le mot de passe" : "Change password"}
            </button>
            {newPassword.length > 0 && newPassword.length < 10 ? (
              <span className="text-xs text-muted">
                {fr ? "Encore " : ""}
                {10 - newPassword.length}
                {fr ? " caractères." : " more characters."}
              </span>
            ) : null}
          </div>

          <div className="border-t border-line pt-4">
            <p className="text-xs font-semibold uppercase tracking-wide text-muted">
              {fr ? "Sessions ouvertes" : "Open sessions"}
            </p>
            {sessions === null ? (
              <div className="py-3">
                <Loading />
              </div>
            ) : (
              <ul className="mt-2 grid gap-2">
                {sessions.map((entry) => (
                  <li
                    key={entry.id}
                    className="flex flex-wrap items-center gap-3 rounded-[var(--radius)] border border-line px-3 py-2"
                  >
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-xs font-medium">
                        {describeUserAgent(entry.userAgent, fr)}
                        {entry.current ? (
                          <span className="app-badge app-badge-success ml-2">
                            {fr ? "cette session" : "this session"}
                          </span>
                        ) : null}
                      </p>
                      <p className="truncate text-xs text-muted">
                        {entry.lastSeenAt
                          ? `${fr ? "vue" : "seen"} ${relativeTime(entry.lastSeenAt)}`
                          : `${fr ? "ouverte" : "opened"} ${relativeTime(entry.createdAt)}`}
                        {entry.ip ? ` · ${entry.ip}` : ""}
                      </p>
                    </div>
                    {entry.current ? null : (
                      <button
                        type="button"
                        className="app-btn"
                        onClick={() => void revokeSession(entry.id)}
                      >
                        {fr ? "Fermer" : "Close"}
                      </button>
                    )}
                  </li>
                ))}
              </ul>
            )}
          </div>
        </div>
      </Card>

      <Card
        className="mt-4"
        title={fr ? "Zone dangereuse" : "Danger zone"}
        description={
          fr
            ? "Supprimer le compte efface votre profil, vos sessions et les espaces dont vous êtes le seul membre."
            : "Deleting the account erases your profile, your sessions, and the workspaces where you are the only member."
        }
      >
        <div className="grid gap-2 px-5 py-4">
          <p className="text-xs text-muted">
            {fr
              ? "Un espace que vous partagez avec d'autres personnes bloque la suppression : transférez-le ou retirez ses membres d'abord."
              : "A workspace you share with others blocks deletion: transfer it or remove its members first."}
          </p>
          <div className="grid gap-2 sm:grid-cols-2">
            <label className="grid gap-1 text-xs text-muted">
              {fr ? "Votre mot de passe" : "Your password"}
              <input
                type="password"
                autoComplete="current-password"
                className="app-input"
                value={deletePassword}
                onChange={(event) => setDeletePassword(event.target.value)}
              />
            </label>
            <label className="grid gap-1 text-xs text-muted">
              {fr ? "Tapez DELETE pour confirmer" : "Type DELETE to confirm"}
              <input
                type="text"
                className="app-input"
                value={deleteConfirm}
                onChange={(event) => setDeleteConfirm(event.target.value)}
                placeholder="DELETE"
              />
            </label>
          </div>
          <div>
            <button
              type="button"
              className="app-btn app-btn-danger"
              onClick={() => void deleteAccount()}
              disabled={deleteConfirm !== "DELETE" || !deletePassword || deletingAccount}
            >
              <Trash2 size={13} aria-hidden />{" "}
              {fr ? "Supprimer définitivement mon compte" : "Permanently delete my account"}
            </button>
          </div>
        </div>
      </Card>

      <Card
        className="mt-4"
        title={fr ? "Jetons API" : "API keys"}
        description={
          fr
            ? "Jetons de projet pour le CLI et la CI. Seul un hash est stocké."
            : "Project tokens for the CLI and CI. Only a hash is stored."
        }
      >
        {!canManage ? (
          <Cannot
            reason={
              fr
                ? `Seuls les propriétaires et administrateurs gèrent les jetons. Votre rôle est ${roleLabel(workspace?.myRole ?? "unknown")}.`
                : `Only owners and admins can manage tokens. Your role is ${workspace?.myRole ?? "unknown"}.`
            }
          />
        ) : !keys ? (
          <Loading label={fr ? "Chargement des jetons…" : "Loading tokens…"} />
        ) : keys.length === 0 ? (
          <Empty
            title={fr ? "Aucun jeton" : "No token yet"}
            body={
              fr
                ? "Créez-en un depuis la page d'un projet. Le jeton est limité à ce projet et affiché une seule fois."
                : "Create one from a project page. Tokens are scoped to that project and shown once."
            }
            action={
              <span className="app-badge">
                <KeyRound size={12} />{" "}
                {fr ? "Projets → ouvrir un projet" : "Projects → open a project"}
              </span>
            }
          />
        ) : (
          <div className="overflow-x-auto">
            <table className="app-table">
              <thead>
                <tr>
                  <th>{fr ? "Libellé" : "Label"}</th>
                  <th>{fr ? "Préfixe" : "Prefix"}</th>
                  <th>{fr ? "Portées" : "Scopes"}</th>
                  <th>{fr ? "Dernier usage" : "Last used"}</th>
                  <th />
                </tr>
              </thead>
              <tbody>
                {keys.map((key) => (
                  <tr key={key.id}>
                    <td className="font-medium">{key.label}</td>
                    <td className="app-mono text-muted">{key.prefix}…</td>
                    <td className="text-xs text-muted">{key.scopes.join(", ")}</td>
                    <td className="text-muted">
                      {key.revokedAt ? (fr ? "révoqué" : "revoked") : relativeTime(key.lastUsedAt)}
                    </td>
                    <td>
                      {key.revokedAt ? (
                        <span className="app-badge">{fr ? "révoqué" : "revoked"}</span>
                      ) : (
                        <button
                          type="button"
                          className="app-btn app-btn-danger"
                          onClick={() => void revoke(key.id)}
                          disabled={busy}
                        >
                          <Trash2 size={13} /> {fr ? "Révoquer" : "Revoke"}
                        </button>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>

      {canManage ? (
        <>
          {whSecret ? (
            <div
              className="app-card mt-4 border-2 p-4"
              style={{ borderColor: "var(--warning, #b45309)" }}
              role="alert"
            >
              <p className="text-sm font-medium">
                {fr ? "Secret du webhook — copiez-le maintenant" : "Webhook secret — copy it now"}
              </p>
              <code className="app-mono mt-2 block break-all rounded-lg bg-surface px-3 py-2 text-xs">
                {whSecret}
              </code>
              <button type="button" className="app-btn mt-3" onClick={() => setWhSecret(null)}>
                {fr ? "Je l'ai copié" : "Done, I copied it"}
              </button>
            </div>
          ) : null}

          <Card className="mt-4" title={t("wh.title")} description={t("wh.description")} enhanced>
            {!webhooks ? (
              <Loading label={fr ? "Chargement des webhooks…" : "Loading webhooks…"} />
            ) : (
              <>
                {showWhForm ? (
                  <div className="px-5 py-4">
                    <label className="block">
                      <span className="app-label">{t("wh.url")}</span>
                      <input
                        className="app-input"
                        value={whUrl}
                        onChange={(event) => setWhUrl(event.target.value)}
                        placeholder="https://votre-n8n.exemple/webhook/proofcore"
                        spellCheck={false}
                        dir="ltr"
                      />
                    </label>
                    <fieldset className="mt-3">
                      <legend className="app-label">{t("wh.events")}</legend>
                      <div className="flex flex-wrap gap-2">
                        {(["run.completed", "findings.failed"] as const).map((eventKey) => (
                          <label
                            key={eventKey}
                            className="flex cursor-pointer items-center gap-2 text-xs"
                          >
                            <input
                              type="checkbox"
                              checked={whEvents.includes(eventKey)}
                              onChange={(event) =>
                                setWhEvents((current) =>
                                  event.target.checked
                                    ? [...current, eventKey]
                                    : current.filter((e) => e !== eventKey)
                                )
                              }
                            />
                            {t(`wh.event.${eventKey}`)}
                          </label>
                        ))}
                      </div>
                    </fieldset>
                    <div className="mt-4 flex gap-2">
                      <button
                        type="button"
                        className="app-btn app-btn-primary"
                        onClick={() => void createWebhook()}
                        disabled={busy || !whUrl.trim().startsWith("https://")}
                      >
                        <Webhook size={13} /> {t("wh.create")}
                      </button>
                      <button
                        type="button"
                        className="app-btn"
                        onClick={() => setShowWhForm(false)}
                      >
                        {t("wh.cancel")}
                      </button>
                    </div>
                  </div>
                ) : null}

                {webhooks.length === 0 && !showWhForm ? (
                  <Empty
                    title={fr ? "Aucun webhook" : "No webhook yet"}
                    body={t("wh.empty")}
                    action={
                      <button
                        type="button"
                        className="app-btn app-btn-primary"
                        onClick={() => setShowWhForm(true)}
                      >
                        <Webhook size={13} /> {t("wh.add")}
                      </button>
                    }
                  />
                ) : webhooks.length > 0 ? (
                  <div className="overflow-x-auto">
                    <table className="app-table">
                      <thead>
                        <tr>
                          <th>{t("wh.url")}</th>
                          <th>{t("wh.events")}</th>
                          <th>{t("wh.lastDelivery")}</th>
                          <th />
                        </tr>
                      </thead>
                      <tbody>
                        {webhooks.map((webhook) => (
                          <tr key={webhook.id}>
                            <td className="max-w-[24rem]">
                              <code className="app-mono break-all text-xs">{webhook.url}</code>
                            </td>
                            <td className="text-xs">{webhook.events.join(", ")}</td>
                            <td className="text-xs text-muted">
                              {webhook.lastStatus === null
                                ? t("wh.never")
                                : `HTTP ${webhook.lastStatus} · ${relativeTime(webhook.lastStatusAt)}`}
                              {webhook.lastError ? (
                                <p className="mt-0.5 text-red-600 dark:text-red-400">
                                  {webhook.lastError}
                                </p>
                              ) : null}
                            </td>
                            <td>
                              <button
                                type="button"
                                className="app-btn app-btn-danger"
                                onClick={() => void deleteWebhook(webhook.id)}
                                disabled={busy}
                              >
                                <Trash2 size={13} /> {t("wh.delete")}
                              </button>
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                ) : null}

                {!showWhForm && webhooks.length > 0 ? (
                  <div className="px-5 pb-4 pt-3">
                    <button type="button" className="app-btn" onClick={() => setShowWhForm(true)}>
                      <Webhook size={13} /> {t("wh.add")}
                    </button>
                  </div>
                ) : null}
              </>
            )}
          </Card>
        </>
      ) : null}
    </>
  );
}
