/// <reference lib="dom" />
import { ProofCoreError } from "@proofcore/core";

/**
 * A small DevTools Protocol client.
 *
 * Chromium already exposes a complete automation API over a WebSocket; every "browser
 * automation" package is a wrapper around exactly this. Speaking it directly keeps the
 * engine at a few hundred lines, removes a dependency that ships its own browser download,
 * and makes the failure modes visible: a protocol error carries the method, the code and
 * the payload instead of being flattened into "locator timed out".
 *
 * Node 22 ships a global WebSocket, so there is no client library either.
 */

export interface CdpEvent {
  method: string;
  params: Record<string, unknown>;
  sessionId?: string;
}

type EventListener = (event: CdpEvent) => void;

interface PendingCall {
  resolve: (value: Record<string, unknown>) => void;
  reject: (error: Error) => void;
  timer: ReturnType<typeof setTimeout>;
  method: string;
}

interface EventWaiter {
  method: string;
  sessionId?: string;
  predicate?: (params: Record<string, unknown>) => boolean;
  resolve: (params: Record<string, unknown>) => void;
  reject: (error: Error) => void;
  timer: ReturnType<typeof setTimeout>;
}

export interface CdpErrorOptions {
  method: string;
  code?: number;
  data?: unknown;
  cause?: unknown;
}

export class CdpError extends Error {
  readonly method: string;
  readonly code?: number;
  readonly data?: unknown;

  constructor(message: string, options: CdpErrorOptions) {
    super(message, options.cause === undefined ? undefined : { cause: options.cause });
    this.name = "CdpError";
    this.method = options.method;
    if (options.code !== undefined) this.code = options.code;
    if (options.data !== undefined) this.data = options.data;
  }
}

const CONNECT_TIMEOUT_MS = 15_000;
const CALL_TIMEOUT_MS = 30_000;

export class CdpConnection {
  private readonly socket: WebSocket;
  private readonly pending = new Map<number, PendingCall>();
  private readonly listeners = new Set<EventListener>();
  private readonly waiters = new Set<EventWaiter>();
  private nextId = 1;
  private open = true;

  private constructor(socket: WebSocket) {
    this.socket = socket;
    socket.addEventListener("message", (event: MessageEvent) => {
      this.receive(String(event.data));
    });
    socket.addEventListener("close", () => {
      this.failAll("the browser connection closed");
    });
    socket.addEventListener("error", () => {
      this.failAll("the browser connection failed");
    });
  }

  static connect(url: string, options: { timeoutMs?: number } = {}): Promise<CdpConnection> {
    if (!/^wss?:\/\//i.test(url)) {
      return Promise.reject(
        new ProofCoreError({
          message: `Not a DevTools WebSocket URL: ${url}`,
          category: "CONFIGURATION",
          code: "browser_endpoint_invalid",
        })
      );
    }
    return new Promise<CdpConnection>((resolve, reject) => {
      const socket = new WebSocket(url);
      const timer = setTimeout(() => {
        socket.close();
        reject(
          new ProofCoreError({
            message: `The browser did not answer on ${url} within ${options.timeoutMs ?? CONNECT_TIMEOUT_MS} ms.`,
            category: "NETWORK",
            code: "browser_connect_timeout",
          })
        );
      }, options.timeoutMs ?? CONNECT_TIMEOUT_MS);

      socket.addEventListener(
        "open",
        () => {
          clearTimeout(timer);
          resolve(new CdpConnection(socket));
        },
        { once: true }
      );
      socket.addEventListener(
        "error",
        () => {
          clearTimeout(timer);
          reject(
            new ProofCoreError({
              message: `Could not connect to the browser at ${url}.`,
              category: "NETWORK",
              code: "browser_connect_failed",
            })
          );
        },
        { once: true }
      );
    });
  }

  get closed(): boolean {
    return !this.open;
  }

