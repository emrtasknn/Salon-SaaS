import { afterEach, describe, expect, it, vi } from "vitest";

const { headersMock } = vi.hoisted(() => ({ headersMock: vi.fn() }));
vi.mock("next/headers", () => ({ headers: headersMock }));

import { getClientIp, normalizeIpSubject, readClientIp } from "./client-ip";

const h = (init: Record<string, string>) => new Headers(init);

afterEach(() => {
  vi.unstubAllEnvs();
  headersMock.mockReset();
});

describe("getClientIp modes", () => {
  it("x-vercel-forwarded-for: reads the left-most entry", () => {
    expect(
      getClientIp(h({ "x-vercel-forwarded-for": "203.0.113.5, 10.0.0.1", "x-forwarded-for": "198.51.100.9" }), "x-vercel-forwarded-for"),
    ).toBe("203.0.113.5");
  });

  it("x-forwarded-for: reads the left-most entry, trimmed", () => {
    expect(getClientIp(h({ "x-forwarded-for": "  198.51.100.9 , 10.0.0.1, 10.0.0.2" }), "x-forwarded-for")).toBe(
      "198.51.100.9",
    );
  });

  it("cf-connecting-ip: reads the single value", () => {
    expect(getClientIp(h({ "cf-connecting-ip": "192.0.2.44", "x-forwarded-for": "198.51.100.9" }), "cf-connecting-ip")).toBe(
      "192.0.2.44",
    );
  });

  it("cf-connecting-ip with a list value is rejected, not split", () => {
    expect(getClientIp(h({ "cf-connecting-ip": "192.0.2.44, 10.0.0.1" }), "cf-connecting-ip")).toBeNull();
  });

  it("only reads the configured header", () => {
    expect(getClientIp(h({ "x-forwarded-for": "198.51.100.9" }), "cf-connecting-ip")).toBeNull();
    expect(getClientIp(h({ "cf-connecting-ip": "192.0.2.44" }), "x-vercel-forwarded-for")).toBeNull();
  });

  it("accepts the mode case-insensitively with whitespace", () => {
    expect(getClientIp(h({ "x-forwarded-for": "198.51.100.9" }), "  X-Forwarded-For ")).toBe("198.51.100.9");
  });

  it.each([undefined, "", "x-real-ip", "forwarded", "true", "x-client-ip"])("unset/untrusted mode %j → null", (mode) => {
    const headers = h({
      "x-forwarded-for": "198.51.100.9",
      "x-real-ip": "198.51.100.9",
      forwarded: "for=198.51.100.9",
      "x-client-ip": "198.51.100.9",
    });
    expect(getClientIp(headers, mode)).toBeNull();
  });

  it("defaults the mode to TRUSTED_IP_HEADER from the environment", () => {
    const headers = h({ "x-forwarded-for": "198.51.100.9" });
    vi.stubEnv("TRUSTED_IP_HEADER", "x-forwarded-for");
    expect(getClientIp(headers)).toBe("198.51.100.9");
    vi.stubEnv("TRUSTED_IP_HEADER", "");
    expect(getClientIp(headers)).toBeNull();
  });

  it("missing header → null", () => {
    expect(getClientIp(h({}), "x-forwarded-for")).toBeNull();
  });

  it.each([
    "",
    "unknown",
    "not-an-ip, 198.51.100.9",
    "198.51.100.9:443",
    "[2001:db8::1]",
    "999.1.1.1",
    "1.2.3",
    "2001:db8::g",
    ", 198.51.100.9",
  ])("invalid left-most value %j → null", (value) => {
    expect(getClientIp(h({ "x-forwarded-for": value }), "x-forwarded-for")).toBeNull();
  });
});

describe("normalizeIpSubject", () => {
  it("keeps IPv4 as-is", () => {
    expect(normalizeIpSubject(" 192.0.2.1 ")).toBe("192.0.2.1");
  });

  it.each([
    ["2001:db8:abcd:12:1:2:3:4", "2001:db8:abcd:12::/64"],
    ["2001:DB8:ABCD:0012:ffff:ffff:ffff:ffff", "2001:db8:abcd:12::/64"],
    ["2001:db8::1", "2001:db8:0:0::/64"],
    ["2001:db8:1:2::", "2001:db8:1:2::/64"],
    ["::1", "0:0:0:0::/64"],
    ["::", "0:0:0:0::/64"],
    ["1:2:3:4:5:6:7::", "1:2:3:4::/64"],
    ["fe80::1%eth0", "fe80:0:0:0::/64"],
    ["fe80::abcd%25", "fe80:0:0:0::/64"],
    ["64:ff9b::192.0.2.1", "64:ff9b:0:0::/64"],
  ])("reduces IPv6 %j to its /64 %j", (raw, expected) => {
    expect(normalizeIpSubject(raw)).toBe(expected);
  });

  it("gives every address in the same /64 the same subject", () => {
    expect(normalizeIpSubject("2001:db8:1:2::a")).toBe(normalizeIpSubject("2001:0db8:0001:0002:ffff::1"));
    expect(normalizeIpSubject("2001:db8:1:2::a")).not.toBe(normalizeIpSubject("2001:db8:1:3::a"));
  });

  it.each([
    ["::ffff:192.0.2.1", "192.0.2.1"],
    ["::FFFF:192.0.2.1", "192.0.2.1"],
    ["::ffff:c000:0201", "192.0.2.1"],
    ["0:0:0:0:0:ffff:203.0.113.5", "203.0.113.5"],
  ])("treats IPv4-mapped %j as IPv4 %j", (raw, expected) => {
    expect(normalizeIpSubject(raw)).toBe(expected);
  });

  it("maps IPv4-mapped and plain IPv4 to the same subject", () => {
    expect(normalizeIpSubject("::ffff:198.51.100.9")).toBe(normalizeIpSubject("198.51.100.9"));
  });

  it.each(["", "   ", "abc", "1.2.3.4.5", "12345::", "1::2::3", "2001:db8::1/64"])("rejects %j", (raw) => {
    expect(normalizeIpSubject(raw)).toBeNull();
  });
});

describe("readClientIp", () => {
  it("reads the trusted header from next/headers", async () => {
    vi.stubEnv("TRUSTED_IP_HEADER", "x-vercel-forwarded-for");
    headersMock.mockResolvedValue(h({ "x-vercel-forwarded-for": "2001:db8:5:6::9, 10.0.0.1" }));
    await expect(readClientIp()).resolves.toBe("2001:db8:5:6::/64");
  });

  it("returns null when TRUSTED_IP_HEADER is unset", async () => {
    vi.stubEnv("TRUSTED_IP_HEADER", undefined);
    headersMock.mockResolvedValue(h({ "x-forwarded-for": "198.51.100.9" }));
    await expect(readClientIp()).resolves.toBeNull();
  });
});
