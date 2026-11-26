import { describe, expect, it } from "vitest";
import { cleanFindings } from "../src/checks.js";

/**
 * CLEAN module tests.
 *
 * Two behaviours are load-bearing: a client-rendered shell must be *not measured*, and an
 * input with an id but no label must not count as labelled. Both used to be ways a page
 * could look clean without being usable.
 */

const PAGE = `<!doctype html>
<html lang="fr">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>Studio Kora — paiement</title>
  <meta name="description" content="Boutique de vêtements à Cotonou.">
</head>
<body>
  <header><nav>menu</nav></header>
  <main>
    <h1>Boubou</h1>
    <img src="/a.png" alt="Boubou brodé">
    <form><input type="tel" name="phone" aria-label="Téléphone"></form>
  </main>
  <footer>© Studio Kora</footer>
</body>
</html>`;

const run = (html: string, text = "Boubou", bytes = 4096) => cleanFindings({ html, text, bytes });
const statusOf = (findings: ReturnType<typeof run>, id: string) =>
  findings.find((item) => item.id === id)?.status;

describe("CLEAN", () => {
  it("recognises a well-formed page", () => {
    const findings = run(PAGE);
    for (const id of [
      "html_lang",
      "title",
      "meta_description",
      "viewport",
      "landmarks",
      "headings",
    ]) {
      expect(statusOf(findings, id), id).toBe("PASS");
    }
    expect(statusOf(findings, "image_alt")).toBe("PASS");
    expect(statusOf(findings, "field_labels")).toBe("PASS");
    expect(statusOf(findings, "rendered_dom")).toBe("PASS");
  });

  it("does not measure the interface of a client-rendered shell", () => {
    const shell = `<html lang="en"><head><title>app</title>
      <meta name="viewport" content="width=device-width"><meta name="description" content="An app">
      </head><body><div id="root"></div><script src="/app.js"></script></body></html>`;
    const findings = run(shell, "app");
    for (const id of ["landmarks", "headings", "image_alt", "field_labels", "rendered_dom"]) {
      expect(statusOf(findings, id), id).toBe("SKIPPED");
    }
    // The metadata is real and stays measured, even on a shell.
    expect(statusOf(findings, "html_lang")).toBe("PASS");
    expect(statusOf(findings, "viewport")).toBe("PASS");
  });

  it("does not count a bare id as an accessible label", () => {
    const html = `<html lang="en"><head><title>Form</title></head><body><main><h1>Form</h1>
      <input id="email" name="email"><label for="phone">Phone</label><input id="phone" name="phone">
      </main></body></html>`;
    const labels = run(html).find((item) => item.id === "field_labels");
    expect(labels?.observed).toBe("1 of 2 unlabelled");
    expect(labels?.status).toBe("WARN");
  });

  it("fails a missing language and warns on a second h1", () => {
    const html = `<html><head><title>x</title></head><body><main><h1>one</h1><h1>two</h1></main></body></html>`;
    const findings = run(html);
    expect(statusOf(findings, "html_lang")).toBe("FAIL");
    expect(statusOf(findings, "headings")).toBe("WARN");
  });

  it("skips alt text when the page has no images", () => {
    const findings = run("<html lang='fr'><body><main><h1>x</h1></main></body></html>");
    expect(statusOf(findings, "image_alt")).toBe("SKIPPED");
    expect(findings.find((item) => item.id === "image_alt")?.observed).toBe("no images");
  });

  it("flags an oversized HTML document", () => {
    const findings = run(PAGE, "Boubou", 700_000);
    expect(statusOf(findings, "html_weight")).toBe("FAIL");
  });

  it("only ever emits findings attributed to clean", () => {
    expect(new Set(run(PAGE).map((item) => item.module))).toEqual(new Set(["clean"]));
  });
});