  /**
   * Sends one protocol command.
   *
   * A `sessionId` addresses a page (flat target mode). The timeout is per call: a page that
   * hangs on `Page.navigate` must not block every later call for the life of the process.
   */
  send<T extends Record<string, unknown> = Record<string, unknown>>(
    method: string,
    params: Record<string, unknown> = {},
    sessionId?: string,
    timeoutMs = CALL_TIMEOUT_MS
  ): Promise<T> {
    if (!this.open) {
      return Promise.reject(
        new CdpError("The browser connection is closed.", { method, code: -32000 })
      );
    }
    const id = this.nextId++;
    return new Promise<T>((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(id);
        reject(
          new CdpError(`The browser did not answer ${method} within ${timeoutMs} ms.`, {
            method,
            code: -32001,
          })
        );
      }, timeoutMs);
      this.pending.set(id, {
        resolve: (value) => resolve(value as T),
        reject,
        timer,
        method,
      });
      try {
        this.socket.send(
          JSON.stringify({ id, method, params, ...(sessionId ? { sessionId } : {}) })
        );
      } catch (error) {
        clearTimeout(timer);
        this.pending.delete(id);
        reject(new CdpError(`Could not send ${method}.`, { method, cause: error }));
      }
    });
  }

  /** Subscribes to every event; returns the unsubscribe function. */
  on(listener: EventListener): () => void {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }

  /** Resolves on the next matching event. Rejects on timeout, never silently. */
  waitFor(
    method: string,
    options: {
      sessionId?: string;
      predicate?: (params: Record<string, unknown>) => boolean;
      timeoutMs?: number;
    } = {}
  ): Promise<Record<string, unknown>> {
    return new Promise((resolve, reject) => {
      const waiter: EventWaiter = {
        method,
        ...(options.sessionId ? { sessionId: options.sessionId } : {}),
        ...(options.predicate ? { predicate: options.predicate } : {}),
        resolve,
        reject,
        timer: setTimeout(() => {
          this.waiters.delete(waiter);
          reject(
            new CdpError(`Timed out waiting for ${method}.`, {
              method,
              code: -32001,
            })
          );
        }, options.timeoutMs ?? 10_000),
      };
      this.waiters.add(waiter);
    });
  }

  close(): void {
    if (!this.open) return;
    this.open = false;
    try {
      this.socket.close();
    } catch {
      // Already closing.
    }
    this.failAll("the browser connection was closed");
  }

  private receive(raw: string): void {
    let message: {
      id?: number;
      method?: string;
      params?: Record<string, unknown>;
      result?: Record<string, unknown>;
      error?: { code?: number; message?: string; data?: unknown };
      sessionId?: string;
    };
    try {
      message = JSON.parse(raw);
    } catch {
      // A malformed frame is not worth tearing the connection down for.
      return;
    }

    if (typeof message.id === "number") {
      const call = this.pending.get(message.id);
      if (!call) return;
      this.pending.delete(message.id);
      clearTimeout(call.timer);
      if (message.error) {
        call.reject(
          new CdpError(message.error.message ?? `${call.method} failed`, {
            method: call.method,
            ...(message.error.code !== undefined ? { code: message.error.code } : {}),
            ...(message.error.data !== undefined ? { data: message.error.data } : {}),
          })
        );
      } else {
        call.resolve(message.result ?? {});
      }
      return;
    }

    if (typeof message.method !== "string") return;
    const event: CdpEvent = {
      method: message.method,
      params: message.params ?? {},
      ...(message.sessionId ? { sessionId: message.sessionId } : {}),
    };
    for (const listener of this.listeners) {
      try {
        listener(event);
      } catch {
        // A listener failure must not stop the protocol loop.
      }
    }
    for (const waiter of [...this.waiters]) {
      if (waiter.method !== event.method) continue;
      if (waiter.sessionId && waiter.sessionId !== event.sessionId) continue;
      if (waiter.predicate && !waiter.predicate(event.params)) continue;
      this.waiters.delete(waiter);
      clearTimeout(waiter.timer);
      waiter.resolve(event.params);
    }
  }

  private failAll(reason: string): void {
    this.open = false;
    for (const [, call] of this.pending) {
      clearTimeout(call.timer);
      call.reject(
        new CdpError(`${reason} while waiting for ${call.method}.`, { method: call.method })
      );
    }
    this.pending.clear();
    for (const waiter of this.waiters) {
      clearTimeout(waiter.timer);
      waiter.reject(new CdpError(`${reason}.`, { method: waiter.method }));
    }
    this.waiters.clear();
  }
}

/** Reads `/json/version` from a running browser and returns its browser-level WebSocket. */
export async function browserWebSocketUrl(endpoint: string): Promise<string> {
  const base = endpoint.replace(/\/+$/, "");
  const response = await fetch(`${base}/json/version`, {
    signal: AbortSignal.timeout(5_000),
  }).catch((error: unknown) => {
    throw new ProofCoreError({
      message: `No DevTools endpoint at ${base}: ${error instanceof Error ? error.message : "network error"}`,
      category: "NETWORK",
      code: "browser_endpoint_unreachable",
    });
  });
  if (!response.ok) {
    throw new ProofCoreError({
      message: `The browser answered HTTP ${response.status} on ${base}/json/version.`,
      category: "NETWORK",
      code: "browser_endpoint_unreachable",
    });
  }
  const payload = (await response.json()) as { webSocketDebuggerUrl?: string };
  if (!payload.webSocketDebuggerUrl) {
    throw new ProofCoreError({
      message: `${base} is not a DevTools endpoint (no webSocketDebuggerUrl).`,
      category: "NETWORK",
      code: "browser_endpoint_invalid",
    });
  }
  return payload.webSocketDebuggerUrl;
}
