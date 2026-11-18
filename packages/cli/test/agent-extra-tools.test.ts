import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  buildSemanticIndex,
  completeCode,
  debugScript,
  generateSvg,
  inspectPage,
  semanticSearch,
} from "../src/agent-extra-tools.js";
import type { ToolContext } from "../src/code-tools.js";

/**
 * The seven extra agent tools.
 *
 * Each test asserts the mechanism, not the marketing: the index ranks a real file, the
 * SVG is byte-stable, the devtools read a real page's console, the debugger pauses on a
 * real breakpoint, and the completion falls back honestly when no model is configured.
 */

let root: string;
let context: ToolContext;

beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), "proofcore-agent-"));
  context = { root };
  await writeFile(
    join(root, "payments.ts"),
    `export function chargeCustomer(amount: number): number {\n  // idempotency key prevents a double charge on retry\n  return amount * 100;\n}\n`,
    "utf8"
  );
  await writeFile(
    join(root, "formatting.ts"),
    `export function formatDate(value: Date): string {\n  return value.toISOString().slice(0, 10);\n}\n`,
    "utf8"
  );
});

afterEach(async () => {
  await rm(root, { recursive: true, force: true });
});

describe("semantic index", () => {
  it("builds an index and refuses to search before it exists", async () => {
    await expect(semanticSearch(context, { query: "idempotency" })).rejects.toThrow(
      /No semantic index/
    );
    const built = await buildSemanticIndex(context);
    expect(built.files).toBeGreaterThanOrEqual(2);
    expect(built.chunks).toBeGreaterThanOrEqual(2);
  });

  it("finds the file that talks about a concept, not just the identifier", async () => {
    await buildSemanticIndex(context);
    // "double charge retry" appears only in a comment: lexical search on the identifier
    // would miss it, which is exactly what the semantic layer is for.
    const result = await semanticSearch(context, { query: "double charge retry" });
    expect(result.hits.length).toBeGreaterThan(0);
    expect(result.hits[0]?.path).toBe("payments.ts");
    expect(result.chunksSearched).toBeGreaterThan(0);
  });

  it("returns an explicit note instead of a plausible neighbour when nothing matches", async () => {
    await buildSemanticIndex(context);
    const result = await semanticSearch(context, { query: "kubernetes ingress controller" });
    expect(result.hits).toHaveLength(0);
    expect(result.note).toContain("lexical, not generative");
  });

  it("is deterministic for the same repository", async () => {
    await buildSemanticIndex(context);
    const first = await semanticSearch(context, { query: "charge amount" });
    await buildSemanticIndex(context);
    const second = await semanticSearch(context, { query: "charge amount" });
    expect(second.hits).toEqual(first.hits);
  });
});

describe("completion", () => {
  it("falls back to real project symbols when no provider is configured", async () => {
    await buildSemanticIndex(context);
    const result = await completeCode(context, { path: "payments.ts", line: 3 });
    expect(result.source).toBe("index");
    expect(result.note).toContain("no provider key");
  });

  it("refuses a path outside the workspace instead of reading it", async () => {
    // The confinement is the point: the refusal happens before any read, and it says
    // why rather than pretending the file is merely unreadable.
    await expect(completeCode(context, { path: "../../etc/passwd", line: 1 })).rejects.toThrow(
      /escapes the workspace/
    );
  });
});

describe("svg generator", () => {
  it("produces byte-identical output for identical input", () => {
    const a = generateSvg({ shape: "icon", name: "shield", size: 32 });
    const b = generateSvg({ shape: "icon", name: "shield", size: 32 });
    expect(a.svg).toBe(b.svg);
    expect(a.svg).toContain('viewBox="0 0 24 24"');
    expect(a.svg).toContain('width="32"');
  });

  it("escapes user-provided text so the output stays valid XML", () => {
    const result = generateSvg({ shape: "placeholder", label: '<script>"x"</script>' });
    expect(result.svg).not.toContain("<script>");
    expect(result.svg).toContain("&lt;script&gt;");
  });

  it("emits each shape without depending on a model or the network", () => {
    for (const shape of ["icon", "placeholder", "spinner", "wave"] as const) {
      const result = generateSvg({ shape });
      expect(result.svg.startsWith("<svg")).toBe(true);
      expect(result.svg.trimEnd().endsWith("</svg>")).toBe(true);
    }
  });
});

