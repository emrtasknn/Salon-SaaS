/**
 * Next.js calls register() once when a server instance starts, before it
 * serves requests. Used for production env validation (WP-5): a missing or
 * short RATE_LIMIT_HMAC_SECRET must stop the server, not degrade silently.
 */
export async function register(): Promise<void> {
  if (process.env.NEXT_RUNTIME !== "nodejs") return;
  // `next build` may load instrumentation while prerendering; validate at runtime only.
  if (process.env.NEXT_PHASE === "phase-production-build") return;
  const { assertRateLimitSecretForProduction } = await import("./infrastructure/rate-limit-secret");
  assertRateLimitSecretForProduction();
}
