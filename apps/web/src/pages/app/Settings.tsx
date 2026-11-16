import { KeyRound, Moon, Sun, Trash2 } from "lucide-react";
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

export function Settings() {
  const { theme, setTheme } = useTheme();
  const { locale, setLocale } = useI18n();
  const session = useSession();
  const [members, setMembers] = useState<Member[] | null>(null);
  const [workspace, setWorkspace] = useState<{ name: string; slug: string; myRole: string } | null>(
    null
  );
  const [keys, setKeys] = useState<ApiKey[] | null>(null);
  const [error, setError] = useState<ApiError | Error | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

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
    } catch (caught) {
      setError(caught as ApiError);
    }
  }, [session.workspaceId]);

  useEffect(() => {
    void load();
  }, [load]);

  const revoke = async (id: string) => {
    if (!session.workspaceId) return;
    setBusy(true);
    try {
      await apiFetch(`/api/v1/api-keys/${id}?workspaceId=${session.workspaceId}`, {
        method: "DELETE",
      });
      setNotice("Token revoked. CI using it will receive 401 on its next upload.");
      await load();
    } catch (caught) {
      setError(caught as ApiError);
    } finally {
      setBusy(false);
    }
  };

  if (!session.workspaceId) return <Empty title="No workspace" body="Create a workspace first." />;
  if (error) return <ErrorState error={error} onRetry={() => void load()} />;

  const canManage = workspace ? ["owner", "admin"].includes(workspace.myRole) : false;

  return (
    <>
      <PageHeader
        title="Settings"
        description="Account, workspace membership and the credentials that can reach this workspace."
      />

      {notice ? (
        <p
          className="mb-4 rounded-[var(--radius)] border border-line bg-surface px-4 py-3 text-xs text-muted"
          role="status"
        >
          {notice}
        </p>
      ) : null}

      <div className="grid gap-4 xl:grid-cols-2">
        <Card title="Account">
          <dl className="grid gap-3 px-5 py-4 text-sm">
            <div>
              <dt className="text-xs text-muted">Name</dt>
              <dd className="mt-0.5">{session.user?.name}</dd>
            </div>
            <div>
              <dt className="text-xs text-muted">Email</dt>
              <dd className="mt-0.5">{session.user?.email}</dd>
            </div>
            <div>
              <dt className="text-xs text-muted">Email verification</dt>
              <dd className="mt-0.5">
                {session.user?.emailVerified
                  ? "Verified"
                  : "Not configured — no email provider is wired to this deployment."}
              </dd>
            </div>
            <div>
              <dt className="text-xs text-muted">Member since</dt>
              <dd className="mt-0.5">{formatDay(session.user?.createdAt)}</dd>
            </div>
          </dl>
          <Cannot reason="Profile edits are not exposed yet: the API has no endpoint that would store them honestly. The form was not added instead of being shown disabled." />
        </Card>

        <Card
          title="Workspace"
          description={
            workspace
              ? `${workspace.name} · ${workspace.slug} · you are ${workspace.myRole}`
              : undefined
          }
        >
          {!members ? (
            <Loading label="Loading members…" />
          ) : (
            <div className="overflow-x-auto">
              <table className="app-table">
                <thead>
                  <tr>
                    <th>Member</th>
                    <th>Role</th>
                    <th>Joined</th>
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
                        <span className="app-badge">{member.role}</span>
                      </td>
                      <td className="text-muted">{formatDay(member.joinedAt)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
          <Cannot reason="Inviting a teammate requires an email delivery provider, which is not configured. The API does not create invitations that could never be delivered." />
        </Card>
      </div>

      <div className="mt-4 grid gap-4 xl:grid-cols-2">
        <Card title="Appearance" description="Applies to this browser only.">
          <div className="flex flex-wrap gap-2 px-5 py-4">
            {(
              [
                { value: "light", label: "Light", icon: Sun },
                { value: "dark", label: "Dark", icon: Moon },
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
          <Cannot reason="The dashboard follows your choice; the marketing site stays dark by design." />
        </Card>

        <Card
          title="Language"
          description="Interface language. Reports and CLI output are unaffected."
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
          <Cannot reason="Stored in this browser. The marketing shell, home page, pricing and account forms follow this choice. Long-form technical pages and the authenticated dashboard are English-only; run reports keep the language of the project config." />
        </Card>
      </div>

      <Card
        className="mt-4"
        title="API keys"
        description="Project tokens for the CLI and CI. Only a hash is stored."
      >
        {!canManage ? (
          <Cannot
            reason={`Only owners and admins can manage tokens. Your role is ${workspace?.myRole ?? "unknown"}.`}
          />
        ) : !keys ? (
          <Loading label="Loading tokens…" />
        ) : keys.length === 0 ? (
          <Empty
            title="No token yet"
            body="Create one from a project page. Tokens are scoped to that project and shown once."
            action={
              <span className="app-badge">
                <KeyRound size={12} /> Projects → open a project
              </span>
            }
          />
        ) : (
          <div className="overflow-x-auto">
            <table className="app-table">
              <thead>
                <tr>
                  <th>Label</th>
                  <th>Prefix</th>
                  <th>Scopes</th>
                  <th>Last used</th>
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
                      {key.revokedAt ? "revoked" : relativeTime(key.lastUsedAt)}
                    </td>
                    <td>
                      {key.revokedAt ? (
                        <span className="app-badge">revoked</span>
                      ) : (
                        <button
                          type="button"
                          className="app-btn app-btn-danger"
                          onClick={() => void revoke(key.id)}
                          disabled={busy}
                        >
                          <Trash2 size={13} /> Revoke
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
    </>
  );
}
