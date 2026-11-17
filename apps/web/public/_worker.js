/**
 * Cloudflare Pages same-origin proxy.
 *
 * The browser must talk to `/api`, `/v1` and `/health` on the Pages domain so the
 * HttpOnly session cookie stays first-party. Those paths are forwarded to the API
 * Worker; every other request is served from the static build.
 */
const API_ORIGIN = "https://proofcore-api.laudesmassamba1.workers.dev";

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    const isApi =
      url.pathname === "/health" ||
      url.pathname.startsWith("/api/") ||
      url.pathname.startsWith("/v1/");

    if (isApi) {
      const target = new URL(url.pathname + url.search, API_ORIGIN);
      return fetch(new Request(target, request));
    }

    return env.ASSETS.fetch(request);
  },
};
