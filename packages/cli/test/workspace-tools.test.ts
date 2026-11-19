import { mkdtemp, readFile, writeFile } from "node:fs/promises";
import { createServer } from "node:http";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { browsers, findChromium } from "@proofcore/adapter-browser";
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { webFetch } from "../src/browser-tools.js";
import {
  copyPath,
  deletePath,
  editFile,
  makeDirectory,
  movePath,
  pathInfo,
} from "../src/fs-tools.js";
import { httpRequest } from "../src/net-tools.js";

/**
 * The tools added for filesystem work beyond whole-file writes, HTTP and the page reader.
 * Each test asserts the contract the agent relies on: a dry run changes nothing, an exact
 * edit refuses ambiguity, and a network answer is the server's real response.
 */

let dir: string;

beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), "proofcore-tools-"));
  await writeFile(
    join(dir, "app.ts"),
    "const port = 3000;\nexport function start() {\n  return port;\n}\n",
    "utf8"
  );
});

afterAll(async () => {
  await browsers.dispose();
});

describe("edit_file", () => {
  it("returns a diff and writes nothing without apply", async () => {
    const result = await editFile(
      { root: dir },
      { path: "app.ts", oldString: "const port = 3000;", newString: "const port = 4000;" }
    );
    expect(result.applied).toBe(false);
    expect(result.diff).toContain("-const port = 3000;");
    expect(result.diff).toContain("+const port = 4000;");
    expect(await readFile(join(dir, "app.ts"), "utf8")).toContain("3000");
  });

  it("applies an exact edit", async () => {
    const result = await editFile(
      { root: dir },
      {
        path: "app.ts",
        oldString: "return port;",
        newString: "return Math.max(port, 1024);",
        apply: true,
      }
    );
    expect(result.applied).toBe(true);
    expect(await readFile(join(dir, "app.ts"), "utf8")).toContain("Math.max(port, 1024)");
  });

  it("refuses an ambiguous match and names the lines", async () => {
    await writeFile(join(dir, "dup.ts"), "same\nsame\n", "utf8");
    await expect(
      editFile({ root: dir }, { path: "dup.ts", oldString: "same", newString: "other" })
    ).rejects.toThrow(/2 occurrences.*lines 1, 2/);
  });

  it("refuses text that is not in the file", async () => {
    await expect(
      editFile({ root: dir }, { path: "app.ts", oldString: "not here", newString: "x" })
    ).rejects.toThrow(/not found/);
  });
});

describe("filesystem operations", () => {
  it("previews a recursive delete, then performs it", async () => {
    await makeDirectory({ root: dir }, { path: "generated/nested" });
    await writeFile(join(dir, "generated/nested/out.txt"), "x", "utf8");

    const preview = await deletePath({ root: dir }, { path: "generated", recursive: true });
    expect(preview.applied).toBe(false);
    expect(preview.removed).toContain("generated/nested/out.txt");
    expect(await pathInfo({ root: dir }, { path: "generated" })).toMatchObject({
      type: "directory",
    });

    await deletePath({ root: dir }, { path: "generated", recursive: true, apply: true });
    await expect(pathInfo({ root: dir }, { path: "generated" })).rejects.toThrow(/No such path/);
  });

  it("does not delete a non-empty directory without recursive", async () => {
    await makeDirectory({ root: dir }, { path: "keep" });
    await writeFile(join(dir, "keep/a.txt"), "x", "utf8");
    await expect(deletePath({ root: dir }, { path: "keep" })).rejects.toThrow(/non-empty/);
  });

  it("moves and copies with an explicit destination", async () => {
    const move = await movePath({ root: dir }, { from: "app.ts", to: "src/app.ts", apply: true });
    expect(move.applied).toBe(true);
    const copy = await copyPath(
      { root: dir },
      { from: "src/app.ts", to: "src/copy.ts", apply: true }
    );
    expect(copy.applied).toBe(true);
    expect(await readFile(join(dir, "src/copy.ts"), "utf8")).toContain("const port");
  });

  it("reports size, lines and a hash", async () => {
    const info = await pathInfo({ root: dir }, { path: "app.ts" });
    expect(info.lines).toBe(5);
    expect(info.sha256).toMatch(/^[a-f0-9]{64}$/);
  });

  it("refuses to escape the workspace", async () => {
    await expect(pathInfo({ root: dir }, { path: "../secret" })).rejects.toThrow(
      /escapes the workspace/
    );
  });
});

describe("http_request", () => {
  it("sends a method, a JSON body and reports the real response", async () => {
    const server = createServer((request, response) => {
      let body = "";
      request.on("data", (chunk) => {
        body += chunk;
      });
      request.on("end", () => {
        response.setHeader("content-type", "application/json");
        response.end(JSON.stringify({ method: request.method, received: body }));
      });
    });
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", () => resolve()));
    const address = server.address();
    const port = typeof address === "object" && address ? address.port : 0;
    try {
      const result = await httpRequest({
        method: "POST",
        url: `http://127.0.0.1:${port}/echo`,
        json: { hello: "world" },
      });
      expect(result.status).toBe(200);
      expect(result.headers["content-type"]).toContain("application/json");
      expect(JSON.parse(result.body)).toEqual({
        method: "POST",
        received: '{"hello":"world"}',
      });
    } finally {
      server.close();
    }
  });
});

describe("web_fetch", () => {
  it("reads the server markup and says so", async () => {
    const server = createServer((_request, response) => {
      response.setHeader("content-type", "text/html; charset=utf-8");
      response.end(
        "<title>Fixture</title><meta name='description' content='A page'><h1>Hello</h1><p>Text here.</p><a href='/next'>Next</a>"
      );
    });
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", () => resolve()));
    const address = server.address();
    const port = typeof address === "object" && address ? address.port : 0;
    try {
      const page = (await webFetch({ root: dir }, { url: `http://127.0.0.1:${port}/` })) as {
        basis: string;
        title: string;
        headings: string[];
        text: string;
        links: { text: string; href: string }[];
      };
      expect(page.basis).toBe("server_html");
      expect(page.title).toBe("Fixture");
      expect(page.headings).toContain("Hello");
      expect(page.text).toContain("Text here.");
      expect(page.links[0]?.text).toBe("Next");
    } finally {
      server.close();
    }
  });
});

describe.skipIf(!findChromium())("browser engine", () => {
  it("opens a page, clicks, types and reads the result", async () => {
    const opened = await browsers.open({
      url: "data:text/html,<title>Engine</title><h1>Hello</h1><button onclick=\"document.title='Clicked'\">Go</button><input aria-label='Name'>",
    });
    try {
      const first = await opened.page.snapshot();
      const button = first.elements.find((element) => element.role === "button");
      expect(button?.name).toBe("Go");
      await opened.page.click({ ref: button?.ref });
      expect((await opened.page.state()).title).toBe("Clicked");

      const input = first.elements.find((element) => element.tag === "input");
      await opened.page.type({ ref: input?.ref }, "Ada");
      expect(await opened.page.evaluateScript("document.querySelector('input').value")).toBe("Ada");

      const shot = await opened.page.screenshot();
      expect(shot.data.byteLength).toBeGreaterThan(1_000);
    } finally {
      await browsers.close(opened.id);
    }
  });
});
