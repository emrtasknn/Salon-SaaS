// WP-06 limiter port for the customer status link, backed by the WP-05 limiter
// (buckets: status.view IP 30/10 min, status.miss IP 10/10 min).
import type { RateLimitCheck, RateLimitDecision } from "./rate-limit";

export type StatusLinkRateLimitBucket = "status.view" | "status.miss";

export type StatusLinkRateLimiter = Readonly<{
  hit(bucket: StatusLinkRateLimitBucket): Promise<"allowed" | "limited">;
}>;

/** Always allows. For tests and for callers without a request context. */
export function createNoopStatusLinkRateLimiter(): StatusLinkRateLimiter {
  return { hit: async () => "allowed" };
}

/**
 * Adapts the WP-05 limiter to the status-link port. The client IP is read once per
 * instance (one instance per request). No trusted IP → WP-05 skips the check (allowed).
 */
export function createStatusLinkRateLimiter(deps: {
  check: (checks: ReadonlyArray<RateLimitCheck>) => Promise<RateLimitDecision>;
  readClientIp: () => Promise<string | null>;
}): StatusLinkRateLimiter {
  let ip: Promise<string | null> | undefined;
  return {
    async hit(bucket) {
      ip ??= deps.readClientIp();
      const decision = await deps.check([{ bucket, subject: await ip }]);
      return decision.status === "RATE_LIMITED" ? "limited" : "allowed";
    },
  };
}
