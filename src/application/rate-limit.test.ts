import { createHash } from "node:crypto";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  RATE_LIMIT_POLICIES,
  createRateLimiter,
  normalizePhoneSubject,
  rateLimitKeyInput,
  type RateLimitLogEvent,
  type RateLimitStore,
} from "./rate-limit";

const NOW = new Date("2026-11-04T12:00:00.000Z");
const IP = "203.0.113.7";
const PHONE = "+905551112233";
const TENANT = "tenant-from-slug";
const HEX64 = /^[0-9a-f]{64}$/;

const sha = (input: string) => createHash("sha256").update(input, "utf8").digest("hex");

function setup(options: {
  hit?: RateLimitStore["hit"];
  hash?: ((input: string) => string) | null;
} = {}) {
  const hit = vi.fn<RateLimitStore["hit"]>(options.hit ?? (async () => ({ count: 1, windowStart: NOW })));
  const hash = options.hash === null ? null : vi.fn(options.hash ?? sha);
  const log = vi.fn<(event: RateLimitLogEvent) => void>();
  const limiter = createRateLimiter({ store: { hit }, hash, now: () => NOW, log });
  return { limiter, hit, hash, log };
}

const secondsAgo = (seconds: number) => new Date(NOW.getTime() - seconds * 1000);

afterEach(() => {
  vi.restoreAllMocks();
});

