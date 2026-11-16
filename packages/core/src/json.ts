import { ProofstackError } from "./errors.js";

/**
 * Deterministic JSON. Used for manifests, checksums and report digests: two
 * payloads that mean the same thing must hash to the same value, which plain
 * JSON.stringify does not guarantee because key order follows insertion order.
 */

export type JsonValue = string | number | boolean | null | JsonValue[] | { [key: string]: JsonValue };

export function stableStringify(value: unknown, indent = 0): string {
  const seen = new WeakSet<object>();
  const walk = (node: unknown, depth: number): string => {
    if (node === undefined) throw new ProofstackError({
      message: "stableStringify: undefined is not a JSON value",
      category: "VALIDATION",
      code: "undefined_value",
    });
    if (typeof node === "bigint") return JSON.stringify(`${node}n`);
    if (node === null || typeof node !== "object") return JSON.stringify(node);
    if (seen.has(node as object)) {
      // A digest of a truncated structure would look authoritative and be wrong,
      // so a cycle is an error rather than a "[cyclic]" placeholder.
      throw new ProofstackError({
        message: "stableStringify: cyclic structure cannot be canonicalized",
        category: "VALIDATION",
        code: "cyclic_structure",
      });
    }
    seen.add(node as object);
    const pretty = indent > 0;
    const pad = pretty ? " ".repeat(indent * (depth + 1)) : "";
    const closePad = pretty ? " ".repeat(indent * depth) : "";
    const nl = pretty ? "\n" : "";
    if (Array.isArray(node)) {
      if (node.length === 0) return "[]";
      const items = node.map((item) => `${pad}${walk(item, depth + 1)}`);
      return `[${nl}${items.join(`,${nl}`)}${nl}${closePad}]`;
    }
    const obj = node as Record<string, unknown>;
    const keys = Object.keys(obj).filter((k) => obj[k] !== undefined).sort();
    if (keys.length === 0) return "{}";
    const sep = pretty ? ": " : ":";
    const entries = keys.map((k) => `${pad}${JSON.stringify(k)}${sep}${walk(obj[k], depth + 1)}`);
    return `{${nl}${entries.join(`,${nl}`)}${nl}${closePad}}`;
  };
  return walk(value, 0);
}

/** Compact canonical form, suitable as a digest input. */
export function canonical(value: unknown): string {
  return stableStringify(value, 0);
}

export function parseJsonSafe(text: string): { ok: true; value: JsonValue } | { ok: false; error: string } {
  try {
    return { ok: true, value: JSON.parse(text) as JsonValue };
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : String(error) };
  }
}
