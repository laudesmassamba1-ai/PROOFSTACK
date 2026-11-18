import { createHash, randomBytes, timingSafeEqual } from "node:crypto";
import { createServer, type IncomingMessage, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { ProofCoreError } from "@proofcore/core";
import {
  type AgentProvider,
  AgentSession,
  type Approver,
  loadSession,
  MUTATING_TOOLS,
  saveSession,
  sessionId,
} from "./agent-runtime.js";
import { loadStoredSession } from "./ui.js";

/**
 * `proofcore serve` — the local agent, driven from a browser on this machine.
 *
 * Why a local page instead of teaching the cloud assistant to call 127.0.0.1:
 *
 * - The cloud runs on a Worker. It cannot reach a loopback address, and no amount of
 *   browser plumbing changes that. A tool executes where the loop runs, so the loop has to
 *   be here.
 * - Cross-origin calls from the deployed site to http://127.0.0.1 would require handing a
 *   token to a page, CORS on a privileged origin, and a private-network-access prompt. Same
 *   origin, no CORS, no token in a third-party page.
 * - The transcript is then pushed to the account over the normal API, so the web app shows
 *   the conversation. Sync happens where the credentials already are.
 *
 * Security: bound to 127.0.0.1 only, a per-run token required on every request, the origin
 * checked against the server's own, and writes still gated by the same approval rule.
 */

export interface ServeOptions {
  root: string;
  /**
   * Optional on purpose: a packaged app must open before a model is configured. Without a
   * provider the window still works - it explains what to set - instead of a dead screen.
   */
  provider?: AgentProvider;
  port?: number;
  /** Approve, refuse or ask. Defaults to asking in the terminal. */
  approve?: Approver;
  /** Auto-approve mutating tools. Off by default: a browser must not widen what the shell allows. */
  allowWrite?: boolean;
  /** Push each finished turn to the signed-in account. */
  sync?: boolean;
  log?: (line: string) => void;
  maxSteps?: number;
}

export interface ServeHandle {
  url: string;
  port: number;
  token: string;
  close: () => Promise<void>;
}

const MAX_BODY_BYTES = 256 * 1024;
const COOKIE = "pc_local";
const TOKEN_PATTERN = /^[A-Za-z0-9_-]{16,128}$/;

function randomToken(): string {
  return randomBytes(24).toString("base64url");
}

function constantTimeEquals(a: string, b: string): boolean {
  const left = Buffer.from(a);
  const right = Buffer.from(b);
  if (left.length !== right.length) return false;
  return timingSafeEqual(left, right);
}

async function readJson(request: IncomingMessage): Promise<Record<string, unknown>> {
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of request) {
    size += (chunk as Buffer).length;
    if (size > MAX_BODY_BYTES) {
      throw new ProofCoreError({
        message: "Request body too large.",
        category: "VALIDATION",
        code: "body_too_large",
      });
    }
    chunks.push(chunk as Buffer);
  }
  const raw = Buffer.concat(chunks).toString("utf8").trim();
  if (!raw) return {};
  try {
    const parsed = JSON.parse(raw);
    return parsed && typeof parsed === "object" ? (parsed as Record<string, unknown>) : {};
  } catch {
    throw new ProofCoreError({
      message: "Body is not valid JSON.",
      category: "VALIDATION",
      code: "invalid_json",
    });
  }
}

/** Extracts the token from the cookie or the Authorization header, never from a URL path. */
function presentedToken(request: IncomingMessage): string | undefined {
  const header = request.headers.authorization;
  if (typeof header === "string" && header.toLowerCase().startsWith("bearer ")) {
    return header.slice(7).trim();
  }
  const cookies = request.headers.cookie ?? "";
  for (const part of cookies.split(";")) {
    const [name, value] = part.trim().split("=");
    if (name === COOKIE && value) return value;
  }
  return undefined;
}

