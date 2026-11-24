import { CircleAlert, CircleCheck, LoaderCircle, Mail } from "lucide-react";
import { type FormEvent, useEffect, useState } from "react";
import { Link, useNavigate } from "react-router";
import { ApiError, apiFetch, postJson } from "../lib/api.js";

/**
 * Account recovery pages.
 *
 * The shared rule: the interface repeats exactly what the server did. When no mail
 * provider is configured, the page says so instead of printing "check your inbox" —
 * a dead-end claim is worse than an honest one, because the user cannot tell whether
 * to wait or to write to support.
 */

type Delivery = {
  emailConfigured?: boolean;
  deliveryNote?: string;
};

function Panel({
  title,
  lede,
  children,
}: {
  title: string;
  lede: string;
  children: React.ReactNode;
}) {
  return (
    <div className="mx-auto w-full max-w-md px-6 py-16">
      {/* The marketing layout paints light text on a dark canvas; this card is a light
          surface, so it must set its own foreground or every heading turns invisible. */}
      <div className="support-card rounded-2xl border border-border bg-surface-1 p-6 text-foreground shadow-sm">
        <h1 className="text-lg font-semibold tracking-tight text-foreground">{title}</h1>
        <p className="mt-1.5 text-sm leading-relaxed text-muted-foreground">{lede}</p>
        <div className="mt-5">{children}</div>
      </div>
      <p className="mt-4 text-center text-xs text-white/45">
        <Link to="/signin" className="underline hover:text-white">
          Retour à la connexion
        </Link>
      </p>
    </div>
  );
}

function Notice({ kind, children }: { kind: "ok" | "warn" | "error"; children: React.ReactNode }) {
  const styles =
    kind === "ok"
      ? "border-emerald-500/40 bg-emerald-500/10 text-emerald-700 dark:text-emerald-400"
      : kind === "warn"
        ? "border-amber-500/40 bg-amber-500/10 text-amber-700 dark:text-amber-400"
        : "border-destructive/40 bg-destructive/10 text-destructive";
  const Icon = kind === "ok" ? CircleCheck : CircleAlert;
  return (
    <div
      className={`flex items-start gap-2 rounded-lg border px-3 py-2 text-xs leading-relaxed ${styles}`}
    >
      <Icon className="mt-0.5 h-3.5 w-3.5 shrink-0" />
      <div>{children}</div>
    </div>
  );
}

export function ForgotPassword() {
  const [email, setEmail] = useState("");
  const [state, setState] = useState<"idle" | "sending" | "done">("idle");
  const [delivery, setDelivery] = useState<Delivery | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function submit(event: FormEvent) {
    event.preventDefault();
    setState("sending");
    setError(null);
    try {
      const data = await postJson<Delivery>("/api/account/forgot-password", { email });
      setDelivery(data);
      setState("done");
    } catch (failure) {
      setError(failure instanceof ApiError ? failure.message : "Requête impossible.");
      setState("idle");
    }
  }

  if (state === "done") {
    return (
      <Panel
        title="Demande enregistrée"
        lede="Si un compte existe pour cette adresse, un lien de réinitialisation valable une heure vient d'être préparé."
      >
        <div className="space-y-3">
          {delivery?.emailConfigured ? (
            <Notice kind="ok">Vérifie ta boîte de réception, puis les indésirables.</Notice>
          ) : (
            <Notice kind="warn">
              <strong>Aucun e-mail n'a pu être envoyé automatiquement.</strong> Aucun fournisseur
              d'e-mail n'est configuré sur ce déploiement : le message est en file d'attente et doit
              être remis par un opérateur. Écris à{" "}
              <Link to="/support" className="underline">
                l'assistance
              </Link>{" "}
              en indiquant l'adresse concernée.
            </Notice>
          )}
          {delivery?.deliveryNote && (
            <p className="text-[11px] leading-relaxed text-muted-foreground">
              {delivery.deliveryNote}
            </p>
          )}
        </div>
      </Panel>
    );
  }

  return (
    <Panel
      title="Mot de passe oublié"
      lede="Indique l'adresse de ton compte : un lien valable une heure te permettra d'en choisir un nouveau."
    >
      <form onSubmit={submit} className="space-y-3">
        <label className="block text-xs font-medium">
          Adresse e-mail
          <input
            type="email"
            required
            value={email}
            onChange={(event) => setEmail(event.target.value)}
            className="mt-1 w-full rounded-lg border border-border bg-surface-2 px-3 py-2 text-sm outline-none focus:border-primary/60"
            placeholder="toi@exemple.com"
            autoComplete="email"
          />
        </label>
        {error && <Notice kind="error">{error}</Notice>}
        <button
          type="submit"
          disabled={state === "sending"}
          className="flex w-full items-center justify-center gap-2 rounded-xl bg-primary px-4 py-2.5 text-sm font-semibold text-primary-foreground transition hover:brightness-110 disabled:opacity-60"
        >
          {state === "sending" ? (
            <LoaderCircle className="h-4 w-4 animate-spin" />
          ) : (
            <Mail className="h-4 w-4" />
          )}
          Envoyer le lien
        </button>
      </form>
    </Panel>
  );
}

