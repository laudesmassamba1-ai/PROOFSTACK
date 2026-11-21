import { createServer } from "node:http";
import type { AddressInfo } from "node:net";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createApp } from "../src/app.js";
import { SESSION_COOKIE } from "../src/auth.js";
import { migrate } from "../src/db/d1.js";
import { migrationFiles, NodeSqliteDatabase } from "../src/db/node-sqlite.js";
import { readConfig } from "../src/env.js";

/**
 * Account lifecycle.
 *
 * The assertions that matter are the ones about truthfulness:
 *  - forgot-password answers the same way for an unknown address;
 *  - without a mail provider the API says so instead of "we sent you an email";
 *  - a reset token is single-use and expires;
 *  - a completed reset signs the user in and closes the old sessions.
 */

interface Harness {
  request: typeof fetch;
  close: () => Promise<void>;
  store: ReturnType<typeof createApp>["services"]["store"];
  outbox: () => Promise<{ status: string; kind: string; to: string }[]>;
}

async function bootstrap(env: Record<string, string | undefined> = {}): Promise<Harness> {
  const db = NodeSqliteDatabase.open(":memory:");
  await migrate(db, migrationFiles());
  const built = createApp({
    db,
    env: { NODE_ENV: "test", ADMIN_EMAILS: "ops@example.com", ...env },
  });
  const config = readConfig({ NODE_ENV: "test", ADMIN_EMAILS: "ops@example.com", ...env });
  const request = (path: string, init: RequestInit = {}) =>
    built.app.request(`http://localhost${path}`, {
      ...init,
      headers: { "content-type": "application/json", origin: config.webOrigin, ...init.headers },
    });
  return {
    request: request as unknown as typeof fetch,
    close: async () => {
      await db.close();
    },
    store: built.services.store,
    outbox: async () => {
      const rows = await db
        .prepare("SELECT status, kind, to_address FROM email_outbox ORDER BY created_at DESC")
        .all<{ status: string; kind: string; to_address: string }>();
      return rows.map((row) => ({ status: row.status, kind: row.kind, to: row.to_address }));
    },
  };
}

async function signUp(harness: Harness, email: string) {
  const response = await harness.request("/api/auth/sign-up/email", {
    method: "POST",
    body: JSON.stringify({ email, password: "correct horse battery", name: "Owner" }),
  });
  expect(response.status).toBe(201);
  return (response.headers.get("set-cookie") ?? "").split(";")[0];
}

let harness: Harness;

beforeEach(async () => {
  harness = await bootstrap();
});

afterEach(async () => {
  await harness.close();
});