describe("createRateLimiter", () => {
  it("allows when the count is at or under the limit", async () => {
    const limit = RATE_LIMIT_POLICIES["booking.submit"].limit;
    const { limiter, hit } = setup({ hit: async () => ({ count: limit, windowStart: secondsAgo(10) }) });

    await expect(limiter.check([{ bucket: "booking.submit", tenantId: TENANT, subject: IP }])).resolves.toEqual({
      status: "ALLOWED",
    });
    expect(hit).toHaveBeenCalledWith(expect.stringMatching(HEX64), "booking.submit", 600);
  });

  it("limits once count exceeds the limit, retryAfter = window end - now", async () => {
    const limit = RATE_LIMIT_POLICIES["booking.submit"].limit;
    const { limiter } = setup({ hit: async () => ({ count: limit + 1, windowStart: secondsAgo(100) }) });

    await expect(limiter.check([{ bucket: "booking.submit", tenantId: TENANT, subject: IP }])).resolves.toEqual({
      status: "RATE_LIMITED",
      retryAfterSeconds: 500,
    });
  });

  it("rounds retryAfter up to whole seconds", async () => {
    // availability: 60 s window; window started 58.8 s ago → 1.2 s left → 2.
    const { limiter } = setup({ hit: async () => ({ count: 61, windowStart: secondsAgo(58.8) }) });

    await expect(limiter.check([{ bucket: "booking.availability", subject: IP }])).resolves.toEqual({
      status: "RATE_LIMITED",
      retryAfterSeconds: 2,
    });
  });

  it("returns at least 1 second when the window already ended", async () => {
    const { limiter } = setup({ hit: async () => ({ count: 99, windowStart: secondsAgo(10_000) }) });

    await expect(limiter.check([{ bucket: "booking.availability", subject: IP }])).resolves.toEqual({
      status: "RATE_LIMITED",
      retryAfterSeconds: 1,
    });
  });

  it("returns the max retryAfter across limited checks and hits every check", async () => {
    const { limiter, hit } = setup({
      hit: async (_key, bucket) => {
        if (bucket === "booking.submit") return { count: 6, windowStart: secondsAgo(500) }; // 100 s left
        if (bucket === "booking.submit.global") return { count: 21, windowStart: secondsAgo(600) }; // 3000 s left
        return { count: 1, windowStart: NOW }; // phone: under limit
      },
    });

    const decision = await limiter.check([
      { bucket: "booking.submit", tenantId: TENANT, subject: IP },
      { bucket: "booking.submit.global", subject: IP },
      { bucket: "booking.submit.phone", tenantId: TENANT, subject: PHONE },
    ]);

    expect(decision).toEqual({ status: "RATE_LIMITED", retryAfterSeconds: 3000 });
    expect(hit).toHaveBeenCalledTimes(3);
  });

  it("allows an empty check list", async () => {
    const { limiter, hit } = setup();
    await expect(limiter.check([])).resolves.toEqual({ status: "ALLOWED" });
    expect(hit).not.toHaveBeenCalled();
  });

  it.each([null, ""])("skips a check with subject %j and logs the bucket only", async (subject) => {
    const { limiter, hit, hash, log } = setup({ hit: async () => ({ count: 999, windowStart: NOW }) });

    await expect(limiter.check([{ bucket: "booking.submit", tenantId: TENANT, subject }])).resolves.toEqual({
      status: "ALLOWED",
    });
    expect(hit).not.toHaveBeenCalled();
    expect(hash).not.toHaveBeenCalled();
    expect(log).toHaveBeenCalledTimes(1);
    expect(log).toHaveBeenCalledWith({ event: "rate_limit.subject_missing", bucket: "booking.submit" });
  });

  it("skips only the missing-subject check and still enforces the others", async () => {
    const { limiter, hit } = setup({ hit: async () => ({ count: 4, windowStart: secondsAgo(60) }) });

    const decision = await limiter.check([
      { bucket: "booking.submit", tenantId: TENANT, subject: null },
      { bucket: "booking.submit.global", subject: null },
      { bucket: "booking.submit.phone", tenantId: TENANT, subject: PHONE },
    ]);

    expect(hit).toHaveBeenCalledTimes(1);
    expect(hit.mock.calls[0][1]).toBe("booking.submit.phone");
    expect(decision).toEqual({ status: "RATE_LIMITED", retryAfterSeconds: 3540 });
  });

  it.each([undefined, ""])("skips a tenant-scoped check without tenantId (%j), never pooling tenants", async (tenantId) => {
    const { limiter, hit, hash, log } = setup({ hit: async () => ({ count: 999, windowStart: NOW }) });

    const decision = await limiter.check([
      { bucket: "booking.submit", tenantId, subject: IP },
      { bucket: "booking.submit.phone", tenantId, subject: PHONE },
    ]);

    expect(decision).toEqual({ status: "ALLOWED" });
    expect(hit).not.toHaveBeenCalled();
    expect(hash).not.toHaveBeenCalled();
    expect(log.mock.calls).toEqual([
      [{ event: "rate_limit.tenant_missing", bucket: "booking.submit" }],
      [{ event: "rate_limit.tenant_missing", bucket: "booking.submit.phone" }],
    ]);
  });

  it("fails open when the store throws and logs only bucket + error name", async () => {
    const leakyError = new TypeError(`connection failed for ${IP} ${PHONE}`);
    const { limiter, hash, log } = setup({
      hit: async () => {
        throw leakyError;
      },
    });

    const decision = await limiter.check([
      { bucket: "booking.submit", tenantId: TENANT, subject: IP },
      { bucket: "booking.submit.phone", tenantId: TENANT, subject: PHONE },
    ]);

    expect(decision).toEqual({ status: "ALLOWED" });
    expect(log.mock.calls).toEqual([
      [{ event: "rate_limit.store_error", bucket: "booking.submit", errorName: "TypeError" }],
      [{ event: "rate_limit.store_error", bucket: "booking.submit.phone", errorName: "TypeError" }],
    ]);
    const logged = JSON.stringify(log.mock.calls);
    const keys = hash!.mock.results.map((result) => result.value as string);
    expect(keys).toHaveLength(2);
    for (const secret of [IP, PHONE, TENANT, ...keys]) expect(logged).not.toContain(secret);
  });

  it("fails open on a non-Error rejection", async () => {
    const { limiter, log } = setup({
      hit: () => Promise.reject(`boom ${IP}`),
    });

    await expect(limiter.check([{ bucket: "booking.availability", subject: IP }])).resolves.toEqual({
      status: "ALLOWED",
    });
    expect(log).toHaveBeenCalledWith({
      event: "rate_limit.store_error",
      bucket: "booking.availability",
      errorName: "string",
    });
    expect(JSON.stringify(log.mock.calls)).not.toContain(IP);
  });

  it("fails open when the hasher throws", async () => {
    const { limiter, hit, log } = setup({
      hash: () => {
        throw new Error("hash failure");
      },
    });

    await expect(limiter.check([{ bucket: "booking.availability", subject: IP }])).resolves.toEqual({
      status: "ALLOWED",
    });
    expect(hit).not.toHaveBeenCalled();
    expect(log).toHaveBeenCalledWith({ event: "rate_limit.store_error", bucket: "booking.availability", errorName: "Error" });
  });

  it("default logger writes only the structured event (no IP/phone/key)", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    const limiter = createRateLimiter({
      store: { hit: async () => Promise.reject(new Error(`${IP} ${PHONE}`)) },
      hash: sha,
      now: () => NOW,
    });

    await limiter.check([{ bucket: "booking.submit.phone", tenantId: TENANT, subject: PHONE }]);

    expect(warn).toHaveBeenCalledTimes(1);
    const printed = JSON.stringify(warn.mock.calls);
    expect(printed).toContain("rate_limit.store_error");
    for (const secret of [IP, PHONE, TENANT, sha(rateLimitKeyInput("booking.submit.phone", TENANT, PHONE))]) {
      expect(printed).not.toContain(secret);
    }
  });

  it.each([null, undefined])("is disabled when hash is %j: ALLOWED and the store is never called", async (hash) => {
    const hit = vi.fn<RateLimitStore["hit"]>(async () => ({ count: 999, windowStart: NOW }));
    const log = vi.fn();
    const limiter = createRateLimiter({ store: { hit }, hash, now: () => NOW, log });

    await expect(
      limiter.check([
        { bucket: "booking.submit", tenantId: TENANT, subject: IP },
        { bucket: "booking.availability", subject: IP },
      ]),
    ).resolves.toEqual({ status: "ALLOWED" });
    expect(hit).not.toHaveBeenCalled();
  });

  it("builds key input v1|bucket|tenant|subject; IP-only buckets ignore tenantId", async () => {
    const { limiter, hash } = setup();

    await limiter.check([
      { bucket: "booking.submit", tenantId: TENANT, subject: IP },
      { bucket: "booking.submit.global", tenantId: TENANT, subject: IP },
      { bucket: "booking.submit.phone", tenantId: TENANT, subject: PHONE },
      { bucket: "booking.availability", tenantId: TENANT, subject: IP },
    ]);

    expect(hash!.mock.calls.map(([input]) => input)).toEqual([
      `v1|booking.submit|${TENANT}|${IP}`,
      `v1|booking.submit.global|-|${IP}`,
      `v1|booking.submit.phone|${TENANT}|${PHONE}`,
      `v1|booking.availability|-|${IP}`,
    ]);
    expect(rateLimitKeyInput("status.view", undefined, IP)).toBe(`v1|status.view|-|${IP}`);
  });

  it("separates tenant-scoped keys per tenant but shares IP-only keys", async () => {
    const { limiter, hit } = setup();

    await limiter.check([
      { bucket: "booking.submit", tenantId: "tenant-a", subject: IP },
      { bucket: "booking.submit", tenantId: "tenant-b", subject: IP },
      { bucket: "booking.submit.global", tenantId: "tenant-a", subject: IP },
      { bucket: "booking.submit.global", tenantId: "tenant-b", subject: IP },
    ]);

    const keys = hit.mock.calls.map(([key]) => key);
    expect(keys[0]).not.toBe(keys[1]);
    expect(keys[2]).toBe(keys[3]);
  });

  it("passes only the 64-hex hash to the store, never raw IP/phone/tenant", async () => {
    const { limiter, hit, hash } = setup();

    await limiter.check([
      { bucket: "booking.submit", tenantId: TENANT, subject: IP },
      { bucket: "booking.submit.phone", tenantId: TENANT, subject: PHONE },
      { bucket: "booking.availability", subject: "2001:db8:1:2::/64" },
    ]);

    expect(hash!.mock.calls.map(([input]) => input).join("\n")).toContain(IP);
    expect(hit).toHaveBeenCalledTimes(3);
    hit.mock.calls.forEach(([key], index) => {
      expect(key).toMatch(HEX64);
      expect(key).toBe(hash!.mock.results[index].value);
    });
    const storeArgs = JSON.stringify(hit.mock.calls);
    for (const raw of [IP, PHONE, TENANT, "2001:db8"]) expect(storeArgs).not.toContain(raw);
  });

  it("passes each policy's window to the store", async () => {
    const { limiter, hit } = setup();

    await limiter.check([
      { bucket: "booking.submit", tenantId: TENANT, subject: IP },
      { bucket: "booking.submit.global", subject: IP },
      { bucket: "booking.submit.phone", tenantId: TENANT, subject: PHONE },
      { bucket: "booking.availability", subject: IP },
    ]);

    expect(hit.mock.calls.map(([, bucket, windowSeconds]) => [bucket, windowSeconds])).toEqual([
      ["booking.submit", 600],
      ["booking.submit.global", 3600],
      ["booking.submit.phone", 3600],
      ["booking.availability", 60],
    ]);
  });
});

