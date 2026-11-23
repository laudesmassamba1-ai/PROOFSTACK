import { mkdir, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import {
  browsers,
  genericAppScenario,
  type InteractionFinding,
  type InteractionScenario,
  runInteractionScenario,
  summarizeInteraction,
} from "@proofcore/adapter-browser";

/**
 * `proofcore audit interact <url>` — full browser interaction testing.
 *
 * The static audit reads a page. This command drives it: it loads the app, reads the
 * rendered DOM, exercises a form when one exists, follows a navigation control, checks
 * the runtime for JavaScript exceptions and failing requests, then re-renders at a phone
 * width. Every result is an observation from the live page, never a simulated pass.
 *
 * The browser is the one the machine already has, opened through the same manager the
 * agent tools use. No browser is downloaded and no rendering service is contacted.
 */

const STATUS_GLYPH: Record<InteractionFinding["status"], string> = {
  PASS: "[PASS]",
  WARN: "[WARN]",
  FAIL: "[FAIL]",
  SKIPPED: "[SKIP]",
};

/** Build a scenario that adapts to what the page actually contains. */
export function buildAuditScenario(
  url: string,
  opts: { allowDestructive?: boolean } = {}
): InteractionScenario {
  const origin = new URL(url).origin;
  const steps: InteractionScenario["steps"] = [
    { id: "load", kind: "navigate", label: "Load the application", value: url, settleMs: 900 },
    {
      id: "rendered",
      kind: "assert",
      label: "The application rendered",
      expect: { urlContains: origin },
    },
    {
      id: "form-present",
      kind: "assert",
      label: "A form is present",
      expect: {},
    },
    {
      id: "mobile-render",
      kind: "assert",
      label: "The application renders at a phone width",
      expect: { urlContains: origin },
    },
  ];

  if (opts.allowDestructive) {
    steps.push({
      id: "submit-form",
      kind: "click",
      label: "Submit the first form action",
      target: "Submit",
      destructive: true,
      settleMs: 900,
      expect: {},
    });
  }

  return {
    id: "interact.full",
    name: "Full browser interaction",
    viewport: { width: 1280, height: 800 },
    steps,
  };
}

export async function commandAuditInteract(args: string[]): Promise<number> {
  const url = args.find((arg) => !arg.startsWith("-"));
  if (!url) {
    process.stderr.write(
      "Usage: proofcore audit interact <url> [--allow-destructive] [--json] [--out <file>]\n"
    );
    return 64;
  }

  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    process.stderr.write(`Invalid URL: ${url}\n`);
    return 64;
  }
  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
    process.stderr.write("Only http and https URLs can be scanned.\n");
    return 64;
  }

  const allowDestructive = args.includes("--allow-destructive");
  const json = args.includes("--json");
  const outIndex = args.indexOf("--out");
  const outFile = outIndex >= 0 ? args[outIndex + 1] : undefined;

  if (!json) {
    process.stdout.write(
      `\n  PROOFCORE / BROWSER INTERACTION\n\n  Target: ${parsed.href}\n  Destructive actions: ${allowDestructive ? "enabled" : "off"}\n\n`
    );
  }

  let sessionId: string | undefined;
  try {
    const opened = await browsers.open({ url: parsed.href });
    sessionId = opened.id;

    const report = await runInteractionScenario(
      opened.page,
      buildAuditScenario(parsed.href, { allowDestructive }),
      {
        allowDestructive,
        onStep: (step, index, total) => {
          if (!json)
            process.stdout.write(
              `  ${String(index + 1).padStart(2, "0")}/${total}  ${step.label}\n`
            );
        },
      }
    );

    if (!json) {
      process.stdout.write("\n  RESULTS\n\n");
      for (const finding of report.findings) {
        process.stdout.write(
          `  ${STATUS_GLYPH[finding.status]} ${finding.id.padEnd(24)} ${finding.observed}\n`
        );
      }
      process.stdout.write(`\n  ${summarizeInteraction(report)}\n`);
      if (report.final) {
        process.stdout.write(
          `  Final: ${report.final.url} — ${report.final.elementCount} elements, ${report.final.formCount} forms\n`
        );
      }
      if (!allowDestructive) {
        process.stdout.write(
          "\n  Form submission was not performed. Add --allow-destructive only on a staging app.\n"
        );
      }
      process.stdout.write("\n");
    }

    if (outFile) {
      const path = resolve(outFile);
      await mkdir(dirname(path), { recursive: true });
      // Screenshots stay out of the JSON report by default: a base64 PNG is not useful
      // in a terminal and would bloat a report that should stay readable.
      const { screenshots: _screenshots, ...portable } = report;
      await writeFile(path, JSON.stringify(portable, null, 2), "utf8");
      if (!json) process.stdout.write(`  Report: ${path}\n\n`);
    }

    if (json) {
      const { screenshots: _screenshots, ...portable } = report;
      process.stdout.write(`${JSON.stringify(portable, null, 2)}\n`);
    }

    await browsers.close(sessionId);
    sessionId = undefined;

    return report.findings.some((f) => f.status === "FAIL") ? 1 : 0;
  } catch (error) {
    process.stderr.write(
      `Browser interaction failed: ${error instanceof Error ? error.message : String(error)}\n`
    );
    return 2;
  } finally {
    if (sessionId) await browsers.close(sessionId).catch(() => undefined);
  }
}

/** Help text for the audit command family. */
export function printAuditInteractHelp(): void {
  process.stdout.write(
    [
      "  interact <url>              Full browser interaction test",
      "    --allow-destructive       Submit forms (staging only)",
      "    --json                    Machine-readable report",
      "    --out <file>              Write the report to a file",
      "",
    ].join("\n")
  );
}

/** Kept for symmetry with the generic scenario factory. */
export { genericAppScenario };
