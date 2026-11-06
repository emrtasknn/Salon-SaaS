import { describe, expect, it } from "vitest";
import { DEFAULT_POOL_MAX, MAX_POOL_MAX, createRuntimePoolConfig } from "./prisma-pool-config";

const URL = "postgresql://user:pw@pooler.example:6543/postgres";

describe("createRuntimePoolConfig", () => {
  it("keeps each serverless instance to a few connections by default", () => {
    const config = createRuntimePoolConfig({ DATABASE_URL: URL });
    expect(config.connectionString).toBe(URL);
    expect(config.max).toBe(DEFAULT_POOL_MAX);
    expect(DEFAULT_POOL_MAX).toBeLessThanOrEqual(5);
  });

  it("closes idle connections quickly and fails fast instead of hanging", () => {
    const config = createRuntimePoolConfig({ DATABASE_URL: URL });
    expect(config.idleTimeoutMillis).toBeGreaterThan(0);
    expect(config.idleTimeoutMillis).toBeLessThanOrEqual(10_000);
    expect(config.connectionTimeoutMillis).toBeGreaterThan(0);
    expect(config.connectionTimeoutMillis).toBeLessThanOrEqual(15_000);
  });

  it.each([
    ["1", 1],
    ["4", 4],
    [String(MAX_POOL_MAX), MAX_POOL_MAX],
  ])("accepts DATABASE_POOL_MAX=%s", (value, expected) => {
    expect(createRuntimePoolConfig({ DATABASE_URL: URL, DATABASE_POOL_MAX: value }).max).toBe(expected);
  });

  it.each(["", "0", "-2", "abc", "2.5", String(MAX_POOL_MAX + 1), "1e3"])(
    "falls back to the default for an invalid DATABASE_POOL_MAX=%j",
    (value) => {
      expect(createRuntimePoolConfig({ DATABASE_URL: URL, DATABASE_POOL_MAX: value }).max).toBe(DEFAULT_POOL_MAX);
    },
  );

  it("requires DATABASE_URL", () => {
    expect(() => createRuntimePoolConfig({})).toThrow("DATABASE_URL is not configured");
    expect(() => createRuntimePoolConfig({ DATABASE_URL: "" })).toThrow("DATABASE_URL is not configured");
  });
});
