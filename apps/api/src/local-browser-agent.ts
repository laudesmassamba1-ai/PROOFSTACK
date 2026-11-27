import { type BrowserPage, browsers } from "@proofcore/adapter-browser";
import { ProofCoreError, shortId } from "@proofcore/core";
import {
  AGENT_VIEWPORT,
  type AgentAction,
  type AgentView,
  type BrowserAgent,
  SNAPSHOT_SCRIPT,
} from "./browser-agent.js";

/**
 * The same browser tool on the Node server, driving the machine's Chromium over CDP.
 *
 * Sessions are process-local and expire after ten idle minutes: the local server is a
 * single process, and a forgotten tab should not hold a Chromium page forever.
 */
const IDLE_MS = 10 * 60_000;

interface LocalSession {
  page: BrowserPage;
  pageId: string;
  userId: string;
  lastUsed: number;
}

export function createLocalBrowserAgent(): BrowserAgent {
  const sessions = new Map<string, LocalSession>();

  const reap = () => {
    const now = Date.now();
    for (const [id, session] of sessions) {
      if (now - session.lastUsed > IDLE_MS) {
        sessions.delete(id);
        void browsers.close(session.pageId).catch(() => undefined);
      }
    }
  };

  const owned = (userId: string, id: string): LocalSession => {
    reap();
    const session = sessions.get(id);
    if (!session || session.userId !== userId) {
      throw new ProofCoreError({
        message: "Browser session not found. Open the page again with browser_open.",
        category: "VALIDATION",
        code: "browser_session_not_found",
      });
    }
    session.lastUsed = Date.now();
    return session;
  };

  const view = async (session: LocalSession, sessionId: string): Promise<AgentView> => {
    const raw = await session.page.evaluateScript(SNAPSHOT_SCRIPT);
    const shot = await session.page.screenshot({ format: "jpeg", quality: 60 });
    return {
      sessionId,
      url: String((raw as { url?: string }).url ?? session.page.url),
      title: String((raw as { title?: string }).title ?? "").slice(0, 300),
      text: String((raw as { text?: string }).text ?? "").slice(0, 6_000),
      elements: ((raw as { elements?: AgentView["elements"] }).elements ?? []).slice(0, 80),
      screenshot: `data:${shot.mimeType};base64,${shot.data.toString("base64")}`,
      engine: "local-chromium",
    };
  };

  return {
    async open({ userId, url }) {
      reap();
      const opened = await browsers.open({
        url,
        width: AGENT_VIEWPORT.width,
        height: AGENT_VIEWPORT.height,
      });
      const sessionId = `bas_${shortId(18)}`;
      const session: LocalSession = {
        page: opened.page,
        pageId: opened.id,
        userId,
        lastUsed: Date.now(),
      };
      sessions.set(sessionId, session);
      return view(session, sessionId);
    },

    async act({ userId, sessionId, action }) {
      const session = owned(userId, sessionId);
      await applyLocalAction(session.page, action);
      return view(session, sessionId);
    },

    async read({ userId, sessionId }) {
      return view(owned(userId, sessionId), sessionId);
    },

    async close({ userId, sessionId }) {
      const session = sessions.get(sessionId);
      if (!session || session.userId !== userId) return;
      sessions.delete(sessionId);
      await browsers.close(session.pageId).catch(() => undefined);
    },
  };
}

async function applyLocalAction(page: BrowserPage, action: AgentAction): Promise<void> {
  if (action.kind === "navigate") {
    await page.navigate(action.url, { settle: true });
    return;
  }
  if (action.kind === "click") {
    await page.click({ selector: action.selector });
    return;
  }
  if (action.kind === "type") {
    await page.type({ selector: action.selector }, action.text, { submit: action.submit });
    return;
  }
  if (action.kind === "press") {
    await page.press(action.key);
    return;
  }
  await page.scroll({ dy: action.dy });
}
