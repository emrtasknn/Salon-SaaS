import { describe, expect, it, vi } from "vitest";
import type { RateLimitCheck } from "./rate-limit";
import { createNoopStatusLinkRateLimiter, createStatusLinkRateLimiter } from "./status-link-rate-limit";

describe("createStatusLinkRateLimiter", () => {
  it("checks the bucket by client IP only (no tenant, no token)", async () => {
    const check = vi.fn<(checks: ReadonlyArray<RateLimitCheck>) => Promise<{ status: "ALLOWED" }>>(async () => ({ status: "ALLOWED" }));
    const limiter = createStatusLinkRateLimiter({ check, readClientIp: async () => "203.0.113.7" });
    await expect(limiter.hit("status.view")).resolves.toBe("allowed");
    expect(check).toHaveBeenCalledWith([{ bucket: "status.view", subject: "203.0.113.7" }]);
  });

  it("maps RATE_LIMITED to limited", async () => {
    const limiter = createStatusLinkRateLimiter({
      check: async () => ({ status: "RATE_LIMITED", retryAfterSeconds: 60 }),
      readClientIp: async () => "203.0.113.7",
    });
    await expect(limiter.hit("status.miss")).resolves.toBe("limited");
  });

  it("reads the client IP once per instance", async () => {
    const readClientIp = vi.fn(async () => "203.0.113.7");
    const check = vi.fn(async () => ({ status: "ALLOWED" as const }));
    const limiter = createStatusLinkRateLimiter({ check, readClientIp });
    await limiter.hit("status.view");
    await limiter.hit("status.miss");
    expect(readClientIp).toHaveBeenCalledTimes(1);
    expect(check).toHaveBeenCalledTimes(2);
  });

  it("passes a null subject through when no trusted IP is available (WP-05 skips the check)", async () => {
    const check = vi.fn<(checks: ReadonlyArray<RateLimitCheck>) => Promise<{ status: "ALLOWED" }>>(async () => ({ status: "ALLOWED" }));
    const limiter = createStatusLinkRateLimiter({ check, readClientIp: async () => null });
    await expect(limiter.hit("status.view")).resolves.toBe("allowed");
    expect(check).toHaveBeenCalledWith([{ bucket: "status.view", subject: null }]);
  });
});

describe("createNoopStatusLinkRateLimiter", () => {
  it("always allows", async () => {
    await expect(createNoopStatusLinkRateLimiter().hit("status.view")).resolves.toBe("allowed");
  });
});
