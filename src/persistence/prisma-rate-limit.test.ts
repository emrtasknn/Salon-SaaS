import { describe, expect, it, vi } from "vitest";
import { createPrismaRateLimitStore, type PrismaRateLimitClient } from "./prisma-rate-limit";

const KEY = "a".repeat(64);

function fakeClient(rows: unknown[] | (() => Promise<unknown[]>)) {
  const queryRaw = vi.fn((strings: TemplateStringsArray, ...values: unknown[]) => {
    void strings;
    void values;
    return typeof rows === "function" ? rows() : Promise.resolve(rows);
  });
  const client = { $queryRaw: queryRaw } as unknown as PrismaRateLimitClient;
  return { client, queryRaw };
}

describe("createPrismaRateLimitStore", () => {
  it("passes key, bucket and window as bound parameters, not interpolated SQL", async () => {
    const { client, queryRaw } = fakeClient([{ hit_count: 1, window_start: new Date("2026-11-04T12:00:00Z") }]);

    await createPrismaRateLimitStore(client).hit(KEY, "booking.submit", 600);

    expect(queryRaw).toHaveBeenCalledTimes(1);
    const [strings, ...values] = queryRaw.mock.calls[0];
    expect(Array.isArray(strings)).toBe(true);
    expect(values).toEqual([KEY, "booking.submit", 600]);
    const sqlText = strings.join("?");
    expect(sqlText).toContain("private.rate_limit_hit(");
    expect(sqlText).not.toContain(KEY);
    expect(sqlText).not.toContain("booking.submit");
    expect(sqlText).not.toContain("600");
    expect(strings).toHaveLength(4);
  });

  it("maps a row to { count, windowStart }", async () => {
    const windowStart = new Date("2026-11-04T12:00:00.000Z");
    const { client } = fakeClient([{ hit_count: 3, window_start: windowStart }]);

    await expect(createPrismaRateLimitStore(client).hit(KEY, "booking.availability", 60)).resolves.toEqual({
      count: 3,
      windowStart,
    });
  });

  it("accepts bigint counts and string timestamps", async () => {
    const { client } = fakeClient([{ hit_count: BigInt(21), window_start: "2026-11-04T11:00:00.000Z" }]);

    const result = await createPrismaRateLimitStore(client).hit(KEY, "booking.submit.global", 3600);

    expect(result.count).toBe(21);
    expect(result.windowStart).toBeInstanceOf(Date);
    expect(result.windowStart.toISOString()).toBe("2026-11-04T11:00:00.000Z");
  });

  it("throws when no row comes back (limiter fails open upstream)", async () => {
    const { client } = fakeClient([]);
    await expect(createPrismaRateLimitStore(client).hit(KEY, "booking.submit", 600)).rejects.toThrow(/no row/);
  });

  it("propagates database errors", async () => {
    const { client } = fakeClient(() => Promise.reject(new Error("22023")));
    await expect(createPrismaRateLimitStore(client).hit(KEY, "booking.submit", 600)).rejects.toThrow("22023");
  });
});