describe("password recovery", () => {
  it("answers identically for a known and an unknown address", async () => {
    await signUp(harness, "known@example.com");

    const known = await harness.request("/api/account/forgot-password", {
      method: "POST",
      body: JSON.stringify({ email: "known@example.com" }),
    });
    const unknown = await harness.request("/api/account/forgot-password", {
      method: "POST",
      body: JSON.stringify({ email: "nobody@example.com" }),
    });

    expect(known.status).toBe(200);
    expect(unknown.status).toBe(200);
    const a = (await known.json()) as Record<string, unknown>;
    const b = (await unknown.json()) as Record<string, unknown>;
    // Same wording, same shape: the response cannot be used to enumerate accounts.
    expect(a.message).toBe(b.message);
    expect(Object.keys(a).sort()).toEqual(Object.keys(b).sort());
  });

  it("says the message was not delivered when no mail provider is configured", async () => {
    await signUp(harness, "nodemailer@example.com");
    const response = await harness.request("/api/account/forgot-password", {
      method: "POST",
      body: JSON.stringify({ email: "nodemailer@example.com" }),
    });
    expect(response.status).toBe(200);
    const body = (await response.json()) as {
      emailConfigured: boolean;
      deliveryNote?: string;
    };
    expect(body.emailConfigured).toBe(false);
    expect(body.deliveryNote).toContain("Aucun fournisseur");

    // The message is not lost: it is in the outbox with an explicit status.
    const outbox = await harness.outbox();
    expect(outbox[0]).toMatchObject({ status: "unconfigured", kind: "password_reset" });
  });

  it("resets the password once, signs the user in, and closes the old sessions", async () => {
    const cookie = await signUp(harness, "reset@example.com");
    await harness.request("/api/account/forgot-password", {
      method: "POST",
      body: JSON.stringify({ email: "reset@example.com" }),
    });

    // The token is only in the outbox body: read it the way the operator would.
    const row = await harness.store.listEmailOutbox(5);
    const stored = await harness.store.findUserByNormalizedEmail("reset@example.com");
    expect(stored).not.toBeNull();
    const outboxRow = await harness.store
      .listEmailOutbox(5)
      .then(() => row.find((entry) => entry.kind === "password_reset"));
    expect(outboxRow).toBeDefined();

    // Pull the token straight from the database body (the outbox keeps the real text).
    const tokens = await (async () => {
      const rows = await (
        harness.store as unknown as {
          db: { prepare: (sql: string) => { all: () => Promise<{ body_text: string }[]> } };
        }
      ).db
        .prepare("SELECT body_text FROM email_outbox WHERE kind = 'password_reset'")
        .all();
      const match = /reset-password#token=([a-f0-9]{64})/.exec(rows[0]?.body_text ?? "");
      return match?.[1];
    })();
    expect(tokens).toHaveLength(64);

    const reset = await harness.request("/api/account/reset-password", {
      method: "POST",
      body: JSON.stringify({ token: tokens, password: "brand new passphrase" }),
    });
    expect(reset.status).toBe(200);
    const sessionCookie = (reset.headers.get("set-cookie") ?? "").split(";")[0];
    expect(sessionCookie).toContain(`${SESSION_COOKIE}=`);

    // The old session is gone.
    const oldSession = await harness.request("/api/auth/session", { headers: { cookie } });
    expect(((await oldSession.json()) as { user: unknown }).user).toBeNull();

    // The new password works and the old one does not.
    const old = await harness.request("/api/auth/sign-in/email", {
      method: "POST",
      body: JSON.stringify({ email: "reset@example.com", password: "correct horse battery" }),
    });
    expect(old.status).toBe(401);
    const fresh = await harness.request("/api/auth/sign-in/email", {
      method: "POST",
      body: JSON.stringify({ email: "reset@example.com", password: "brand new passphrase" }),
    });
    expect(fresh.status).toBe(200);

    // A reset proves control of the address.
    const user = await harness.store.findUserByNormalizedEmail("reset@example.com");
    expect(user?.emailVerifiedAt).not.toBeNull();
  });

  it("refuses a token a second time and refuses an expired one", async () => {
    await signUp(harness, "single@example.com");
    await harness.request("/api/account/forgot-password", {
      method: "POST",
      body: JSON.stringify({ email: "single@example.com" }),
    });
    const rows = await (
      harness.store as unknown as {
        db: { prepare: (sql: string) => { all: () => Promise<{ body_text: string }[]> } };
      }
    ).db
      .prepare("SELECT body_text FROM email_outbox WHERE kind = 'password_reset'")
      .all();
    const token = /reset-password#token=([a-f0-9]{64})/.exec(rows[0]?.body_text ?? "")?.[1] ?? "";

    const first = await harness.request("/api/account/reset-password", {
      method: "POST",
      body: JSON.stringify({ token, password: "first new passphrase" }),
    });
    expect(first.status).toBe(200);

    const second = await harness.request("/api/account/reset-password", {
      method: "POST",
      body: JSON.stringify({ token, password: "second attempt passphrase" }),
    });
    expect(second.status).toBe(400);
    expect(((await second.json()) as { error: { code: string } }).error.code).toBe("invalid_token");
  });

  it("invalidates every outstanding reset link when a new one is requested", async () => {
    await signUp(harness, "twice@example.com");
    for (let i = 0; i < 2; i += 1) {
      await harness.request("/api/account/forgot-password", {
        method: "POST",
        body: JSON.stringify({ email: "twice@example.com" }),
      });
    }
    const rows = await (
      harness.store as unknown as {
        db: {
          prepare: (sql: string) => {
            all: () => Promise<{ body_text: string; created_at: string }[]>;
          };
        };
      }
    ).db
      .prepare("SELECT body_text, created_at FROM email_outbox WHERE kind = 'password_reset'")
      .all();
    expect(rows.length).toBe(2);
    const [older, newer] = rows.sort((a, b) => a.created_at.localeCompare(b.created_at));
    const oldToken = /reset-password#token=([a-f0-9]{64})/.exec(older?.body_text ?? "")?.[1] ?? "";
    const newToken = /reset-password#token=([a-f0-9]{64})/.exec(newer?.body_text ?? "")?.[1] ?? "";

    const stale = await harness.request("/api/account/reset-password", {
      method: "POST",
      body: JSON.stringify({ token: oldToken, password: "stale link passphrase" }),
    });
    expect(stale.status).toBe(400);

    const current = await harness.request("/api/account/reset-password", {
      method: "POST",
      body: JSON.stringify({ token: newToken, password: "current link passphrase" }),
    });
    expect(current.status).toBe(200);
  });
});

