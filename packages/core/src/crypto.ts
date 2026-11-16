import { ProofstackError } from "./errors.js";

/**
 * Minimal structural types for the Web Crypto surface PROOFSTACK depends on.
 *
 * Declaring them here (instead of adding the DOM lib) keeps every package free of
 * a DOM dependency while still type-checking in the three real runtimes: Node 22,
 * Cloudflare Workers and the browser build of the web app. All of them expose
 * `globalThis.crypto` with these members.
 */
export interface CryptoKeyLike {
  readonly type: string;
  readonly extractable: boolean;
  readonly algorithm: unknown;
  readonly usages: readonly string[];
}

export interface SubtleCryptoLike {
  digest(algorithm: "SHA-256", data: Uint8Array): Promise<ArrayBuffer>;
  importKey(
    format: "raw",
    keyMaterial: Uint8Array,
    algorithm: { name: "HMAC"; hash: "SHA-256" },
    extractable: boolean,
    keyUsages: readonly ("sign" | "verify")[],
  ): Promise<CryptoKeyLike>;
  sign(
    algorithm: { name: "HMAC" },
    key: CryptoKeyLike,
    data: Uint8Array,
  ): Promise<ArrayBuffer>;
}

export interface CryptoLike {
  randomUUID(): string;
  getRandomValues<T extends Uint8Array>(array: T): T;
  readonly subtle: SubtleCryptoLike;
}

export function webcrypto(): CryptoLike {
  const c = (globalThis as { crypto?: CryptoLike }).crypto;
  if (!c || typeof c.randomUUID !== "function" || !c.subtle) {
    throw new ProofstackError({
      message:
        "globalThis.crypto is unavailable in this runtime; PROOFSTACK needs Web Crypto for identifiers, checksums and signature checks",
      category: "CONFIGURATION",
      code: "crypto_unavailable",
    });
  }
  return c;
}

export function requireCrypto(): void {
  webcrypto();
}
