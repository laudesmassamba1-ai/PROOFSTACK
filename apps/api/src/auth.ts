import { hmacSha256Hex, sha256Hex, timingSafeEqualHex } from "@proofcore/core";

/**
 * Password and session primitives.
 *
 * Why not better-auth: it is a good library, but its D1 story requires an adapter and
 * a schema we would then own anyway, and this product's auth surface is deliberately
 * small — email/password, one session cookie, no social login yet. Implementing it
 * with WebCrypto keeps one auditable code path that runs unchanged on Workers and
 * Node. The decision and its trade-offs are recorded in docs/ARCHITECTURE.md.
 *
 * Guarantees:
 *   - passwords are PBKDF2-HMAC-SHA256, 100 000 iterations, 16-byte random salt.
 *     That is not an arbitrary choice: Cloudflare's Workers WebCrypto rejects any
 *     iteration count above 100 000, so a higher value is a 500 in production even
 *     though it passes on Node. Raising it requires a KDF that does not go through
 *     crypto.subtle.
 *   - session tokens are 32 random bytes, sent HttpOnly, and stored only as SHA-256
 *   - comparisons are constant-time
 *   - a session is looked up by hash, so a database leak does not yield live cookies
 */

// Hard ceiling enforced by the Workers runtime: >100 000 throws
// "Pbkdf2 failed: iteration counts above 100000 are not supported".
const PBKDF2_ITERATIONS = 100_000;
const SALT_BYTES = 16;
const KEY_BITS = 256;
export const SESSION_COOKIE = "ps_session";
export const SESSION_TTL_DAYS = 30;

function subtle() {
  const crypto = globalThis.crypto;
  if (!crypto?.subtle) {
    throw new Error("WebCrypto is unavailable: the API requires a runtime with crypto.subtle");
  }
  return crypto.subtle;
}

export function randomBytes(length: number): Uint8Array {
  const bytes = new Uint8Array(length);
  globalThis.crypto.getRandomValues(bytes);
  return bytes;
}

export function base64(bytes: Uint8Array): string {
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary);
}

export function fromBase64(value: string): Uint8Array {
  const binary = atob(value);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i += 1) bytes[i] = binary.charCodeAt(i);
  return bytes;
}

export function base64url(bytes: Uint8Array): string {
  return base64(bytes).replaceAll("+", "-").replaceAll("/", "_").replaceAll("=", "");
}

async function derive(password: string, salt: Uint8Array, iterations: number): Promise<Uint8Array> {
  const key = await subtle().importKey("raw", new TextEncoder().encode(password), "PBKDF2", false, [
    "deriveBits",
  ]);
  const parameters: { name: string; hash: string; salt: Uint8Array; iterations: number } = {
    name: "PBKDF2",
    hash: "SHA-256",
    salt,
    iterations,
  };
  const bits = await subtle().deriveBits(parameters as never, key, KEY_BITS);
  return new Uint8Array(bits);
}

export async function hashPassword(password: string): Promise<string> {
  const salt = randomBytes(SALT_BYTES);
  const hash = await derive(password, salt, PBKDF2_ITERATIONS);
  return `pbkdf2-sha256$${PBKDF2_ITERATIONS}$${base64(salt)}$${base64(hash)}`;
}

/**
 * Verify a password. The comparison is constant-time and the stored parameters are
 * read from the record, so raising the iteration count later does not invalidate
 * existing hashes.
 */
export async function verifyPassword(password: string, stored: string): Promise<boolean> {
  const [scheme, iterationsRaw, saltRaw, hashRaw] = stored.split("$");
  if (scheme !== "pbkdf2-sha256" || !iterationsRaw || !saltRaw || !hashRaw) return false;
  const iterations = Number(iterationsRaw);
  if (!Number.isInteger(iterations) || iterations < 10_000) return false;
  const expected = fromBase64(hashRaw);
  const actual = await derive(password, fromBase64(saltRaw), iterations);
  if (actual.length !== expected.length) return false;
  let difference = 0;
  for (let i = 0; i < actual.length; i += 1) difference |= (actual[i] ?? 0) ^ (expected[i] ?? 0);
  return difference === 0;
}

/** A new session token and its storage hash. Only the hash is persisted. */
export async function createSessionToken(): Promise<{ token: string; tokenHash: string }> {
  const token = `ps_sess_${base64url(randomBytes(32))}`;
  return { token, tokenHash: await sha256Hex(token) };
}

export async function hashToken(token: string): Promise<string> {
  return sha256Hex(token);
}

/** A project API key. The plaintext is shown once and never stored. */
export async function createApiKeyToken(): Promise<{
  token: string;
  tokenHash: string;
  prefix: string;
}> {
  const token = `psk_${base64url(randomBytes(24))}`;
  return { token, tokenHash: await sha256Hex(token), prefix: token.slice(0, 12) };
}

export function sessionExpiry(now = new Date()): string {
  return new Date(now.getTime() + SESSION_TTL_DAYS * 86_400_000).toISOString();
}

// ------------------------------------------------------------------- cookies

export function readCookie(header: string | undefined, name: string): string | undefined {
  if (!header) return undefined;
  for (const part of header.split(";")) {
    const [key, ...rest] = part.trim().split("=");
    if (key === name) return decodeURIComponent(rest.join("="));
  }
  return undefined;
}

export function serializeSessionCookie(
  token: string,
  options: { secure: boolean; maxAgeSeconds?: number }
): string {
  const parts = [
    `${SESSION_COOKIE}=${encodeURIComponent(token)}`,
    "Path=/",
    "HttpOnly",
    "SameSite=Lax",
    `Max-Age=${options.maxAgeSeconds ?? SESSION_TTL_DAYS * 86_400}`,
  ];
  if (options.secure) parts.push("Secure");
  return parts.join("; ");
}

export function clearSessionCookie(secure: boolean): string {
  return serializeSessionCookie("", { secure, maxAgeSeconds: 0 });
}

/** Constant-time signature comparison helper kept here for route code symmetry. */
export async function signPayload(secret: string, payload: string): Promise<string> {
  return hmacSha256Hex(secret, payload);
}

export { timingSafeEqualHex };
