import { describe, expect, it } from "vitest";
import { assertScannableUrl, scanPage, visibleText } from "../src/page-scan.js";

/**
 * The page scan.
 *
 * Two things are worth testing here and nothing else needs a browser to be wrong: the
 * address guard (a server-side scan that follows a redirect to the cloud metadata endpoint
 * is a vulnerability, not a feature) and the honesty of the findings (a check that could not
 * be measured must never read as a pass).
 */

const PAGE = `<!doctype html>
<html lang="fr">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>Studio Kora — paiement</title>
  <meta name="description" content="Boutique de vêtements à Cotonou.">
  <link rel="alternate" hreflang="en" href="https://example.com/en">
  <script type="application/ld+json">{"@type":"Product","name":"Boubou"}</script>
</head>
<body dir="rtl">
  <header><nav>menu</nav></header>
  <main>
    <h1>Boubou</h1>
    <img src="/a.png" alt="Boubou brodé">
    <p>Commande du 12/31/2024, livraison 31.12.2024</p>
    <p>12 500 FCFA · $24.99</p>
    <form><input type="tel" name="phone"><input type="email" name="email" aria-label="Email"></form>
    <a href="/exports/orders.csv" download>Exporter les commandes</a>
  </main>
  <footer>© Studio Kora</footer>
</body>
</html>`;

function htmlResponse(
  html: string,
  init: { status?: number; headers?: Record<string, string> } = {}
) {
  return new Response(html, {
    status: init.status ?? 200,
    headers: { "content-type": "text/html; charset=utf-8", ...init.headers },
  });
}

const fetchOnce = (html: string, headers: Record<string, string> = {}) =>
  (async () => htmlResponse(html, { headers })) as unknown as typeof fetch;

describe("assertScannableUrl", () => {
  it("accepts a public https URL", () => {
    expect(assertScannableUrl("https://example.com/a?b=1").hostname).toBe("example.com");
  });

  it("refuses every shape of internal address by default", () => {
    const refused = [
      "http://localhost:3000",
      "http://127.0.0.1:8787",
      "http://10.0.0.5",
      "http://172.16.4.4",
      "http://192.168.1.10",
      "http://169.254.169.254/latest/meta-data/",
      "http://[::1]:8080",
      "http://metadata.google.internal/",
      "http://intranet",
      "file:///etc/passwd",
    ];
    for (const candidate of refused) {
      expect(() => assertScannableUrl(candidate), candidate).toThrow();
    }
  });

  it("allows them when the caller opts in, which is what the local CLI does", () => {
    expect(assertScannableUrl("http://localhost:3000", { allowPrivate: true }).port).toBe("3000");
    expect(assertScannableUrl("http://192.168.1.10", { allowPrivate: true }).hostname).toBe(
      "192.168.1.10"
    );
  });
});

