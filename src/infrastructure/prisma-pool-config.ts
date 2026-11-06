import type { PoolConfig } from "pg";

/**
 * Per-instance pg Pool settings for the Vercel runtime.
 *
 * Every warm serverless instance owns its own Pool. Supabase's pooler caps the
 * clients it accepts (15 in session mode on the pilot), so large per-instance
 * pools let two or three instances exhaust it and every query fails with
 * EMAXCONNSESSION. Keep each instance small, release idle clients quickly and
 * fail fast instead of queueing forever.
 */
export const DEFAULT_POOL_MAX = 3;
export const MAX_POOL_MAX = 10;
const IDLE_TIMEOUT_MS = 5_000;
const CONNECTION_TIMEOUT_MS = 10_000;

type PoolEnv = Readonly<{ DATABASE_URL?: string; DATABASE_POOL_MAX?: string }>;

function readPoolMax(value: string | undefined): number {
  if (value === undefined || !/^\d+$/.test(value)) return DEFAULT_POOL_MAX;
  const parsed = Number(value);
  return parsed >= 1 && parsed <= MAX_POOL_MAX ? parsed : DEFAULT_POOL_MAX;
}

export function createRuntimePoolConfig(env: PoolEnv): PoolConfig {
  const connectionString = env.DATABASE_URL;
  if (!connectionString) throw new Error("DATABASE_URL is not configured");
  return {
    connectionString,
    max: readPoolMax(env.DATABASE_POOL_MAX),
    idleTimeoutMillis: IDLE_TIMEOUT_MS,
    connectionTimeoutMillis: CONNECTION_TIMEOUT_MS,
  };
}
