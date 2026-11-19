import { mkdtemp, rm } from "node:fs/promises";
import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import type { AddressInfo } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  loadStoredProvider,
  providerFilePath,
  saveStoredProvider,
  syncAccountAi,
} from "../src/agent-runtime.js";

/**
 * The account profile is the source of truth for "the model I already connected on the
 * site". Login must make the local agent use it without asking for the same key again.
 * The key itself never crosses this boundary: the local file points at the authenticated
 * relay instead.
 */

let directory: string;
let previousProviderFile: string | undefined;

function reply(response: ServerResponse, status: number, body: unknown): void {
  response.writeHead(status, { "content-type": "application/json" });
  response.end(JSON.stringify(body));
}

function profileServer(
  profile: (request: IncomingMessage) => unknown
): Promise<{ url: string; close: () => Promise<void>; requests: IncomingMessage[] }> {
  const requests: IncomingMessage[] = [];
  const server = createServer((request, response) => {
    requests.push(request);
    if (request.url === "/api/v1/ai/profile") {
      reply(response, 200, profile(request));
      return;
    }
    reply(response, 404, { error: { code: "not_found" } });
  });
  return new Promise((resolve) => {
    server.listen(0, "127.0.0.1", () => {
      const address = server.address() as AddressInfo;
      resolve({
        url: `http://127.0.0.1:${address.port}`,
        close: () => new Promise<void>((done) => server.close(() => done())),
        requests,
      });
    });
  });
}

beforeEach(async () => {
  directory = await mkdtemp(join(tmpdir(), "proofcore-ai-sync-"));
  previousProviderFile = process.env.PROOFCORE_PROVIDER_FILE;
  process.env.PROOFCORE_PROVIDER_FILE = join(directory, "provider.json");
});

afterEach(async () => {
  if (previousProviderFile === undefined) delete process.env.PROOFCORE_PROVIDER_FILE;
  else process.env.PROOFCORE_PROVIDER_FILE = previousProviderFile;
  await rm(directory, { recursive: true, force: true });
});

describe("account AI sync", () => {
  it("writes a relay provider from the profile on the site", async () => {
    const server = await profileServer(() => ({
      configured: true,
      providerId: "groq",
      providerKind: "openai",
      providerLabel: "Groq",
      baseUrl: "https://api.groq.com/openai/v1",
      model: "openai/gpt-oss-120b",
      keyFingerprint: "abcd1234",
    }));
    try {
      const result = await syncAccountAi({
        apiUrl: server.url,
        cookie: "ps_session=test-cookie",
      });
      expect(result).toMatchObject({
        configured: true,
        model: "openai/gpt-oss-120b",
        providerLabel: "Groq",
      });

      const stored = await loadStoredProvider();
      expect(stored).toMatchObject({
        baseUrl: `${server.url}/api/v1/ai/relay`,
        model: "openai/gpt-oss-120b",
        kind: "openai",
        relay: true,
        sessionCookie: "ps_session=test-cookie",
        source: "account",
      });
      // The provider secret stays on the server; the local file contains only the
      // account session needed to call the relay.
      expect(stored.apiKey).toBe("");
      expect(JSON.stringify(stored)).not.toContain("abcd1234");
      expect(server.requests[0]?.headers.cookie).toBe("ps_session=test-cookie");
    } finally {
      await server.close();
    }
  });

  it("does not erase a local provider when the account has no AI profile", async () => {
    const local = {
      baseUrl: "http://localhost:11434/v1",
      model: "local-model",
      apiKey: "local-key",
      source: "local" as const,
    };
    await saveStoredProvider(local);
    const server = await profileServer(() => ({ configured: false }));
    try {
      const result = await syncAccountAi({ apiUrl: server.url, cookie: "ps_session=test" });
      expect(result.configured).toBe(false);
      expect(await loadStoredProvider()).toMatchObject(local);
    } finally {
      await server.close();
    }
  });

  it("clears only the account-managed file when the site disconnects the model", async () => {
    const server = await profileServer(() => ({ configured: false }));
    try {
      await syncAccountAi({
        apiUrl: server.url,
        cookie: "ps_session=test",
      });
      await saveStoredProvider({
        baseUrl: `${server.url}/api/v1/ai/relay`,
        model: "old-model",
        apiKey: "",
        relay: true,
        sessionCookie: "ps_session=test",
        source: "account",
        accountApiUrl: server.url,
      });
      await syncAccountAi({ apiUrl: server.url, cookie: "ps_session=test" });
      expect(await loadStoredProvider()).toEqual({});
      // The file is left in the restrictive mode, not deleted with its directory.
      expect(providerFilePath()).toContain(directory);
    } finally {
      await server.close();
    }
  });
});
