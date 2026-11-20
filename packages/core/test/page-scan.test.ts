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
    const result = await scanPage("https://example.com/", { fetchImpl: fetchOnce(PAGE) });
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
    const result = await scanPage("https://example.com/", { fetchImpl: fetchOnce(PAGE) });
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

    const result = await scanPage("https://shop.example/", { fetchImpl });
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
    const result = await scanPage("https://docs.example/", { fetchImpl: fetchOnce(docs) });
    expect(result.findings.find((item) => item.id === "journey_entry")?.status).toBe("SKIPPED");
    expect(result.findings.find((item) => item.id === "webhook_observability")?.status).toBe(
      "SKIPPED"
    );
    expect(result.modules.find((item) => item.module === "flow")?.verdict).not.toBe("pass");
  });

  it("judges a client-rendered shell without pretending to have seen the page", async () => {
    const shell = `<html><head><title>app</title></head><body><div id="root"></div><script src="/app.js"></script></body></html>`;
    const result = await scanPage("https://app.example/", { fetchImpl: fetchOnce(shell) });
    const rendered = result.findings.find((item) => item.id === "rendered_dom");
    expect(rendered?.status).toBe("SKIPPED");
    expect(result.clientRendered).toBe(true);
  });

  it("treats an error status as a finding, not a crash", async () => {
    const failing = (async () =>
      htmlResponse("<html><body>nope</body></html>", { status: 503 })) as unknown as typeof fetch;
    const result = await scanPage("https://example.com/", { fetchImpl: failing });
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

    await expect(scanPage("https://example.com/", { fetchImpl: bouncing })).rejects.toThrow();
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

    const result = await scanPage("https://example.com/", { fetchImpl: redirecting });
    expect(result.finalUrl).toBe("https://www.example.com/");
    expect(result.findings.find((item) => item.id === "hsts")?.status).toBe("PASS");
  });

  it("stops reading at the byte cap instead of pulling an unbounded body", async () => {
    const huge = `<html><body><p>${"x".repeat(5000)}</p></body></html>`;
    const result = await scanPage("https://example.com/", {
      fetchImpl: fetchOnce(huge),
      maxBytes: 500,
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
