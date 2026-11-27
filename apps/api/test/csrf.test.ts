import { describe, expect, it } from "vitest";
import { bootstrap } from "./harness.js";

/**
 * Double-submit CSRF on the account writes.
 *
 * The origin guard alone left one documented gap: a POST that sends neither `Origin`
 * nor `Sec-Fetch-Site` was accepted. Native clients need that door, so the sensitive
 * writes now also require the readable `ps_csrf` cookie to be echoed in
 * `x-csrf-token`. A cross-site attacker cannot read the cookie, so the forged write
 * arrives without a matching header. The guard is presence-triggered: a session that
 * never received `ps_csrf` (CLI, machine, pre-rollout session) keeps working through
 * the origin check alone.
 */

function setCookiePairs(response: Response): string[] {
  const headers = response.headers as Headers & { getSetCookie?: () => string[] };
  const raw =
    headers.getSetCookie?.() ??
    (response.headers.get("set-cookie") ? [response.headers.get("set-cookie") as string] : []);
  return raw
    .flatMap((value) => value.split(/,(?=\s*ps_)/))
    .map((value) => value.split(";")[0]?.trim() ?? "")
    .filter(Boolean);
}

function cookieValue(pairs: string[], name: string): string | undefined {
  const pair = pairs.find((value) => value.startsWith(`${name}=`));
  return pair?.slice(name.length + 1);
}

async function signUpWithCsrf() {
  const h = await bootstrap();
  const response = await h.request("/api/auth/sign-up/email", {
    method: "POST",
    body: JSON.stringify({
      email: "csrf@example.com",
      password: "correct horse battery",
      name: "Ada Lovelace",
      workspace: "Csrf",
    }),
  });
  expect(response.status).toBe(201);
  const headers = response.headers as Headers & { getSetCookie?: () => string[] };
  const rawCookies = headers.getSetCookie?.() ?? [];
  const pairs = setCookiePairs(response);
  const session = cookieValue(pairs, "ps_session");
  const csrf = cookieValue(pairs, "ps_csrf");
  expect(session).toBeTruthy();
  expect(csrf).toBeTruthy();
  return {
    h,
    pairs,
    rawCookies,
    session: session as string,
    csrf: csrf as string,
  };
}

describe("CSRF double-submit on account writes", () => {
  it("signs up with an HttpOnly session cookie and a readable CSRF cookie", async () => {
    const { h, rawCookies, session, csrf } = await signUpWithCsrf();
    const sessionCookie = rawCookies.find((value) => value.startsWith("ps_session=")) ?? "";
    const csrfCookie = rawCookies.find((value) => value.startsWith("ps_csrf=")) ?? "";
    expect(sessionCookie).toContain("HttpOnly");
    expect(csrfCookie).not.toContain("HttpOnly");
    expect(csrfCookie).toContain("SameSite=Lax");
    const probe = await h.request("/api/auth/session", {
      headers: { cookie: `ps_session=${session}; ps_csrf=${csrf}` },
    });
    expect(probe.status).toBe(200);
    // The probe does not replace an existing CSRF cookie; it only issues one when absent.
    expect(probe.headers.getSetCookie?.() ?? []).toHaveLength(0);
  });

  it("refuses an account write that has both cookies but no token", async () => {
    const { h, session, csrf } = await signUpWithCsrf();
    const response = await h.request("/api/account/password", {
      method: "POST",
      headers: { cookie: `ps_session=${session}; ps_csrf=${csrf}` },
      body: JSON.stringify({
        currentPassword: "correct horse battery",
        newPassword: "another horse battery",
      }),
    });
    expect(response.status).toBe(403);
    const body = (await response.json()) as { error: { code: string } };
    expect(body.error.code).toBe("csrf_token_required");
  });

  it("refuses a token that does not match the cookie", async () => {
    const { h, session, csrf } = await signUpWithCsrf();
    const response = await h.request("/api/auth/sign-out", {
      method: "POST",
      headers: {
        cookie: `ps_session=${session}; ps_csrf=${csrf}`,
        "x-csrf-token": "not-the-token",
      },
      body: JSON.stringify({}),
    });
    expect(response.status).toBe(403);
    const body = (await response.json()) as { error: { code: string } };
    expect(body.error.code).toBe("csrf_token_invalid");
  });

  it("accepts the matching token and ends the session", async () => {
    const { h, session, csrf } = await signUpWithCsrf();
    const response = await h.request("/api/auth/sign-out", {
      method: "POST",
      headers: {
        cookie: `ps_session=${session}; ps_csrf=${csrf}`,
        "x-csrf-token": csrf,
      },
      body: JSON.stringify({}),
    });
    expect(response.status).toBe(200);
    const cleared = (response.headers.getSetCookie?.() ?? []).join(" ");
    expect(cleared).toContain("ps_session=");
    expect(cleared).toContain("ps_csrf=");
  });

  it("keeps a session alive when it never received a CSRF cookie", async () => {
    const { h, session } = await signUpWithCsrf();
    const probe = await h.request("/api/auth/session", {
      headers: { cookie: `ps_session=${session}` },
    });
    expect(probe.status).toBe(200);
    const issued = (probe.headers.getSetCookie?.() ?? []).join(" ");
    expect(issued).toContain("ps_csrf=");

    const signout = await h.request("/api/auth/sign-out", {
      method: "POST",
      headers: { cookie: `ps_session=${session}` },
      body: JSON.stringify({}),
    });
    expect(signout.status).toBe(200);
  });

  it("refuses a cross-site write even with a matching token", async () => {
    const { h, session, csrf } = await signUpWithCsrf();
    const response = await h.request("/api/auth/sign-out", {
      method: "POST",
      headers: {
        cookie: `ps_session=${session}; ps_csrf=${csrf}`,
        "x-csrf-token": csrf,
        "sec-fetch-site": "cross-site",
      },
      body: JSON.stringify({}),
    });
    expect(response.status).toBe(403);
    const body = (await response.json()) as { error: { code: string } };
    expect(body.error.code).toBe("cross_site_write");
  });
});