export async function serveLocal(options: ServeOptions): Promise<ServeHandle> {
  const token = randomToken();
  const log = options.log ?? (() => undefined);
  const sessions = new Map<string, AgentSession>();
  const approvals = new Map<string, (allow: boolean) => void>();
  // The active SSE writer, set for the duration of one /api/chat request.
  let stream: ((event: { type: string; payload: unknown }) => void) | undefined;

  const server: Server = createServer(async (request, response) => {
    const url = new URL(request.url ?? "/", "http://127.0.0.1");
    const isApi = url.pathname.startsWith("/api/");

    // Same-origin only: a page on another origin must not drive this server, even if it
    // somehow learned the token.
    const origin = request.headers.origin;
    if (typeof origin === "string") {
      const expected = `http://127.0.0.1:${(server.address() as AddressInfo | null)?.port ?? options.port ?? 0}`;
      if (origin !== expected && origin !== expected.replace("127.0.0.1", "localhost")) {
        response.writeHead(403, { "content-type": "text/plain; charset=utf-8" });
        response.end("origin refused");
        return;
      }
    }

    if (url.pathname === "/health") {
      response.writeHead(200, { "content-type": "application/json" });
      response.end(JSON.stringify({ ok: true, service: "proofcore-local-agent" }));
      return;
    }

    // The token arrives once, in the query string, immediately after the terminal prints
    // the URL. It is exchanged for an HttpOnly cookie so it stops travelling in the address
    // bar, and so a script on the page cannot read it.
    if (url.pathname === "/" && !presentedToken(request)) {
      const supplied = url.searchParams.get("t") ?? "";
      if (TOKEN_PATTERN.test(supplied) && constantTimeEquals(supplied, token)) {
        response.writeHead(302, {
          location: "/",
          "set-cookie": `${COOKIE}=${token}; HttpOnly; SameSite=Strict; Path=/; Max-Age=86400`,
        });
        response.end();
        return;
      }
      response.writeHead(401, { "content-type": "text/plain; charset=utf-8" });
      response.end("Open the URL printed in the terminal (it carries the one-time token).");
      return;
    }

    if (isApi) {
      const presented = presentedToken(request);
      if (!presented || !constantTimeEquals(presented, token)) {
        response.writeHead(401, { "content-type": "application/json" });
        response.end(JSON.stringify({ error: "unauthorized" }));
        return;
      }
      if (request.method === "POST") {
        // A cross-site form post cannot set this content type, and a JSON body cannot be
        // constructed by a simple HTML form.
        const contentType = request.headers["content-type"] ?? "";
        if (!String(contentType).includes("application/json")) {
          response.writeHead(415, { "content-type": "application/json" });
          response.end(JSON.stringify({ error: "content_type_required" }));
          return;
        }
      }
    }

    try {
      if (request.method === "GET" && url.pathname === "/") {
        response.writeHead(200, { "content-type": "text/html; charset=utf-8" });
        response.end(renderPage(options));
        return;
      }

      if (request.method === "GET" && url.pathname === "/api/state") {
        const account = await loadStoredSession().catch(() => null);
        response.writeHead(200, { "content-type": "application/json" });
        response.end(
          JSON.stringify({
            root: options.root,
            model: options.provider?.model ?? "non configuré",
            allowWrite: options.allowWrite === true,
            sync: options.sync === true,
            account: account ? { email: account.email, apiUrl: account.apiUrl } : null,
          })
        );
        return;
      }

      if (request.method === "POST" && url.pathname === "/api/approve") {
        const body = await readJson(request);
        const id = String(body.id ?? "");
        const resolver = approvals.get(id);
        if (resolver) {
          approvals.delete(id);
          resolver(body.allow === true);
        }
        response.writeHead(200, { "content-type": "application/json" });
        response.end(JSON.stringify({ ok: Boolean(resolver) }));
        return;
      }

      if (request.method === "POST" && url.pathname === "/api/chat") {
        const body = await readJson(request);
        const message = String(body.message ?? "").trim();
        if (!message) {
          response.writeHead(400, { "content-type": "application/json" });
          response.end(JSON.stringify({ error: "message_required" }));
          return;
        }
        if (!options.provider) {
          // The window is open, the engine runs, one thing is missing. Saying it in the
          // conversation keeps the app usable: the user reads it where they were typing.
          response.writeHead(200, {
            "content-type": "text/event-stream; charset=utf-8",
            "cache-control": "no-cache",
          });
          const explanation =
            "Aucun modèle n'est configuré. Deux façons de le faire, une seule fois :\n\n" +
            "1. Menu PROOFCORE → « Se connecter… », puis le compte fournit le modèle.\n" +
            "2. proofcore agent --configure  (URL, modèle, clé — stockés en 0600 sur cette machine).\n\n" +
            "Tout le reste tourne déjà ici : les audits, le bac à sable, l'index, les outils.";
          const frame = (event: string, payload: unknown) =>
            `event: ${event}\ndata: ${JSON.stringify(payload)}\n\n`;
          response.write(frame("assistant_text", { text: explanation }));
          response.write(frame("done", {}));
          response.end();
          return;
        }
        const conversationKey =
          typeof body.conversationKey === "string" ? body.conversationKey : "default";
        let session = sessions.get(conversationKey);
        if (!session) {
          const history = await loadSession(options.root, sessionId(options.root, conversationKey));
          const approve: Approver = async (request_) => {
            if (!MUTATING_TOOLS.has(request_.tool)) return true;
            if (options.allowWrite) return true;
            if (options.approve) return options.approve(request_);
            // No approval channel: refuse instead of assuming yes.
            return false;
          };
          session = new AgentSession(
            {
              root: options.root,
              provider: options.provider as AgentProvider,
              approve,
              ...(options.maxSteps ? { maxSteps: options.maxSteps } : {}),
              // Every event the loop produces is forwarded to the page as it happens, so a
              // long turn shows its reads and edits instead of one final blob.
              onEvent: (event) => {
                stream?.({ type: event.type, payload: event });
              },
            },
            history ?? []
          );
          sessions.set(conversationKey, session);
        }
        const active = session;

        // Server-sent events: one frame per agent event, so the page shows the tool calls as
        // they happen instead of waiting for a final blob.
        response.writeHead(200, {
          "content-type": "text/event-stream; charset=utf-8",
          "cache-control": "no-cache, no-transform",
          connection: "keep-alive",
        });
        const send = (event: string, data: unknown) => {
          response.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
        };
        stream = (event) => {
          if (event.type === "assistant_text") send("assistant_text", event.payload);
          else if (event.type === "tool_call") send("tool_call", event.payload);
          else if (event.type === "tool_result") send("tool_result", event.payload);
          else if (event.type === "tool_refused") send("tool_refused", event.payload);
        };

        const result = await runWithApproval({ session: active, message, send, approvals });
        stream = undefined;

        await saveSession(options.root, sessionId(options.root, conversationKey), result.messages, {
          model: options.provider?.model ?? "non configuré",
          source: "local-bridge",
        });

        let syncError: string | undefined;
        if (options.sync) {
          syncError = await pushTranscript(result.messages);
          if (syncError) log(`sync failed: ${syncError}`);
        }
        send("done", { syncError: syncError ?? null });
        response.end();
        return;
      }

      response.writeHead(404, { "content-type": "application/json" });
      response.end(JSON.stringify({ error: "not_found" }));
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      log(`error: ${message}`);
      if (!response.headersSent) {
        response.writeHead(500, { "content-type": "application/json" });
        response.end(JSON.stringify({ error: message }));
      } else {
        response.end();
      }
    }
  });

  await new Promise<void>((resolvePromise, reject) => {
    server.once("error", reject);
    server.listen(options.port ?? 7317, "127.0.0.1", () => resolvePromise());
  });

  const address = server.address() as AddressInfo;
  return {
    url: `http://127.0.0.1:${address.port}/?t=${token}`,
    port: address.port,
    token,
    close: () =>
      new Promise<void>((resolvePromise) => {
        server.closeAllConnections?.();
        server.close(() => resolvePromise());
      }),
  };
}

