/**
 * Deterministic pseudo-randomness.
 *
 * Every generated fixture is derived from `engine.seed` plus the case id, so a
 * reported failure can be reproduced by re-running the same command — not by
 * hoping the random generator lands in the same place twice.
 */

/** SplitMix64 → 32-bit, small and stable across runtimes (no Math.random anywhere). */
export function hashSeed(...parts: (string | number)[]): number {
  let h = 0x9e3779b97f4a7c15n;
  for (const part of parts) {
    const text = typeof part === "number" ? `n${part}` : part;
    for (let i = 0; i < text.length; i++) {
      h = BigInt.asUintN(64, h + BigInt(text.charCodeAt(i)));
      h = BigInt.asUintN(64, h * 0xff51afd7ed558ccdn);
    }
    h = BigInt.asUintN(64, h + 0x1n);
  }
  h ^= h >> 33n;
  h = BigInt.asUintN(64, h * 0xff51afd7ed558ccdn);
  h ^= h >> 33n;
  return Number(h & 0xffffffffn);
}

export class Rng {
  private state: number;

  constructor(seed: number | string) {
    this.state = (typeof seed === "string" ? hashSeed(seed) : seed) >>> 0 || 1;
  }

  /** xorshift32: uniform in [0,1). */
  next(): number {
    let x = this.state;
    x ^= x << 13;
    x >>>= 0;
    x ^= x >>> 17;
    x ^= x << 5;
    x >>>= 0;
    this.state = x;
    return x / 0x1_0000_0000;
  }

  int(maxExclusive: number): number {
    if (maxExclusive <= 0) throw new RangeError(`Rng.int: bad bound ${maxExclusive}`);
    return Math.floor(this.next() * maxExclusive);
  }

  pick<T>(items: readonly T[]): T {
    if (items.length === 0) throw new RangeError("Rng.pick: empty list");
    return items[this.int(items.length)] as T;
  }

  /** Fisher–Yates, deterministic for a given seed. */
  shuffle<T>(items: readonly T[]): T[] {
    const out = [...items];
    for (let i = out.length - 1; i > 0; i--) {
      const j = this.int(i + 1);
      const tmp = out[i] as T;
      out[i] = out[j] as T;
      out[j] = tmp;
    }
    return out;
  }

  bool(probability = 0.5): boolean {
    return this.next() < probability;
  }

  /** Stable alphanumeric token, used for synthetic record ids. */
  token(length = 8): string {
    const alphabet = "abcdefghijklmnopqrstuvwxyz0123456789";
    let out = "";
    for (let i = 0; i < length; i++) out += alphabet[this.int(alphabet.length)];
    return out;
  }
}

export function rngFor(...parts: (string | number)[]): Rng {
  return new Rng(hashSeed(...parts));
}
