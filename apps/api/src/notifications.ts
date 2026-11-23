import { parseJson, type Row } from "./db/types.js";
import type { AppStore } from "./store/app-store.js";

/**
 * The in-app inbox is a projection of the workspace audit trail.
 *
 * Every event below is already recorded by a real route or by the billing engine with
 * `appendAudit`. Nothing here invents an event: if an action has no audit row, it has no
 * notification. The bridge runs after the action has committed, so a notification can
 * never be the authority for a state change — it only tells a person where to look.
 *
 * `dedupeKey` is the audit id plus the recipient. Payment finalisation is reached from
 * a return, a webhook and reconciliation; the unique index makes repeats inert, so the
 * first path to observe the event wins and the others add nothing.
 */

/** Audit actions with a defined inbox representation. */
const NOTIFIABLE_ACTIONS = new Set([
  "run.uploaded",
  "finalize.credited",
  "finalize.payment_failed",
  "api_key.created",
  "api_key.revoked",
  "invitation.sent",
  "invitation.request",
  "invitation.accepted",
  "invitation.declined",
  "invitation.revoked",
  "member.removed",
  "member.role_changed",
]);

interface AuditEntry {
  id: string;
  workspaceId: string;
  actor: string;
  action: string;
  detail: Record<string, unknown>;
  at: string;
}

export interface NotificationTemplate {
  kind: string;
  title: string;
  body: string;
  link: string | null;
  /** Recipients, resolved from the audit detail where the event names one. */
  recipients: string[];
}

/** Read one audit row by id. The audit store has no by-id method, so the query lives here. */
async function auditById(
  db: AppStore["db"],
  workspaceId: string,
  auditId: string
): Promise<AuditEntry | null> {
  const row = await db
    .prepare("SELECT * FROM audit_logs WHERE id = ? AND workspace_id = ?")
    .bind(auditId, workspaceId)
    .first<Row>();
  if (!row) return null;
  return {
    id: String(row.id),
    workspaceId: String(row.workspace_id),
    actor: String(row.actor),
    action: String(row.action),
    detail: parseJson<Record<string, unknown>>(row.detail, {}),
    at: String(row.at),
  };
}

function stringField(detail: Record<string, unknown>, key: string): string | null {
  const value = detail[key];
  return typeof value === "string" && value.length > 0 ? value : null;
}

/**
 * Turn one committed audit row into a template. Returns null for actions that are not
 * user-facing notifications, so the bridge is safe to call after any audit write.
 */