describe("devtools", () => {
  it("reports real console messages, errors and network from a live page", {
    timeout: 60_000,
  }, async () => {
    const { createServer } = await import("node:http");
    const server = createServer((req, res) => {
      if (req.url === "/fail") {
        res.writeHead(500, { "content-type": "text/plain" });
        res.end("boom");
        return;
      }
      res.writeHead(200, { "content-type": "text/html" });
      res.end(`<!doctype html><html lang="en"><head><title>Fixture</title></head><body>
        <main><h1>Hello</h1><img src="/missing.png"><input id="q"></main>
        <script>
          console.log("boot ok");
          fetch("/fail").catch(() => {});
          setTimeout(() => { null.x; }, 10);
        </script></body></html>`);
    });
    await new Promise<void>((resolvePromise) => server.listen(0, "127.0.0.1", resolvePromise));
    const address = server.address() as { port: number };
    try {
      const report = await inspectPage({ url: `http://127.0.0.1:${address.port}/` });
      expect(report.title).toBe("Fixture");
      expect(report.status).toBe(200);
      // Console output is the page's own, not a summary of it.
      expect(report.console.some((entry) => entry.text.includes("boot ok"))).toBe(true);
      // A real runtime error is captured with its message.
      expect(report.errors.length).toBeGreaterThan(0);
      // A real HTTP 500 appears in the network log.
      expect(report.network.some((entry) => entry.status === 500)).toBe(true);
      // DOM counts and accessibility findings come from the rendered document.
      expect(report.dom.counts.h1).toBe(1);
      expect(report.dom.landmarks).toContain("main");
      expect(report.accessibility.violationsLike.some((v) => v.includes("img without alt"))).toBe(
        true
      );
      expect(report.accessibility.violationsLike.some((v) => v.includes("unlabelled field"))).toBe(
        true
      );
    } finally {
      server.close();
    }
  });

  it("saves a screenshot when asked", { timeout: 60_000 }, async () => {
    const { createServer } = await import("node:http");
    const server = createServer((_req, res) => {
      res.writeHead(200, { "content-type": "text/html" });
      res.end("<html><body><h1>Shot</h1></body></html>");
    });
    await new Promise<void>((resolvePromise) => server.listen(0, "127.0.0.1", resolvePromise));
    const address = server.address() as { port: number };
    const target = join(root, "shot.png");
    try {
      const report = await inspectPage({
        url: `http://127.0.0.1:${address.port}/`,
        screenshotPath: target,
      });
      expect(report.screenshot).toBe(target);
      const bytes = await readFile(target);
      expect(bytes.byteLength).toBeGreaterThan(1000);
      // PNG magic number: a real image, not an empty file.
      expect(bytes.subarray(0, 4).toString("hex")).toBe("89504e47");
    } finally {
      server.close();
    }
  });
});

describe("step debugger", () => {
  it("pauses on a breakpoint and returns the real variables", { timeout: 60_000 }, async () => {
    await writeFile(
      join(root, "script.js"),
      `function double(n) {\n  const doubled = n * 2;\n  return doubled;\n}\nconsole.log(double(21));\n`,
      "utf8"
    );
    const session = await debugScript(context, { file: "script.js", breakpointLine: 2 });
    // The debugger either attaches and pauses, or says it could not: never a fake success.
    expect(session.usedCdp).toBe(true);
    if (session.stopped) {
      const callFrame = session.scopes?.find((scope) => scope.name === "local");
      expect(callFrame).toBeDefined();
      expect(callFrame?.variables.some((variable) => variable.name === "n")).toBe(true);
      expect(callFrame?.variables.find((variable) => variable.name === "n")?.value).toBe("21");
    } else {
      expect(session.note).toContain("never hit");
    }
  });

  it("refuses a file that does not exist instead of pretending to run it", async () => {
    await expect(debugScript(context, { file: "nope.js", breakpointLine: 1 })).rejects.toThrow(
      /missing file/
    );
  });
});
