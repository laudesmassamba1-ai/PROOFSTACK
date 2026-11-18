/**
 * Encryption for stored AI provider keys.
 *
 * AES-256-GCM with a key derived from AI_KEYS_SECRET (HKDF, per-record random
 * nonce). The ciphertext is self-contained: `v1.<nonce>.<ciphertext>` in
 * base64url. A database dump alone reveals nothing; the secret lives only in
 * the deployment environment. If the secret is unset, key storage is refused —
 * the feature stays unavailable rather than silently storing plaintext.
 */

/** WebCrypto handles typed structurally: the api compiles with node types only. */
interface SubtleCryptoLike {
  importKey(
    format: string,
    material: Uint8Array | ArrayBuffer,
    algorithm: string,
    extractable: boolean,
    usages: string[]
  ): Promise<unknown>;
  deriveKey(
    algorithm: { name: string; hash: string; salt: Uint8Array; info: Uint8Array },
    material: unknown,
    derived: { name: string; length: number },
    extractable: boolean,
    usages: string[]
  ): Promise<CryptoKeyLike>;
  encrypt(
    algorithm: { name: string; iv: Uint8Array },
    key: CryptoKeyLike,
    data: Uint8Array
  ): Promise<ArrayBuffer>;
  decrypt(
    algorithm: { name: string; iv: Uint8Array },
    key: CryptoKeyLike,
    data: Uint8Array
  ): Promise<ArrayBuffer>;
  digest(algorithm: string, data: Uint8Array): Promise<ArrayBuffer>;
}

interface CryptoKeyLike {
  readonly type: string;
}

function subtle(): SubtleCryptoLike {
  const handle = (globalThis as { crypto?: { subtle?: SubtleCryptoLike } }).crypto?.subtle;
  if (!handle)
    throw new Error("WebCrypto is unavailable: the API requires a runtime with crypto.subtle");
  return handle;
}

const SALT = new Uint8Array([
  0x70, 0x72, 0x6f, 0x6f, 0x66, 0x63, 0x6f, 0x72, 0x65, 0x2d, 0x61, 0x69, 0x2d, 0x6b, 0x65, 0x79,
]);

async function importMaster(secret: string): Promise<CryptoKeyLike> {
  const handle = subtle();
  const material = await handle.importKey("raw", new TextEncoder().encode(secret), "HKDF", false, [
    "deriveKey",
  ]);
  return handle.deriveKey(
    {
      name: "HKDF",
      hash: "SHA-256",
      salt: SALT,
      info: new TextEncoder().encode("proofcore-ai-key-storage"),
    },
    material,
    { name: "AES-GCM", length: 256 },
    false,
    ["encrypt", "decrypt"]
  );
}

function base64url(bytes: Uint8Array): string {
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replaceAll("+", "-").replaceAll("/", "_").replaceAll("=", "");
}

function fromBase64url(value: string): Uint8Array {
  const normalized = value.replaceAll("-", "+").replaceAll("_", "/");
  const padded = normalized + "=".repeat((4 - (normalized.length % 4)) % 4);
  const binary = atob(padded);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i += 1) bytes[i] = binary.charCodeAt(i);
  return bytes;
}

export function hasEncryptionSecret(config: { aiKeysSecret?: string }): boolean {
  return typeof config.aiKeysSecret === "string" && config.aiKeysSecret.length >= 32;
}

/** Short, non-reversible identifier so the UI can show which key is set. */
export async function keyFingerprint(apiKey: string): Promise<string> {
  const digest = await subtle().digest("SHA-256", new TextEncoder().encode(apiKey));
  return [...new Uint8Array(digest).slice(0, 4)]
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");
}

export async function encryptApiKey(
  config: { aiKeysSecret?: string },
  apiKey: string
): Promise<string> {
  if (!hasEncryptionSecret(config)) {
    throw new Error("AI_KEYS_SECRET is not configured; refusing to store an AI key unencrypted.");
  }
  const key = await importMaster(config.aiKeysSecret as string);
  const nonce = globalThis.crypto.getRandomValues(new Uint8Array(12));
  const ciphertext = new Uint8Array(
    await subtle().encrypt({ name: "AES-GCM", iv: nonce }, key, new TextEncoder().encode(apiKey))
  );
  return `v1.${base64url(nonce)}.${base64url(ciphertext)}`;
}

export async function decryptApiKey(
  config: { aiKeysSecret?: string },
  stored: string
): Promise<string> {
  if (!hasEncryptionSecret(config)) {
    throw new Error("AI_KEYS_SECRET is not configured; the stored key cannot be decrypted.");
  }
  const [version, noncePart, cipherPart] = stored.split(".");
  if (version !== "v1" || !noncePart || !cipherPart) {
    throw new Error("Stored AI key format is unknown.");
  }
  const key = await importMaster(config.aiKeysSecret as string);
  const plaintext = await subtle().decrypt(
    { name: "AES-GCM", iv: fromBase64url(noncePart) },
    key,
    fromBase64url(cipherPart)
  );
  return new TextDecoder().decode(plaintext);
}