/**
 * Runs one turn, forwarding approval requests to the page over the same stream.
 *
 * The approval channel is per request id and single-use: a stale "allow" cannot be replayed
 * onto a later call.
 */
async function runWithApproval(input: {
  session: AgentSession;
  message: string;
  send: (event: string, data: unknown) => void;
  approvals: Map<string, (allow: boolean) => void>;
}): Promise<{ messages: import("./agent-runtime.js").ChatMessage[] }> {
  const { session, message, send, approvals } = input;
  // AgentSession owns the loop; approvals arrive through its callback, so the stream and the
  // callback are wired here rather than inside the session.
  let counter = 0;
  const request: Approver = async (candidate) => {
    const id = `a${Date.now().toString(36)}${counter++}`;
    const decision = new Promise<boolean>((resolvePromise) => {
      approvals.set(id, resolvePromise);
      setTimeout(() => {
        if (approvals.delete(id)) resolvePromise(false);
      }, 120_000);
    });
    send("approval", {
      id,
      tool: candidate.tool,
      args: candidate.args,
      preview: candidate.preview ?? null,
    });
    return decision;
  };
  session.setApprover(request);
  const result = await session.send(message);
  send("result", { text: result.text, toolCalls: result.toolCalls, refused: result.refused });
  return { messages: result.messages };
}

