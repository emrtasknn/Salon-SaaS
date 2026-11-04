import type { RateLimitStore } from "../application/rate-limit";

/**
 * Store adapter for private.rate_limit_hit (migration 20261104100000_rate_limit).
 * Runs as its own statement, deliberately outside withPrismaTenantContext: the
 * table is non-tenant and needs no app.tenant_id. Keys are HMACs only.
 */

export type PrismaRateLimitClient = {
  $queryRaw<T = unknown>(query: TemplateStringsArray, ...values: unknown[]): PromiseLike<T>;
};

type Row = { hit_count: number | bigint; window_start: Date | string };

export function createPrismaRateLimitStore(prisma: PrismaRateLimitClient): RateLimitStore {
  return {
    async hit(key, bucket, windowSeconds) {
      const rows = await prisma.$queryRaw<Row[]>`SELECT hit_count, window_start FROM private.rate_limit_hit(${key}, ${bucket}, ${windowSeconds}::integer)`;
      const row = rows[0];
      if (!row) throw new Error("rate_limit_hit returned no row");
      return { count: Number(row.hit_count), windowStart: new Date(row.window_start) };
    },
  };
}