describe("scanPage", () => {
  it("reports each family with counts, and never invents a pass", async () => {
    const result = await scanPage("https://example.com/", {
      fetchImpl: fetchOnce(PAGE),
      ownershipHint: "local",
    });
    const byModule = Object.fromEntries(result.modules.map((item) => [item.module, item]));
    expect(Object.keys(byModule).sort()).toEqual(["clean", "exit", "fail", "flow", "world"]);

    // No HSTS on this response: a real failure, not a silent pass.
    const hsts = result.findings.find((item) => item.id === "hsts");
    expect(hsts?.status).toBe("FAIL");

    // The document does the right things, and that is recognised.
    expect(result.findings.find((item) => item.id === "html_lang")?.status).toBe("PASS");
    expect(result.findings.find((item) => item.id === "hreflang")?.status).toBe("PASS");
    expect(result.findings.find((item) => item.id === "export_affordances")?.status).toBe("PASS");
    expect(result.findings.find((item) => item.id === "structured_data")?.status).toBe("PASS");

    // And the things that are genuinely wrong are reported, not softened.
    expect(result.findings.find((item) => item.id === "ambiguous_dates")?.status).toBe("WARN");
    expect(result.findings.find((item) => item.id === "price_format")?.status).toBe("WARN");
    expect(byModule.fail?.verdict).toBe("fail");
    expect(byModule.clean?.score).toBeGreaterThan(0);
  });

  it("marks a check it could not measure as SKIPPED rather than PASS", async () => {
    const result = await scanPage("https://example.com/", {
      fetchImpl: fetchOnce(PAGE),
      ownershipHint: "local",
    });
    // No Set-Cookie on this response, so cookie flags cannot be judged either way.
    const cookies = result.findings.find((item) => item.id === "cookie_flags");
    expect(cookies?.status).toBe("SKIPPED");
    expect(cookies?.observed).toContain("no cookie");
  });

  it("finds the checkout entry point, probes it, and reports what it answered", async () => {
    const shop = `<html lang="fr"><head><title>Boutique</title></head><body><main>
      <a href="/panier">Panier</a>
      <form action="/checkout"><input name="csrf_token" value="x"></form>
      <script src="https://js.stripe.com/v3"></script>
      <a href="/remboursement">Remboursement</a>
    </main></body></html>`;
    const seen: string[] = [];
    const fetchImpl = (async (input: string | URL | Request) => {
      const target = String(input);
      seen.push(target);
      if (target.endsWith("/panier")) return new Response("ok", { status: 200 });
      return htmlResponse(shop);
    }) as unknown as typeof fetch;

    // The owner's view: a local scan needs no proof, and the detail is what makes this
    // assertion meaningful.
    const result = await scanPage("https://shop.example/", {
      fetchImpl,
      ownershipHint: "local",
    });
    expect(result.findings.find((item) => item.id === "journey_entry")?.status).toBe("PASS");
    expect(result.findings.find((item) => item.id === "journey_reachable")).toMatchObject({
      status: "PASS",
      observed: expect.stringContaining("HTTP 200"),
    });
    expect(result.findings.find((item) => item.id === "payment_methods")?.observed).toContain(
      "Stripe"
    );
    expect(result.findings.find((item) => item.id === "journey_csrf")?.status).toBe("PASS");
    expect(result.findings.find((item) => item.id === "refund_path")?.status).toBe("PASS");
    // The probe happens once, and it is the entry point that was followed.
    expect(seen.filter((item) => item.endsWith("/panier"))).toHaveLength(1);
    expect(result.probes).toEqual([{ url: "https://shop.example/panier", status: 200 }]);
  });

  it("fails the journey when the entry point answers an error", async () => {
    const shop = `<html lang="fr"><body><main><a href="/checkout">Commander</a></main></body></html>`;
    const fetchImpl = (async (input: string | URL | Request) => {
      if (String(input).endsWith("/checkout")) return new Response("boom", { status: 500 });
      return htmlResponse(shop);
    }) as unknown as typeof fetch;

    const result = await scanPage("https://shop.example/", { fetchImpl });
    expect(result.findings.find((item) => item.id === "journey_reachable")?.status).toBe("FAIL");
    expect(result.modules.find((item) => item.module === "flow")?.verdict).toBe("fail");
  });

  it("says a page has no journey rather than marking it green", async () => {
    const docs = `<html lang="fr"><head><title>Docs</title></head><body><main><h1>Docs</h1></main></body></html>`;
    const result = await scanPage("https://docs.example/", {
      fetchImpl: fetchOnce(docs),
      ownershipHint: "local",
    });
    expect(result.findings.find((item) => item.id === "journey_entry")?.status).toBe("SKIPPED");
    expect(result.findings.find((item) => item.id === "webhook_observability")?.status).toBe(
      "SKIPPED"
    );
    expect(result.modules.find((item) => item.module === "flow")?.verdict).not.toBe("pass");
  });

  it("withholds the exact locations of a remote site nobody has proven they own", async () => {
    const shop = `<html lang="fr"><head><title>Boutique</title></head><body><main>
      <a href="/panier">Panier</a>
    </main></body></html>`;
    const fetchImpl = (async (input: string | URL | Request) => {
      if (String(input).endsWith("/panier")) return new Response("missing", { status: 404 });
      return htmlResponse(shop);
    }) as unknown as typeof fetch;

    const result = await scanPage("https://shop.example/", { fetchImpl });
    expect(result.ownership).toBe("unverified");
    expect(result.redacted).toBe(true);
    const serialised = JSON.stringify(result.findings);
    // The customer learns that the journey is broken; not where to aim.
    expect(serialised).not.toContain("/panier");
    expect(serialised).not.toContain("HTTP 404");
    expect(result.probes).toEqual([{ url: "shop.example", status: 404 }]);
    const entry = result.findings.find((item) => item.id === "journey_entry");
    expect(entry?.status).toBe("PASS");
    expect(entry?.observed).toContain("withheld");
  });

  it("returns the exact locations when the owner proves the site with the token", async () => {
    const token = "pc_verify_token";
    const page = `<html lang="fr"><head><title>Boutique</title>
      <meta name="proofcore-verification" content="${token}"></head>
      <body><main><a href="/panier">Panier</a></main></body></html>`;
    const fetchImpl = (async () => htmlResponse(page)) as unknown as typeof fetch;

    const result = await scanPage("https://shop.example/", { fetchImpl, ownershipToken: token });
    expect(result.ownership).toBe("verified");
    expect(result.redacted).toBe(false);
    expect(result.verification).toEqual({ tokenProvided: true, found: true, where: "meta" });
    expect(JSON.stringify(result.findings)).toContain("/panier");
  });

  it("keeps a wrong token unverified, and says the file was checked", async () => {
    const page = `<html lang="fr"><head><title>Boutique</title></head><body><main><a href="/panier">Panier</a></main></body></html>`;
    const fetchImpl = (async (input: string | URL | Request) => {
      if (String(input).includes("/.well-known/proofcore-verification.txt")) {
        return new Response("another-token", { status: 200 });
      }
      return htmlResponse(page);
    }) as unknown as typeof fetch;

    const result = await scanPage("https://shop.example/", { fetchImpl, ownershipToken: "wrong" });
    expect(result.ownership).toBe("unverified");
    expect(result.verification.found).toBe(false);
    expect(result.redacted).toBe(true);
  });

  it("signs in with the given credentials, and never lets them into the report", async () => {
    const password = "s3cret-site-password";
    const requests: { url: string; body?: string; cookie?: string }[] = [];
    const fetchImpl = (async (input: string | URL | Request, init?: RequestInit) => {
      const url = String(input);
      const headers = (init?.headers ?? {}) as Record<string, string>;
      requests.push({
        url,
        ...(init?.body ? { body: String(init.body) } : {}),
        ...(headers.cookie ? { cookie: headers.cookie } : {}),
      });
      if (url.endsWith("/api/login")) {
        return new Response("{}", {
          status: 200,
          headers: {
            "set-cookie": "session=abc123; Path=/; HttpOnly",
            "content-type": "application/json",
          },
        });
      }
      return htmlResponse(
        `<html lang="fr"><head><title>Espace client</title></head><body><main><h1>Compte</h1></main></body></html>`
      );
    }) as unknown as typeof fetch;

    const result = await scanPage("https://shop.example/", {
      fetchImpl,
      ownershipHint: "local",
      login: { url: "https://shop.example/api/login", email: "audit@shop.example", password },
    });

    expect(result.login).toEqual({ attempted: true, ok: true, status: 200 });
    const login = requests.find((item) => item.url.endsWith("/api/login"));
    expect(JSON.parse(login?.body ?? "{}")).toEqual({
      email: "audit@shop.example",
      password,
    });
    const page = requests.find((item) => item.url === "https://shop.example/");
    expect(page?.cookie).toBe("session=abc123");
    expect(JSON.stringify(result)).not.toContain(password);
    expect(JSON.stringify(result)).not.toContain("abc123");
  });

  it("does not call a login that set no cookie a success", async () => {
    const fetchImpl = (async (input: string | URL | Request) => {
      if (String(input).endsWith("/login")) return new Response("ok", { status: 200 });
      return htmlResponse(`<html lang="fr"><body><main><h1>x</h1></main></body></html>`);
    }) as unknown as typeof fetch;

    const result = await scanPage("https://shop.example/", {
      fetchImpl,
      ownershipHint: "local",
      login: { url: "https://shop.example/login", email: "a@b.co", password: "pw" },
    });
    expect(result.login?.ok).toBe(false);
    expect(result.login?.reason).toContain("no cookie");
  });

  it("judges a client-rendered shell without pretending to have seen the page", async () => {
    const shell = `<html><head><title>app</title></head><body><div id="root"></div><script src="/app.js"></script></body></html>`;
    const result = await scanPage("https://app.example/", {
      fetchImpl: fetchOnce(shell),
      ownershipHint: "local",
    });
    const rendered = result.findings.find((item) => item.id === "rendered_dom");
    expect(rendered?.status).toBe("SKIPPED");
    expect(result.clientRendered).toBe(true);
  });

  it("treats an error status as a finding, not a crash", async () => {
    const failing = (async () =>
      htmlResponse("<html><body>nope</body></html>", { status: 503 })) as unknown as typeof fetch;
    const result = await scanPage("https://example.com/", {
      fetchImpl: failing,
      ownershipHint: "local",
    });
    expect(result.status).toBe(503);
    expect(result.findings[0]).toMatchObject({ id: "http_status", status: "FAIL" });
  });

  it("validates every redirect hop, so a public URL cannot bounce to 169.254.169.254", async () => {
    const bouncing = (async (input: string | URL | Request) => {
      const target = String(input);
      if (target.startsWith("https://example.com")) {
        return new Response(null, {
          status: 302,
          headers: { location: "http://169.254.169.254/latest/meta-data/" },
        });
      }
      return htmlResponse("<html><body>metadata</body></html>");
    }) as unknown as typeof fetch;

    await expect(
      scanPage("https://example.com/", { fetchImpl: bouncing, ownershipHint: "local" })
    ).rejects.toThrow();
  });

  it("follows a redirect that stays public, and reports the final address", async () => {
    const redirecting = (async (input: string | URL | Request) => {
      const target = String(input);
      if (target === "https://example.com/") {
        return new Response(null, {
          status: 301,
          headers: { location: "https://www.example.com/" },
        });
      }
      return htmlResponse(PAGE, { headers: { "strict-transport-security": "max-age=31536000" } });
    }) as unknown as typeof fetch;

    const result = await scanPage("https://example.com/", {
      fetchImpl: redirecting,
      ownershipHint: "local",
    });
    expect(result.finalUrl).toBe("https://www.example.com/");
    expect(result.findings.find((item) => item.id === "hsts")?.status).toBe("PASS");
  });

  it("stops reading at the byte cap instead of pulling an unbounded body", async () => {
    const huge = `<html><body><p>${"x".repeat(5000)}</p></body></html>`;
    const result = await scanPage("https://example.com/", {
      fetchImpl: fetchOnce(huge),
      maxBytes: 500,
      ownershipHint: "local",
    });
    expect(result.bytes).toBeLessThanOrEqual(500);
  });

  it("sends the caller's headers, for a page behind a login", async () => {
    let seen: Record<string, string> = {};
    const capturing = (async (_input: string | URL | Request, init?: RequestInit) => {
      seen = init?.headers as Record<string, string>;
      return htmlResponse(PAGE);
    }) as unknown as typeof fetch;

    await scanPage("https://example.com/", {
      fetchImpl: capturing,
      headers: { cookie: "session=abc", authorization: "Bearer t" },
      ownershipHint: "local",
    });
    expect(seen.cookie).toBe("session=abc");
    expect(seen.authorization).toBe("Bearer t");
  });
});

describe("visibleText", () => {
  it("strips tags and scripts and decodes entities", () => {
    const text = visibleText(
      "<style>p{color:red}</style><p>Prix&nbsp;: 12 &amp; 5 &lt;ok&gt;</p><script>x()</script>"
    );
    expect(text).toBe("Prix : 12 & 5 <ok>");
  });
});
