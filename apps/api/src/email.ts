import { ProofCoreError, uuid } from "@proofcore/core";
import type { AppStore } from "./store/app-store.js";

/**
 * Outbound e-mail.
 *
 * There is exactly one rule here: what the user is told must match what happened.
 *
 *  - With `RESEND_API_KEY` set, the message is sent through Resend's HTTP API and the
 *    outbox row records the provider id.
 *  - Without it, the message is journalled with status `unconfigured` — never silently
 *    dropped, and the API says so — and an operator can deliver it by hand from the
 *    outbox. The UI never claims "we sent you an email" in that case.
 */

export interface EmailMessage {
  to: string;
  subject: string;
  text: string;
  html?: string;
  kind: string;
  userId?: string | null;
}

export interface EmailDelivery {
  delivered: boolean;
  status: "sent" | "failed" | "unconfigured";
  provider: string | null;
  /** Present when delivery did not happen, phrased for the end user. */
  message: string;
}

export interface EmailSender {
  readonly configured: boolean;
  send(message: EmailMessage): Promise<EmailDelivery>;
}

export function createEmailSender(
  store: AppStore,
  env: { RESEND_API_KEY?: string; MAIL_FROM?: string }
): EmailSender {
  const apiKey = env.RESEND_API_KEY?.trim();
  const from = env.MAIL_FROM?.trim() || "PROOFCORE <notifications@proofcore.dev>";

  const journal = async (
    message: EmailMessage,
    status: "sent" | "failed" | "unconfigured",
    provider: string | null,
    providerId: string | null,
    error: string | null
  ): Promise<void> => {
    await store.enqueueEmail({
      id: `mail_${uuid().replaceAll("-", "").slice(0, 20)}`,
      userId: message.userId ?? null,
      to: message.to,
      subject: message.subject,
      text: message.text,
      html: message.html ?? null,
      kind: message.kind,
      status,
      provider,
      providerId,
      error,
    });
  };

  return {
    configured: Boolean(apiKey),
    async send(message: EmailMessage): Promise<EmailDelivery> {
      if (!apiKey) {
        await journal(message, "unconfigured", null, null, "RESEND_API_KEY is not set");
        return {
          delivered: false,
          status: "unconfigured",
          provider: null,
          message:
            "E-mail delivery is not configured on this deployment. An operator can read and deliver the message from the outbox.",
        };
      }

      try {
        const response = await fetch("https://api.resend.com/emails", {
          method: "POST",
          headers: {
            authorization: `Bearer ${apiKey}`,
            "content-type": "application/json",
          },
          body: JSON.stringify({
            from,
            to: [message.to],
            subject: message.subject,
            text: message.text,
            ...(message.html ? { html: message.html } : {}),
          }),
          signal: AbortSignal.timeout(10_000),
        });

        if (!response.ok) {
          const detail = (await response.text().catch(() => "")).slice(0, 300);
          await journal(message, "failed", "resend", null, `HTTP ${response.status}: ${detail}`);
          return {
            delivered: false,
            status: "failed",
            provider: "resend",
            message: `The mail provider refused the message (HTTP ${response.status}).`,
          };
        }

        const payload = (await response.json().catch(() => ({}))) as { id?: string };
        await journal(message, "sent", "resend", payload.id ?? null, null);
        return {
          delivered: true,
          status: "sent",
          provider: "resend",
          message: "Message accepted by the mail provider.",
        };
      } catch (error) {
        const detail = error instanceof Error ? error.message : "network error";
        await journal(message, "failed", "resend", null, detail);
        return {
          delivered: false,
          status: "failed",
          provider: "resend",
          message: `The mail provider could not be reached: ${detail}`,
        };
      }
    },
  };
}

/** Shared layout so every transactional message looks like the product. */
export function renderEmail(input: {
  heading: string;
  body: string;
  action?: { label: string; url: string };
  footer?: string;
}): { text: string; html: string } {
  const lines = [input.heading, "", input.body];
  if (input.action) lines.push("", `${input.action.label}: ${input.action.url}`);
  if (input.footer) lines.push("", input.footer);

  const html = `<!doctype html>
<html><body style="margin:0;background:#0a0a0b;font-family:-apple-system,Segoe UI,Roboto,sans-serif">
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="padding:32px 16px">
    <tr><td align="center">
      <table role="presentation" width="100%" cellpadding="0" cellspacing="0"
             style="max-width:520px;background:#141412;border-radius:14px;padding:28px;color:#f3f0e8">
        <tr><td style="font-size:12px;letter-spacing:.18em;color:#63d6a2;text-transform:uppercase">
          PROOFCORE
        </td></tr>
        <tr><td style="padding-top:14px;font-size:20px;font-weight:600">${escapeHtml(input.heading)}</td></tr>
        <tr><td style="padding-top:12px;font-size:14px;line-height:1.6;color:#b8b3a8">
          ${escapeHtml(input.body).replaceAll("\n", "<br/>")}
        </td></tr>
        ${
          input.action
            ? `<tr><td style="padding-top:22px">
                 <a href="${input.action.url}"
                    style="display:inline-block;background:#63d6a2;color:#05231b;text-decoration:none;
                           padding:12px 20px;border-radius:10px;font-weight:600;font-size:14px">
                   ${escapeHtml(input.action.label)}
                 </a>
               </td></tr>
               <tr><td style="padding-top:14px;font-size:12px;color:#8a8a82;word-break:break-all">
                 ${input.action.url}
               </td></tr>`
            : ""
        }
        ${
          input.footer
            ? `<tr><td style="padding-top:24px;font-size:12px;color:#8a8a82;line-height:1.6">
                 ${escapeHtml(input.footer)}
               </td></tr>`
            : ""
        }
      </table>
    </td></tr>
  </table>
</body></html>`;

  return { text: lines.join("\n"), html };
}

function escapeHtml(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}

/**
 * The link a reset e-mail points at.
 *
 * The reset token travels in the fragment (`#token=…`), not the query string, so it is
 * never sent to the server in a Referer header or captured by an access log.
 */
export function resetUrl(webOrigin: string, token: string): string {
  return `${webOrigin.replace(/\/+$/, "")}/reset-password#token=${encodeURIComponent(token)}`;
}

export function verifyUrl(webOrigin: string, token: string): string {
  return `${webOrigin.replace(/\/+$/, "")}/verify-email#token=${encodeURIComponent(token)}`;
}

export function requireEmailSender(sender: EmailSender | null): EmailSender {
  if (!sender) {
    throw new ProofCoreError({
      message: "no email sender is wired",
      category: "CONFIGURATION",
      code: "email_sender_missing",
    });
  }
  return sender;
}