/** Pushes the transcript to the signed-in account, so the web app shows it. */
async function pushTranscript(
  messages: { role: string; content: string }[]
): Promise<string | undefined> {
  const account = await loadStoredSession().catch(() => null);
  if (!account) return "not signed in (run `proofcore login`)";
  const conversation = messages
    .filter((message) => message.role === "user" || message.role === "assistant")
    .map((message) => ({ role: message.role, content: message.content }))
    .filter((message) => message.content.trim().length > 0);
  if (conversation.length === 0) return undefined;
  // The account knows which workspaces it has; asking is better than guessing an id.
  let workspaceId = "";
  try {
    const list = await fetch(`${account.apiUrl}/api/v1/workspaces`, {
      headers: { cookie: account.cookie, accept: "application/json" },
      signal: AbortSignal.timeout(10_000),
    });
    if (!list.ok) return `could not list workspaces: HTTP ${list.status}`;
    const payload = (await list.json()) as { items?: { id?: string }[] };
    workspaceId = payload.items?.[0]?.id ?? "";
  } catch (error) {
    return `could not list workspaces: ${error instanceof Error ? error.message : String(error)}`;
  }
  if (!workspaceId) return "no workspace on this account";

  try {
    const response = await fetch(`${account.apiUrl}/api/v1/ai/conversations`, {
      method: "POST",
      headers: { "content-type": "application/json", cookie: account.cookie },
      body: JSON.stringify({
        workspaceId,
        title: conversation[0]?.content.slice(0, 60) ?? "Local session",
        effort: "balanced",
        // Stable key: re-posting the same session updates the row instead of creating a copy.
        importId: conversationKeyFromTitle(conversation[0]?.content ?? ""),
        messages: conversation.slice(-200),
      }),
      signal: AbortSignal.timeout(15_000),
    });
    if (!response.ok) {
      const detail = await response.text().catch(() => "");
      return `HTTP ${response.status} ${detail.slice(0, 160)}`;
    }
    return undefined;
  } catch (error) {
    return error instanceof Error ? error.message : String(error);
  }
}

/** Deterministic import key, so the same first message does not create two rows. */
function conversationKeyFromTitle(text: string): string {
  return createHash("sha256").update(text).digest("hex").slice(0, 16);
}

