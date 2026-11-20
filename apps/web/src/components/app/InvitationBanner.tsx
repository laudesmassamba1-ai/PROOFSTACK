import { Check, Loader2, MailPlus, X } from "lucide-react";
import type React from "react";
import { useCallback, useEffect, useState } from "react";
import { useI18n } from "../../i18n/index.js";
import { apiFetch } from "../../lib/api.js";
import { useSession } from "../../lib/session.js";

/**
 * The invitation notification.
 *
 * A workspace invitation is a request, so it has to reach the person it concerns: this
 * banner sits above every application page until they answer. Accepting is what creates
 * the membership, so the session is refreshed afterwards and the new workspace appears in
 * the switcher immediately.
 *
 * The whole component renders nothing when there is nothing pending — a notification that
 * is always there is not a notification.
 */

interface PendingInvitation {
  id: string;
  role: string;
  workspaceName: string;
  invitedByName: string;
  createdAt: string;
}

export function InvitationBanner(): React.ReactElement | null {
  const { locale } = useI18n();
  const fr = locale === "fr";
  const session = useSession();
  const [items, setItems] = useState<PendingInvitation[]>([]);
  const [busy, setBusy] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [failed, setFailed] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (session.status !== "ready") return;
    try {
      const body = await apiFetch<{ items: PendingInvitation[] }>("/api/account/invitations");
      setItems(body.items);
    } catch {
      // A notification is not worth an error dialog: the workspace page still lists
      // everything, so a failed background read stays silent.
      setItems([]);
    }
  }, [session.status]);

  useEffect(() => {
    void load();
  }, [load]);

  const answer = async (invitation: PendingInvitation, accept: boolean) => {
    setBusy(invitation.id);
    setFailed(null);
    try {
      await apiFetch(`/api/account/invitations/${invitation.id}/${accept ? "accept" : "decline"}`, {
        method: "POST",
      });
      setItems((current) => current.filter((item) => item.id !== invitation.id));
      setNotice(
        accept
          ? fr
            ? `Tu as rejoint « ${invitation.workspaceName} ». Il apparaît dans le sélecteur d'espace.`
            : `You joined “${invitation.workspaceName}”. It is now in the workspace switcher.`
          : fr
            ? `Invitation de « ${invitation.workspaceName} » refusée.`
            : `Invitation to “${invitation.workspaceName}” declined.`
      );
      if (accept) await session.refresh();
    } catch (caught) {
      setFailed(
        caught instanceof Error
          ? caught.message
          : fr
            ? "Impossible de répondre à l'invitation."
            : "Could not answer the invitation."
      );
    } finally {
      setBusy(null);
    }
  };

  if (items.length === 0 && !notice) return null;

  return (
    <div className="app-invite-banner" role="status" aria-live="polite">
      <MailPlus size={16} aria-hidden />
      <div className="app-invite-body">
        {items.length > 0 ? (
          <>
            <p className="app-invite-title">
              {fr
                ? items.length === 1
                  ? "Une invitation t'attend"
                  : `${items.length} invitations t'attendent`
                : items.length === 1
                  ? "One invitation is waiting"
                  : `${items.length} invitations are waiting`}
            </p>
            <ul className="app-invite-list">
              {items.map((invitation) => (
                <li key={invitation.id}>
                  <span>
                    <strong>{invitation.invitedByName || (fr ? "Un membre" : "A member")}</strong>{" "}
                    {fr ? "t'invite à rejoindre" : "invites you to join"}{" "}
                    <strong>{invitation.workspaceName}</strong>{" "}
                    <span className="app-invite-role">({invitation.role})</span>
                  </span>
                  <span className="app-invite-actions">
                    <button
                      type="button"
                      className="app-btn app-btn-primary"
                      onClick={() => void answer(invitation, true)}
                      disabled={busy === invitation.id}
                    >
                      {busy === invitation.id ? (
                        <Loader2 size={13} className="animate-spin" aria-hidden />
                      ) : (
                        <Check size={13} aria-hidden />
                      )}
                      {fr ? "Accepter" : "Accept"}
                    </button>
                    <button
                      type="button"
                      className="app-btn"
                      onClick={() => void answer(invitation, false)}
                      disabled={busy === invitation.id}
                    >
                      <X size={13} aria-hidden />
                      {fr ? "Refuser" : "Decline"}
                    </button>
                  </span>
                </li>
              ))}
            </ul>
          </>
        ) : null}
        {notice ? <p className="app-invite-notice">{notice}</p> : null}
        {failed ? <p className="app-invite-error">{failed}</p> : null}
      </div>
      {items.length === 0 && notice ? (
        <button
          type="button"
          className="app-btn"
          onClick={() => setNotice(null)}
          aria-label={fr ? "Masquer" : "Dismiss"}
        >
          <X size={13} aria-hidden />
        </button>
      ) : null}
    </div>
  );
}