export function notificationTemplate(entry: AuditEntry): NotificationTemplate | null {
  if (!NOTIFIABLE_ACTIONS.has(entry.action)) return null;
  const detail = entry.detail;
  const runId = stringField(detail, "runId");
  const projectId = stringField(detail, "projectId");
  const status = stringField(detail, "status");
  const planKey = stringField(detail, "planKey");
  const label = stringField(detail, "label");
  const keyId = stringField(detail, "keyId");
  const invitationId = stringField(detail, "invitationId");
  const userId = stringField(detail, "userId");
  const email = stringField(detail, "email");
  const role = stringField(detail, "role");
  const from = stringField(detail, "from");
  const to = stringField(detail, "to");

  switch (entry.action) {
    case "run.uploaded": {
      const failed = status && status !== "COMPLETED";
      // The audit detail does not carry a failure count; the run upload route writes
      // one in the dedicated notification call. This fallback never claims a number.
      return {
        kind: failed ? "run.failed" : "run.completed",
        title: failed ? `Run ${status?.toLowerCase() ?? "interrupted"}` : "Run completed",
        body: runId
          ? `Run ${runId} was uploaded${projectId ? ` for project ${projectId}` : ""}.`
          : "A run was uploaded.",
        link: projectId ? `/app/projects/${projectId}` : "/app",
        recipients: [],
      };
    }
    case "finalize.credited":
      return {
        kind: "payment.credited",
        title: "Payment verified",
        body: planKey
          ? `Payment for ${planKey} was verified and credited.`
          : "A payment was verified and credited.",
        link: "/app/billing",
        recipients: [],
      };
    case "finalize.payment_failed":
      return {
        kind: "payment.failed",
        title: "Payment failed",
        body: planKey
          ? `The payment for ${planKey} was not credited. No paid access was granted.`
          : "The payment was not credited. No paid access was granted.",
        link: "/app/billing",
        recipients: [],
      };
    case "api_key.created":
      return {
        kind: "api_key.created",
        title: "API key created",
        body: label ? `API key “${label}” was created.` : "An API key was created.",
        link: "/app/settings",
        recipients: [],
      };
    case "api_key.revoked":
      return {
        kind: "api_key.revoked",
        title: "API key revoked",
        body: keyId ? `API key ${keyId} was revoked.` : "An API key was revoked.",
        link: "/app/settings",
        recipients: [],
      };
    case "invitation.sent":
      return {
        kind: "invitation.sent",
        title: "Workspace invitation sent",
        body: email
          ? `${email} was invited to this workspace${role ? ` as ${role}` : ""}. Membership starts on acceptance.`
          : "A workspace invitation was sent. Membership starts on acceptance.",
        link: "/app/workspace",
        recipients: [],
      };
    case "invitation.accepted":
      return {
        kind: "invitation.accepted",
        title: "Invitation accepted",
        body: email
          ? `${email} accepted the invitation${role ? ` as ${role}` : ""}.`
          : "An invitation was accepted.",
        link: "/app/workspace",
        recipients: [],
      };
    case "invitation.declined":
      return {
        kind: "invitation.declined",
        title: "Invitation declined",
        body: email ? `${email} declined the invitation.` : "An invitation was declined.",
        link: "/app/workspace",
        recipients: [],
      };
    case "invitation.revoked":
      return {
        kind: "invitation.revoked",
        title: "Invitation revoked",
        body: invitationId
          ? `Invitation ${invitationId} was revoked.`
          : "An invitation was revoked.",
        link: "/app/workspace",
        recipients: [],
      };
    case "member.removed":
      return {
        kind: "member.removed",
        title: "Member removed",
        body: email
          ? `${email} was removed from the workspace.`
          : userId
            ? `Member ${userId} was removed from the workspace.`
            : "A member was removed from the workspace.",
        link: "/app/workspace",
        recipients: [],
      };
    case "member.role_changed":
      return {
        kind: "member.role_changed",
        title: "Member role changed",
        body: `${userId ?? "A member"}: ${from ?? "?"} → ${to ?? "?"}.`,
        link: "/app/workspace",
        recipients: [],
      };
    default:
      return null;
  }
}

/**
 * Project an existing audit row into the inbox of its recipients.
 *
 * `recipients` defaults to every current member of the workspace except the actor:
 * an actor does not need to be told about their own click. The invitation case is the
 * exception handled by the caller, because the invitee is not a member yet and the
 * invitation is addressed to them personally.
 */
export async function notifyAudit(
  services: { store: AppStore; db: AppStore["db"] },
  workspaceId: string,
  auditId: string,
  options: {
    recipients?: string[];
    title?: string;
    body?: string;
    kind?: string;
    link?: string;
  } = {}
): Promise<void> {
  const entry = await auditById(services.db, workspaceId, auditId);
  if (!entry) return;
  const template = notificationTemplate(entry);
  if (!template && !options.kind) return;
  const members = await services.store.listMembers(workspaceId);
  const recipients = options.recipients ?? members.map((member) => member.userId);
  for (const userId of new Set(recipients)) {
    // An actor is excluded only when the caller addressed someone else explicitly (an
    // invitation to a future member). For workspace events — a key created, a payment
    // verified, a run uploaded — the actor is usually the only member, and skipping them
    // produced an inbox that stayed empty after real actions.
    if (userId === entry.actor && options.recipients?.length) continue;
    await services.store.createNotification({
      workspaceId,
      userId,
      kind: options.kind ?? template?.kind ?? entry.action,
      title: options.title ?? template?.title ?? entry.action,
      body: options.body ?? template?.body ?? "",
      ...((options.link ?? template?.link) ? { link: options.link ?? template?.link ?? "" } : {}),
      dedupeKey: `${entry.id}:${userId}`,
    });
  }
}
