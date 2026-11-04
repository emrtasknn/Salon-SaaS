/**
 * WP-5 public-surface rate limiting (fixed window, Postgres-backed store).
 *
 * Pure application logic: no Next.js or Prisma imports. The store and the keyed
 * hasher are injected. Keys are HMACs, so raw IPs/phones never reach the store.
 * Logs carry the bucket name and error name only — never keys, IPs or phones.
 */

export type RateLimitScope = "tenant+ip" | "ip" | "tenant+phone";

export type RateLimitPolicy = Readonly<{
  limit: number;
  windowSeconds: number;
  scope: RateLimitScope;
}>;

export const RATE_LIMIT_POLICIES = {
  "booking.submit": { limit: 5, windowSeconds: 600, scope: "tenant+ip" },
  "booking.submit.global": { limit: 20, windowSeconds: 3600, scope: "ip" },
  "booking.submit.phone": { limit: 3, windowSeconds: 3600, scope: "tenant+phone" },
  "booking.availability": { limit: 60, windowSeconds: 60, scope: "ip" },
  // WP-6 status link (not wired yet).
  "status.view": { limit: 30, windowSeconds: 600, scope: "ip" },
  "status.miss": { limit: 10, windowSeconds: 600, scope: "ip" },
} as const satisfies Record<string, RateLimitPolicy>;

export type RateLimitBucket = keyof typeof RATE_LIMIT_POLICIES;

export interface RateLimitStore {
  hit(key: string, bucket: string, windowSeconds: number): Promise<{ count: number; windowStart: Date }>;
}

/** Keyed hasher (HMAC-SHA256) returning 64 lowercase hex chars. */
export type RateLimitHasher = (input: string) => string;

export type RateLimitCheck = Readonly<{
  bucket: RateLimitBucket;
  /** Trusted server-side tenant id (never client input). Used only for tenant-scoped buckets. */
  tenantId?: string;
  /** Client IP (/64 for IPv6) or normalised phone; null when unavailable → check is skipped. */
  subject: string | null;
}>;

export type RateLimitDecision =
  | { readonly status: "ALLOWED" }
  | { readonly status: "RATE_LIMITED"; readonly retryAfterSeconds: number };

export type RateLimitLogEvent = Readonly<{
  event: "rate_limit.subject_missing" | "rate_limit.tenant_missing" | "rate_limit.store_error";
  bucket: RateLimitBucket;
  errorName?: string;
}>;

export type RateLimitLogger = (event: RateLimitLogEvent) => void;

export type RateLimiter = Readonly<{
  check(checks: ReadonlyArray<RateLimitCheck>): Promise<RateLimitDecision>;
}>;

const ALLOWED: RateLimitDecision = { status: "ALLOWED" };

const defaultLog: RateLimitLogger = (event) => {
  console.warn("[rate-limit]", JSON.stringify(event));
};

export function rateLimitKeyInput(bucket: RateLimitBucket, tenantId: string | undefined, subject: string): string {
  return "v1|" + bucket + "|" + (tenantId ?? "-") + "|" + subject;
}

function errorName(error: unknown): string {
  return error instanceof Error ? error.name : typeof error;
}

export function createRateLimiter(deps: {
  store: RateLimitStore;
  /** null/undefined → limiter disabled (always ALLOWED). */
  hash: RateLimitHasher | null | undefined;
  now?: () => Date;
  log?: RateLimitLogger;
}): RateLimiter {
  const now = deps.now ?? (() => new Date());
  const log = deps.log ?? defaultLog;

  return {
    async check(checks) {
      const hash = deps.hash;
      if (!hash) return ALLOWED;

      let retryAfterSeconds = 0;
      for (const check of checks) {
        const policy: RateLimitPolicy = RATE_LIMIT_POLICIES[check.bucket];
        if (check.subject === null || check.subject === "") {
          log({ event: "rate_limit.subject_missing", bucket: check.bucket });
          continue;
        }
        const tenantScoped = policy.scope.startsWith("tenant+");
        if (tenantScoped && !check.tenantId) {
          // Never pool tenant-scoped buckets across tenants.
          log({ event: "rate_limit.tenant_missing", bucket: check.bucket });
          continue;
        }
        try {
          const key = hash(rateLimitKeyInput(check.bucket, tenantScoped ? check.tenantId : undefined, check.subject));
          const { count, windowStart } = await deps.store.hit(key, check.bucket, policy.windowSeconds);
          if (count > policy.limit) {
            const remainingMs = windowStart.getTime() + policy.windowSeconds * 1000 - now().getTime();
            const seconds = Math.max(1, Math.ceil(remainingMs / 1000));
            retryAfterSeconds = Math.max(retryAfterSeconds, seconds);
          }
        } catch (error) {
          // Fail-open: a limiter fault must never block real bookings.
          log({ event: "rate_limit.store_error", bucket: check.bucket, errorName: errorName(error) });
        }
      }

      return retryAfterSeconds > 0 ? { status: "RATE_LIMITED", retryAfterSeconds } : ALLOWED;
    },
  };
}

/**
 * Phone subject for the per-tenant phone bucket: one canonical digit string
 * (E.164 without "+", default country Türkiye) so that "+90 555…", "90555…",
 * "0555…" and "555…" share a bucket and cannot be used to multiply the limit.
 * Empty → null.
 */
export function normalizePhoneSubject(phone: string | null | undefined): string | null {
  if (!phone) return null;
  let digits = phone.replace(/\D/g, "");
  if (digits.startsWith("00")) digits = digits.slice(2);
  if (digits.length === 11 && digits.startsWith("0")) digits = "90" + digits.slice(1);
  else if (digits.length === 10 && digits.startsWith("5")) digits = "90" + digits;
  return digits.length === 0 ? null : digits;
}
