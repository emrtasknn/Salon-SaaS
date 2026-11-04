import { createHmac } from "node:crypto";
import type { RateLimitHasher } from "../application/rate-limit";

/**
 * RATE_LIMIT_HMAC_SECRET handling (WP-5, owner decision 5).
 * - production: missing/short secret fails loudly at server start (src/instrumentation.ts).
 * - dev/test: missing/short secret disables the limiter with a warning.
 * The secret value is never logged.
 */

export const RATE_LIMIT_SECRET_MIN_BYTES = 32;

type Env = Readonly<Record<string, string | undefined>>;

export type RateLimitSecretCheck =
  | { readonly ok: true; readonly secret: string }
  | { readonly ok: false; readonly reason: "MISSING" | "TOO_SHORT" };

export function checkRateLimitSecret(secret: string | undefined): RateLimitSecretCheck {
  if (!secret) return { ok: false, reason: "MISSING" };
  if (Buffer.byteLength(secret, "utf8") < RATE_LIMIT_SECRET_MIN_BYTES) return { ok: false, reason: "TOO_SHORT" };
  return { ok: true, secret };
}

export function createHmacRateLimitHasher(secret: string): RateLimitHasher {
  return (input) => createHmac("sha256", secret).update(input, "utf8").digest("hex");
}

/** Throws in production when the secret is missing or shorter than 32 bytes. No-op elsewhere. */
export function assertRateLimitSecretForProduction(env: Env = process.env): void {
  if (env.NODE_ENV !== "production") return;
  const check = checkRateLimitSecret(env.RATE_LIMIT_HMAC_SECRET);
  if (!check.ok) {
    throw new Error(
      `RATE_LIMIT_HMAC_SECRET is ${check.reason === "MISSING" ? "missing" : "shorter than 32 bytes"}; refusing to start in production.`,
    );
  }
}

/**
 * Hasher for the runtime limiter, or null (limiter disabled) with a warning.
 * In production the startup check already refuses to boot without a valid
 * secret; at request time we never throw (fail-open, decision 5).
 */
export function resolveRateLimitHasher(
  env: Env = process.env,
  warn: (message: string) => void = (message) => console.warn(message),
): RateLimitHasher | null {
  const check = checkRateLimitSecret(env.RATE_LIMIT_HMAC_SECRET);
  if (check.ok) return createHmacRateLimitHasher(check.secret);
  warn(`[rate-limit] disabled: RATE_LIMIT_HMAC_SECRET ${check.reason === "MISSING" ? "missing" : "too short"}`);
  return null;
}
