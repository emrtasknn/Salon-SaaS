import { describe, expect, it, vi } from "vitest";
import {
  RATE_LIMIT_SECRET_MIN_BYTES,
  assertRateLimitSecretForProduction,
  checkRateLimitSecret,
  createHmacRateLimitHasher,
  resolveRateLimitHasher,
} from "./rate-limit-secret";

const SECRET_A = "a".repeat(RATE_LIMIT_SECRET_MIN_BYTES);
const SECRET_B = "b".repeat(48);
const SHORT = "s".repeat(RATE_LIMIT_SECRET_MIN_BYTES - 1);

describe("checkRateLimitSecret", () => {
  it.each([
    [undefined, { ok: false, reason: "MISSING" }],
    ["", { ok: false, reason: "MISSING" }],
    [SHORT, { ok: false, reason: "TOO_SHORT" }],
    [SECRET_A, { ok: true, secret: SECRET_A }],
  ])("%j → %j", (secret, expected) => {
    expect(checkRateLimitSecret(secret)).toEqual(expected);
  });

  it("measures bytes, not characters", () => {
    expect(checkRateLimitSecret("ğ".repeat(16)).ok).toBe(true); // 32 bytes UTF-8
    expect(checkRateLimitSecret("ğ".repeat(15) + "x").ok).toBe(false); // 31 bytes
  });
});

describe("assertRateLimitSecretForProduction", () => {
  it.each([
    [{ NODE_ENV: "production" }, /missing/],
    [{ NODE_ENV: "production", RATE_LIMIT_HMAC_SECRET: "" }, /missing/],
    [{ NODE_ENV: "production", RATE_LIMIT_HMAC_SECRET: SHORT }, /shorter than 32 bytes/],
  ])("throws in production for %j", (env, message) => {
    expect(() => assertRateLimitSecretForProduction(env)).toThrow(message);
  });

  it("never puts the secret value into the error", () => {
    try {
      assertRateLimitSecretForProduction({ NODE_ENV: "production", RATE_LIMIT_HMAC_SECRET: SHORT });
      expect.unreachable();
    } catch (error) {
      expect(String(error)).not.toContain(SHORT);
    }
  });

  it("passes in production with a valid secret", () => {
    expect(() => assertRateLimitSecretForProduction({ NODE_ENV: "production", RATE_LIMIT_HMAC_SECRET: SECRET_A })).not.toThrow();
  });

  it.each([{}, { NODE_ENV: "development" }, { NODE_ENV: "test" }, { NODE_ENV: "development", RATE_LIMIT_HMAC_SECRET: SHORT }])(
    "is a no-op outside production (%j)",
    (env) => {
      expect(() => assertRateLimitSecretForProduction(env)).not.toThrow();
    },
  );
});

describe("resolveRateLimitHasher", () => {
  it.each([
    [{}, /missing/],
    [{ NODE_ENV: "development", RATE_LIMIT_HMAC_SECRET: SHORT }, /too short/],
  ])("returns null and warns for %j (limiter disabled)", (env, message) => {
    const warn = vi.fn();
    expect(resolveRateLimitHasher(env, warn)).toBeNull();
    expect(warn).toHaveBeenCalledTimes(1);
    expect(warn.mock.calls[0][0]).toMatch(message);
    expect(warn.mock.calls[0][0]).not.toContain(SHORT);
  });

  it("returns a hasher without warning when the secret is valid", () => {
    const warn = vi.fn();
    const hasher = resolveRateLimitHasher({ RATE_LIMIT_HMAC_SECRET: SECRET_A }, warn);
    expect(hasher).toBeTypeOf("function");
    expect(warn).not.toHaveBeenCalled();
    expect(hasher!("v1|booking.submit|t|1.2.3.4")).toBe(createHmacRateLimitHasher(SECRET_A)("v1|booking.submit|t|1.2.3.4"));
  });
});

describe("createHmacRateLimitHasher", () => {
  const input = "v1|booking.submit|tenant-1|203.0.113.7";

  it("returns 64 lowercase hex chars without the input or secret", () => {
    const out = createHmacRateLimitHasher(SECRET_A)(input);
    expect(out).toMatch(/^[0-9a-f]{64}$/);
    expect(out).not.toContain("203.0.113.7");
  });

  it("is deterministic", () => {
    expect(createHmacRateLimitHasher(SECRET_A)(input)).toBe(createHmacRateLimitHasher(SECRET_A)(input));
  });

  it("differs per secret and per input", () => {
    const a = createHmacRateLimitHasher(SECRET_A);
    expect(a(input)).not.toBe(createHmacRateLimitHasher(SECRET_B)(input));
    expect(a(input)).not.toBe(a(input + "x"));
  });

  it("matches the RFC 4231 HMAC-SHA256 test case 2", () => {
    expect(createHmacRateLimitHasher("Jefe")("what do ya want for nothing?")).toBe(
      "5bdcc146bf60754e6a042426089575c75a003f089d2739839dec58b964ec3843",
    );
  });
});