describe("RATE_LIMIT_POLICIES", () => {
  it("matches the approved WP-5 starting limits", () => {
    expect(RATE_LIMIT_POLICIES).toEqual({
      "booking.submit": { limit: 5, windowSeconds: 600, scope: "tenant+ip" },
      "booking.submit.global": { limit: 20, windowSeconds: 3600, scope: "ip" },
      "booking.submit.phone": { limit: 3, windowSeconds: 3600, scope: "tenant+phone" },
      "booking.availability": { limit: 60, windowSeconds: 60, scope: "ip" },
      "status.view": { limit: 30, windowSeconds: 600, scope: "ip" },
      "status.miss": { limit: 10, windowSeconds: 600, scope: "ip" },
    });
  });

  it("uses bucket names and windows accepted by the SQL function", () => {
    for (const [bucket, policy] of Object.entries(RATE_LIMIT_POLICIES)) {
      expect(bucket).toMatch(/^[a-z][a-z0-9_.]{0,63}$/);
      expect(policy.windowSeconds).toBeGreaterThanOrEqual(1);
      expect(policy.windowSeconds).toBeLessThanOrEqual(86400);
    }
  });
});

describe("normalizePhoneSubject", () => {
  it.each([null, undefined, "", "   ", "abc", "+ () -"])("returns null for %j", (phone) => {
    expect(normalizePhoneSubject(phone)).toBeNull();
  });

  it.each([
    ["+905551112233", "905551112233"],
    ["+90 (555) 111-22-33", "905551112233"],
    ["  +90 555 111 22 33  ", "905551112233"],
    ["0555 111 22 33", "905551112233"],
    ["905551112233", "905551112233"],
    ["5551112233", "905551112233"],
    ["0090 555 111 22 33", "905551112233"],
    ["+44 20 7946 0958", "442079460958"],
  ])("normalises %j to %j", (phone, expected) => {
    expect(normalizePhoneSubject(phone)).toBe(expected);
  });

  it("maps every format of the same Turkish number to one subject (no limit multiplication)", () => {
    const formats = ["+905551112233", "905551112233", "05551112233", "5551112233", "00905551112233"];
    expect(new Set(formats.map(normalizePhoneSubject)).size).toBe(1);
  });
});
