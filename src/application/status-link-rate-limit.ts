// WP-06 limiter port for the customer status link. WP-05's implementation provides the
// real adapter (buckets: status.view IP 30/10 min, status.miss IP 10/10 min).

export type StatusLinkRateLimitBucket = "status.view" | "status.miss";

export type StatusLinkRateLimiter = Readonly<{
  hit(bucket: StatusLinkRateLimitBucket): Promise<"allowed" | "limited">;
}>;

/** Always allows. Used until WP-05 wires the persistent IP-based limiter. */
export function createNoopStatusLinkRateLimiter(): StatusLinkRateLimiter {
  return { hit: async () => "allowed" };
}
