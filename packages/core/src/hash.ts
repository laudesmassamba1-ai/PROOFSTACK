import { webcrypto } from "./crypto.js";
import { ProofstackError } from "./errors.js";

/**
 * Hashing on Web Crypto only (available in Node >= 19, Cloudflare Workers and the
 * browser). SHA-256 is the integrity primitive for exports, manifests, evidence
 * files and payment webhook signatures.
 */

function buf(data: string | Uint8Array): Uint8Array {
  if (typeof data === "string") return new TextEncoder().encode(data);
  return data;
}

export async function sha256(data: string | Uint8Array): Promise<Uint8Array> {
  const digest = await webcrypto().subtle.digest("SHA-256", buf(data));
  return new Uint8Array(digest);
}

export async function sha256Hex(data: string | Uint8Array): Promise<string> {
  return toHex(await sha256(data));
}

export function toHex(bytes: Uint8Array): string {
  let out = "";
  for (const b of bytes) out += b.toString(16).padStart(2, "0");
  return out;
}

export function fromHex(value: string): Uint8Array {
  if (!/^([0-9a-fA-F]{2})+$/.test(value)) {
    throw new ProofstackError({
      message: "not a hex string",
      category: "VALIDATION",
      code: "bad_hex",
    });
  }
  const out = new Uint8Array(value.length / 2);
  for (let i = 0; i < out.length; i++) out[i] = Number.parseInt(value.slice(i * 2, i * 2 + 2), 16);
  return out;
}

/** Constant-time comparison of two hex digests. */
export function timingSafeEqualHex(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

export async function hmacSha256(secret: string, message: string): Promise<Uint8Array> {
  const enc = new TextEncoder();
  const key = await webcrypto().subtle.importKey(
    "raw",
    enc.encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const sig = await webcrypto().subtle.sign({ name: "HMAC" }, key, enc.encode(message));
  return new Uint8Array(sig);
}

export async function hmacSha256Hex(secret: string, message: string): Promise<string> {
  return toHex(await hmacSha256(secret, message));
}

export function assertHexDigest(value: string, label = "digest"): void {
  if (!/^[0-9a-f]{64}$/i.test(value)) {
    throw new ProofstackError({
      message: `${label} is not a SHA-256 hex digest`,
      category: "VALIDATION",
      code: "bad_digest",
      details: { label },
    });
  }
}
