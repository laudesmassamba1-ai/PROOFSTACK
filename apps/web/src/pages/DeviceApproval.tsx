import { CircleAlert, CircleCheck, LoaderCircle } from "lucide-react";
import { useState } from "react";
import { Link } from "react-router";
import { useI18n } from "../i18n/index.js";
import { postJson } from "../lib/api.js";
import { useSession } from "../lib/session.js";

/**
 * Device authorization approval (RFC 8628-style).
 *
 * `proofcore login --device` prints a short code; the user lands here on any
 * device where they are already signed in and decides. The decision is bound to
 * this browser session — the device channel cannot approve anything by itself.
 * A grant is consumed on first use and expires after ten minutes; those
 * guarantees live in the API, not in this page.
 */
export function DeviceApproval() {
  const { t } = useI18n();
  const session = useSession();
  const [code, setCode] = useState("");
  const [state, setState] = useState<"idle" | "sending" | "done" | "failed">("idle");
  const [message, setMessage] = useState("");

  if (session.status === "loading") return null;

  if (!session.user) {
    return (
      <section className="mx-auto max-w-md px-6 py-24 text-center">
        <h1 className="text-2xl font-semibold tracking-tight">{t("device.signinRequired")}</h1>
        <p className="mt-3 text-sm text-neutral-600 dark:text-neutral-400">
          {t("device.signinHint")}
        </p>
        <Link
          to="/signin"
          className="mt-6 inline-block rounded-full border border-neutral-300 px-5 py-2.5 text-sm font-medium hover:border-neutral-500 dark:border-neutral-700 dark:hover:border-neutral-500"
        >
          {t("device.goSignin")}
        </Link>
      </section>
    );
  }

  async function approve() {
    setState("sending");
    setMessage("");
    try {
      const result = await postJson<{ ok: boolean; clientName?: string }>(
        "/api/auth/device/verify",
        { userCode: code.trim().toUpperCase() }
      );
      setState("done");
      setMessage(
        result.clientName
          ? t("device.approvedFor", { client: result.clientName })
          : t("device.approved")
      );
    } catch (error) {
      setState("failed");
      setMessage(error instanceof Error && error.message ? error.message : t("device.failed"));
    }
  }

  async function deny() {
    setState("sending");
    setMessage("");
    try {
      await postJson("/api/auth/device/deny", { userCode: code.trim().toUpperCase() });
      setState("done");
      setMessage(t("device.denied"));
    } catch (error) {
      setState("failed");
      setMessage(error instanceof Error && error.message ? error.message : t("device.failed"));
    }
  }

  return (
    <section className="mx-auto max-w-md px-6 py-24">
      <h1 className="text-2xl font-semibold tracking-tight">{t("device.title")}</h1>
      <p className="mt-3 text-sm text-neutral-600 dark:text-neutral-400">
        {t("device.description", { email: session.user.email })}
      </p>

      <label
        className="mt-8 block text-xs font-semibold tracking-widest text-neutral-500"
        htmlFor="device-code"
      >
        {t("device.codeLabel")}
      </label>
      <input
        id="device-code"
        value={code}
        onChange={(event) => {
          setCode(event.target.value);
          if (state !== "idle") setState("idle");
        }}
        autoComplete="off"
        spellCheck={false}
        placeholder="ABCD-2345"
        className="mt-2 w-full rounded-xl border border-neutral-300 bg-transparent px-4 py-3 font-mono text-lg tracking-[0.2em] uppercase dark:border-neutral-700"
      />

      <div className="mt-6 flex gap-3">
        <button
          type="button"
          onClick={approve}
          disabled={state === "sending" || code.trim().length < 6}
          className="flex-1 rounded-full bg-neutral-900 px-5 py-3 text-sm font-medium text-white disabled:opacity-50 dark:bg-white dark:text-black"
        >
          {state === "sending" ? (
            <LoaderCircle aria-hidden className="mx-auto size-4 animate-spin" />
          ) : (
            t("device.approve")
          )}
        </button>
        <button
          type="button"
          onClick={deny}
          disabled={state === "sending" || code.trim().length < 6}
          className="rounded-full border border-neutral-300 px-5 py-3 text-sm font-medium disabled:opacity-50 dark:border-neutral-700"
        >
          {t("device.deny")}
        </button>
      </div>

      {message && (
        <p
          role="status"
          className={`mt-6 flex items-center gap-2 text-sm ${
            state === "failed"
              ? "text-red-600 dark:text-red-400"
              : "text-emerald-700 dark:text-emerald-400"
          }`}
        >
          {state === "failed" ? (
            <CircleAlert aria-hidden className="size-4" />
          ) : (
            <CircleCheck aria-hidden className="size-4" />
          )}
          {message}
        </p>
      )}

      <p className="mt-10 text-xs leading-relaxed text-neutral-500">{t("device.safety")}</p>
    </section>
  );
}
