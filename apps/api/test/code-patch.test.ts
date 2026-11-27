import { describe, expect, it } from "vitest";
import { buildUnifiedDiff } from "../src/code-patch.js";

/**
 * The patch builder is the only place a diff is produced.
 *
 * It works on whole lines, refuses an absent or ambiguous `before`, and never writes.
 * These tests pin the hunk header and the exact lines a person would apply.
 */

const FILE = [
  'import express from "express";',
  "const app = express();",
  "app.get('/', (_req, res) => res.send('ok'));",
  "app.listen(3000);",
].join("\n");

describe("buildUnifiedDiff", () => {
  it("replaces whole lines and reports the real line numbers", () => {
    const result = buildUnifiedDiff(
      "src/server.ts",
      FILE,
      "const app = express();",
      "const app = express();\napp.use(helmet());"
    );
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.line).toBe(2);
    expect(result.linesAdded).toBe(2);
    expect(result.linesRemoved).toBe(1);
    expect(result.diff).toContain("--- a/src/server.ts");
    expect(result.diff).toContain("+++ b/src/server.ts");
    expect(result.diff).toContain("@@ -1,4 +1,5 @@");
    expect(result.diff).toContain("-const app = express();");
    expect(result.diff).toContain("+app.use(helmet());");
  });

  it("refuses text that is not in the file instead of guessing a location", () => {
    const result = buildUnifiedDiff(
      "src/server.ts",
      FILE,
      "app.use(helmet());",
      "app.use(cors());"
    );
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error).toBe("before_not_found");
  });

  it("refuses an ambiguous block and names every candidate line", () => {
    const duplicated = `${FILE}\nconst app = express();`;
    const result = buildUnifiedDiff(
      "src/server.ts",
      duplicated,
      "const app = express();",
      "const app = express();\napp.disable('x-powered-by');"
    );
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error).toBe("before_ambiguous");
    expect(result.lines).toEqual([2, 5]);
  });

  it("supports deleting the selected lines with an empty after", () => {
    const result = buildUnifiedDiff("src/server.ts", FILE, "app.listen(3000);", "");
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.linesRemoved).toBe(1);
    expect(result.linesAdded).toBe(0);
    expect(result.diff).toContain("-app.listen(3000);");
    expect(result.diff).not.toContain("+app.listen(3000);");
  });

  it("matches CRLF files and says so, without inventing a line-ending change", () => {
    const result = buildUnifiedDiff(
      "src/server.ts",
      FILE.replaceAll("\n", "\r\n"),
      "const app = express();",
      "const app = express();\napp.use(helmet());"
    );
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.lineEndings).toBe("CRLF");
    expect(result.diff).toContain("+app.use(helmet());");
  });
});
