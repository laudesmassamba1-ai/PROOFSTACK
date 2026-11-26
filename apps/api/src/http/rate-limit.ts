import type { Services } from "./services.js";

/**
 * Distributed rate limiting.
 *
 * The database counter is the budget; the in-memory map is only a guard for the case
 * where the database itself is failing. That fallback is reported as `degraded` rather
 * than hidden: a limit that silently stopped counting is worse than no limit at all,
 * because the product would keep claiming it is protected.
 */

const local = new Map<string, { count: number; resetAt: number }>();

export interface RateLimitDecision {
  allowed: boolean;
  retryAfterSeconds: number;
  remaining: number;
  degraded: boolean;
}

export async function checkDistributedRateLimit(
  services: Services,
  input: { scope: string; key: string; limit: number; windowMs: number }
): Promise<RateLimitDecision> {
  const now = services.clock();
  try {
    const { count, resetAt } = await services.store.hitRateLimit({
      scope: input.scope,
      key: input.key,
      windowMs: input.windowMs,
      now,
    });
    const retryAfterSeconds = Math.max(
      1,
      Math.ceil((new Date(resetAt).getTime() - now.getTime()) / 1000)
    );
    return {
      allowed: count <= input.limit,
      retryAfterSeconds,
      remaining: Math.max(0, input.limit - count),
      degraded: false,
    };
  } catch {
    return localDecision(input, now.getTime());
  }
}

/**
 * The fallback: correct within one isolate, and honest about it.
 *
 * The key includes the scope so two features that happen to use the same string do not
 * share a budget by accident.
 */
function localDecision(
  input: { scope: string; key: string; limit: number; windowMs: number },
  now: number
): RateLimitDecision {
  const key = input.scope + "|" + input.key;
  const entry = local.get(key);
  if (!entry || entry.resetAt <= now) {
    local.set(key, { count: 1, resetAt: now + input.windowMs });
    return {
      allowed: 1 <= input.limit,
      retryAfterSeconds: Math.ceil(input.windowMs / 1000),
      remaining: Math.max(0, input.limit - 1),
      degraded: true,
    };
  }
  entry.count += 1;
  return {
    allowed: entry.count <= input.limit,
    retryAfterSeconds: Math.max(1, Math.ceil((entry.resetAt - now) / 1000)),
    remaining: Math.max(0, input.limit - entry.count),
    degraded: true,
  };
}

/** Only for tests: the fallback map must not leak between cases. */
export function resetLocalRateLimits(): void {
  local.clear();
}