export function ResetPassword() {
  const navigate = useNavigate();
  const [token, setToken] = useState("");
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [state, setState] = useState<"idle" | "sending" | "done">("idle");
  const [error, setError] = useState<string | null>(null);

  // The token travels in the fragment so it never reaches a server log or a Referer.
  useEffect(() => {
    const hash = window.location.hash.replace(/^#/, "");
    const value = new URLSearchParams(hash).get("token");
    if (value) setToken(value);
  }, []);

  async function submit(event: FormEvent) {
    event.preventDefault();
    if (password !== confirm) {
      setError("Les deux mots de passe ne correspondent pas.");
      return;
    }
    setState("sending");
    setError(null);
    try {
      await postJson("/api/account/reset-password", { token, password });
      setState("done");
      setTimeout(() => navigate("/app"), 900);
    } catch (failure) {
      setError(failure instanceof ApiError ? failure.message : "Requête impossible.");
      setState("idle");
    }
  }

  if (!token) {
    return (
      <Panel title="Lien incomplet" lede="Ce lien ne contient pas de jeton de réinitialisation.">
        <Notice kind="error">
          Le lien a peut-être été tronqué par ta messagerie.{" "}
          <Link to="/forgot-password" className="underline">
            Demande-en un nouveau
          </Link>
          .
        </Notice>
      </Panel>
    );
  }

  if (state === "done") {
    return (
      <Panel title="Mot de passe modifié" lede="Tu es connecté. Redirection vers ton espace…">
        <Notice kind="ok">
          Toutes les autres sessions ont été fermées : change de mot de passe ferme l'accès partout.
        </Notice>
      </Panel>
    );
  }

  return (
    <Panel
      title="Nouveau mot de passe"
      lede="Choisis un mot de passe d'au moins 10 caractères. Il remplacera l'ancien immédiatement."
    >
      <form onSubmit={submit} className="space-y-3">
        <label className="block text-xs font-medium">
          Nouveau mot de passe
          <input
            type="password"
            required
            minLength={10}
            value={password}
            onChange={(event) => setPassword(event.target.value)}
            className="mt-1 w-full rounded-lg border border-border bg-surface-2 px-3 py-2 text-sm outline-none focus:border-primary/60"
            autoComplete="new-password"
          />
        </label>
        <label className="block text-xs font-medium">
          Confirmation
          <input
            type="password"
            required
            minLength={10}
            value={confirm}
            onChange={(event) => setConfirm(event.target.value)}
            className="mt-1 w-full rounded-lg border border-border bg-surface-2 px-3 py-2 text-sm outline-none focus:border-primary/60"
            autoComplete="new-password"
          />
        </label>
        {error && <Notice kind="error">{error}</Notice>}
        <button
          type="submit"
          disabled={state === "sending"}
          className="flex w-full items-center justify-center gap-2 rounded-xl bg-primary px-4 py-2.5 text-sm font-semibold text-primary-foreground transition hover:brightness-110 disabled:opacity-60"
        >
          {state === "sending" && <LoaderCircle className="h-4 w-4 animate-spin" />}
          Enregistrer le mot de passe
        </button>
      </form>
    </Panel>
  );
}

export function VerifyEmail() {
  const [_token, setToken] = useState("");
  const [state, setState] = useState<"idle" | "sending" | "done" | "failed">("idle");
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const hash = window.location.hash.replace(/^#/, "");
    const value = new URLSearchParams(hash).get("token");
    if (!value) {
      setState("failed");
      setError("Ce lien ne contient pas de jeton de vérification.");
      return;
    }
    setToken(value);
    void (async () => {
      setState("sending");
      try {
        await postJson("/api/account/verify-email/confirm", { token: value });
        setState("done");
      } catch (failure) {
        setState("failed");
        setError(failure instanceof ApiError ? failure.message : "Vérification impossible.");
      }
    })();
  }, []);

  return (
    <Panel
      title="Vérification de l'adresse"
      lede="Ce lien confirme que cette adresse t'appartient."
    >
      {state === "sending" && (
        <p className="flex items-center gap-2 text-xs text-muted-foreground">
          <LoaderCircle className="h-3.5 w-3.5 animate-spin" /> Vérification…
        </p>
      )}
      {state === "done" && <Notice kind="ok">Adresse confirmée. Tu peux continuer.</Notice>}
      {state === "failed" && error && <Notice kind="error">{error}</Notice>}
      {state === "done" && (
        <Link
          to="/app"
          className="mt-4 inline-block rounded-xl bg-primary px-4 py-2 text-xs font-semibold text-primary-foreground"
        >
          Ouvrir mon espace
        </Link>
      )}
    </Panel>
  );
}