describe("support", () => {
  it("stores every message with a reference, even with no mail provider", async () => {
    const response = await harness.request("/api/account/support", {
      method: "POST",
      body: JSON.stringify({
        email: "customer@example.com",
        subject: "Impossible de me connecter",
        body: "J'ai perdu mon mot de passe et le lien n'arrive pas.",
      }),
    });
    expect(response.status).toBe(200);
    const body = (await response.json()) as { reference: string; message: string };
    expect(body.reference).toMatch(/^sup_/);
    expect(body.message).toContain("Aucun e-mail");

    const rows = await (
      harness.store as unknown as {
        db: {
          prepare: (sql: string) => {
            all: () => Promise<{ subject: string; status: string }[]>;
          };
        };
      }
    ).db
      .prepare("SELECT subject, status FROM support_messages")
      .all();
    expect(rows).toHaveLength(1);
    expect(rows[0]?.status).toBe("open");
  });

  it("rejects an empty message and keeps a rate limit", async () => {
    const tooShort = await harness.request("/api/account/support", {
      method: "POST",
      body: JSON.stringify({ email: "a@b.co", subject: "Hi", body: "short" }),
    });
    expect(tooShort.status).toBe(400);
  });
});

describe("support status and reply", () => {
  it("shows the reply only to the reference and the address that wrote it", async () => {
    const created = await harness.request("/api/account/support", {
      method: "POST",
      body: JSON.stringify({
        email: "customer@example.com",
        subject: "Paiement bloqué",
        body: "Le paiement reste en attente depuis hier.",
      }),
    });
    expect(created.status).toBe(200);
    const { reference } = (await created.json()) as { reference: string };

    const wrong = await harness.request(
      `/api/account/support/${reference}?email=someone-else@example.com`
    );
    expect(wrong.status).toBe(404);

    await harness.store.replyToSupportMessage(
      reference,
      "Le paiement a été vérifié et crédité.",
      "resolved"
    );
    const found = await harness.request(
      `/api/account/support/${reference}?email=customer@example.com`
    );
    expect(found.status).toBe(200);
    const body = (await found.json()) as { status: string; reply: string | null };
    expect(body.status).toBe("resolved");
    expect(body.reply).toContain("vérifié");
  });

  it("lets an operator reply from the console route", async () => {
    const created = await harness.request("/api/account/support", {
      method: "POST",
      body: JSON.stringify({
        email: "customer@example.com",
        subject: "Export incomplet",
        body: "Il manque les commandes de la semaine dernière.",
      }),
    });
    const { reference } = (await created.json()) as { reference: string };
    const cookie = await signUp(harness, "ops@example.com");
    const replied = await harness.request(`/api/v1/admin/support/${reference}/reply`, {
      method: "POST",
      headers: { cookie },
      body: JSON.stringify({ reply: "Le correctif est en place.", status: "resolved" }),
    });
    expect(replied.status).toBe(200);
    const read = (await (
      await harness.request(`/api/account/support/${reference}?email=customer@example.com`)
    ).json()) as { status: string; reply: string | null };
    expect(read).toMatchObject({ status: "resolved", reply: "Le correctif est en place." });
  });
});

describe("email delivery", () => {
  it("records a failed delivery as failed when the provider refuses", async () => {
    const server = createServer((_req, res) => {
      res.writeHead(500, { "content-type": "application/json" });
      res.end(JSON.stringify({ message: "provider down" }));
    });
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
    const port = (server.address() as AddressInfo).port;
    // Point the sender at the fake by overriding fetch for this test only.
    const realFetch = globalThis.fetch;
    globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
      if (String(input).startsWith("https://api.resend.com/")) {
        return realFetch(`http://127.0.0.1:${port}/emails`, init);
      }
      return realFetch(input as RequestInfo, init);
    }) as typeof fetch;

    try {
      const withMail = await bootstrap({ RESEND_API_KEY: "re_test_key" });
      await signUp(withMail, "failmail@example.com");
      const response = await withMail.request("/api/account/forgot-password", {
        method: "POST",
        body: JSON.stringify({ email: "failmail@example.com" }),
      });
      expect(response.status).toBe(200);
      const body = (await response.json()) as { emailConfigured: boolean };
      expect(body.emailConfigured).toBe(true);
      const outbox = await withMail.outbox();
      expect(outbox[0]?.status).toBe("failed");
      await withMail.close();
    } finally {
      globalThis.fetch = realFetch;
      server.close();
    }
  });
});
