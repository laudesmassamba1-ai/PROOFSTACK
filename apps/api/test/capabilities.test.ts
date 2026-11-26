import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createApp } from "../src/app.js";
import { migrate } from "../src/db/d1.js";
import { migrationFiles, NodeSqliteDatabase } from "../src/db/node-sqlite.js";
import { readConfig } from "../src/env.js";

const PASSWORD = "correct horse battery";
const ENV = { NODE_ENV: "test", ADMIN_EMAILS: "ops@example.com" };

async function bootstrap() {
  const db = NodeSqliteDatabase.open(":memory:");
  await migrate(db, migrationFiles());
  const built = createApp({ db, env: ENV });
  const config = readConfig(ENV);
  return {
    request: (path: string, init: RequestInit = {}) =>
      built.app.request(`http://localhost${path}`, {
        ...init,
        headers: { "content-type": "application/json", origin: config.webOrigin, ...init.headers },
      }),
    close: async () => db.close(),
  };
}

type Harness = Awaited<ReturnType<typeof bootstrap>>;
let harness: Harness;

beforeEach(async () => {
  harness = await bootstrap();
});
afterEach(async () => {
  await harness.close();
});

async function signUp(email: string): Promise<string> {
  const response = await harness.request("/api/auth/sign-up/email", {
    method: "POST",
    body: JSON.stringify({ email, password: PASSWORD, name: "Tester" }),
  });
  return (response.headers.get("set-cookie") ?? "").split(";")[0] ?? "";
}

interface CapabilityList {
  version: string;
  items: { id: string; module: string; controls: string[] }[];
  profiles: { id: string; modules: string[] }[];
  modulesByTargetType: Record<string, string[]>;
}

describe("capabilities API", () => {
  it("requires a session, like every other tenant endpoint", async () => {
    const anonymous = await harness.request("/api/v1/capabilities");
    expect(anonymous.status).toBe(401);
  });

  it("serves the registry, its profiles and the target matrix", async () => {
    const cookie = await signUp("caps@example.com");
    const response = await harness.request("/api/v1/capabilities", { headers: { cookie } });
    expect(response.status).toBe(200);
    const body = (await response.json()) as CapabilityList;
    expect(body.items.length).toBeGreaterThan(5);
    expect(body.profiles.map((profile) => profile.id)).toContain("conversion");
    expect(body.modulesByTargetType.PROJECT).toContain("clean");
  });

  it("filters by module and by target type", async () => {
    const cookie = await signUp("filter@example.com");
    const byModule = (await (
      await harness.request("/api/v1/capabilities?module=flow", { headers: { cookie } })
    ).json()) as CapabilityList;
    expect(byModule.items.length).toBeGreaterThan(0);
    expect(byModule.items.every((entry) => entry.module === "flow")).toBe(true);

    const byTarget = (await (
      await harness.request("/api/v1/capabilities?targetType=PROJECT", { headers: { cookie } })
    ).json()) as CapabilityList;
    expect(byTarget.items.map((entry) => entry.id)).toContain("project.repository");
    expect(byTarget.items.map((entry) => entry.id)).not.toContain("page.flow");
  });

  it("rejects an unknown module instead of answering an empty list", async () => {
    const cookie = await signUp("unknown@example.com");
    const response = await harness.request("/api/v1/capabilities?module=vibes", {
      headers: { cookie },
    });
    expect(response.status).toBe(400);
  });

  it("returns one capability by id and 404 for a wrong id", async () => {
    const cookie = await signUp("one@example.com");
    const found = await harness.request("/api/v1/capabilities/page.fail", { headers: { cookie } });
    expect(found.status).toBe(200);
    const body = (await found.json()) as { capability: { controls: string[] } };
    expect(body.capability.controls).toContain("hsts");

    const missing = await harness.request("/api/v1/capabilities/page.telepathy", {
      headers: { cookie },
    });
    expect(missing.status).toBe(404);
  });
});
