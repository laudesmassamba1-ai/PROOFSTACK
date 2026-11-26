import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createApp } from "../src/app.js";
import { migrate } from "../src/db/d1.js";
import { migrationFiles, NodeSqliteDatabase } from "../src/db/node-sqlite.js";
import { readConfig } from "../src/env.js";

/**
 * Onboarding: one workspace, one answer, and the profile recommendation comes from the
 * same registry the analyses use.
 */

const PASSWORD = "correct horse battery";
const ENV = { NODE_ENV: "test", ADMIN_EMAILS: "ops@example.com" };

async function bootstrap() {
  const db = NodeSqliteDatabase.open(":memory:");
  await migrate(db, migrationFiles());
  const built = createApp({ db, env: ENV });
  const config = readConfig(ENV);
  return {
    request: (path: string, init: RequestInit = {}) =>
      built.app.request("http://localhost" + path, {
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

async function signUp(email: string): Promise<{ cookie: string; workspaceId: string }> {
  const response = await harness.request("/api/auth/sign-up/email", {
    method: "POST",
    body: JSON.stringify({ email, password: PASSWORD, name: "Tester" }),
  });
  expect(response.status).toBe(201);
  const cookie = (response.headers.get("set-cookie") ?? "").split(";")[0] ?? "";
  const session = (await (
    await harness.request("/api/auth/session", { headers: { cookie } })
  ).json()) as { workspaceId: string };
  return { cookie, workspaceId: session.workspaceId };
}

interface OnboardingBody {
  experience: string;
  steps: string[];
  onboarding: { completed: boolean; target: string | null };
  progress: { filled: number; total: number; next: string | null; complete: boolean };
  recommendation: { profile: { id: string } | null; modules: string[] } | null;
}

describe("workspace onboarding", () => {
  it("starts simple, empty, and honest about what is missing", async () => {
    const auth = await signUp("new@example.com");
    const response = await harness.request("/api/v1/onboarding?workspaceId=" + auth.workspaceId, {
      headers: { cookie: auth.cookie },
    });
    expect(response.status).toBe(200);
    const body = (await response.json()) as OnboardingBody;
    expect(body.experience).toBe("simple");
    expect(body.progress).toMatchObject({ filled: 0, next: "projectType", complete: false });
    expect(body.recommendation).toBeNull();
    expect(body.steps).toHaveLength(3);
  });

  it("recommends nothing until both the project type and the goal are known", async () => {
    const auth = await signUp("half@example.com");
    const partial = await harness.request("/api/v1/onboarding?workspaceId=" + auth.workspaceId, {
      method: "PUT",
      headers: { cookie: auth.cookie },
      body: JSON.stringify({ projectType: "shop" }),
    });
    expect(partial.status).toBe(200);
    const partialBody = (await partial.json()) as OnboardingBody;
    expect(partialBody.recommendation).toBeNull();
    expect(partialBody.progress.next).toBe("goal");
  });

  it("completes with the profile that answers the goal", async () => {
    const auth = await signUp("done@example.com");
    const response = await harness.request("/api/v1/onboarding?workspaceId=" + auth.workspaceId, {
      method: "PUT",
      headers: { cookie: auth.cookie },
      body: JSON.stringify({
        projectType: "shop",
        goal: "conversion",
        level: "beginner",
        target: "https://shop.example",
      }),
    });
    expect(response.status, await response.clone().text()).toBe(200);
    const body = (await response.json()) as OnboardingBody;
    expect(body.progress.complete).toBe(true);
    expect(body.onboarding.completed).toBe(true);
    expect(body.recommendation?.profile?.id).toBe("conversion");
    expect(body.recommendation?.modules.length).toBeGreaterThan(0);
  });

  it("switches to studio without losing the answers already given", async () => {
    const auth = await signUp("studio@example.com");
    await harness.request("/api/v1/onboarding?workspaceId=" + auth.workspaceId, {
      method: "PUT",
      headers: { cookie: auth.cookie },
      body: JSON.stringify({
        projectType: "shop",
        goal: "conversion",
        level: "expert",
        target: "https://shop.example",
      }),
    });
    const switched = await harness.request("/api/v1/onboarding?workspaceId=" + auth.workspaceId, {
      method: "PUT",
      headers: { cookie: auth.cookie },
      body: JSON.stringify({ experience: "studio" }),
    });
    const body = (await switched.json()) as OnboardingBody;
    expect(body.experience).toBe("studio");
    expect(body.steps).toHaveLength(6);
    expect(body.onboarding.target).toBe("https://shop.example");
    expect(body.progress.complete).toBe(true);
  });

  it("rejects an unknown goal instead of silently ignoring it", async () => {
    const auth = await signUp("bad@example.com");
    const response = await harness.request("/api/v1/onboarding?workspaceId=" + auth.workspaceId, {
      method: "PUT",
      headers: { cookie: auth.cookie },
      body: JSON.stringify({ goal: "make_money" }),
    });
    expect(response.status).toBe(400);
  });
});