interface Ticket {
  reference: string;
  subject: string;
  status: "open" | "in_progress" | "resolved" | string;
  reply: string | null;
  repliedAt: string | null;
  createdAt: string;
}

const TICKET_STATUS: Record<string, string> = {
  open: "Reçu, en attente de lecture",
  in_progress: "En cours de traitement",
  resolved: "Réponse disponible",
};

export function Support() {
  const [form, setForm] = useState({ email: "", subject: "", body: "" });
  const [state, setState] = useState<"idle" | "sending" | "done">("idle");
  const [reference, setReference] = useState<string | null>(null);
  const [message, setMessage] = useState<string>("");
  const [error, setError] = useState<string | null>(null);
  const [lookup, setLookup] = useState({ reference: "", email: "" });
  const [ticket, setTicket] = useState<Ticket | null>(null);
  const [lookupError, setLookupError] = useState<string | null>(null);
  const [lookingUp, setLookingUp] = useState(false);

  async function lookupTicket(ticketReference: string, email: string) {
    setLookingUp(true);
    setLookupError(null);
    try {
      const data = await apiFetch<Ticket>(
        `/api/account/support/${encodeURIComponent(ticketReference)}?email=${encodeURIComponent(email)}`
      );
      setTicket(data);
    } catch (failure) {
      setTicket(null);
      setLookupError(
        failure instanceof ApiError
          ? failure.message
          : "Aucun message ne correspond à cette référence et à cette adresse."
      );
    } finally {
      setLookingUp(false);
    }
  }

  async function submit(event: FormEvent) {
    event.preventDefault();
    setState("sending");
    setError(null);
    try {
      const data = await postJson<{ reference: string; message: string }>(
        "/api/account/support",
        form
      );
      setReference(data.reference);
      setMessage(data.message);
      setState("done");
    } catch (failure) {
      setError(failure instanceof ApiError ? failure.message : "Envoi impossible.");
      setState("idle");
    }
  }

  if (state === "done") {
    return (
      <Panel
        title="Message enregistré"
        lede="Il est conservé avec sa référence, même sans e-mail configuré."
      >
        <div className="space-y-3">
          <Notice kind="ok">
            Référence <span className="font-mono">{reference}</span>. {message}
          </Notice>
          <button
            type="button"
            className="w-full rounded-xl border border-border px-4 py-2 text-sm font-medium hover:bg-surface-2"
            onClick={() => {
              if (reference) {
                setLookup({ reference, email: form.email });
                void lookupTicket(reference, form.email);
              }
            }}
            disabled={lookingUp || !reference}
          >
            {lookingUp ? "Vérification…" : "Voir l'état et la réponse"}
          </button>
          {lookupError && <Notice kind="warn">{lookupError}</Notice>}
          {ticket && <TicketView ticket={ticket} />}
        </div>
      </Panel>
    );
  }

  return (
    <Panel
      title="Assistance"
      lede="Décris ce qui bloque. Une personne lit chaque message ; rien n'est envoyé à un service tiers."
    >
      <form onSubmit={submit} className="space-y-3">
        <label className="block text-xs font-medium">
          Ton adresse e-mail
          <input
            type="email"
            required
            value={form.email}
            onChange={(event) => setForm({ ...form, email: event.target.value })}
            className="mt-1 w-full rounded-lg border border-border bg-surface-2 px-3 py-2 text-sm outline-none focus:border-primary/60"
            autoComplete="email"
          />
        </label>
        <label className="block text-xs font-medium">
          Sujet
          <input
            required
            minLength={3}
            value={form.subject}
            onChange={(event) => setForm({ ...form, subject: event.target.value })}
            className="mt-1 w-full rounded-lg border border-border bg-surface-2 px-3 py-2 text-sm outline-none focus:border-primary/60"
            placeholder="Accès au compte, facturation, bug…"
          />
        </label>
        <label className="block text-xs font-medium">
          Message
          <textarea
            required
            minLength={10}
            rows={6}
            value={form.body}
            onChange={(event) => setForm({ ...form, body: event.target.value })}
            className="mt-1 w-full resize-y rounded-lg border border-border bg-surface-2 px-3 py-2 text-sm outline-none focus:border-primary/60"
            placeholder="Ce que tu faisais, ce que tu attendais, ce qui s'est passé."
          />
        </label>
        {error && <Notice kind="error">{error}</Notice>}
        <button
          type="submit"
          disabled={state === "sending"}
          className="w-full rounded-xl bg-primary px-4 py-2.5 text-sm font-semibold text-primary-foreground transition hover:brightness-110 disabled:opacity-60"
        >
          {state === "sending" ? "Envoi…" : "Envoyer le message"}
        </button>
      </form>

      <div className="mt-6 border-t border-border pt-4">
        <p className="text-xs font-semibold">Suivre un message</p>
        <p className="mt-1 text-[11px] leading-relaxed text-muted-foreground">
          La référence a été affichée à l'envoi. L'adresse doit être celle qui a écrit : elle prouve
          que la conversation vous appartient.
        </p>
        <form
          className="mt-3 space-y-2"
          onSubmit={(event) => {
            event.preventDefault();
            void lookupTicket(lookup.reference.trim(), lookup.email.trim());
          }}
        >
          <input
            required
            value={lookup.reference}
            onChange={(event) => setLookup({ ...lookup, reference: event.target.value })}
            placeholder="sup_…"
            className="w-full rounded-lg border border-border bg-surface-2 px-3 py-2 text-sm outline-none focus:border-primary/60"
            autoComplete="off"
          />
          <input
            type="email"
            required
            value={lookup.email}
            onChange={(event) => setLookup({ ...lookup, email: event.target.value })}
            placeholder="toi@exemple.com"
            className="w-full rounded-lg border border-border bg-surface-2 px-3 py-2 text-sm outline-none focus:border-primary/60"
            autoComplete="email"
          />
          <button
            type="submit"
            disabled={lookingUp}
            className="w-full rounded-xl border border-border px-4 py-2 text-sm font-medium hover:bg-surface-2 disabled:opacity-60"
          >
            {lookingUp ? "Recherche…" : "Afficher l'état"}
          </button>
        </form>
        {lookupError && (
          <div className="mt-3">
            <Notice kind="warn">{lookupError}</Notice>
          </div>
        )}
        {ticket && (
          <div className="mt-3">
            <TicketView ticket={ticket} />
          </div>
        )}
      </div>
    </Panel>
  );
}

function TicketView({ ticket }: { ticket: Ticket }) {
  return (
    <div className="space-y-2 rounded-lg border border-border bg-surface-2 px-3 py-2 text-xs">
      <p className="font-mono text-[11px] text-muted-foreground">{ticket.reference}</p>
      <p>
        <strong>Statut :</strong> {TICKET_STATUS[ticket.status] ?? ticket.status}
      </p>
      <p className="text-muted-foreground">Sujet : {ticket.subject}</p>
      {ticket.reply ? (
        <div className="rounded-md border border-emerald-500/30 bg-emerald-500/5 px-2 py-1.5">
          <p className="font-medium">Réponse</p>
          <p className="mt-1 whitespace-pre-wrap leading-relaxed">{ticket.reply}</p>
          {ticket.repliedAt && (
            <p className="mt-1 text-[10px] text-muted-foreground">
              {new Date(ticket.repliedAt).toLocaleString("fr-FR")}
            </p>
          )}
        </div>
      ) : (
        <p className="text-muted-foreground">Aucune réponse pour l'instant.</p>
      )}
    </div>
  );
}
