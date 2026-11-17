import http from "node:http";

/**
 * Public webhook-only facade for n8n.
 *
 * The Cloudflare Quick Tunnel points here instead of at the n8n editor, so the
 * admin UI is never exposed. Only the signed PROOFSTACK webhook path is accepted;
 * n8n still verifies the HMAC and the 300-second timestamp window.
 */
const target =
  process.env.N8N_WEBHOOK_TARGET ?? "http://127.0.0.1:5678/webhook/proofstack-payments";
const allowedPath = new URL(target).pathname;
const port = Number(process.env.PORT ?? 5681);
const maxBytes = 64 * 1024;

const server = http.createServer((request, response) => {
  if (request.method !== "POST" || request.url !== allowedPath) {
    response.writeHead(404, { "content-type": "application/json" });
    response.end(JSON.stringify({ error: "not_found" }));
    return;
  }

  const chunks = [];
  let size = 0;

  request.on("data", (chunk) => {
    size += chunk.length;
    if (size > maxBytes) {
      response.writeHead(413, { "content-type": "application/json" });
      response.end(JSON.stringify({ error: "payload_too_large" }));
      request.destroy();
      return;
    }
    chunks.push(chunk);
  });

  request.on("end", async () => {
    if (response.writableEnded) return;

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 10_000);
    try {
      const upstream = await fetch(target, {
        method: "POST",
        headers: {
          "content-type": request.headers["content-type"] ?? "application/json",
          "x-proofstack-timestamp": request.headers["x-proofstack-timestamp"] ?? "",
          "x-proofstack-signature": request.headers["x-proofstack-signature"] ?? "",
        },
        body: Buffer.concat(chunks),
        signal: controller.signal,
      });
      const body = await upstream.text();
      response.writeHead(upstream.status, {
        "content-type": upstream.headers.get("content-type") ?? "application/json",
      });
      response.end(body);
    } catch {
      response.writeHead(502, { "content-type": "application/json" });
      response.end(JSON.stringify({ error: "n8n_unreachable" }));
    } finally {
      clearTimeout(timer);
    }
  });
});

server.listen(port, "127.0.0.1", () => {
  console.log(`n8n webhook-only proxy listening on http://127.0.0.1:${port}${allowedPath}`);
});
