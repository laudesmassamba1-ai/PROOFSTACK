import type { ScanModule } from "@proofcore/core";
import { allControls } from "@proofcore/core";
import { Hono } from "hono";
import type { AppEnv } from "../http/services.js";

/**
 * The control registry, readable by anyone.
 *
 * This is deliberately public: it says what the product can check and how each check can
 * be fixed, which is the same information a visitor needs before paying. It carries no
 * customer data, no scan result and no secret — only the catalogue.
 *
 * It is also what makes the explanations deterministic: the web app and the CLI render
 * these entries instead of asking a model to describe a finding.
 */
export function controlRoutes(): Hono<AppEnv> {
  const app = new Hono<AppEnv>();

  app.get("/controls", (c) => {
    const locale = c.req.query("locale") === "en" ? "en" : "fr";
    const requested = c.req.query("module");
    const modules: ScanModule[] = ["fail", "clean", "flow", "world", "exit"];
    const module = modules.find((item) => item === requested);

    const items = allControls()
      .filter((control) => (module ? control.module === module : true))
      .map((control) => {
        const copy = locale === "en" ? control.en : control.fr;
        return {
          id: control.id,
          module: control.module,
          title: copy.title,
          objective: copy.objective,
          consequence: copy.consequence,
          fix: copy.fix,
          verify: copy.verify,
          fixes: control.fixes,
          complexity: control.complexity,
          risk: control.risk,
          method: control.method,
          result: control.result,
          ...(control.aliasOf === undefined ? {} : { aliasOf: control.aliasOf }),
        };
      });

    // The catalogue changes only when the product ships, so a day of caching is honest
    // and keeps a scan page from re-downloading 46 entries on every render.
    c.header("Cache-Control", "public, max-age=86400");
    return c.json({ locale, count: items.length, items });
  });

  return app;
}
