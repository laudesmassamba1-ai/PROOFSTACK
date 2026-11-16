import { webcrypto } from "./crypto.js";
import { ProofstackError } from "./errors.js";
import { sha256Hex } from "./hash.js";

/**
 * Identifier helpers.
 *
 * Availability: `globalThis.crypto` is present in Node >= 19 and in Cloudflare
 * Workers, so no polyfill is required in either runtime.
 */
export function uuid(): string {
  return webcrypto().randomUUID();
}

const ALPHABET = "0123456789abcdefghijklmnopqrstuvwxyz";

/** URL-safe short id from crypto randomness (default 16 chars ≈ 82 bits). */
export function shortId(length = 16): string {
  if (length < 4 || length > 64) {
    throw new ProofstackError({
      message: `shortId length must be between 4 and 64, received ${length}`,
      category: "VALIDATION",
      code: "bad_length",
    });
  }
  const bytes = new Uint8Array(length);
  webcrypto().getRandomValues(bytes);
  let out = "";
  for (let i = 0; i < length; i++) out += ALPHABET[(bytes[i] as number) % ALPHABET.length];
  return out;
}

/**
 * Deterministic, namespaced identifier (v5-style: derived from content, not from
 * randomness). Used for reproducible fixtures and for idempotency keys so a retry
 * of the same intent reuses the same key instead of moving money twice.
 */
export async function deterministicId(
  namespace: string,
  parts: readonly string[]
): Promise<string> {
  const digest = await sha256Hex([namespace, ...parts].join("\u0000"));
  return [
    digest.slice(0, 8),
    digest.slice(8, 12),
    `5${digest.slice(13, 16)}`,
    ((Number.parseInt(digest.slice(16, 18), 16) & 0b0011_1000) | 0b1000_0000).toString(16) +
      digest.slice(18, 20),
    digest.slice(20, 32),
  ].join("-");
}

/**
 * Unicode-aware slug: keeps no accents, never strips a whole non-Latin word to
 * empty (falls back to a transliteration-free hash suffix instead).
 */
export function slugify(input: string, maxLength = 48): string {
  const base = input
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/['’]/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, maxLength)
    .replace(/-+$/g, "");
  return base.length > 0 ? base : "item";
}

export function isUuid(value: string): boolean {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value);
}