function renderPage(options: ServeOptions): string {
  return `<!doctype html><html lang="fr"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>PROOFCORE · agent local</title>
<style>
:root{--bg:#0b0d10;--panel:#14181d;--line:#242b33;--fg:#e8ecf1;--dim:#8b97a5;--acc:#4ade80;--warn:#fbbf24}
*{box-sizing:border-box}body{margin:0;background:var(--bg);color:var(--fg);font:14px/1.55 ui-sans-serif,system-ui,sans-serif}
header{display:flex;gap:12px;align-items:center;padding:14px 18px;border-bottom:1px solid var(--line)}
header b{letter-spacing:.14em;font-size:12px}header span{color:var(--dim);font-size:12px}
main{max-width:860px;margin:0 auto;padding:18px;display:flex;flex-direction:column;gap:12px;height:calc(100vh - 56px)}
#log{flex:1;overflow:auto;display:flex;flex-direction:column;gap:10px}
.msg{padding:10px 12px;border:1px solid var(--line);border-radius:10px;background:var(--panel);white-space:pre-wrap}
.msg.me{border-color:#2b4a37}.tool{font-family:ui-monospace,monospace;font-size:12px;color:var(--dim);border-left:2px solid var(--line);padding-left:10px}
.approve{border:1px solid var(--warn);border-radius:10px;padding:10px;background:#1d1a10}
pre{margin:6px 0 0;font:12px/1.5 ui-monospace,monospace;max-height:220px;overflow:auto}
.add{background:#0f2a1b;color:#b6f3ce}.del{background:#2a1414;color:#f7bcbc}
button{cursor:pointer;border-radius:8px;border:1px solid var(--line);background:var(--panel);color:var(--fg);padding:6px 12px;font:inherit}
button.ok{border-color:var(--acc);color:var(--acc)}button.no{border-color:#ef4444;color:#ef4444}
form{display:flex;gap:8px}textarea{flex:1;background:var(--panel);color:var(--fg);border:1px solid var(--line);border-radius:10px;padding:10px;font:inherit;resize:none;min-height:52px}
</style></head><body>
<header><b>PROOFCORE</b><span>agent local · ${escapeHtml(options.provider?.model ?? "aucun modèle configuré")}</span><span id="meta"></span></header>
<main><div id="log"></div>
<form id="f"><textarea id="q" placeholder="Demande quelque chose sur ce dépôt…" required></textarea><button class="ok">Envoyer</button></form>
</main>
<script>
const log=document.getElementById('log'), form=document.getElementById('f'), q=document.getElementById('q');
const add=(cls,text)=>{const d=document.createElement('div');d.className=cls;d.textContent=text;log.appendChild(d);log.scrollTop=log.scrollHeight;return d};
const pre=(parent,text)=>{const p=document.createElement('pre');p.textContent=text;parent.appendChild(p);return p};
fetch('/api/state').then(r=>r.json()).then(s=>{
  document.getElementById('meta').textContent=(s.sync?'sync compte: '+(s.account?s.account.email:'non connecté'):'sync off')+(s.allowWrite?' · écriture auto':' · écriture sur accord');
}).catch(()=>{});
form.addEventListener('submit',async(e)=>{
  e.preventDefault();const message=q.value.trim();if(!message)return;q.value='';
  add('msg me',message);
  const status=add('tool','… en cours');
  const res=await fetch('/api/chat',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({message})});
  if(!res.ok){status.textContent='erreur HTTP '+res.status;return}
  const reader=res.body.getReader(),dec=new TextDecoder();let buf='';
  while(true){
    const {value,done}=await reader.read();if(done)break;
    buf+=dec.decode(value,{stream:true});
    let idx;
    while((idx=buf.indexOf('\\n\\n'))>=0){
      const frame=buf.slice(0,idx);buf=buf.slice(idx+2);
      const evt=/^event: (.+)$/m.exec(frame)?.[1];const data=/^data: (.+)$/m.exec(frame)?.[1];
      if(!evt||!data)continue;const payload=JSON.parse(data);
      if(evt==='assistant_text'){add('msg',payload.text)}
      if(evt==='tool_call'){status.textContent='→ '+payload.name+' '+JSON.stringify(payload.args).slice(0,120);status.className='tool'}
      if(evt==='approval'){
        const box=add('approve','Approuver '+payload.tool+' ?');
        if(payload.preview)pre(box,payload.preview);
        const row=document.createElement('div');row.style.marginTop='8px';
        const yes=document.createElement('button');yes.className='ok';yes.textContent='Appliquer';
        const no=document.createElement('button');no.className='no';no.textContent='Refuser';no.style.marginLeft='8px';
        const decide=(allow)=>{fetch('/api/approve',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({id:payload.id,allow})});box.replaceWith(Object.assign(document.createElement('div'),{className:'tool',textContent:(allow?'approuvé':'refusé')+' · '+payload.tool}))};
        yes.onclick=()=>decide(true);no.onclick=()=>decide(false);
        row.append(yes,no);box.appendChild(row);log.scrollTop=log.scrollHeight;
      }
      if(evt==='result'){status.remove();if(payload.syncError)add('tool','sync non effectuée: '+payload.syncError)}
      if(evt==='done'){status.remove()}
    }
  }
});
</script></body></html>`;
}

function escapeHtml(text: string): string {
  return text.replace(/[&<>"']/g, (char) => {
    switch (char) {
      case "&":
        return "&amp;";
      case "<":
        return "&lt;";
      case ">":
        return "&gt;";
      case '"':
        return "&quot;";
      default:
        return "&#39;";
    }
  });
}
