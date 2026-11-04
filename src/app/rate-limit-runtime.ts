import "server-only";
import { createRateLimiter, type RateLimitCheck, type RateLimitDecision, type RateLimiter } from "../application/rate-limit";
import { readClientIp } from "../infrastructure/client-ip";
import { resolveRateLimitHasher } from "../infrastructure/rate-limit-secret";
import { getPrisma } from "../infrastructure/prisma-runtime";
import { createPrismaRateLimitStore } from "../persistence/prisma-rate-limit";

let limiter: RateLimiter | undefined;

function getRateLimiter(): RateLimiter {
  if (limiter) return limiter;
  limiter = createRateLimiter({
    // Lazy so a disabled limiter (no secret) never touches the database.
    store: { hit: (key, bucket, windowSeconds) => createPrismaRateLimitStore(getPrisma()).hit(key, bucket, windowSeconds) },
    hash: resolveRateLimitHasher(),
  });
  return limiter;
}

export { readClientIp };

/** Runs the given checks for the current request. Fail-open on store errors. */
export async function checkRateLimit(checks: ReadonlyArray<RateLimitCheck>): Promise<RateLimitDecision> {
  return getRateLimiter().check(checks);
}
