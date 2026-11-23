import { Bell, CheckCheck, Inbox } from "lucide-react";
import { useCallback, useEffect, useState } from "react";
import { Link } from "react-router";
import { Empty, ErrorState, Loading, StatusBadge } from "../../components/app/ui.js";
import { useI18n } from "../../i18n/index.js";
import { PageHeader } from "../../layouts/AppLayout.js";
import { type ApiError, apiFetch } from "../../lib/api.js";
import { formatDate, relativeTime } from "../../lib/format.js";
import { useSession } from "../../lib/session.js";

/**
 * The workspace inbox.
 *
 * Every row comes from a real audit event projected by the API. Nothing is generated
 * here, and an empty inbox says so instead of showing sample notifications. The badge
 * in the top bar and this page read the same endpoint, so they cannot disagree.
 */

interface Notification {
  id: string;
  kind: string;
  title: string;
  body: string;
  link: string | null;
  read: boolean;
  createdAt: string;
  readAt: string | null;
}

interface InboxPayload {
  items: Notification[];
  total: number;
  unreadCount: number;
  limit: number;
  offset: number;
}

type Filter = "all" | "unread";

export function NotificationsPage() {
  const { locale } = useI18n();
  const { workspaceId } = useSession();
  const [filter, setFilter] = useState<Filter>("all");
  const [payload, setPayload] = useState<InboxPayload | null>(null);
  const [error, setError] = useState<ApiError | Error | null>(null);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    if (!workspaceId) return;
    setError(null);
    try {
      setPayload(
        await apiFetch<InboxPayload>(
          `/api/v1/notifications?workspaceId=${encodeURIComponent(workspaceId)}&filter=${filter}&limit=50`
        )
      );
    } catch (caught) {
      setError(caught as ApiError);
    }
  }, [workspaceId, filter]);

  useEffect(() => {
    void load();
  }, [load]);

  const markRead = useCallback(
    async (id?: string) => {
      if (!workspaceId) return;
      setBusy(true);
      try {
        const path = id
          ? `/api/v1/notifications/${encodeURIComponent(id)}/read?workspaceId=${encodeURIComponent(workspaceId)}`
          : `/api/v1/notifications/read-all?workspaceId=${encodeURIComponent(workspaceId)}`;
        const result = await apiFetch<{ unreadCount: number }>(path, { method: "POST" });
        await load();
        // The shell badge reads the same endpoint; tell it to re-fetch after a write.
        window.dispatchEvent(
          new CustomEvent("proofcore:notifications-changed", {
            detail: { unreadCount: result.unreadCount },
          })
        );
      } catch (caught) {
        setError(caught as ApiError);
      } finally {
        setBusy(false);
      }
    },
    [workspaceId, load]
  );

  if (!workspaceId) {
    return (
      <Empty
        title={locale === "fr" ? "Aucun espace de travail sélectionné" : "No workspace selected"}
        body={
          locale === "fr"
            ? "Choisissez un espace de travail dans l'en-tête pour voir ses notifications."
            : "Pick a workspace in the header to see its notifications."
        }
      />
    );
  }

  const title = locale === "fr" ? "Notifications" : "Notifications";
  const description =
    locale === "fr"
      ? "Événements réels de cet espace de travail : exécutions, paiements, clés et invitations."
      : "Real events from this workspace: runs, payments, keys and invitations.";

  return (
    <>
      <PageHeader
        title={title}
        description={description}
        actions={
          <button
            type="button"
            className="app-btn"
            disabled={busy || !payload?.unreadCount}
            onClick={() => void markRead()}
          >
            <CheckCheck size={14} />
            {locale === "fr" ? "Tout marquer comme lu" : "Mark all read"}
          </button>
        }
      />

      <div className="flex flex-wrap items-center gap-2 border-b border-line pb-4">
        {(["all", "unread"] as const).map((value) => (
          <button
            key={value}
            type="button"
            className={`app-btn ${filter === value ? "app-btn-primary" : ""}`}
            aria-pressed={filter === value}
            onClick={() => setFilter(value)}
          >
            {value === "all"
              ? locale === "fr"
                ? "Toutes"
                : "All"
              : locale === "fr"
                ? `Non lues${payload?.unreadCount ? ` (${payload.unreadCount})` : ""}`
                : `Unread${payload?.unreadCount ? ` (${payload.unreadCount})` : ""}`}
          </button>
        ))}
      </div>

      {error ? (
        <div className="mt-4">
          <ErrorState error={error} onRetry={() => void load()} />
        </div>
      ) : !payload ? (
        <Loading
          label={locale === "fr" ? "Chargement des notifications…" : "Loading notifications…"}
        />
      ) : payload.items.length === 0 ? (
        <div className="app-card mt-4">
          <Empty
            title={locale === "fr" ? "Aucune notification" : "No notifications"}
            body={
              filter === "unread"
                ? locale === "fr"
                  ? "Tout est lu. Les nouveaux événements apparaîtront ici."
                  : "All caught up. New events will appear here."
                : locale === "fr"
                  ? "Les exécutions, paiements vérifiés et invitations apparaîtront ici."
                  : "Runs, verified payments and invitations will appear here."
            }
            action={<Inbox size={22} className="text-muted" />}
          />
        </div>
      ) : (
        <ul className="mt-4 divide-y divide-line overflow-hidden rounded-[var(--radius-lg)] border border-line bg-surface">
          {payload.items.map((item) => (
            <li key={item.id} className={item.read ? "opacity-65" : ""}>
              <div className="flex flex-wrap items-start gap-3 px-5 py-4">
                <span
                  className={`mt-1 size-2 shrink-0 rounded-full ${item.read ? "bg-line" : "bg-accent"}`}
                  aria-hidden
                />
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-2">
                    <p className="text-sm font-medium">{item.title}</p>
                    <StatusBadge status={item.kind} />
                  </div>
                  <p className="mt-1 text-xs leading-relaxed text-muted">{item.body}</p>
                  <p className="mt-1 text-[0.68rem] text-muted" title={formatDate(item.createdAt)}>
                    {relativeTime(item.createdAt)}
                  </p>
                  {item.link ? (
                    <Link
                      to={item.link}
                      className="mt-2 inline-block text-xs underline underline-offset-2"
                    >
                      {locale === "fr" ? "Ouvrir" : "Open"}
                    </Link>
                  ) : null}
                </div>
                {!item.read ? (
                  <button
                    type="button"
                    className="app-btn"
                    disabled={busy}
                    onClick={() => void markRead(item.id)}
                    aria-label={locale === "fr" ? "Marquer comme lu" : "Mark as read"}
                  >
                    <Bell size={13} />
                  </button>
                ) : null}
              </div>
            </li>
          ))}
        </ul>
      )}
    </>
  );
}
