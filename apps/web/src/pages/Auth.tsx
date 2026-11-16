import { useEffect, useMemo, useState } from "react";
import { Link, useSearchParams } from "react-router";
import { CircleAlert, CircleCheck, LoaderCircle } from "lucide-react";
import { z } from "zod";
import { findPlan } from "@proofstack/billing";
import { useI18n } from "../i18n/index.js";
import { API_BASE, postJson, probeApi, type Probe } from "../lib/api.js";
import { Wordmark } from "../components/brand/Logo.js";

const signInSchema = z.object({
  email: z.string().email(),
  password: z.string().min(1, "Required"),
});

const signUpSchema = signInSchema
  .extend({
    name: z.string().min(2, "At least 2 characters"),
    workspace: z.string().min(2, "At least 2 characters"),
  })
  .refine((value) => value.password.length >= 10, {
    message: "Use at least 10 characters",
    path: ["password"],
  });

type Mode = "in" | "up";

/**
 * Auth is one page in two modes because the fields, the validation and the failure
 * explanation are the same problem. It probes the API on mount and reports the
 * truth: no mock session, no "demo user", no silently disabled button.
 */
export function Auth({ mode }: { mode: Mode }) {
  const { t } = useI18n();
  const [params] = useSearchParams();
  const [probe, setProbe] = useState<Probe>({ status: "checking" });
  const [values, setValues] = useState({ email: "", password: "", name: "", workspace: "" });
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [state, setState] = useState<"idle" | "sending" | "sent" | "failed">("idle");
  const [message, setMessage] = useState<string>("");

  const plan = useMemo(() => {
    const key = params.get("plan");
    return key ? findPlan(key) : undefined;
  }, [params]);

  useEffect(() => {
    let cancelled = false;
    probeApi().then((result) => {
      if (!cancelled) setProbe(result);
    });
    return () => {
      cancelled = true;
    };
  }, []);

  const submit = async (event: React.FormEvent) => {
    event.preventDefault();
    setErrors({});
    const schema = mode === "in" ? signInSchema : signUpSchema;
    const parsed = schema.safeParse(values);
    if (!parsed.success) {
      const next: Record<string, string> = {};
      for (const issue of parsed.error.issues) next[String(issue.path[0])] = issue.message;
      setErrors(next);
      return;
    }
    if (probe.status !== "reachable") {
      setState("failed");
      setMessage(t("auth.noBackend").replace("{url}", API_BASE));
      return;
    }
    setState("sending");
    try {
      await postJson(
        mode === "in" ? "/api/auth/sign-in/email" : "/api/auth/sign-up/email",
        mode === "in"
          ? { email: values.email, password: values.password }
          : { email: values.email, password: values.password, name: values.name },
      );
      setState("sent");
      setMessage(mode === "in" ? "Signed in — redirecting to your workspace." : "Account created. Confirm your email.");
    } catch (error) {
      setState("failed");
      setMessage(error instanceof Error ? error.message : String(error));
    }
  };

  return (
    <div className="mx-auto flex min-h-[calc(100vh-6rem)] max-w-[520px] flex-col justify-center px-5 py-10">
      <Link to="/" className="mb-8 self-start">
        <Wordmark size={14} />
      </Link>

      <h1 className="text-[1.6rem] tracking-tight">
        {mode === "in" ? t("auth.signin.title") : t("auth.signup.title")}
      </h1>

      {plan ? (
        <p className="mt-3 rounded-lg border border-brand-mint/30 bg-brand-mint/8 px-3 py-2 text-[0.82rem] text-white/74">
          Selected plan: <strong>{plan.name}</strong>
          {params.get("period") ? ` · ${params.get("period")}` : ""}
          {params.get("currency") ? ` · ${params.get("currency")}` : ""}
          . The plan is applied after the account exists; the price is re-read from the server at checkout.
        </p>
      ) : null}

      <form onSubmit={submit} className="brand-panel mt-6 space-y-4 p-6" noValidate>
        {mode === "up" ? (
          <>
            <Field label={t("auth.name")} error={errors.name}>
              <input
                className="field"
                name="name"
                autoComplete="name"
                value={values.name}
                onChange={(event) => setValues({ ...values, name: event.target.value })}
              />
            </Field>
            <Field label={t("auth.company")} error={errors.workspace}>
              <input
                className="field"
                name="workspace"
                autoComplete="organization"
                value={values.workspace}
                onChange={(event) => setValues({ ...values, workspace: event.target.value })}
              />
            </Field>
          </>
        ) : null}

        <Field label={t("auth.email")} error={errors.email}>
          <input
            className="field"
            type="email"
            name="email"
            autoComplete="email"
            required
            value={values.email}
            onChange={(event) => setValues({ ...values, email: event.target.value })}
          />
        </Field>

        <Field label={t("auth.password")} error={errors.password}>
          <input
            className="field"
            type="password"
            name="password"
            autoComplete={mode === "in" ? "current-password" : "new-password"}
            required
            value={values.password}
            onChange={(event) => setValues({ ...values, password: event.target.value })}
          />
        </Field>

        <button type="submit" className="btn btn-primary w-full justify-center" disabled={state === "sending"}>
          {state === "sending" ? <LoaderCircle size={16} className="animate-spin" /> : null}
          {mode === "in" ? t("auth.submit.in") : t("auth.submit.up")}
        </button>

        <p className="text-[0.8rem] text-white/46">
          {mode === "in" ? t("auth.noAccount") : t("auth.haveAccount")}{" "}
          <Link className="text-brand-mint underline-offset-2 hover:underline" to={mode === "in" ? "/signup" : "/signin"}>
            {mode === "in" ? t("nav.signup") : t("nav.signin")}
          </Link>
        </p>
      </form>

      <div
        className="mt-4 flex items-start gap-2.5 rounded-lg border px-4 py-3 text-[0.8rem] leading-relaxed"
        role="status"
        aria-live="polite"
        style={{
          borderColor:
            probe.status === "reachable" ? "rgba(115,214,139,0.35)" : probe.status === "checking" ? "rgba(255,255,255,0.12)" : "rgba(233,180,90,0.35)",
          background:
            probe.status === "reachable" ? "rgba(115,214,139,0.07)" : probe.status === "checking" ? "rgba(255,255,255,0.03)" : "rgba(233,180,90,0.07)",
          color: probe.status === "reachable" ? "#bfeed4" : "rgba(242,246,250,0.7)",
        }}
      >
        {probe.status === "checking" ? <LoaderCircle size={15} className="mt-0.5 shrink-0 animate-spin" /> : null}
        {probe.status === "reachable" ? <CircleCheck size={15} className="mt-0.5 shrink-0" /> : null}
        {probe.status === "unreachable" ? <CircleAlert size={15} className="mt-0.5 shrink-0 text-[#e9b45a]" /> : null}
        <span>
          {probe.status === "checking"
            ? t("auth.checking")
            : probe.status === "reachable"
              ? `${t("auth.reachable")} (${API_BASE}${probe.detail ? ` · ${probe.detail}` : ""})`
              : t("auth.noBackend").replace("{url}", API_BASE)}
          {message ? <strong className="mt-1 block text-white/86">{message}</strong> : null}
        </span>
      </div>
    </div>
  );
}

function Field({ label, error, children }: { label: string; error?: string; children: React.ReactNode }) {
  return (
    <label className="block">
      <span className="label">{label}</span>
      {children}
      {error ? <span className="mt-1.5 block text-[0.76rem] text-[#f07884]">{error}</span> : null}
    </label>
  );
}
